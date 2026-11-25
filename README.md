# TileTrace

TileTrace 是 VS Code 的 Triton 张量变换可视化扩展。打开 Triton 脚本，选中表达式，在编辑器右侧查看形状变化与元素来源。

分析器不执行脚本、不导入 Triton、不启动 kernel；使用 Python 3.10+，无需 GPU。采用 [MIT 许可证](LICENSE)。

> 当前版本为 0.1.5，支持本地 VSIX 安装。[更新日志](docs/CHANGELOG.md)

## 当前功能

- `arange`、新增轴、广播、reshape、transpose、sum/max、二维 `tl.dot`、显式类型转换，以及常见逐元素操作的静态形状分析。
- 点击输出坐标，查看参与该位置计算的直接输入坐标；大归约限定展示数量。
- 查看常见 `tl.load` 的逻辑分块位置，追踪 `arange` 的块内索引如何加上 program 或循环偏移。
- 支持符号尺寸和缺失参数提示，未知语法提供诊断。
- VS Code 读取未保存缓冲区、跟随选择和参数变化、反向定位源码。
- 默认只显示关键张量步骤，参数与常量折叠到操作详情；“显示全部节点”可以查看完整分析图。标量归约及依赖归约结果的计算仍然保留。

展示的是逻辑坐标与依赖。它不表示实际数值执行、GPU 线程布局、内存搬运或性能测量。只展开已知整数边界的 `tl.static_range`，一次分析共享最多 16 次循环迭代；未知/超限循环、循环控制跳转、数据相关分支与跨函数调用仍保留诊断。FlashAttention 示例是单 batch/head 的教学前向实现，尚未在本机验证 GPU 数值或性能。

## 安装与快速开始

运行扩展需要 Python 3.10+。从源码构建还需要 Node.js 与 npm。在仓库根目录运行以下命令生成 VSIX。

```sh
npm --prefix extension ci
npm --prefix extension run package
```

Windows PowerShell 也可以运行 `.\scripts\setup.ps1` 生成 VSIX。构建完成后，在 VS Code 扩展面板的菜单中选择 **Install from VSIX…**，安装 `dist/tiletrace-0.1.5.vsix`。

安装后，在受信任的工作区打开包含 `@triton.jit` kernel 的已保存 `.py` 文件。点击编辑器右上角的 **TileTrace 矩阵图标**，或运行命令 **TileTrace: 打开变换可视化**。选中源码表达式可查看输入和输出形状，点击输出坐标可查看直接输入来源。

扩展自带静态分析 worker，无需安装 Triton、NumPy 或使用 GPU。Python 路径未自动识别时，在设置中配置 `tiletrace.pythonPath`。

面板由用户手动打开，打开后会跟随当前源码更新。面板标签也使用 TileTrace 矩阵图标。运行 **TileTrace: 重启分析进程** 可重新启动本地分析。

## FlashAttention 示例与交互

下载或克隆本仓库，打开 [examples/flash_attention.py](examples/flash_attention.py) 即可体验完整示例。

示例只保留一个 `flash_attention_forward`，默认参数无需填写 JSON。每个 program 处理 16 个 Q 行，每次循环读取 32 个 K/V 行，head 维度为 32，序列长度为 64。`program_ids` 填 `[1]` 可切换到第二块 Q 行；`{"CAUSAL":false}` 可关闭因果掩码。

依次查看行列 `arange`、新增轴、`q`/`k`/`v`、K 转置、`scores`、softmax 的归约与广播、`accumulator`、`output`。点击矩阵乘法输出坐标可查看左右输入的整行/整列；循环内操作标注 `start_n=0` 或 `start_n=32`。示例使用在线 softmax，逐块更新结果，无需构建整个注意力矩阵。

选中 `tl.arange(0, BLOCK_M)` 可看到它关联的 Q 读取块。「分块位置」显示行偏移公式、当前行列区间和可识别的掩码上界。示例 program `[0]` 的 Q 行是 `[0, 16)`，在分析参数中把 `program_ids` 改为 `[1]` 可查看 `[16, 32)`。K/V 按 `start_n` 展示两个循环读取块。分块图覆盖可以静态确认的线性偏移与行列步长。

默认只展示张量步骤，常量与参数折叠到操作详情。选中 `arange` 时展示起点、终点和长度；源码中的边界常量或归约轴会选中所属张量操作。前后导航遵循当前视图。

一维张量的行列方向根据实际新增轴用法展示：`query_rows[:, None]` 对应行轴，因此 `query_rows` 的 16 个索引纵向排列；`head_cols[None, :]` 对应列轴，横向排列。真实 shape 仍是 `[16]` 或 `[32]`。同一向量用于两个方向时，查看具体新增轴操作可获得相应方向；单独查看时会提示方向未指定。矩阵卡片同时说明完整行列数与网格显示窗口，避免将只显示的 8 行误读成整个 program 的行数。

普通视图中，超过 8 个坐标的轴默认显示前 3 项、`…`、后 3 项，例如 16 行显示为 `0、1、2、…、13、14、15`。点击省略号或“展开显示窗口”查看中间坐标，每卡最多显示 128 个格子。“定位首个来源坐标”会将输入窗口移到对应位置。来源文本只展示返回坐标的首尾各 3 项，并保留枚举截断说明。

面板默认打开“简约”视图。每张卡片直接显示最多 4 行 × 4 列真实坐标，较短的轴按实际长度显示。点击输出格即可查询来源，通过“行起点”“列起点”移动窗口。高维张量用前缀轴选择切片，卡片显示完整 shape。用网格上方的“简约 / 普通”切换视图，两种视图各自记住窗口位置。

面板优先显示当前操作和输出网格。点击输出格后，网格下方的直接来源区域显示对应输入、坐标范围和可见高亮数量。输出和来源空间充足时并排展示，窄面板默认将步骤收起，宽面板使用按迭代分组的步骤侧栏。矩阵行列数与显示数量可通过 shape 和网格的悬停提示查看。

同一文件中点击格子、切换步骤或收到分析结果时，会保留页面、列表和网格的滚动位置，以及参数区展开状态和输入焦点。重新分析时暂时缩短的等待页面不会覆盖原阅读位置；首次切换到另一文件从顶部开始。内容变短时，浏览器会将位置限制在新的可滚动范围内。

输入参数与 `input_shapes` 是 JSON 对象；program IDs 是坐标数组。形状未知时先补充缺失参数。源文件仅被静态读取，不能通过修改示例参数取得执行数值。

## 开发与测试

在仓库根目录运行以下命令检查分析器、编辑器控制逻辑和面板交互。Python 测试使用 Python 3.10+，VSIX 构建后还会检查打包内容和分析进程的隔离启动。

```sh
python -m unittest discover -s tests -v
npm --prefix extension test
```

[VS Code 扩展开发与打包说明](extension/README.md)

## 来源

分析规则依据 [Triton 官方 API](https://triton-lang.org/main/python-api/triton.language.html)，编辑器接入依据 [VS Code Webview API](https://code.visualstudio.com/api/extension-guides/webview)。[TileLens](https://github.com/Deep-Learning-Profiling-Tools/tilelens) 用于功能覆盖比较；本项目没有复制其代码或界面。

## 许可证

[MIT](LICENSE)
