"""Internal JSON Lines worker for the VS Code extension."""

from __future__ import annotations

import json
import math
import sys

from .analyzer import analyze, inspect_transform


MAX_SOURCE_CHARACTERS = 1_000_000
MAX_REQUEST_CHARACTERS = 2_000_000


def dispatch(method: str, params: dict) -> dict:
    if not isinstance(params, dict):
        raise ValueError("params must be an object")
    if method == "analyze":
        allowed = {"source", "kernel", "parameters", "input_shapes", "program_ids", "document_id", "version"}
        if unknown := params.keys() - allowed:
            raise ValueError("Unknown analyze parameters: " + ", ".join(sorted(unknown)))
        source = params.get("source")
        if not isinstance(source, str):
            raise ValueError("source must be a string")
        if len(source) > MAX_SOURCE_CHARACTERS:
            raise ValueError("Source exceeds the one-million-character analysis limit")
        return analyze(**params)
    if method == "inspect":
        analysis = params.get("analysis")
        if not isinstance(analysis, dict):
            raise ValueError("Provide an analysis object")
        return inspect_transform(analysis, params["node_id"], params.get("index"), params.get("limit", 128))
    raise ValueError(f"Unknown method: {method}")


def emit(value: dict) -> None:
    print(json.dumps(value, ensure_ascii=False, allow_nan=False), flush=True)


def main() -> None:
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    for line in sys.stdin:
        request_id = None
        try:
            if len(line) > MAX_REQUEST_CHARACTERS:
                raise ValueError("Request exceeds the two-million-character limit")
            request = json.loads(line)
            if not isinstance(request, dict):
                raise ValueError("Request must be an object")
            raw_id = request.get("id")
            if not (raw_id is None or type(raw_id) in (str, int) or
                    (type(raw_id) is float and math.isfinite(raw_id))):
                raise ValueError("Request id must be null, a string or a finite number")
            request_id = raw_id
            # json.loads accepts NaN, Infinity and overflowing exponents.
            json.dumps(request, allow_nan=False)
            result = dispatch(request["method"], request.get("params", {}))
            emit({"id": request_id, "result": result})
        except Exception as exc:
            emit({"id": request_id,
                  "error": {"message": str(exc), "type": type(exc).__name__}})


if __name__ == "__main__":
    main()
