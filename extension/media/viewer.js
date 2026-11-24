/* Original logical-coordinate viewer. No kernel values are evaluated here. */
(() => {
  'use strict';
  const vscode = acquireVsCodeApi();
  const {operationNodes, operationId, contextInputs} = TileTraceOperations;
  const root = document.getElementById('app');
  let state = {stale:true,version:0,generation:0};
  let inspection = null;
  let outputIndex = null;
  let inspectionSequence = 0;
  let pendingInspection = null;
  let localError = '';
  const slices = new Map();
  const simpleSlices = new Map();
  let simpleMode = false;
  const drafts = new Map();
  const remembered = vscode.getState() || {};
  const readingPositions = new Map();
  const consumerGraphs = new WeakMap();
  let flowLayoutFrame=null;
  const flowObserver=typeof ResizeObserver==='function'?new ResizeObserver(()=>queueFlowLayout()):null;
  let stepListVisible=false;
  let renderedFile = null;
  let renderedStale = false;
  let interactedWhileStale = false;
  const markStaleInteraction=()=>{if(renderedStale)interactedWhileStale=true;};
  // Restoring focus is not user activity. Only explicit interaction can replace
  // the last full-view viewport while the loading layout is temporarily short.
  for(const event of ['pointerdown','keydown','wheel','input','change'])root.addEventListener(event,markStaleInteraction,{capture:true,passive:event==='wheel'});
  const post = (type, data = {}) => vscode.postMessage({type,generation:state.generation,...data});
  const el = (tag, text, className) => {
    const element = document.createElement(tag);
    if(text !== undefined) element.textContent = String(text);
    if(className) element.className = className;
    return element;
  };
  const button = (text, action, className = '') => {
    const b = el('button',text,className); b.type='button'; b.addEventListener('click',action); return b;
  };
  const shapeText = node => node.shape.length ? '['+node.shape.join(', ')+']' : '[] · 标量';
  const coordText = index => '['+index.join(', ')+']';
  const loopText = node => (node.attrs?.loops||[]).map(loop=>`${loop.variable}=${loop.value}`).join(' · ');
  function section(title) {const box=el('section',undefined,'section');box.append(el('h2',title));return box;}
  function disclosure(title,key,className) {
    const details=el('details',undefined,className);
    details.dataset.disclosure=key;
    details.append(el('summary',title));
    return details;
  }
  function selected() {
    const nodes=state.analysis?.nodes??[];
    const id=state.show_all?state.selected:operationId(nodes,state.selected);
    return nodes.find(node=>node.id===id);
  }

  function operationDetails(node, nodes) {
    const fields=[];
    const display=value=>value===undefined||value===null?'未知':typeof value==='string'?value:JSON.stringify(value);
    const scalar=input=>{
      if(!input)return '未知';
      if(Object.hasOwn(input.attrs,'value'))return input.op==='constant'?display(input.attrs.value):`${input.name} = ${display(input.attrs.value)}`;
      return `${input.attrs.symbol||input.name}（符号）`;
    };
    const context=contextInputs(node,nodes);
    if(loopText(node))fields.push(['循环分块',loopText(node)]);
    if(node.op==='arange') {
      const inputs=node.inputs.map(id=>nodes.find(n=>n.id===id));
      fields.push(['起点',inputs[0]?scalar(inputs[0]):display(node.attrs.start)],['终点',inputs[1]?scalar(inputs[1]):display(node.attrs.end)],['长度',display(node.shape[0])]);
    } else {
      for(const input of context)fields.push([input.op==='constant'?'常量':input.name,scalar(input)]);
      for(const [key,label] of [['axes','轴'],['permutation','轴排列'],['keep_dims','保留归约轴'],['can_reorder','允许重排'],['fill_value','静态填充值'],['contraction','矩阵乘法归约长度'],['target_dtype','目标类型']]) {
        if(Object.hasOwn(node.attrs,key))fields.push([label,display(node.attrs[key])]);
      }
    }
    if(!fields.length)return null;
    const box=disclosure('参数与属性',`operation:${node.id}`,'operation-details');
    const list=el('dl');
    for(const [label,value] of fields)list.append(el('dt',label),el('dd',value));
    box.append(list);return box;
  }
  function draft() {
    const key=state.file||'';
    if(!drafts.has(key)) drafts.set(key,remembered[key] || {
      parameters:JSON.stringify(state.parameters||{},null,2),
      input_shapes:JSON.stringify(state.input_shapes||{},null,2),
      program_ids:JSON.stringify(state.program_ids||[])
    });
    return drafts.get(key);
  }
  function parameters() {
    const details=disclosure('分析参数 · JSON','parameters','parameters');
    details.open=!!state.analysis?.missing_parameters.length;
    const fields=draft();
    for(const [key,label] of [['parameters','constexpr / 标量参数'],['input_shapes','输入形状（可选）'],['program_ids','program ID（可选）']]){
      const wrapper=el('label',undefined,'field');wrapper.append(el('span',label));
      const input=el('textarea');input.value=fields[key];input.rows=key==='program_ids'?1:3;input.spellcheck=false;input.setAttribute('aria-label',label);
      input.addEventListener('input',()=>{fields[key]=input.value;remembered[state.file||'']={...fields};vscode.setState(remembered);});wrapper.append(input);details.append(wrapper);
    }
    if(localError){
      const error=el('p',localError,'error');error.setAttribute('role','alert');details.append(error);
    }
    details.append(button('应用参数并重新分析',()=>{
      try {
        const options={kernel:state.analysis?.kernel||undefined,parameters:JSON.parse(fields.parameters),input_shapes:JSON.parse(fields.input_shapes),program_ids:JSON.parse(fields.program_ids)};
        localError='';inspection=null;outputIndex=null;pendingInspection=null;post('applyParameters',{options});
      } catch(error) {localError='JSON 格式无效：'+error.message;render();}
    },'primary'));
    return details;
  }
  function focusParameters(details) {
    details.open=true;
    details.querySelector('textarea')?.focus({preventScroll:true});
    details.scrollIntoView?.({block:'nearest'});
  }
  function sliceFor(node) {
    const active=simpleMode?simpleSlices:slices;
    if(!active.has(node.id)) {
      const previous=simpleMode?slices.get(node.id):null;
      active.set(node.id,{prefix:previous?[...previous.prefix]:node.shape.slice(0,-2).map(()=>0),row:previous?.row||0,col:previous?.col||0,expanded:previous?.expanded||false,detail:null});
    }
    return active.get(node.id);
  }
  function numericControl(label,axis,value,max,change,output) {
    const wrapper=el('label',undefined,'slice-control');wrapper.append(el('span',label));
    const input=el('input');input.type='number';input.min='0';input.max=String(max);input.step='1';input.value=String(value);input.dataset.axis=String(axis);input.setAttribute('aria-label',label);
    input.addEventListener('change',()=>{const n=Number(input.value);if(!Number.isSafeInteger(n)||n<0||n>max){input.value=String(value);return;}if(output){pendingInspection=null;outputIndex=null;inspection=null;}change(n);render();});
    wrapper.append(input);return wrapper;
  }
  function vectorAxis(node) {
    // Rank-one tensors have no inherent row/column direction. Use actual
    // new-axis consumers to choose a presentation, while preserving shape.
    const nodes=state.analysis?.nodes||[];
    if(!consumerGraphs.has(nodes)) {
      const graph=new Map();
      for(const use of nodes)for(const id of use.inputs){if(!graph.has(id))graph.set(id,[]);graph.get(id).push(use);}
      consumerGraphs.set(nodes,graph);
    }
    const consumers=consumerGraphs.get(nodes);
    const expansionAxis=(use,id)=>{
      if(use.status==='unsupported'||use.attrs?.mapping!=='expand_dims'||!use.inputs.includes(id)||use.shape.length!==2)return null;
      const axes=use.attrs.axes;
      return axes?.length===1&&axes[0]===1?0:axes?.length===1&&axes[0]===0?1:null;
    };
    const current=selected();const contextual=current&&expansionAxis(current,node.id);
    if(contextual===0||contextual===1)return contextual;
    const axes=new Set(),seen=new Set(),queue=[node];
    for(let i=0;i<queue.length;i++) {
      const tensor=queue[i];if(seen.has(tensor.id))continue;seen.add(tensor.id);
      for(const use of consumers.get(tensor.id)||[]) {
        if(use.status==='unsupported')continue;
        const axis=expansionAxis(use,tensor.id);if(axis!==null)axes.add(axis);
        if(use.shape.length===1&&use.shape[0]===tensor.shape[0]&&['identity','broadcast'].includes(use.attrs?.mapping)&&!seen.has(use.id))queue.push(use);
      }
    }
    return axes.size===1?[...axes][0]:null;
  }
  function axisCoordinates(length,start,limit,overview) {
    if(overview&&length>8)return [0,1,2,null,length-3,length-2,length-1];
    return Array.from({length:Math.min(length-start,limit)},(_,i)=>start+i);
  }
  function gridLayout(node) {
    const rank=node.shape.length,axis=rank===1?vectorAxis(node):null,vertical=axis===0;
    const rows=rank>=2?node.shape[rank-2]:vertical?node.shape[0]:1;
    const cols=rank>=2?node.shape[rank-1]:rank===1&&!vertical?node.shape[0]:1;
    const slice=sliceFor(node);
    const maxRows=vertical||cols===1?16:8,maxCols=16;
    const factor=length=>simpleMode&&!slice.detail&&length>4&&length%4===0?4:1;
    const rowStep=factor(rows),colStep=factor(cols),rowCount=rows/rowStep,colCount=cols/colStep;
    let startRow=slice.expanded?Math.floor(Math.min(rank===1?(vertical?slice.col:0):slice.row,rows-1)/rowStep)*rowStep:0;
    let startCol=slice.expanded?Math.floor(Math.min(vertical?0:slice.col,cols-1)/colStep)*colStep:0;
    if(rowStep>1&&rowCount<=maxRows)startRow=0;
    if(colStep>1&&colCount<=maxCols)startCol=0;
    let rowIndices,colIndices;
    if(slice.detail) {
      startRow=rank>=2?slice.detail.start[rank-2]:vertical?slice.detail.start[0]:0;
      startCol=rank>=2?slice.detail.start[rank-1]:rank===1&&!vertical?slice.detail.start[0]:0;
      const endRow=rank>=2?slice.detail.end[rank-2]:vertical?slice.detail.end[0]:0;
      const endCol=rank>=2?slice.detail.end[rank-1]:rank===1&&!vertical?slice.detail.end[0]:0;
      rowIndices=axisCoordinates(endRow+1,startRow,maxRows,false);colIndices=axisCoordinates(endCol+1,startCol,maxCols,false);
    } else {
      rowIndices=axisCoordinates(rowCount,startRow/rowStep,maxRows,!slice.expanded).map(i=>i===null?null:i*rowStep);
      colIndices=axisCoordinates(colCount,startCol/colStep,maxCols,!slice.expanded).map(i=>i===null?null:i*colStep);
    }
    return {axis,vertical,rows,cols,maxRows,maxCols,startRow,startCol,rowStep,colStep,rowCount,colCount,rowIndices,colIndices,detail:slice.detail,grouped:rowStep>1||colStep>1};
  }
  const axisLabel=(index,step)=>String(index/step);
  const containsCoordinate=(index,start,end)=>index.length===start.length&&index.every((value,axis)=>value>=start[axis]&&value<=end[axis]);
  function groupDetail(node,output,detail,occurrence=0) {
    const previous=sliceFor(node).detail;sliceFor(node).detail=detail;
    if(output){pendingInspection=null;outputIndex=null;inspection=null;}
    render();
    const card=Array.from(root.querySelectorAll('[data-card-node]')).find(candidate=>candidate.dataset.cardNode===node.id&&candidate.dataset.cardRole===(output?'output':'input')&&candidate.dataset.cardOccurrence===String(occurrence));
    const focus=detail?card?.querySelector('[data-role="back-to-simple"]'):Array.from(card?.querySelectorAll('.group-cell')||[]).find(cell=>cell.dataset.groupStart===JSON.stringify(previous?.start));
    focus?.focus({preventScroll:true});
  }
  function gridMode(node,output,expanded,axis=null,start=0) {
    const slice=sliceFor(node);slice.expanded=expanded;
    if(axis!==null){if(axis===node.shape.length-1)slice.col=start;else slice.row=start;}
    if(output){pendingInspection=null;outputIndex=null;inspection=null;}
    render();
  }
  function ellipsis(node,output,axis,length,key,step=1) {
    const gap=button('…',event=>{
      const owner=event.currentTarget.closest('[data-card-node]');const occurrence=owner.dataset.cardOccurrence;
      gridMode(node,output,true,axis,3*step);
      const card=Array.from(root.querySelectorAll('[data-card-node]')).find(candidate=>candidate.dataset.cardNode===node.id&&candidate.dataset.cardRole===(output?'output':'input')&&candidate.dataset.cardOccurrence===occurrence);
      card?.querySelector('[data-role="toggle-grid-window"]')?.focus({preventScroll:true});
    },'axis-ellipsis');
    gap.dataset.axis=String(axis);gap.dataset.gapKey=key;
    const label=`轴 ${axis} 的 ${3*step}–${length-3*step-1} 坐标已省略，点击查看中间窗口`;
    gap.title=label;gap.setAttribute('aria-label',label);return gap;
  }
  function tensorCard(node,output,occurrence=0) {
    const card=el('article',undefined,'tensor-card');card.dataset.cardNode=node.id;
    card.dataset.cardRole=output?'output':'input';card.dataset.cardOccurrence=String(occurrence);
    const header=el('div',undefined,'card-title');const shapeBadge=el('span',shapeText(node),'pill');
    header.append(el(output?'h2':'strong',output?'输出':node.name||node.op),shapeBadge);card.append(header);
    const status={resolved:'已解析',symbolic:'符号推断',unsupported:'未支持'}[node.status];
    card.append(el('p',[output?'':node.op,node.dtype,status].filter(Boolean).join(' · '),'muted'));
    if(node.status==='unsupported'){card.append(el('p','此操作未获支持，无法证明精确坐标映射。','notice'));return card;}
    if(!node.shape.every(dim=>Number.isSafeInteger(dim)&&dim>=0)) {card.append(el('p','符号形状：补充参数后可显示逻辑坐标。','notice'));return card;}
    const shape=node.shape;const rank=shape.length;const slice=sliceFor(node);
    let total=1n;for(const size of shape)total*=BigInt(size);
    if(total===0n){card.append(el('p','空张量，没有可选坐标。','notice'));return card;}
    const layout=gridLayout(node);const {rows,cols,maxRows,maxCols,vertical,rowStep,colStep,rowCount,colCount,grouped,detail}=layout;
    shapeBadge.title=rank===0?'标量，shape []':rank===1?(layout.axis===0?'一维索引，对应矩阵行轴，纵向展示；shape '+shapeText(node):layout.axis===1?'一维索引，对应矩阵列轴，横向展示；shape '+shapeText(node):'一维向量，未指定行列方向；shape '+shapeText(node)):`当前切片包含 ${rows} 行 × ${cols} 列；展开窗口最多展示 ${maxRows} 行 × ${maxCols} 列。`;
    if(grouped)shapeBadge.title+=` 简约：${rank===1?Math.max(rowCount,colCount):rowCount+' × '+colCount} 个坐标组，原始 shape 不变。`;
    const controls=el('div',undefined,'slice-controls');
    if(detail){const back=button('返回简约',()=>groupDetail(node,output,null,occurrence));back.dataset.role='back-to-simple';controls.append(back);}
    else if(rowCount>8||colCount>8){const toggle=button(slice.expanded?'收起为首尾概览':'展开显示窗口',()=>gridMode(node,output,!slice.expanded));toggle.dataset.role='toggle-grid-window';toggle.setAttribute('aria-expanded',String(slice.expanded));toggle.title='长度超过 8 时概览保留首尾各 3 项；展开查看中间坐标。';controls.append(toggle);}
    if(rank>2){controls.title='前缀轴选择一个切片；网格对应最后两轴。';for(let axis=0;axis<rank-2;axis++)controls.append(numericControl(`轴 ${axis}`,axis,slice.prefix[axis],shape[axis]-1,n=>{slice.prefix[axis]=n;slice.detail=null;},output));}
    if(!detail&&slice.expanded&&rowCount>maxRows)controls.append(numericControl(`轴 ${vertical?0:rank-2} 起点`,vertical?0:rank-2,layout.startRow,rows-1,n=>{if(vertical)slice.col=Math.floor(n/rowStep)*rowStep;else slice.row=Math.floor(n/rowStep)*rowStep;},output));
    if(!detail&&slice.expanded&&colCount>maxCols)controls.append(numericControl(`轴 ${rank-1} 起点`,rank-1,layout.startCol,cols-1,n=>{slice.col=Math.floor(n/colStep)*colStep;},output));
    if(controls.childNodes.length)card.append(controls);
    const table=el('table',undefined,'index-grid');table.setAttribute('aria-label',`${node.name} 逻辑坐标`);
    const head=el('thead');const heading=el('tr');
    const corner=el('th',rank>=2?'行 / 列':'坐标');
    if(rank>=2)corner.title=`行轴 ${rank-2} · 列轴 ${rank-1}`;
    heading.append(corner);
    const {rowIndices,colIndices}=layout;
    for(const col of colIndices){const th=el('th');th.scope='col';if(col===null&&rank>=2)th.append(ellipsis(node,output,rank-1,cols,'header-col',colStep));else th.textContent=col===null?'…':vertical?'索引':rank?axisLabel(col,colStep):'标量';heading.append(th);}head.append(heading);table.append(head);
    const matrix=rank>=2&&!grouped;
    const selectedIndex=output&&outputIndex?JSON.stringify(outputIndex):null;
    const origin=!output&&inspection?.status==='exact'?inspection.origins.find(item=>item.node_id===node.id):undefined;
    const body=el('tbody');let displayed=0;
    for(const row of rowIndices){
      const tr=el('tr');const rowHeader=el('th',row===null?'…':rank>=2||vertical?axisLabel(row,rowStep):'—');rowHeader.scope='row';tr.append(rowHeader);
      if(row===null){const td=el('td');td.colSpan=colIndices.length;td.append(ellipsis(node,output,vertical?0:rank-2,rows,'row',rowStep));tr.append(td);body.append(tr);continue;}
      for(const col of colIndices){
        if(col===null){const td=el('td');td.append(ellipsis(node,output,rank-1,cols,`col:${row}`,colStep));tr.append(td);continue;}
        const index=rank===0?[]:rank===1?[vertical?row:col]:[...slice.prefix,row,col];
        const end=[...index];if(rank>=2)end[rank-2]+=rowStep-1;if(rank>=1)end[rank-1]+=(rank===1&&vertical?rowStep:colStep)-1;
        const label=grouped?(rank===1?axisLabel(index[0],vertical?rowStep:colStep):`${axisLabel(row,rowStep)},${axisLabel(col,colStep)}`):rank===0?'·':rank===1?String(index[0]):`${index[rank-2]},${index[rank-1]}`;
        const td=el('td');const cell=button(matrix?undefined:label,()=>{
          if(grouped){groupDetail(node,output,{start:[...index],end:[...end]},occurrence);return;}
          if(!output)return;outputIndex=index;inspection=null;
          const request_id=String(++inspectionSequence);pendingInspection={request_id,generation:state.generation,node_id:node.id,index};
          post('inspectIndex',{node_id:node.id,index,request_id});render();
        },matrix?'cell matrix-cell':'cell');
        if(matrix)cell.append(el('span',label,'cell-coordinate'));
        cell.dataset.node=node.id;if(grouped){cell.classList.add('group-cell');cell.dataset.groupStart=JSON.stringify(index);cell.dataset.groupEnd=JSON.stringify(end);}else cell.dataset.index=JSON.stringify(index);if(output)cell.dataset.output='true';
        cell.title=grouped?`${node.name} ${coordText(index)}–${coordText(end)} · 坐标组，点击查看真实坐标`:`${node.name} ${coordText(index)} · 逻辑坐标，非数值`;cell.setAttribute('aria-label',cell.title);cell.disabled=!output&&!grouped;
        if(output&&!grouped){
          const active=selectedIndex===cell.dataset.index;
          cell.classList.toggle('selected-cell',active);
          cell.setAttribute('aria-pressed',String(active));
        }
        if(origin?.indices.some(coordinate=>containsCoordinate(coordinate,index,end)))cell.classList.add('origin');
        td.append(cell);tr.append(td);displayed++;
      }
      body.append(tr);
    }
    table.append(body);const scroll=el('div',undefined,'grid-scroll');scroll.title=grouped?`显示 ${displayed} 个坐标组 / 原始 ${total.toString()} 个逻辑坐标；点击分组查看真实坐标。`:`显示 ${displayed} 个逻辑坐标 / 总计 ${total.toString()} 个${rank>2?'（当前切片）':''}；每卡最多 128 个。`;
    table.setAttribute('aria-label',`${node.name} 逻辑坐标；${shapeBadge.title} ${scroll.title}${rank>2?' '+controls.title:''}`);
    scroll.append(table);card.append(scroll);
    return card;
  }
  function originPreview(origin,node) {
    const {indices,truncated}=origin;
    if(!indices.length)return '无输入坐标';
    const first=indices[0],last=indices.at(-1);
    if(indices.length===1)return coordText(first);
    const axes=first.map((value,axis)=>indices.some(index=>index[axis]!==value)?axis:-1).filter(axis=>axis>=0);
    if(!truncated&&axes.length===1){
      const axis=axes[0];
      if(indices.every((index,offset)=>index[axis]===first[axis]+offset)){
        const parts=[...first];
        parts[axis]=first[axis]===0&&indices.length===node?.shape[axis]?':':`${first[axis]}–${last[axis]}`;
        return coordText(parts);
      }
    }
    return `${coordText(first)} … ${coordText(last)}`;
  }
  function mapping(hasInputs) {
    const box=el('div',undefined,'mapping');
    const message=(text,className)=>{
      const status=el('p',text,className);status.setAttribute('role','status');box.append(status);
    };
    if(!inspection){
      const text=outputIndex?`正在查询输出 ${coordText(outputIndex)}…`:hasInputs?'点击输出格查看对应的输入坐标。':'此操作没有直接输入。';
      message(text,'muted');return box;
    }
    if(inspection.status!=='exact'){box.append(el('p',`坐标映射不可用：${inspection.message||'符号参数、未知重排或未支持操作无法证明映射。'}`,'notice'));return box;}
    message(`输出 ${coordText(inspection.output_index||[])} → 直接输入坐标`,'mapping-current');
    const current=selected();const folded=new Set(state.show_all||!current?[]:contextInputs(current,state.analysis.nodes).map(input=>input.id));
    for(const [ordinal,origin] of inspection.origins.entries()){
      const n=state.analysis.nodes.find(n=>n.id===origin.node_id);
      const line=el('div',undefined,'origin-description');line.dataset.originNode=origin.node_id;
      const summary=el('div',undefined,'origin-summary');
      summary.append(el('strong',n?.name||origin.node_id),el('code',originPreview(origin,n)));
      line.append(summary);
      const detail=disclosure('坐标明细',`origin:${current?.id}:${origin.node_id}:${ordinal}`,'origin-details');
      const coordinates=origin.indices.map(coordText);const compact=coordinates.length>8?[...coordinates.slice(0,3),'…',...coordinates.slice(-3)]:coordinates;
      detail.append(el('p',compact.join(' · ')||'无输入坐标','coordinates'));
      detail.append(el('p',`返回 ${origin.indices.length} / 总计 ${origin.total}${origin.truncated?' · 来源枚举已截断':''}${origin.indices.length>8?' · 文本只显示返回坐标的首尾各 3 项':''}`,'muted'));
      if(folded.has(origin.node_id)){line.append(el('p','该标量输入已显示在参数与属性中。','muted'),detail);box.append(line);continue;}
      if(n){const slice=sliceFor(n);const rank=n.shape.length;const layout=gridLayout(n);const visible=origin.indices.filter(index=>{
        if(rank===0)return true;
        if(rank>2&&!slice.prefix.every((v,i)=>v===index[i]))return false;
        const row=rank>=2?index[rank-2]:layout.vertical?index[0]:0;const col=layout.vertical?0:index[rank-1];
        return layout.rowIndices.some(start=>start!==null&&row>=start&&row<start+layout.rowStep)&&layout.colIndices.some(start=>start!==null&&col>=start&&col<start+layout.colStep);
      }).length;line.append(el('p',`当前${layout.grouped?'简约网格覆盖':'网格高亮'} ${visible} / ${origin.indices.length}${visible<origin.indices.length?' · 其余在显示范围之外':''}`,'muted'));}
      if(n&&origin.indices.length){const jump=button('定位首个来源坐标',()=>{const index=origin.indices[0];const slice=sliceFor(n);slice.detail=null;slice.expanded=true;slice.prefix=index.slice(0,-2);slice.row=index.length>=2?index[index.length-2]:0;slice.col=index.length?index[index.length-1]:0;render();});jump.dataset.originTarget=origin.node_id;line.append(jump);}
      line.append(detail);box.append(line);
    }
    if(!inspection.origins.length)box.append(el('p','此节点没有直接输入来源。','muted'));
    return box;
  }
  function setStepListOpen(nav,open) {
    nav.dataset.expanded=String(open);
    nav.querySelector('.steps-toggle').setAttribute('aria-expanded',String(open));
  }
  function stepNavigation(steps,node) {
    const nav=el('nav',undefined,'step-navigation');
    nav.setAttribute('aria-label','张量步骤');
    const position=steps.findIndex(item=>item.id===node?.id);
    const toolbar=el('div',undefined,'step-toolbar');
    const change=delta=>{const next=steps[position+delta];if(next)post('selectNode',{node_id:next.id});};
    const prev=button('←',()=>change(-1));
    prev.append(el('span',' 上一步','step-button-label'));prev.setAttribute('aria-label','上一步');
    const next=button(undefined,()=>change(1));
    next.append(el('span','下一步 ','step-button-label'),el('span','→'));next.setAttribute('aria-label','下一步');
    prev.disabled=position<=0;
    next.disabled=position<0||position>=steps.length-1;
    const toggleSteps=button('步骤列表',()=>{
      setStepListOpen(nav,nav.dataset.expanded!=='true');
      fitFlowLayout();
    },'steps-toggle');
    toggleSteps.setAttribute('aria-controls','tiletrace-step-browser');
    toolbar.append(prev,el('span',`${position+1} / ${steps.length}`,'step-position'),next,toggleSteps);
    nav.append(toolbar);
    setStepListOpen(nav,false);

    const browser=el('div',undefined,'step-browser');browser.id='tiletrace-step-browser';
    const visibility=el('label',undefined,'visibility-control');
    const toggle=el('input');toggle.type='checkbox';toggle.checked=!!state.show_all;toggle.dataset.role='show-all-nodes';
    toggle.addEventListener('change',()=>{
      pendingInspection=null;inspection=null;outputIndex=null;
      post('setNodeVisibility',{show_all:toggle.checked});
    });
    visibility.append(toggle,el('span','显示全部节点'));browser.append(visibility);
    const list=el('div',undefined,'operation-list');
    let group=list,previousLoop='';
    for(const item of steps){
      const loop=loopText(item);
      if(loop!==previousLoop){
        group=list;
        if(loop){
          group=el('div',undefined,'step-group');
          group.append(el('div',loop,'step-group-label'));list.append(group);
        }
        previousLoop=loop;
      }
      const name=item.name||item.op;
      const row=button(undefined,()=>post('selectNode',{node_id:item.id}),'operation');
      row.append(el('span',name,'step-name'),el('span',shapeText(item),'step-shape'));
      row.title=`${name} · ${item.op} ${shapeText(item)}${loop?' · '+loop:''}`;
      row.setAttribute('aria-label',row.title);
      row.dataset.node=item.id;
      row.classList.toggle('active',item.id===node?.id);
      row.setAttribute('aria-current',String(item.id===node?.id));
      group.append(row);
    }
    browser.append(list);nav.append(browser);return nav;
  }
  function revealCurrentStep(list=root.querySelector('.operation-list')) {
    const row=list?.querySelector('.operation.active');
    if(!row||!list.clientHeight)return;
    const top=list.getBoundingClientRect().top+list.clientTop;
    const bottom=top+list.clientHeight;
    const bounds=row.getBoundingClientRect();
    if(bounds.top<top)list.scrollTop+=bounds.top-top;
    else if(bounds.bottom>bottom)list.scrollTop+=bounds.bottom-bottom;
  }
  function viewKey(element) {
    if(!element)return null;
    const card=element.closest('[data-card-node]');
    const scope=card?`${card.dataset.cardRole}:${card.dataset.cardNode}:${card.dataset.cardOccurrence}`:'';
    if(element.matches('.operation-list'))return 'operations';
    if(element.matches('.expression'))return `expression:${element.dataset.ownerNode}`;
    if(element.matches('.grid-scroll'))return `grid:${scope}`;
    if(element.matches('.group-cell'))return `group:${scope}:${element.dataset.groupStart}`;
    if(element.matches('.cell'))return `cell:${scope}:${element.dataset.index}`;
    if(element.matches('.axis-ellipsis'))return `gap:${scope}:${element.dataset.gapKey}`;
    if(element.matches('[data-role="toggle-grid-window"]'))return `grid-mode:${scope}`;
    if(element.matches('[data-role="back-to-simple"]'))return `group-back:${scope}`;
    if(element.matches('.operation'))return `operation:${element.dataset.node}`;
    if(element.matches('textarea'))return `parameter:${element.getAttribute('aria-label')}`;
    if(element.matches('input[type="number"]'))return `slice:${scope}:${element.dataset.axis}:${element.getAttribute('aria-label')}`;
    if(element.matches('[data-role="show-all-nodes"]'))return 'visibility';
    if(element.matches('[data-role="simple-mode"]'))return 'simple-mode';
    if(element.matches('select[aria-label="Kernel"]'))return 'kernel';
    if(element.matches('summary')&&element.parentElement.dataset.disclosure)return `disclosure:${element.parentElement.dataset.disclosure}`;
    if(element.dataset.originTarget)return `origin:${element.dataset.originTarget}`;
    if(element.matches('button'))return `button:${element.textContent}`;
    return null;
  }
  function captureReadingPosition() {
    const scrolls=new Map();
    for(const element of root.querySelectorAll('.operation-list,.expression,.grid-scroll,textarea')) {
      const key=viewKey(element);
      if(key)scrolls.set(key,{top:element.scrollTop,left:element.scrollLeft,height:element.style.height,width:element.style.width});
    }
    const active=document.activeElement;
    const key=root.contains(active)&&document.hasFocus()?viewKey(active):null;
    const focus=key?{key}:null;
    if(focus&&active.tagName==='TEXTAREA')Object.assign(focus,{start:active.selectionStart,end:active.selectionEnd,direction:active.selectionDirection});
    const disclosures=new Map(Array.from(root.querySelectorAll('details[data-disclosure]'),details=>[details.dataset.disclosure,details.open]));
    const stepsOpen=root.querySelector('.step-navigation')?.dataset.expanded;
    return {x:window.scrollX,y:window.scrollY,scrolls,disclosures,stepsOpen,focus};
  }
  function restoreReadingPosition(position) {
    const elements=Array.from(root.querySelectorAll('button,input,textarea,select,summary,.operation-list,.expression,.grid-scroll'));
    const nav=root.querySelector('.step-navigation');
    if(nav&&position.stepsOpen!==undefined)setStepListOpen(nav,position.stepsOpen==='true');
    for(const details of root.querySelectorAll('details[data-disclosure]')){
      const open=position.disclosures?.get(details.dataset.disclosure);
      if(open!==undefined)details.open=open;
    }
    for(const element of elements) {
      const saved=position.scrolls?.get(viewKey(element));
      if(saved&&element.tagName==='TEXTAREA'){element.style.height=saved.height;element.style.width=saved.width;}
    }
    const focus=position.focus&&elements.find(element=>viewKey(element)===position.focus.key);
    if(focus){focus.focus({preventScroll:true});if(focus.tagName==='TEXTAREA'&&position.focus.start!==undefined)focus.setSelectionRange(position.focus.start,position.focus.end,position.focus.direction);}
    for(const element of elements) {
      const saved=position.scrolls?.get(viewKey(element));
      if(saved){element.scrollTop=saved.top;element.scrollLeft=saved.left;}
    }
    if(window.scrollX!==position.x||window.scrollY!==position.y)window.scrollTo(position.x,position.y);
  }
  function queueFlowLayout() {
    if(flowLayoutFrame!==null)return;
    if(typeof requestAnimationFrame!=='function'){fitFlowLayout();return;}
    flowLayoutFrame=requestAnimationFrame(()=>{flowLayoutFrame=null;fitFlowLayout();});
  }
  function fitFlowLayout() {
    const list=root.querySelector('.operation-list');
    if(list){
      const visible=list.clientHeight>0;
      if(visible&&!stepListVisible)revealCurrentStep(list);
      stepListVisible=visible;
    }
    const flow=root.querySelector('.flow');if(!flow)return;
    const input=flow.querySelector('.flow-inputs'),output=flow.querySelector('.flow-output');
    if(!input||!output)return;
    const available=flow.getBoundingClientRect().width;
    if(available<=0)return;
    const gap=parseFloat(getComputedStyle(flow).columnGap)||14;
    const needed=input.getBoundingClientRect().width+output.getBoundingClientRect().width+gap;
    const layout=Math.ceil(needed)<=available?'horizontal':'vertical';
    if(flow.dataset.layout!==layout)flow.dataset.layout=layout;
  }
  function observeFlowLayout() {
    flowObserver?.disconnect();fitFlowLayout();
    if(flowObserver){flowObserver.observe(root);for(const part of root.querySelectorAll('.flow-inputs,.flow-output'))flowObserver.observe(part);}
  }
  window.addEventListener('resize',fitFlowLayout);
  function render(followStep=false) {
    if(renderedFile!==null) {
      const current=captureReadingPosition();const saved=readingPositions.get(renderedFile);
      if(!renderedStale||!saved)readingPositions.set(renderedFile,current);
      else {
        // A loading placeholder clamps scroll to zero. Keep the last full-view
        // position unless the user is actively working in a surviving control.
        for(const [key,open] of current.disclosures)saved.disclosures.set(key,open);
        for(const [key,value] of current.scrolls)saved.scrolls.set(key,value);
        if(interactedWhileStale){saved.x=current.x;saved.y=current.y;saved.focus=current.focus;}
      }
    }
    const file=state.file||'';
    const position=readingPositions.get(file)??{x:0,y:0,scrolls:new Map()};
    const fragment=document.createDocumentFragment();
    renderContent(fragment);
    // Build the complete replacement off-page, then restore reading state.
    root.replaceChildren(fragment);
    restoreReadingPosition(position);
    observeFlowLayout();
    if(followStep)revealCurrentStep();
    renderedFile=file;renderedStale=!!state.stale;interactedWhileStale=false;
  }
  function panelHeader() {
    const header=el('header',undefined,'panel-header');
    const fileName=state.file?.split(/[\\/]/).at(-1)||'TileTrace';
    const file=el('h1',fileName,'file-name');file.title=state.file||'';
    header.append(file);
    const actions=el('div',undefined,'panel-actions');
    const kernels=state.analysis?.kernels||[];
    if(kernels.length>1){
      const label=el('label',undefined,'kernel-select');
      label.append(el('span','Kernel'));
      const select=el('select');select.setAttribute('aria-label','Kernel');
      for(const name of kernels){
        const option=el('option',name);option.value=name;option.selected=name===state.analysis.kernel;select.append(option);
      }
      select.addEventListener('change',()=>{
        try {
          const fields=draft();
          const options={kernel:select.value,parameters:JSON.parse(fields.parameters),input_shapes:JSON.parse(fields.input_shapes),program_ids:JSON.parse(fields.program_ids)};
          localError='';post('applyParameters',{options});
        } catch(error) {
          localError='JSON 格式无效：'+error.message;render();
          focusParameters(root.querySelector('.parameters'));
        }
      });
      label.append(select);actions.append(label);
    } else if(kernels.length===1){
      const kernel=el('code',kernels[0],'kernel-name');kernel.title=kernels[0];actions.append(kernel);
    }
    const display=el('label',undefined,'display-mode');const simple=el('input');simple.type='checkbox';simple.checked=simpleMode;simple.dataset.role='simple-mode';
    simple.addEventListener('change',()=>{simpleMode=simple.checked;pendingInspection=null;inspection=null;outputIndex=null;render();});
    display.title='大于 4 且能被 4 整除的行或列，每 4 个坐标合并显示；原始 shape 不变。';display.append(simple,el('span','简约'));actions.append(display);
    if(state.stale)actions.append(el('span',state.error?'分析不可用':'等待分析','status'));
    header.append(actions);return header;
  }
  function operationView(node,nodes) {
    const workspace=el('section',undefined,'workbench');
    workspace.setAttribute('aria-label','当前操作');
    const header=el('div',undefined,'operation-header');
    const expression=el('pre',state.expressions?.[node.id]||node.name||node.op,'expression');
    expression.dataset.ownerNode=node.id;
    const metadata=el('div',undefined,'operation-meta');
    metadata.append(el('code',node.op,'operator'));
    const loop=loopText(node);if(loop)metadata.append(el('span',loop,'muted'));
    metadata.append(button(`查看源码 · 第 ${node.source.start_line} 行`,()=>post('revealSource',{node_id:node.id}),'source-link'));
    header.append(expression,metadata);workspace.append(header);

    const hidden=new Set(state.show_all?[]:contextInputs(node,nodes).map(input=>input.id));
    const dataInputs=node.inputs.map(id=>nodes.find(item=>item.id===id)).filter(input=>input&&!hidden.has(input.id));
    const flow=el('div',undefined,'flow');
    flow.setAttribute('role','group');
    flow.setAttribute('aria-label',`输入经过 ${node.op} 得到输出`);
    const output=el('section',undefined,'flow-output');output.append(tensorCard(node,true));
    const inputs=section('直接来源');inputs.classList.add('flow-inputs');
    inputs.append(mapping(dataInputs.length>0||hidden.size>0));
    dataInputs.forEach((input,index)=>inputs.append(tensorCard(input,false,index)));
    if(!dataInputs.length&&hidden.size)inputs.append(el('p','标量输入列在参数与属性中。','muted'));
    flow.append(output,inputs);workspace.append(flow);
    const details=operationDetails(node,nodes);if(details)workspace.append(details);
    return workspace;
  }
  function renderContent(target) {
    target.append(panelHeader());
    const settings=el('div',undefined,'analysis-settings');
    const parametersPanel=parameters();settings.append(parametersPanel);
    if(state.error){const error=el('p',state.error,'error');error.setAttribute('role','alert');target.append(error);}
    if(state.stale){
      if(!state.error)target.append(el('p','源码或参数已变化，坐标映射已清除。等待当前版本分析完成。','notice'));
      target.append(settings);
      return;
    }
    const analysis=state.analysis;
    if(!analysis){target.append(settings);return;}
    if(analysis.missing_parameters.length){
      const missing=el('div',undefined,'notice analysis-notice');
      missing.append(el('span','待补参数：'+analysis.missing_parameters.join('、')),button('填写参数',()=>focusParameters(parametersPanel)));
      target.append(missing);
    }
    const secondary=analysis.diagnostics.filter(item=>item.severity!=='error');
    if(secondary.length){
      const diagnostics=disclosure(`诊断 · ${secondary.length}`,'diagnostics','diagnostics');
      for(const item of secondary)diagnostics.append(el('p',item.message,'diagnostic'));
      settings.append(diagnostics);
    }
    for(const item of analysis.diagnostics){
      if(item.severity==='error')target.append(el('p',item.message,'error'));
    }
    if(!analysis.nodes.length){
      target.append(el('p','没有可显示的操作。请查看诊断和分析参数。','notice'),settings);
      return;
    }
    const steps=operationNodes(analysis.nodes,!!state.show_all);
    const node=selected();
    const layout=el('div',undefined,'workspace');
    layout.append(stepNavigation(steps,node));
    if(node)layout.append(operationView(node,analysis.nodes));
    else layout.append(el('p','当前没有张量步骤。可在步骤列表中开启“显示全部节点”。','notice'));
    target.append(layout,settings);
  }
  window.addEventListener('message',event=>{
    const message=event.data;if(!message||typeof message!=='object')return;
    if(message.type==='state'){
      const next=message.state;
      const followStep=!next.stale&&(next.selected!==state.selected||next.file!==state.file||next.show_all!==state.show_all);
      if(next.file!==state.file||next.generation!==state.generation||next.version!==state.version){slices.clear();simpleSlices.clear();}
      if(next.stale||next.show_all!==state.show_all||next.file!==state.file||next.selected!==state.selected||next.generation!==state.generation||next.version!==state.version){inspection=null;outputIndex=null;pendingInspection=null;}
      state=next;render(followStep);
    } else if(message.type==='inspection'&&!state.stale){
      if(!pendingInspection||message.request_id!==pendingInspection.request_id||message.generation!==state.generation||message.generation!==pendingInspection.generation||message.node_id!==state.selected||message.node_id!==pendingInspection.node_id)return;
      if(message.inspection.node?.id!==state.selected||JSON.stringify(message.inspection.output_index)!==JSON.stringify(pendingInspection.index))return;
      pendingInspection=null;
      inspection=message.inspection;render();
    }
  });
  render();post('ready');
})();
