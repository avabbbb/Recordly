# Unified Quick Capture：截图、贴图与录屏一体化设计

> 状态：**Design Proposal / 待评审** · 更新：2026-10-15
> 范围：`avabbbb/Recordly` Fork · 基线：2026-10-14 上游 `main`（`52a91356`）
> 本文仅定义产品和技术设计，不代表相关功能已实现。

## 0. 一句话愿景

**一次框选，立即截图、贴图或录制 GIF/MP4；需要精修时再进入 Recordly 编辑器。**

交互取向：Snipaste 的「随叫随到、精确框选、贴图」，吸收 PixPin 好用的编号/长截图操作，复用 Recordly 的原生采集、鼠标轨迹、自动缩放、背景与视频编辑。**不是把两个进程强行捆绑，也不复制 Snipaste/PixPin 的专有实现。**

### 设计原则（按优先级）

1. **快捷键优先，零阻塞**：常用截图/录制无需先打开项目或完整编辑器；退出、取消与停止始终可用。
2. **框选只有一套**：截图/动图/视频/长截图共享同一套选区、显示器坐标与覆盖层。
3. **轻量常驻、按需加载**：截图可用不意味着编辑器/编码器/OCR/GIF 转码器必须常驻。
4. **复用，不重造**：保留 Recordly 现有 Electron + React + Swift/C++ 原生采集 + PixiJS 编辑链；迁移 Rust/Go 需先证明收益。
5. **不中断既有能力**：全屏/窗口录制、音频、暂停、光标轨迹、`.recordly` 项目、导出均不回退。
6. **本地优先**：默认本地处理、不上传截屏；权限及时申请，未授权时清晰提示。

## 1. 用户任务与边界

| 使用场景 | 目标操作 | 首次交付阶段 |
| --- | --- | --- |
| 随手截图 | 快捷键 → 拖选/吸附窗口 → 复制或保存 | PR2 |
| 桌面贴图 | 截图 → 一键置顶 → 缩放、透明度、关闭 | PR2 |
| GIF 小演示 | 快捷键 → 框选区域 → 录制 → 停止 → GIF | PR1 |
| MP4 小演示 | 框选区域 → 录制 → 停止 → MP4 或进入编辑器 | PR1 |
| 详细标注 | 箭头/框/文字/任意颜色/编号 ①②③ | PR3 |
| 滚动长截图 | 选定滚动容器 → 分段采集与拼接 → 预览纠错 | PR4 |
| 精美产品视频 | 录制后在 Recordly 中应用自动缩放、鼠标动画、背景 | 复用现有功能 |

**首个可运行 MVP = 区域框选 + 原生录制 + 停止 + 可用 MP4 + 现有编辑器接入。** GIF 走已有导出/转码链，允许转码耗时；不声称 GIF 是零耗时原生编码。截图、贴图、长截图分阶段增加。

### 首版明确不做

- 自建通用视频编辑时间线，或复制现有编辑器状态。
- Rust/Go 全面重写、替换整个 Electron 外壳。
- AI 自动 OCR/云识别/云素材库默认常驻。
- 多显示器跨屏的连续矩形录像（首版只允许单显示器内区域）；Windows/Linux 行为不得假装已支持。
- 绕过系统录屏授权、抓取被系统保护的画面、隐藏录制状态。

## 2. 关键交互设计

### 2.1 快捷键统一入口

**P0：全局唤起与录制控制必须随第一阶段交付。** 现有编辑器快捷键与全局录制快捷键是两个入口，不能以编辑器内支持自定义来替代后台控制。

| 操作 | macOS 建议默认值 | Windows/Linux 建议默认值 |
| --- | --- | --- |
| 唤起捕获选择器 | `Cmd+Shift+2` | `Ctrl+Shift+2` |
| 开始 / 停止录制 | `Cmd+Option+R` | `Ctrl+Alt+R` |
| 暂停 / 恢复 | `Cmd+Option+P` | `Ctrl+Alt+P` |
| 显示 / 隐藏 HUD | `Cmd+Option+H` | `Ctrl+Alt+H` |
| 取消并丢弃（确认后） | `Cmd+Option+Shift+X` | `Ctrl+Alt+Shift+X` |

