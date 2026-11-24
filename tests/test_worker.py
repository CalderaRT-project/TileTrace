import json
import subprocess
import sys
import unittest

from tiletrace.worker import dispatch


SOURCE = """import triton
import triton.language as tl
@triton.jit
def kernel(BLOCK: tl.constexpr):
    x = tl.arange(0, BLOCK)
    y = tl.reshape(x, (2, 4))
    z = tl.trans(y)
"""


class WorkerTests(unittest.TestCase):
    def run_worker(self, requests):
        result = subprocess.run([sys.executable, "-m", "tiletrace.worker"],
                                input="\n".join(requests) + "\n", encoding="utf-8",
                                capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        return [json.loads(line) for line in result.stdout.splitlines()]

    def test_analyze_and_inspect_use_same_graph(self):
        analysis = dispatch("analyze", {"source": SOURCE, "parameters": {"BLOCK": 8},
                                        "document_id": "kernel.py", "version": 3})
        node = next(n for n in analysis["nodes"] if n["name"] == "z")
        result = dispatch("inspect", {"analysis": analysis, "node_id": node["id"], "index": [1, 0]})
        self.assertEqual(result["status"], "exact")
        self.assertEqual(result["origins"][0]["indices"], [[0, 1]])

    def test_unknown_method_returns_clear_error(self):
        for method in ("execute_python", "get_context", "sync_context", "clear_context"):
            with self.subTest(method=method), self.assertRaisesRegex(ValueError, "Unknown method"):
                dispatch(method, {})

    def test_inspect_requires_analysis(self):
        with self.assertRaisesRegex(ValueError, "Provide an analysis object"):
            dispatch("inspect", {"node_id": "n1", "index": [0]})

    def test_worker_recovers_after_invalid_json(self):
        request = {"id": "good", "method": "analyze", "params": {
            "source": SOURCE, "parameters": {"BLOCK": 8}}}
        lines = self.run_worker(["not json", json.dumps(request)])
        self.assertIn("error", lines[0])
        self.assertEqual(lines[1]["id"], "good")
        self.assertEqual(lines[1]["result"]["kernel"], "kernel")

    def test_worker_recovers_after_invalid_ids_and_nonfinite_numbers(self):
        invalid = ['NaN', 'Infinity', '-Infinity', '1e999', 'true', '[]', '{}']
        requests = ['{"id":' + value + ',"method":"analyze","params":{"source":""}}' for value in invalid]
        requests.append('{"id":"bad-parameter","method":"analyze","params":{"source":"",'
                        '"parameters":{"BLOCK":1e999}}}')
        requests.append(json.dumps({"id": "good-中文", "method": "analyze", "params": {
            "source": SOURCE}}, ensure_ascii=False))
        lines = self.run_worker(requests)
        self.assertEqual(len(lines), len(requests))
        for response in lines[:-1]:
            self.assertIn("error", response)
        for response in lines[:-2]:
            self.assertIsNone(response["id"])
        self.assertEqual(lines[-2]["id"], "bad-parameter")
        self.assertEqual(lines[-1]["id"], "good-中文")
        self.assertEqual(lines[-1]["result"]["kernel"], "kernel")

    def test_rejects_oversized_source_before_parsing(self):
        request = {"id": "oversized", "method": "analyze", "params": {"source": "!" + " " * 1_000_000}}
        response, = self.run_worker([json.dumps(request)])
        self.assertEqual(response["id"], "oversized")
        self.assertEqual(response["error"]["type"], "ValueError")
        self.assertIn("one-million-character", response["error"]["message"])


if __name__ == "__main__":
    unittest.main()
