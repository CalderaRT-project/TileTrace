<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="extension/media/icons/tiletrace-dark.svg">
    <img src="extension/media/icons/tiletrace-light.svg" alt="" width="40" height="40" align="middle">
  </picture>
  TileTrace
</h1>

<p align="center">Select a Triton expression in VS Code to see its tensor shape. Click an output cell to find the input coordinates it uses.</p>
<p align="center"><a href="README.md">简体中文</a> · <strong>English</strong></p>

![Row index 1 of q and column index 2 of k_transposed contribute to output cell [1, 2] of the dot product.](docs/images/dot-trace.svg)

Click `[1, 2]` in the output of `tl.dot(q, k_transposed)` and TileTrace highlights `q[1, :]` and `k_transposed[:, 2]`. Each input contributes 32 coordinates. The diagram shows the top-left 4 × 4 window of each tensor.

## Install and open TileTrace

You need **VS Code 1.85+** and **Python 3.10+**. The VSIX includes a static analyzer that reads source code using the Python standard library. You can explore a kernel without a GPU, Triton, or NumPy.

To build the installer from source, run these commands from the repository root with Node.js and npm installed.

```sh
npm --prefix extension ci
npm --prefix extension run package
```

On Windows, you can also build the package from the repository root with [scripts/setup.ps1](scripts/setup.ps1).

1. In VS Code’s Extensions view, open the **…** menu, choose **Install from VSIX…**, and select `dist/tiletrace-0.1.5.vsix`.
2. Open the project folder as a trusted workspace, then open a saved `.py` file containing an `@triton.jit` kernel. You can use the included [FlashAttention example](examples/flash_attention.py).
3. Click the **TileTrace matrix icon** in the editor toolbar, or run **TileTrace: 打开变换可视化** (open transform viewer) from the Command Palette. The panel opens beside the code, follows your selection, and picks up unsaved edits.

TileTrace looks for Python in the workspace’s `.venv` and then on `PATH`. To choose an interpreter, set `tiletrace.pythonPath` to its absolute path. Run **TileTrace: 重启分析进程** to restart the local analyzer.

## Trace a Q tile in FlashAttention

The example implements a forward pass for one batch and one head. Its defaults give a sequence length of 64 and a head dimension of 32. Each program handles 16 query rows. You can use these defaults as soon as you open the file.

1. Select `tl.load` in `q = tl.load(...)`. Under **分块位置** (tile location), program `[0]` reads rows `[0, 16)` of Q. Selecting the row index expression `tl.arange(0, BLOCK_M)` also reveals this tile.
2. Expand **分析参数 · JSON** (analysis parameters), enter `[1]` in **program ID（可选）**, and click **应用参数并重新分析** (apply and reanalyze). The read window now covers rows `[16, 32)` and columns `[0, 32)` of Q.
3. Click `[1, 2]` in the output grid for `tl.load`. Under **直接来源** (direct sources), the panel shows `块内 [1, 2] → Q [17, 2]`. The tile starts at row 16, so its local row 1 maps to row 17 of Q.

![VS Code with the Q load selected. TileTrace shows the read window for program [1] and maps local cell [1, 2] to Q [17, 2].](docs/images/flash-attention-q.png)

Next, select `tl.dot(q, k_transposed)` and click output cell `[1, 2]` to reproduce the row and column highlights at the top of this page. The step list labels the two loop iterations `start_n=0` and `start_n=32`. Each reads 32 rows of K/V. The online softmax updates the row maximum, denominator, and output accumulator one tile at a time. To explore the branch with causal masking disabled, enter `{"CAUSAL": false}` in the constexpr parameters.

## Panel guide

| What to inspect | How to find it |
| --- | --- |
| Shapes through a transform | Select an `arange`, axis insertion, broadcast, reshape, transpose, explicit cast, or elementwise operation and compare the input and output cards. A 1-D index is drawn along the axis implied by `[:, None]` or `[None, :]`. |
| Inputs to reductions and dot products | Click an output cell of `tl.sum`, `tl.max`, or a 2-D `tl.dot`. **坐标明细** (coordinate details) shows returned and total counts and indicates truncation. **定位首个来源坐标** moves the input grid to the first contributing coordinate. |
| Coordinates outside the window | **简约** (compact) shows up to 4 rows × 4 columns by default. Change the row or column start to move the window. **普通** (normal) shows the first and last 3 positions of axes longer than 8. Click the ellipsis to expand, up to 128 cells per card. For higher-rank tensors, select a slice along the leading axes. |
| The expression behind a step | The list opens on the main tensor steps, with parameters and constants under **参数与属性** (parameters and attributes). Enable **显示全部节点** to see all nodes, or click **查看源码** to jump to the expression. |

## Analysis scope

TileTrace infers logical shapes and coordinate dependencies. When a `tl.load` pointer expression has a recognizable linear offset and stride, the panel also shows the read window and any mask bounds it can infer. Tensor values, GPU thread layouts, physical memory traffic, and timing are runtime concerns.

If a shape depends on a missing parameter, the panel prompts you for it. The constexpr / scalar parameters and optional `input_shapes` fields take JSON objects. The `program_ids` field takes a coordinate array. TileTrace unrolls `tl.static_range` loops with known integer bounds. All loops in one analysis share a budget of 16 iterations. The analyzer reports diagnostics for loops it cannot unroll, control transfers inside loops, data-dependent branches, and calls to other kernels or helpers.

## Development and references

Run the analyzer and extension tests from the repository root. If you have built the VSIX, the Python suite also checks its contents and verifies that the bundled analyzer starts in isolation.

```sh
python -m unittest discover -s tests -v
npm --prefix extension test
```

[Extension development and packaging (中文)](extension/README.md) · [Changelog (中文)](docs/CHANGELOG.md) · [MIT license](LICENSE)

The analysis rules follow the [Triton language API](https://triton-lang.org/main/python-api/triton.language.html). The editor panel uses the [VS Code Webview API](https://code.visualstudio.com/api/extension-guides/webview). [TileLens](https://github.com/Deep-Learning-Profiling-Tools/tilelens) was a reference for comparing feature coverage.
