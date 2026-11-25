"""Find logical read windows in separable Triton pointer expressions."""

from dataclasses import dataclass
from functools import cache


_MAX_COORDINATE = (1 << 53) - 1
_FIXED = (0, 0, 0)


def _safe_integer(value):
    return type(value) is int and -_MAX_COORDINATE <= value <= _MAX_COORDINATE


@dataclass(frozen=True)
class _Index:
    start: int
    program_steps: tuple = _FIXED
    arange: str | None = None

    @property
    def constant(self):
        return self.arange is None and self.program_steps == _FIXED


def _checked_index(start, program_steps, arange=None):
    if _safe_integer(start) and all(_safe_integer(step) for step in program_steps):
        return _Index(start, program_steps, arange)
    return None


def _non_overlapping_axes(axes):
    # Ignore overlapping address patterns. Either logical axis may be contiguous.
    for fast, slow in (axes, axes[::-1]):
        if fast['stride'] == 1 and fast['length'] <= slow['stride']:
            return True
    return False


def infer_read_blocks(nodes, masks):
    lookup = {node['id']: node for node in nodes}

    def unalias(node):
        while node['op'] == 'alias':
            node = lookup[node['inputs'][0]]
        return node

    @cache
    def index(node_id):
        node = unalias(lookup[node_id])
        op, attrs, inputs = node['op'], node['attrs'], node['inputs']
        if node['status'] == 'unsupported' or attrs.get('opaque_pointer'):
            return None
        if op == 'program_id':
            return _Index(0, tuple(int(axis == attrs['axis']) for axis in range(3)))
        operands = [index(item) for item in inputs]
        if any(item is None for item in operands):
            return None
        if op == 'arange':
            if _safe_integer(attrs.get('start')) and _safe_integer(attrs.get('end')) and all(item.constant for item in operands):
                return _Index(attrs['start'], arange=node['id'])
            return None
        if op in ('add', 'sub'):
            left, right = operands
            if right.arange and (left.arange or op == 'sub'):
                return None
            sign = -1 if op == 'sub' else 1
            steps = tuple(a + sign * b for a, b in zip(left.program_steps, right.program_steps))
            return _checked_index(left.start + sign * right.start, steps, left.arange or right.arange)
        if op == 'mult':
            left, right = operands
            if right.constant:
                left, right = right, left
            if left.constant and right.arange is None:
                return _checked_index(left.start * right.start, tuple(left.start * step for step in right.program_steps))
            return None
        value = attrs.get('value')
        if not node['shape'] and _safe_integer(value) and all(item.constant for item in operands):
            return _Index(value)
        return None

    @cache
    def pointer_parts(node_id):
        node = unalias(lookup[node_id])
        if node['status'] == 'unsupported':
            return None
        if node['attrs'].get('opaque_pointer') and not node['shape']:
            return node, ()
        if node['op'] == 'add':
            left, right = node['inputs']
            lhs, rhs = pointer_parts(left), pointer_parts(right)
            if lhs and not rhs:
                return lhs[0], (*lhs[1], right)
            if rhs and not lhs:
                return rhs[0], (*rhs[1], left)
        return None

    def dimension(term_id, rank):
        term = unalias(lookup[term_id])
        stride = 1
        if term['op'] == 'mult':
            left, right = term['inputs']
            for scale_id, vector_id in ((left, right), (right, left)):
                scale = index(scale_id)
                if scale and scale.constant and scale.start > 0:
                    stride = scale.start
                    term = unalias(lookup[vector_id])
                    break
            else:
                return None
        axis = 0
        if rank == 2:
            axes = term['attrs'].get('axes')
            if term['op'] != 'expand_dims' or axes not in ([0], [1]):
                return None
            axis = 1 - axes[0]
            term = unalias(lookup[term['inputs'][0]])
        value = index(term['id'])
        if value is None or value.arange is None or len(term['shape']) != 1 or not _safe_integer(term['shape'][0]):
            return None
        return axis, term['id'], {
            'start': value.start, 'length': term['shape'][0], 'stride': stride,
            'program_steps': value.program_steps, 'arange_node': value.arange,
        }

    blocks = []
    for node in nodes:
        rank = len(node['shape'])
        if node['op'] != 'load' or node['status'] == 'unsupported' or rank not in (1, 2):
            continue
        pointer_id = node['inputs'][0]
        try:
            parts = pointer_parts(pointer_id)
            if parts is None:
                continue
            base, terms = parts
            if rank == 2 and len(terms) == 1:
                summed = unalias(lookup[terms[0]])
                if summed['op'] == 'add':
                    terms = summed['inputs']
            if len(terms) != rank:
                continue
            dimensions = [dimension(term, rank) for term in terms]
        except RecursionError:
            continue
        if any(item is None for item in dimensions) or {item[0] for item in dimensions} != set(range(rank)):
            continue
        axes = []
        for axis, index_id, data in sorted(dimensions):
            if data['length'] != node['shape'][axis]:
                break
            limits = [limit for bound_id, bound_axis, limit in masks.get(node['id'], ())
                      if unalias(lookup[bound_id])['id'] == index_id
                      and (bound_axis if bound_axis >= 0 else rank + bound_axis) == axis
                      and _safe_integer(limit)]
            if limits:
                data['limit'] = min(limits)
            axes.append(data)
        if len(axes) != rank:
            continue
        if rank == 2 and not _non_overlapping_axes(axes):
            continue
        related = {node['id']}
        pending = [pointer_id]
        while pending:
            item = lookup[pending.pop()]
            if item['id'] not in related and item['shape']:
                related.add(item['id'])
                pending.extend(item['inputs'])
        blocks.append({
            'node_id': node['id'], 'pointer': base['name'], 'axes': axes,
            'related_nodes': sorted(related),
        })
    return blocks
