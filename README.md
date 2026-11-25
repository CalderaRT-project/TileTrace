<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="extension/media/icons/tiletrace-dark.svg">
    <img src="extension/media/icons/tiletrace-light.svg" alt="" width="40" height="40" align="middle">
  </picture>
  TileTrace
</h1>

<p align="center">在 VS Code 里选中 Triton 表达式，查看张量形状，再点一个输出格，看看哪些输入参与了计算。</p>
<p align="center"><strong>简体中文</strong> · <a href="README.en.md">English</a></p>

![点积的坐标来源。q 的行索引 1 和 k_transposed 的列索引 2 共同决定输出格 [1, 2]。](docs/images/dot-trace.svg)

在 `tl.dot(q, k_transposed)` 的输出网格里，点选 `[1, 2]` 会高亮 `q[1, :]` 和 `k_transposed[:, 2]`。两个输入各贡献 32 个坐标，图中展示每个张量左上角的 4 × 4 窗口。

## 安装与快速开始

运行扩展需要 **VS Code 1.85+** 和 **Python 3.10+**。VSIX 自带静态分析器，用 Python 标准库解析源码，无需 GPU、Triton 或 NumPy。

从源码安装时，先在仓库根目录用 Node.js 和 npm 生成安装包。

```sh
npm --prefix extension ci
npm --prefix extension run package
```

Windows 上也可以在仓库根目录运行 PowerShell 脚本 [scripts/setup.ps1](scripts/setup.ps1)。

1. 在 VS Code 扩展视图的 **…** 菜单中选择 **Install from VSIX…**，安装 `dist/tiletrace-0.1.5.vsix`。
2. 将项目文件夹作为受信任的工作区打开，再打开一个已保存、包含 `@triton.jit` kernel 的 `.py` 文件。可以直接使用仓库里的 [FlashAttention 示例](examples/flash_attention.py)。
3. 点击编辑器右上角的 **TileTrace 矩阵图标**，或在命令面板运行 **TileTrace: 打开变换可视化**。右侧面板会跟随源码选择，也会分析尚未保存的编辑。

扩展会先在工作区的 `.venv`、再在 `PATH` 中查找 Python。若要指定解释器，可将 `tiletrace.pythonPath` 设为可执行文件的绝对路径。运行 **TileTrace: 重启分析进程** 可以重启本地分析器。

## 跟踪 FlashAttention 的一次 Q 读取

示例演示单个 batch、单个 head 的前向计算。默认序列长度为 64，head 维度为 32，每个 program 处理 16 行 Q。打开示例即可使用这些默认值。

1. 在 `q = tl.load(...)` 中选中 `tl.load`。**分块位置** 显示 program `[0]` 读取 Q 的行区间 `[0, 16)`。选中构造行索引的 `tl.arange(0, BLOCK_M)` 也能找到同一读取块。
2. 展开 **分析参数 · JSON**，在 **program ID（可选）** 中填入 `[1]`，点击 **应用参数并重新分析**。现在读取的是 Q 的行 `[16, 32)`、列 `[0, 32)`。
3. 回到 `tl.load` 的输出网格，点选 `[1, 2]`。**直接来源** 显示 `块内 [1, 2] → Q [17, 2]`。块的起始行是 16，加上块内行索引 1，就得到了 Q 中的行索引 17。

![VS Code 中选中了读取 Q 的 tl.load。TileTrace 面板显示 program [1] 的读取范围，以及块内 [1, 2] 对应的 Q 坐标 [17, 2]。](docs/images/flash-attention-q.png)

接着选中 `tl.dot(q, k_transposed)` 并点击输出格 `[1, 2]`，就能重现页首的行列高亮。步骤列表用 `start_n=0` 和 `start_n=32` 区分两次循环。每次读取 32 行 K/V，在线 softmax 逐块更新行最大值、归一化分母和输出累加器。要查看关闭因果掩码的分支，可在 constexpr 参数中填入 `{"CAUSAL": false}`。

## 面板速查

| 想查看什么 | 怎么看 |
| --- | --- |
| 每一步的形状 | 选中 `arange`、新增轴、广播、reshape、转置、显式类型转换或逐元素操作，对照输入和输出卡片。一维索引的显示方向取决于 `[:, None]` 或 `[None, :]` 的用法。 |
| 归约与点积的输入 | 点击 `tl.sum`、`tl.max` 或二维 `tl.dot` 的输出格。**坐标明细** 显示已返回数量、总数和截断情况，**定位首个来源坐标** 可将输入网格移到对应位置。 |
| 窗口以外的坐标 | **简约** 默认最多显示 4 行 × 4 列，可调整行列起点。**普通** 将长度超过 8 的轴折叠为首尾各 3 项，点击省略号可展开，每卡最多显示 128 格。高维张量可用前缀轴选择切片。 |
| 步骤对应的源码 | 默认列出关键张量步骤，参数与常量收在 **参数与属性** 中。勾选 **显示全部节点** 可浏览完整列表，点击 **查看源码** 可跳回表达式。 |

## 分析范围

TileTrace 推导逻辑形状和坐标依赖。能从 `tl.load` 的指针表达式推导出线性偏移与步长时，面板还会标出读取范围及可识别的掩码上界。张量数值、GPU 线程布局、实际访存与耗时属于运行时分析的范畴。

若形状取决于缺少的参数，面板会提示需要补充的值。constexpr / 标量参数与可选的 `input_shapes` 接受 JSON 对象，`program_ids` 接受坐标数组。分析器可展开整数边界已知的 `tl.static_range`，一次分析中的所有循环共用 16 次迭代额度。无法展开的循环、循环内的控制跳转、依赖运行时数据的分支和跨函数调用会给出诊断。

## 开发与参考

在仓库根目录运行分析器和扩展测试。生成 VSIX 后，Python 测试也会检查包内文件和分析进程的隔离启动。

```sh
python -m unittest discover -s tests -v
npm --prefix extension test
```

[扩展开发与打包](extension/README.md) · [更新日志](docs/CHANGELOG.md) · [MIT 许可证](LICENSE)

分析规则参考 [Triton 语言 API](https://triton-lang.org/main/python-api/triton.language.html)，编辑器面板使用 [VS Code Webview API](https://code.visualstudio.com/api/extension-guides/webview)。功能覆盖对照参考了 [TileLens](https://github.com/Deep-Learning-Profiling-Tools/tilelens)。