以上均须可自定义、禁用、持久化，注册失败明确显示冲突。全局快捷键在应用失焦、HUD 隐藏时仍连接同一个采集会话；取消丢弃须确认，停止不要求先恢复 HUD。录制中不允许重新选源；倒计时、结束收尾期间不重复开始。系统或远程软件拦截的按键不能保证送达，须用真实 Mac → UU → Windows 会话验证。

**截至当前基线的实现状态**：上游已有 `CapturePicker`，macOS 支持区域选择，Windows 选择屏幕/窗口，Linux 使用既有列表或系统 portal；选择后仍由 HUD 控制录制。任意区域录制不能笼统称为“全平台已实现”或“完全未实现”。上游 [PR #1137](https://github.com/webadderallorg/Recordly/pull/1137) 是未合并的全局控制/远程可见模式实现，本次延续它接入现有选择器。截图、贴图、区域 GIF/MP4 快速工具栏仍是后续产品目标。

**远程可见模式**：显式关闭 HUD 捕获保护，提示 HUD 也可能出现在录像里；关闭后恢复用户原来的隐藏偏好。显示 HUD 的快捷键只改变窗口可见性，不暗中修改捕获保护。macOS 原生进程排除在录制启动时生效，改变模式后须重启当前录制才能更新该排除。

实现约束：直接复用已有选源入口、录制回调与状态；不创建第二套控制器、失败时自动切换的录制引擎、推测性的兼容层或伪成功返回。系统输入、磁盘设置等边界做必要校验，失败明确呈现。

1. 按「快速捕获」热键（首次提供建议值，必须可自定义并检测系统/其他应用占用）。
2. 用 **浅色边框 + 四角拖拽柄 + 尺寸数值** 预览选区；默认支持拖拽任意区域、点击窗口吸附、Esc 取消。
3. 鼠标松开后，选区旁只显示一条紧凑工具栏：**截图 | GIF | MP4 | 贴图 | 更多**。
4. 点击截图：立即进入「复制/保存/标注」；点击 GIF/MP4：进入录制态，原工具栏不遮住录制画面；点击贴图：就地生成悬浮图；「更多」放长截图/设置/进入专业编辑。
5. 录制态保留**暂停、停止、取消**三种明确操作；停止后呈现「复制路径 / 保存 / 在 Recordly 编辑」。不弹出必须确认的阻塞式浏览器对话框。

文字线框（仅是交互，不是视觉规范）：

```text
┌─────────────────── 被框选的屏幕区域 ──────────────────┐
│                                                       │
│                 1280 × 720                             │
│                                                       │
└───────────────────────────────────────────────────────┘
  [截图]  [GIF]  [MP4]  [贴图]  [···]

录制中：● 00:12  [暂停] [停止] [取消]
结束后：[保存 MP4 / 导出 GIF] [进入 Recordly 编辑]
```

**交互规则**：
- 全局快捷键不是硬编码的唯一热键；优先重用 Recordly 现有快捷键/窗口入口，避免冲突。
- 选区浮层不出现在最终视频/截图里；录制开始前隐藏或从采集中过滤，状态栏应在选区外可见。
- 任何阶段都可以 Esc/停止；录制异常时保留可恢复的临时文件并说明位置。
- 视频与截图共享选区组件，但不共享不适合互用的 UI 状态；**后台只有一个捕获会话权威状态**，不创建第二套录制状态机。
- 工具栏贴近选区边缘，靠近屏幕边界时翻转方向，不遮挡用户目标。

### 2.2 截图 / 贴图

- 捕获物理像素，不做隐式缩放；默认复制原图，PNG 保存；支持复制文件或像素图的显式区分。
- 窗口吸附、边缘微调、键盘方向键 1px 调整；多显示器独立显示选区浮层，避免跨屏 DPI 错位。
- 贴图：可移动、置顶、滚轮缩放、调透明度、关闭、批量隐藏；支持从剪贴板创建（图像）。
- 可选历史记录，初版默认临时会话保存；是否磁盘持久化由设置明确控制，避免隐私意外保留。

### 2.3 自由颜色与标注（消除预设色板限制）

- 矩形/椭圆/箭头/画笔/文字/马赛克/高亮/序号 ①②③。
- 颜色控件同时支持**HEX / RGB 输入、吸管取色、收藏与最近使用颜色**；预设色板只是捷径，不能限制用户。
- 编号标注按当前截图中的顺序递增；可编辑数字、重排序、撤销/重做、重复上一次样式。
- 「复制」需将**最终标注合成结果**写入剪贴板，不泄漏仅用于编辑的隐藏图层。
- 标注方案由静态截图领域独立承载，不塞入视频时间线 schema；视频时间线需要标注时仍复用现有编辑功能。

### 2.4 长截图

- 与录屏**不是一回事**：需在可滚动区域重复获取图像、估计相邻帧重叠、去重并拼接。
- v1：用户明确选择滚动容器/窗口，手动触发逐段滚动；检测重叠失败就暂停让用户重定位，禁止无声拼错。
- 先支持纵向滚动、单窗口、非虚拟化页面的常见场景；网页懒加载/吸顶栏/动画和虚拟列表需明确降级。
- 最终可裁切和标注，不需要录制视频才能获得长图。

## 3. 架构：在 Recordly 内渐进增强

```text
  全局快捷键 / HUD / SourceSelector
                 │
        CapturePicker 扩展         ← 复用现有选区浮层
                 │
         Selection Contract        ← 唯一的选区坐标契约
            ┌────┴───────────┐
            │                │
      Image Pipeline    Recording Orchestrator (现有 IPC)
       ├─ screenshot       ├─ macOS: Swift ScreenCaptureKit helper
       ├─ annotate         ├─ Windows: native C++ capture helper
       ├─ pin              └─ Linux: 后续评估
       └─ scroll stitch                │
                              existing session + cursor telemetry
                                          │
                              Quick Export / Open Editor
                                          │
                            existing PixiJS editor & exporter
```

### 已核对的代码锚点（2026-10-15）

| 路径 | 目前职责 | 设计改动 |
| --- | --- | --- |
| [`src/components/capture-picker/CapturePicker.tsx`](../../src/components/capture-picker/CapturePicker.tsx) / [`electron/ipc/register/capturePicker.ts`](../../electron/ipc/register/capturePicker.ts) | 上游现有选择器；区域仅向 macOS 开放 | 复用现有 UI 与 IPC，Windows 区域采集单独扩展；不另起一套选区 |
| [`electron/ipc/register/recording.ts`](../../electron/ipc/register/recording.ts) | 启动录制 IPC；向原生 helper 传配置 | 将规范化区域作为可选捕获范围传给原生 helper |
| [`electron/native/ScreenCaptureKitRecorder.swift`](../../electron/native/ScreenCaptureKitRecorder.swift) | macOS 显示器/窗口/区域录制、音视频写入 | 复用区域模式，验证源矩形、输出尺寸和快捷入口的一致性 |
| [`electron/ipc/sourceArea.ts`](../../electron/ipc/sourceArea.ts) | 现有选区标准化与区域源构建 | 共享当前坐标契约，截图与后续 Windows 区域扩展沿用同一来源 |
| [`electron/native/windows-capture/src/dxgi_session.cpp`](../../electron/native/windows-capture/src/dxgi_session.cpp) | Windows 原生 DXGI 会话、屏幕/窗口矩形 | 后续将区域模式接入该捕获裁切/复制流程 |
| [`electron/ipc/windowsCaptureSelection.ts`](../../electron/ipc/windowsCaptureSelection.ts) | Windows 屏幕与窗口源解析 | 在这里解决具体 display/窗口映射，不塞给 UI 猜测 |
| [`electron/ipc/state.ts`](../../electron/ipc/state.ts) | 选源、录制状态、光标轨迹状态 | **复用**录制单一权威状态 |
| [`electron/ipc/recording/ffmpeg.ts`](../../electron/ipc/recording/ffmpeg.ts) | FFmpeg 等后备录制路径 | Linux/回退路径仅在有明确能力支持后暴露区域模式 |

**注意**：产品 README 描述 Windows 原生录制为 WGC，但本次检查代码的 helper 包含 `DxgiSession` 和 Desktop Duplication 相关实现。第一阶段按当前代码事实设计，不依赖尚未确认的「任意区域 WGC API」。

### 3.1 统一选区契约（设计草案，不是已存在类型）

```ts
type CaptureIntent = "image" | "gif" | "mp4" | "pin" | "long-image";
type CaptureTarget =
  | { kind: "display"; displayId: string }
  | { kind: "window"; sourceId: string }
  | {
      kind: "region";
      displayId: string;
      // Relative to selected display in *physical pixels*, top-left origin.
      pixelRect: { x: number; y: number; width: number; height: number };
    };

type CaptureRequest = {
  intent: CaptureIntent;
  target: CaptureTarget;
  audio: { system: boolean; microphone: boolean }; // quick clip 默认均为 false
};
```

这是 UI → 录制 IPC 的建议边界，不要求直接改写现有 `SelectedSource` 或 `.recordly` 项目 schema。具体命名由实现 PR 与现有类型对齐。

**坐标必须先归一化后下沉到平台 helper：**

- UI 获取全局逻辑坐标、当前 display bounds、对应缩放比例；**选区落在一块显示器内**。
- 转为 display-local physical pixel rect；裁剪到显示器边界；x/y/w/h 非负，w/h > 0。
- 编码要求偶数尺寸时，显式向内/边界安全对齐，并将最终实际 capture rect 写回会话元数据，禁止 UI 显示 1280×720 而最终实际截到 1278×718 且无记录。
- 视网膜屏幕、高 DPI、负坐标显示器布局、旋转显示器和缩放显示在原生验证中覆盖；**不要把 1 CSS px 假定为 1 physical px**。
- 鼠标轨迹维持既有全局采样时间轴，编辑器读取时再用源 display 偏移与实际 capture rect 做坐标转换，确保自动变焦与点击位置与裁剪后视频一致。
- 调整录制区域后不能把先前区域的轨迹元数据当成新录制坐标；v1 录制中禁止修改区域。

### 3.2 macOS — 首要交付平台

- 继续复用 `ScreenCaptureKitRecorder.swift`，在区域模式下使用显示器内容过滤器和 `SCStreamConfiguration.sourceRect`，并设置匹配尺寸的输出帧；不要先完整编码 4K 再导出裁切。
- Apple 文档明确：`sourceRect` 是采集显示器内容的源矩形，**单窗口捕获时不生效**；因此区域模式须走显示器路径，不能在单窗口过滤器上硬加 `sourceRect`。
- 保留当前音频与光标的生命周期逻辑；首个 PR 不改音频混流和视频编辑 schema。
- 对系统录屏授权失败、helper crash、唤醒、显示器拔插提供明确错误及可停止路径。
- 录制前隐藏选区 UI（或显式排除），录制控制 HUD 同样不能污染图像。
- 快速 MP4 直接交付捕获产物；只有点击「进入编辑」才加载完整编辑器。GIF 走已有 GIF 导出管线，需有尺寸/帧率提示。

### 3.3 Windows — 验证后追加

- 当前 `dxgi_session.cpp` 已处理全屏和窗口截取矩形；需新增「固定区域矩形」，并在 D3D 复制/裁切阶段只输出所选画面、避免无必要的整屏视频编码。
- 保留窗体最小化、窗口消失、音频、pause/resume 和 WGC/后备逻辑的现有行为；区域录制可先以特性开关交付。
- 明确多屏、DPI Awareness、混合缩放、负坐标、权限、硬件编码失败等边界。
- Linux：在确定现有捕获后端能稳定支持前不显示不可用的「区域录制」按钮，或明确标注暂不支持。

### 3.4 轻量化与运行时

先测量，再决定是否引入 Rust/Go。短期不因「Rust 更省内存」而将已可用的 Swift/C++ 采集重写：

- 快捷键、简单设置与轻量覆盖层常驻；编辑器、导出界面、OCR、长截图拼接只在使用时加载。
- 关闭 Quick Capture 后销毁屏幕纹理/帧缓存、事件监听器、定时任务和未引用窗口；不留下隐藏且持续渲染的视频界面。
- 区分 CPU/RSS 内存、系统统一内存压力、GPU/纹理占用和磁盘临时文件；**不是只比较活动监视器的一行数字**。
- 先在同一台 Mac/Windows 设备上记录旧版基线；再比较 idle 5min/30min、持续录制 5min、导出完成后 5min 的内存与 CPU；Rust/Tauri 技术路线必须由可复现的基准推动。

## 4. 生命周期、权限与可靠性

简单状态流程（**意图级 UI 状态**，不得替代已有录制会话源）：

```text
idle -> selecting -> selected -> recording -> finalizing -> done
   \       \          \         \             \
    \----cancel -------cancel----stop/cancel---error/recovery
```

- **只允许一个有效采集会话**；重复热键不触发并发录制，不造成不可关闭的浮层。
- Cancel selection：不写文件；Cancel recording：请求清理，若有用户可恢复数据须明确询问保留与否（非浏览器原生阻塞确认）。
- Stop：总是可执行且幂等；点击多次不会生成多个音视频片段或多个编辑器。
- Finalizing：展示进度/可取消导出；UI 刷新或崩溃后重启能报告临时文件，不标注虚假的成功。
- 对系统屏幕录制授权、麦克风、音频分别处理；授权不通过时仍允许本地非录制操作（若有相应系统能力）。
- 隐私：默认不自动上传、不记录截图图像到日志；临时文件有回收策略；贴图恢复需显式 opt-in。

## 5. 验收与测试（所有功能 PR 都须给实测证据）

### PR1：区域 MP4 / GIF 的最小闭环（Mac first）

- [ ] **P0**：应用失焦时全局唤起选择器；隐藏 HUD 时仍可开始/停止、暂停/恢复，不要求点击控制条。
- [ ] **P0**：快捷键自定义、禁用、重启持久化、注册冲突提示、退出释放有验证；与编辑器内快捷键分别列出。
- [ ] **P0**：Mac → UU → Windows 实测按键转发、录像暂停/恢复/停止与输出回放；浏览器模拟事件不算真实全局快捷键验收。
- [ ] **P0**：远程可见模式提示可能入镜；恢复隐藏偏好；取消只作用于用户确认的那一条录制。
- [ ] 快捷键进入选区；拖动矩形，支持 Esc 取消；工具栏不遮选区。
- [ ] 任意单显示器选区录制成功，输出可播放、尺寸与实际 rect 一致的 MP4。
- [ ] 停止后既可直接保存，也可进入现有 Recordly 编辑器，鼠标轨迹/自动变焦坐标正确。
- [ ] GIF 经现有导出链获得可用产物（转码需要等待时进度真实可见）。
- [ ] Retina / 非主显示器 / 负坐标布局 / 大小变化 / 小奇数宽高均有回归验证。
- [ ] 系统权限拒绝、热键冲突、重复停止、录制中拔屏、helper 异常都有可操作的退出状态。
- [ ] 选区、录制浮层、HUD 不进入输出画面；原有全屏/窗口录制和音频仍可用。
- [ ] 完成后无残留采集进程、纹理/帧缓存和失效监听。

### PR2：截图 / 贴图

- [ ] 物理像素分辨率正确、窗口边缘捕获准确、PNG/剪贴板一致。
- [ ] 贴图置顶、缩放/透明度/关闭能在 macOS 工作，不抢输入焦点。
- [ ] 贴图和选区层支持单独退出、没有残留屏幕捕获权限/进程占用。

### PR3：标注与自由颜色

- [ ] HEX/RGB/吸管和预设色板工作；编号 ①②③、撤销、重做、复制结果正确。
- [ ] 中文输入、屏幕缩放、窗口边缘弹层位置和主题切换验证。

### PR4：长截图 / 性能

- [ ] 纵向连续内容无断行/重复内容；失败可回退/重试/手工调整。
- [ ] 完成前后 5/30 分钟空闲占用有可复现对比，不能只报总内存未给基线。
- [ ] 形成是否迁移 Tauri/Rust、是否引入 Go 的测量结论。

**最小自动化**：坐标转换单元测试（包括奇数宽高/DPI/负坐标/边界钳制）、录制状态/取消/恢复测试、导出参数测试。**必须补充真实 macOS 截屏与视频回放验收**：CI 不等于系统采集正确。尽量复用现有测试框架，不写大批无意义测试。

## 6. PR 拆分与依赖

| PR | 范围 | 不应混入 |
| --- | --- | --- |
| **PR0（本文）** | 产品目标、交互图、API 草案、验收、许可证与性能基准 | 生产代码和依赖升级 |
| **PR1（P0）** | 全局唤起/控制/自定义与远控验收；Mac 区域选区 + 原生采集 + MP4/GIF + 现有编辑器接入 | 完整截图标注器、Rust 重构 |
| **PR2** | 截图 + 复制/保存 + 置顶贴图 | 复杂长截图算法 |
| **PR3** | 自由颜色、常用标注、编号 ①②③ | 替换现有时间线 |
| **PR4** | 长截图、性能基线、Windows 区域录制单独评估与交付 | 强制跨平台一次到位 |

同级 PR 的技术顺序可以视实际依赖调整，尤其 PR1、PR2 共享选区层时，**先把可独立测试的选区坐标模块作为 PR1 第一提交**。整个路线要先小样、真实 dogfood，再批量扩展。

## 7. 许可证、品牌与素材边界

- 本仓库 [`LICENSE.md`](../../LICENSE.md) 标注 AGPL-3.0，并附有衍生项目的署名和 Recordly 名称/品牌限制说明；改名分发前复核具体义务及第三方许可清单，不能把「开源」理解成任意闭源复用。
- Snipaste、PixPin 是**体验对照**，不复制它们的专有代码、图标或商业素材；需要移植实现时先确认明确授权。
- 任何新依赖均需要校验许可证兼容性、隐私风险与打包体积。
- 本文对兼容性为工程规划而非法律意见。

## 8. 尚待真实验证的决策

1. Mac capture target 构建后，`sourceRect` 的实际坐标系与 output width/height 在 Retina/跨显示器环境是否完全满足需求。
2. 现有录制产物与光标元数据能否无 schema 变化进入编辑器；若不行应提出精简适配层方案，而不是暗中建第二套状态。
3. Windows helper 当前 DXGI 窗口裁切逻辑是否能复用固定矩形，是否仍有 README 中所述的 WGC 后备路径。
4. macOS 贴图窗口置顶且鼠标穿透/多 Space/全屏应用行为如何保证；隐私录屏层的排除方式如何稳定实现。
5. GIF 的直出体验能否通过旧有 exporter 快速路径完成；若编码或性能不足，再规划独立转码策略。
6. 专业编辑器按需加载能省多少内存；未测量前不预设 Rust/Go 的胜者。

## 9. 官方技术参考

- Apple `SCStreamConfiguration.sourceRect`（显示器源矩形，单窗口无效）：https://developer.apple.com/documentation/screencapturekit/scstreamconfiguration/sourcerect
- Apple `SCStream`（捕获流与过滤器）：https://developer.apple.com/documentation/screencapturekit/scstream
- Microsoft `Windows.Graphics.Capture`（显示器/窗口捕获 API 参考，具体实现需与当前 DXGI helper 对齐）：https://learn.microsoft.com/en-us/uwp/api/windows.graphics.capture
- 上游 Recordly（捕获、编辑、导出）：https://github.com/webadderallorg/Recordly
- Snipaste 产品交互参考（参考产品而非移植代码）：https://www.snipaste.com/
