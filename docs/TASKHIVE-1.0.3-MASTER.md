# TaskHive 1.0.3（产品版本 1.1.0）唯一权威任务清单

更新时间：2026-09-09（Asia/Shanghai）  
唯一工作目录：`C:\Users\29925\Documents\TaskHive1.0.3`  
历史基线：`C:\Users\29925\Documents\TaskHive1.0.2`

## 版本标识（两个记号，分别指不同的东西）

本工作区同时存在两个版本记号。它们是**不同层的东西，不是笔误**；本清单叙述里出现的 `1.0.x` 一律指**发布线**，不指产品版本。

| 记号 | 含义 | 出现位置 |
|---|---|---|
| **1.0.3** | **工作目录 / 发布线**名称（承接 1.0.1 → 1.0.2 → 1.0.3，与 `TASKHIVE-1.0.1-MASTER.md`、`TASKHIVE-1.0.2-MASTER.md` 同一条线） | 目录名 `TaskHive1.0.3`、本清单标题、T016/T042/T043 等任务叙述、"三个版本共用 AppData"的记录 |
| **1.1.0** | **产品版本**，即构建产物自身的版本号 | `resources/app/package.json`、`TaskHive.exe` 的 `FileVersion` / `ProductVersion`、根目录 `release-manifest.json`、`%APPDATA%\TaskHive\runtime\runtime-owner.json` |

**为什么不能靠"改一处"来统一**：

- 产品版本是**单一来源** —— `app/main.js` 的 `APP_VERSION` 直接读 `resources/app/package.json`（不硬编码），用于消息展示与"共享 runtime 归属告警"（`shared-runtime-warning … thisVersion=`）。改 `package.json` 会连带改变该告警语义，也会让 exe 内已烧录的版本号与清单不符。
- 工作目录名被全树绝对路径引用（`profiles/directories.json`、`profiles/model-catalog.json`、CODESYS 授权路径、本清单 L4 等），**改名会打断这些引用**。
- exe 内的版本号只能在构建时写入；`release-manifest.json` 记录的 `sha256` 正是当前这个 1.1.0 产物。

**校验命令**（两者应当都输出 `1.1.0`）：

```powershell
(Get-Item TaskHive.exe).VersionInfo.ProductVersion
(Get-Content resources\app\package.json -Raw | ConvertFrom-Json).version
```

## 文档地位与工作规则

本文档是 TaskHive 1.0.3（产品版本 1.1.0）的唯一权威任务清单、实施记录、验证记录和上下文恢复入口。

1. 所有后续改动只能发生在 `TaskHive1.0.3`，不得回写旧版本。
2. 每项用户请求先登记任务编号；实现、验证、风险和修改文件必须在同一轮同步记录。
3. `已验证` 必须有实际检查证据；未运行的检查不得标记通过。
4. Harness/DSH 保持唯一 Agent 生命周期、会话和工具调度；不得新增第二个 Agent Loop。
5. 所有会话保留用户已确认的全本地路径权限；PLC 在线控制、下载、写变量、启停、复位、Force 和调试仍不由本轮功能触发。
6. CODESYS 的完整工程索引可留在本地审计存储，但不得作为永久普通聊天消息写入会话历史。

## 历史承接

`TASKHIVE-1.0.2-MASTER.md` 中 T001-T015 是 1.0.2 已登记历史，原状态不回写。本版本从 T016 连续编号。

## 当前有效任务（未收尾）

本清单**只列尚未收尾的任务**：待开始 / 待验证 / 待真实界面验证 / 待决策 / 待执行 / 待人工确认，共 **65** 条。
已收尾的任务（含已取消、已被取代，以及其余 `已验证`，共 48 条）**不再列在此表**。

| 编号 | 任务 | 状态 |
|---|---|---|
| T003 | 分析真实 CODESYS 写入耗时并增加分阶段计时 | 已实现待真实验证 |
| T005 | 修复 CODESYS 切换残留和长期运行后误报未打开 | 已实现待真实界面验证 |
| T006 | 允许 CODESYS 工程绝对路径访问 | 已实现待真实验证 |
| T007 | 降低长对话输入和渲染卡顿 | 已实现待真实界面验证 |
| T011 | 提供全会话全本地路径权限 | 已实现待真实 Harness 验证 |
| T017 | 对模型请求实行分层、受预算的会话上下文 | 已实现待验证 |
| T018 | 分离 CODESYS 临时工程上下文与普通聊天历史 | 已实现待验证 |
| T019 | 关闭 `distill` 自动复盘 | 已实现待验证 |
| T020 | 收紧 `dsh-mnemon` 自动召回和空闲写回 | 已实现待验证 |
| T021 | 关闭普通对话自动知识候选写盘 | 已实现待验证 |
| T022 | 限制专家团队上下文预算并保持显式启动 | 已实现待验证 |
| T023 | 复核长会话、CODESYS 与后台任务性能合同 | 待开始 |
| T026 | 升级 DeepSeek Harness 至最新上游版本 | 已验证；发布闭包待重算 |
| T035 | 全功能审计：性能、UI/UX、可访问性、测试覆盖与发布内容清理 | 已验证；发布清理待执行 |
| T039 | 验证并接入 GPT-6 模型 | 已验证；当前窗口重启后生效 |
| T047 | 支持 DeepSeek/Codex/Claude 等模型并支持自定义 API 接口 | 已验证（真实凭据调用待用户验收） |
| T051 | 任务拆解与多模型分发架构复核（专家插件定位） | 已取证待决策 |
| T062 | 思考行折叠修复无效，改为"永不点击思考行" | 已验证（运行时待用户复验） |
| T063 | 删除思考过程展示并修复 Codex 300 秒超时失败 | 已验证（客户端部分待重启后人工确认） |
| T064 | 修复切换 DeepSeek 模型后输入框模型选择消失/变成 TaskHive | 已验证（真实 DOM 取证；用户窗口待重启确认） |
| T069 | 消除 CODESYS 代码工作台的定时自动刷新，并建立工作台与对话的代码双向联动 | 已实现待真实界面验证 |
| T070 | 工作台项目树改为真实 CODESYS 多级树：区分设备与代码、可逐级展开 | 已实现待真实界面验证 |
| T071 | 修复工作台实测问题：读取慢、不能折叠、按钮点不到、顶层平铺 | 已实现待真实界面验证 |
| T072 | 修复"工程打开很久但项目树一直不加载"：改用 .~u 占用标记 + PID 配对识别当前工程，并给空树明确的下一步 | 已实现待真实界面验证 |
| T073 | 修复"等了 2 分钟却什么都没读到"：完整结果不再因 ScriptEngine 进程被结束而丢弃，并加入耗时分解与缓存预热 | 已实现待真实界面验证 |
| T074 | 工程识别严格限定在本插件打开的 CODESYS 实例：占用标记扫描按插件 PID 过滤 | 已实现待真实界面验证 |
| T075 | 代码区按 CODESYS 拆分为「声明」与「实现」两个编辑区，各自从第 1 行编号 | 已实现待真实界面验证 |
| T076 | 工作台只跟随 CODESYS 面板的"当前监视窗口"，不再跨窗口替换 | 已实现待真实界面验证 |
| T077 | TaskHive 退出时关闭自己启动的 CODESYS 实例（有未保存改动则保留），并清理崩溃残留 | 已实现待真实界面验证 |
| T078 | 修复 `workbench_propose` 返回 accepted 但提案未进入工作台读模型（读模型改为宿主队列 ∪ 页面状态，并加快领取） | 已实现待真实界面验证 |
| T079 | 去掉代码编辑区点击时的黑框：移除原生 tooltip 来源与 1.0.2 的黑色 focus 内环 | 已实现待真实界面验证 |
| T080 | 代码编辑区点击不再有任何视觉提示；项目树/编辑器与声明/实现改为可拖拽分隔条，可挤压其他区域至极限并记住比例 | 已实现待真实界面验证 |
| T081 | 提高项目树占用比例，把「当前工程」并进工作台顶栏，「代码任务/工程写入」压缩到一行并把省下的高度全给代码编辑器 | 已实现待真实界面验证 |
| T082 | 修复第三行（代码任务/工程写入）错位：合并成一条对齐的命令条；底部两行小字并成一行；按用户要求删除「全展开/全折叠」 | 已实现待真实界面验证 |
| T083 | 缩短命令条按钮文案，使默认 400px 侧栏下该行不再折行；把「不可写入」的原因从固定宽度状态词移到可伸缩详情 | 已实现待真实界面验证 |
| T084 | 修复顶栏（第一行）折行：低频工程操作图标化 + 容器查询分档，任何侧栏宽度下顶栏都落在一行 | 已实现待真实界面验证 |
| T085 | 删除命令条内与顶栏「刷新」完全重复的「重新检测」按钮，把省下的宽度给「不可写入的原因」 | 已实现待真实界面验证 |
| T086 | 「代码任务」改为命名命令「AI 审核」并移到顶栏；按下只发「命令 + 上下文引用」，管道说明交还系统提示；底部条变为纯「写入」条 | 已实现待真实界面验证 |
| T087 | 修复 T086 造成的"盲审"风险：消息补回"必须先读取快照"硬指令、宿主提示写明快照在工作区外可直接读；工程快照口径改为"全部有代码对象，按上限截断" | 已实现待真实界面验证 |
| T088 | 乙：读工具支持 `include:"project-snapshot"`，工程快照随实时状态发布并由工具按需返回，模型不再需要去读工作区外的文件 | 已实现待真实界面验证 |
| T089 | 状态续期心跳（每 5 分钟原样重发已持有状态，不探测不启引擎）；并修复 T088 的换绑工程残留旧快照缺陷 | 已实现待真实界面验证 |
| T090 | 修复 CODESYS 任务回合丢失用户命令、以及 64KB 字节上限导致中文工程快照被整体丢掉（回合变空）；底部状态行补上「已联动到会话 xxx」 | 已实现待真实界面验证 |
| T091 | 修复左侧栏 TaskHive 图标与文字消失（观察者只看 addedNodes，React 丢弃我们注入的节点时不重新注入）；品牌化所有匹配槽 | 已实现待真实界面验证 |
| T092 | 新增「会话记录」标签：真删会话文件回收磁盘（DSH 只有归档、无删除 API），并把官方归档与文件删除串成两步 | 已实现待真实界面验证 |
| T093 | 会话行「…」菜单里注入「彻底删除」：克隆现成归档项保样式，标题→会话 id 唯一匹配定位目标，运行中/当前会话一律拒绝 | 已实现待真实界面验证 |
| T093b | 现场实测修复：菜单项已注入成功，但定位卡在"标题不唯一"——改为**先合成 dragstart 取精确 id**，标题只作退路；标题改为只读行的直接子节点；拒绝时自动打开「会话记录」标签 | 已实现待真实界面验证 |
| T094 | 现场实测修复：会话日志版本不是固定的（应用 profile 写 **v2**、CLI 写 v3），只认 v3 导致"一个会话都找不到"，而归档那步让行消失造成"删成功"假象；改为**先删文件后归档**并用应用内对话框替换全部原生弹窗 | 已实现待真实界面验证 |
| T095 | 会话删除的确认框只说确认（去掉"这不是归档/无法撤销/写句柄"等无关文案）；「会话记录」面板重做外观（注入样式表，带 hover/选中/焦点态与独立操作栏） | 已实现待真实界面验证 |
| T096 | CODESYS 工作台在线功能：扫描设备 / 登录 / 断开 / 下载 + 在线变量（九项能力模型、会话绑定授权、IP 直连、顶栏一行动作、扫描弹窗） | 已实现待真实界面验证 |
| T097 | 修复「登录上了却看不到在线变量」+「有延迟卡顿」：登录改用 `Keep`（只登录、不传输）、变量名按所选对象解析、读值轮询去重与退避 | 已实现待真实界面验证 |
| T098 | 修复「扫描失败：EBUSY …online-worker.py」：在线会话启动做在途合并（并发只起一个 worker），脚本与命令/就绪/进度/停止/结果文件、工程副本全部带运行令牌 | 已实现待真实界面验证 |
| T099 | 停顿与目标可见性：工程探测节流（交互 45 秒 / 后台 5 分钟 / 宿主缓存 45 秒）、在线进程不再自动重启、常驻「在线目标」栏 + 登录/下载前确认设备 | 已实现待真实界面验证 |
| T100 | 在线值对齐原生 CODESYS：FB 实例按成员读值（`power.Status` 等）并显示成员摘要；实现区也按行显示所引用变量的当前值 | 已实现待真实界面验证 |
| T101 | 「扫描设备」改为底部面板（与「编译输出」同形态）：扫描已用时间 + 进程启动 / 缓存轮 / 实时广播 / 合计四段计时 | 已实现待真实界面验证 |
| T102 | 插件改名为「CODESYS 工作台」并统一图标（侧栏入口、顶栏标题、设置里的插件列表共用同一枚 SVG） | 已实现待真实界面验证 |
| T103 | 绑定即状态：「扫描设备」选中设备后自己变成「已绑定」；绑定写进作业元数据（在线进程重启/重开仍在），登录不再弹一次性设备确认框 | 已实现待真实界面验证 |
| T104 | 修复「点侧栏入口显示为空白」：工作台补上真正的错误边界（崩溃时显示可复制的错误块，而不是无声空白）；工作台标签名与插件名对齐 | 已实现待真实界面验证 |
| T105 | 修复「切屏即掉线」（卸载工作台就解绑并杀掉在线进程）；在线动作进行中提示（`⏳ 正在连接 PLC… · Ns`）；说明在线值的呈现方式 | 已实现待真实界面验证 |
| T106 | 「新界面 + 旧引擎」自证：主进程记录引擎文件 mtime + 新通道 `codesys:engine-freshness`，界面据此提示重启；扫描成功轮清掉上一轮错误 | 已实现待真实界面验证 |
| T107 | 绑定成为登录/下载的前置条件：未绑定时按钮禁用（黄色「目标 未绑定」chip），引擎侧同样拒绝 `CODESYS_ONLINE_TARGET_NOT_BOUND` | 已实现待真实界面验证 |
| T108 | IP 直连入口恢复可达（目标面板两条路都在：扫描设备 / IP 直连，未绑定也有引导 + 自动补拉网关）；在线进行中提示挪到最下面的状态栏 | 已实现待真实界面验证 |
| T109 | 未绑定不常驻告警：登录/下载保持可点，点了在**状态栏**说明；目标 chip 改中性「未选择」；绑定成功再提示一次 | 已实现待真实界面验证 |
| T110 | IP 直连并入「扫描设备」底部面板（不必先扫描，填 IP 直接用作目标）；目标弹层里的 IP/寻址方式字段删除，只留指路按钮 | 已实现待真实界面验证 |
| T111 | IP 行改用皮肤既有控件类名（不再自造外观）；目标状态不再常驻 chip，改为绑定/更换时状态行播报一次 | 已实现待真实界面验证 |
| T112 | 「在线目标」弹层整体删除：网关/节点地址/应用/释放会话/仿真备注全部搬进底部「扫描设备」面板，目标操作只剩一处 | 已实现待真实界面验证 |

> 逐条的验收标准与风险记录（T016-T043）保留在下方 `### 历史任务记录`；
> T044 起的实施与验证证据保留在本文档各自的 `## T0xx` 章节，**本次整理未删除任何详情章节**。

### 本次会话新增（2026-09-17 / 09-18，待分配 T 编号）

本会话的排查与修复**尚未挂 T 编号**（编号由用户指定）。完整根因、证据与复发信号见 `resources/app/docs/KNOWN-ISSUES.md`。

| 编号 | 任务 | 状态 |
|---|---|---|
| #6 | 冷启动就绪超时 `90000`→`180000` ms（`app/harness-runtime.js`） | 已修复；37 项契约 exit 0，**待冷启动复验** |
| #7 | `models:set-visible` 补守卫 + catalog 恢复 `gpt-5.5` 可见（`app/main.js`、`profiles/model-catalog.json`） | 已修复并验收 |
| #8 | 工程快照投递改为「确认送达」+ 唯一出口 `sendCodesysState`（`taskhive-surfaces/dsh/client.js`） | 已修复；**待重启后在工作台复验** |
| #9 | 会话路由基址改由 `TASKHIVE_API_BASE` 派生（`client.js` + 2 个契约） | 已修复；活体 harness 实测 `sessions.list` = 200 |
| — | 「会话记录」标签收进 `hidden: true`（保留会话菜单里的「彻底删除」） | 已改；**待重启看侧栏** |
| — | `profiles/directories.json` 陈旧路径重锚定（8 条 → 0 条失效） | 已修复 |
| — | `tests/run-contracts.js` 固定 `cwd`/`TASKHIVE_ROOT`，消除跨目录假失败 | 已修复 |
| — | **一次确认写入 = 一次 CODESYS 启动**：新增复合动作 `apply-and-build`（改文本 → 保存 → 离线编译 → 回读工程树，三步改为共享 helper） | 已实现；副本 A/B 实测 **128.7 s → 55.6 s（−57 %）**，**待重启后在真实工作台复验** |
| — | **编辑器草稿改为按对象存储**：切换对象不再丢失"待写入"内容；写入集合改为覆盖全部草稿，使"待写入计数"与实际写入集合一致（修 KNOWN-ISSUES #10） | 已修复；行为对照 7/7 PASS + 37 项契约 exit 0，**待重启后在真实工作台复验** |
| — | **顶栏新增独立「编译」入口**（宽档显示「编译」字样便于辨识，窄栏 <380px 自动退化为 26px 图标；Shift+点击 = 全量重建），新增可折叠的**编译输出面板**（计数 + 逐条消息文本 + 复制；写入时那次编译的消息也进同一面板）；顶栏移除「对话联动」徽章（底部状态行已显示），并按用户要求移除「复制工程路径」「资源管理器定位」两颗按钮 | 已实现；37 项契约 exit 0（含顶栏宽度预算 464/620、321/380、236/340、198/280），**待重启后在真实工作台复验** |
| — | **「选择工程」改为常驻**：绑定工程之后仍然可以点，方便第二次选择工程（原来只在未绑定/空树时才渲染） | 已实现；37 项契约 exit 0，**待重启后复验** |
| — | **修编译输出乱码**：CODESYS 控制台输出是 Windows ANSI 代码页（GBK），按 UTF-8 解会变成一片 U+FFFD。子进程改为按原始字节捕获 + 择优解码（`decodeProcessText`） | 已修复；真实工程副本实测 5/5 条恢复为真中文、0 个替换字符；37 项契约 exit 0 |

### 历史任务记录（T016-T043，仅备查，不再维护）

| 编号 | 任务 | 状态 | 验收标准 | 风险/后续 |
|---|---|---|---|---|
| T016 | 建立 1.0.3 基线、登记上下文性能诊断和优化范围 | 已验证 | 1.0.3 目录存在；完成影响插件与上下文链路只读诊断；本清单已建立。 | 旧版本保持不变。 |
| T017 | 将模型请求从固定长历史改为受预算的近期原文、会话摘要和按需检索 | 已实现待验证 | 已改为最近 8 条、28,000 字符预算和最多 4,500 字符提取式历史摘要；系统和工具定义也有预算。 | 需避免摘要遗漏未完成任务和用户约束。 |
| T018 | 将 CODESYS 工程上下文从普通会话历史分离为临时任务上下文 | 已实现待验证 | 完整工程审计快照仅本地保存；聊天消息只保留临时上下文路径，模型仅在当前 CODESYS 任务读取最多 28,000 字符的紧凑快照。 | 必须保留代码审计和绝对路径授权。 |
| T019 | 关闭 `distill` 自动复盘，改为显式手动触发 | 已实现待验证 | `distill` 默认值、配置回退值和 TaskHive profile 均为 `enabled: false`，普通回合不再自动启动复盘子代理。 | 当前只完成“关闭自动”部分；未新增独立手动按钮/命令，手动入口需后续明确设计。 |
| T020 | 收紧 `dsh-mnemon` 自动召回和空闲写回 | 已实现待验证 | `routingGuidance: false`、`recallMode: off`、`writebackMode: off`；显式记忆工具和已审核知识文件仍保留。 | 需隔离 Harness 验证服务 active 且显式调用可用。 |
| T021 | 关闭普通对话自动知识候选写盘，改为用户确认后沉淀 | 已实现待验证 | 普通会话知识 sink 由 `AUTO_CONVERSATION_KNOWLEDGE = false` 门控；专家显式运行后的候选保留。 | 需确认不会影响用户已有知识库读取和专家结果保留。 |
| T022 | 限制专家团队上下文预算并保持仅显式启动 | 已实现待验证 | 专家任务 4,000 字符、上游结果 4,000 字符、知识证据 3,000 字符、最多 3 条检索结果；仍仅由 `taskhive_expert_run` 显式调用。 | 复杂任务需要按需增加预算时再单独调整。 |
| T023 | 复核并量化长会话输入渲染、CODESYS 任务构造和后台任务性能 | 待开始 | 添加针对请求大小、后台触发和输入渲染的合同/性能检查。 | 真实 CODESYS 写入仍需用户离线工程验收。 |
| T024 | 评估 DSH/Harness 升级兼容性，决定是否迁移 | 已验证 | 已核对安装版本、上游发布和插件耦合；不直接替换运行时。 | 如迁移，必须在独立副本做完整兼容性和 packaged smoke。 |
| T025 | 重新核对 Harness 上游版本与本包升级必要性 | 已验证 | 已以 Git 远端标签和本地完整包版本复核：本包为 `0.1.0-rc.8`；稳定候选为 `0.1.2-rc.1`；远端 HEAD 为 `0.1.3-alpha.1`。 | `0.1.2-rc.1` 仅作为隔离迁移候选；当前不直接升级。 |
| T026 | 升级 DeepSeek Harness 至最新上游版本 | 已验证；发布闭包待重算 | 已安装 npm 最新 `@deepseek-ai/dsh@0.1.3-alpha.2`；静态检查、上下文合同和隔离 packaged UI smoke 通过。 | closure/SBOM 与发布哈希尚未重算；T034 记录独立品牌探针的选择器漂移。 |
| T027 | 修复 Windows 下 `fs-ext` 缺失导致的 DSH session-persistence 启动阻断 | 已验证 | Windows 分支不再在启动时强制导入 POSIX `fs-ext`；Windows 使用内置 Win32 semaphore 锁，POSIX 仍保留显式失败。 | 旧日志中的 `fs_ext.node` 堆栈属于修复前历史记录；发布前仍需重算 closure/SBOM。 |
| T028 | 兼容 DSH alpha.2 带 token 的 web URL，避免认证页/空白工作台 | 已验证 | `harness-runtime.js` 捕获 `dsh web: http://...?token=...` 并在 ready 状态暴露 `authUrl`；`main.js` 以 `URL.searchParams` 保留 token 并追加 TaskHive 参数。 | t040 隔离 packaged UI smoke 显示 Harness ready、非白屏、正常自动关闭。 |
| T029 | 修复 `taskhive-surfaces` 全量 DOM 轮询导致的长会话输入卡顿和 UI smoke 卡死 | 已验证 | 长会话页面不再每 250ms 遍历 `body *`、读取全部 `innerText` 和布局；t040 真实工作台可响应并完成所有插件探针。 | 真实用户长会话下的体感仍需后续人工验收。 |
| T030 | 修复 DSH alpha.2 工作区快照方法未绑定导致的工作台白屏 | 已验证 | `workspaces.list` 以 React 外部存储安全方式传递；t040 首帧渲染且无 `refreshSnapshot` 错误。 | 上游 alpha 运行时补丁，后续上游版本需复测。 |
| T031 | 兼容 DSH alpha.2 工作区就绪快照，恢复默认工作区和会话创建 | 已验证 | 隔离 profile 自动创建默认工作区/会话，侧栏入口可用；未触及用户 profile。 | 保持仅通过官方工作区和会话接口操作。 |
| T032 | 兼容 DSH alpha.2 会话事件快照并验证会话归档 | 已验证 | t040 `session-delete-probe.json` 为 `ok:true`，官方 `uiWorkspace.archiveSession()` 后当前会话保留、归档行消失。 | 仅验证隔离 profile。 |
| T033 | 恢复 alpha.2 URL 归一化后的 Web AI descriptor，并修复嵌入 CODESYS 首次打开竞态 | 已验证 | 回退 descriptor 包含浏览器；嵌入 renderer 串行化 surface 切换。t040 `plugin-right-sidebar-probe.json` 四项均 `ok:true`，CODESYS 首次加载出现 `#vision-status` 和 6 个控件。 | 不触及用户运行中的 CODESYS/TaskHive 进程。 |
| T034 | 移除 DeepSeek 品牌图标并保留原生 DSH 界面 | 已验证 | 已删除 TaskHive 替换品牌、输入区/预览/模式隐藏、侧栏折叠图标改写和自定义恢复按钮；仅删除 DSH 原生 `sidebar.brand.mark` 中的图标 SVG。 | t057 隔离 packaged UI smoke 确认只移除图形标记，保留原文字、输入区、预览版和折叠按钮。 |
| T035 | 全功能审计：性能、UI/UX、可访问性、测试覆盖与发布内容清理 | 已验证；发布清理待执行 | 已完成代码审计、模型请求探测、合同测试、关闭确认框焦点隔离、t044 全插件 smoke 及 t045 视觉细节修改后的 packaged UI smoke。关闭确认框改为 8px 圆角和正常字距。 | 发布目录中的备份、QA profile、日志和历史文档须在 T040 归档、重算 closure/SBOM/hash 并复测后才可删除。 |
| T036 | 修复多模型对话的默认路由、超时与错误分类 | 已验证 | 默认模型统一为 `codex-cli/gpt-5.5`；Codex 请求 120 秒超时；未知模型返回 `MODEL_NOT_FOUND`，流式断线给出可操作提示。四类自定义适配器均实现 DSH alpha.2 所需的 `prepareCall`。隔离适配器实测 `gpt-5.5` 返回 DSH 流事件，t046 真实工作台不再出现 `prepareCall` 错误。 | 已隐藏本机未验证的 `gpt-5.6-*` 路由；其他第三方提供方需在完成配置后各自验收。 |
| T037 | 修复流式对话期间皮肤观察器造成的点击迟滞 | 已验证 | 主皮肤观察器不再监听 `characterData`，只将相关新增根节点加入队列后局部处理；登录标记只检查已变更文本节点。 | 真实长会话下的主观点击延迟仍建议人工验收。 |
| T038 | 恢复完整合同测试入口并补充模型、性能与可访问性覆盖 | 已验证 | `npm test` 调用 `tests/run-contracts.js` 并通过；新增模型路由、适配器 `prepareCall` 兼容、皮肤性能、关闭确认框可访问性合同，更新 CODESYS workbench 断言。 | 仍缺少 200% 缩放和真实用户长会话的人工回归。 |
| T039 | 验证并接入 GPT-6 模型 | 已验证；当前窗口重启后生效 | 使用当前 Codex 可识别的 `gpt-6-astra`，目录显示为 `GPT-6 Astra`；隔离模型烟测在输入框目录中同时检出 `GPT-6 Astra` 与 `GPT-5.5`，首次目录打开约 63ms。 | 未将模型设为默认路由；实际请求仍须以用户账号的 Codex 后端权限为准。 |
| T040 | 发布前归档和清理可移除的历史运行内容 | 已提供工具，待执行清理 | 已新增 `resources/app/tools/clean-release.ps1`（默认 dry-run），实测可回收 1026 MB / 29292 个文件；图标旧代已全部迁移到 v3，脚本带"仍被引用则拒绝删除"前置校验。 | 实际删除需人工执行 `-Apply`；已泄露的 18 份 QA 会话密钥须轮换。 |
| T041 | 修复插件打开时的右栏覆盖、自动终端与点击迟滞 | 已验证 | 打开四个插件均保留原生右栏；知识库不再覆盖右栏菜单；插件切换不自动点击底部终端。 | 已使用隔离 profile 验证；用户当前窗口须重启以加载本轮客户端脚本。 |
| T042 | 复用 1.0.2 的 TaskHive 主题皮肤并撤销 1.0.3 的 UI 布局替换 | 已验证 | 1.0.2 的 TaskHive 皮肤（品牌按钮/折叠栏图标/输入区品牌/权限重复项隐藏/内测提示关闭/公开推理摘要/无障碍名称回填）已移植回 1.0.3，并改写到 1.0.3 的增量扫描架构上。 | 未恢复 1.0.2 的 250 ms 全页 interval；`ui-branding-probe.json` 折叠加固仅作证据不计入 ok。 |
| T043 | 修复 1.0.3 全功能审计发现的问题 | 已验证 | P0/P1/P2/P3 共 20 余项已修复并逐一验证，详见下方"审计整改记录"。 | slot closure/SBOM 仍需上游闭包工具重算；AppData 共享仍为跨版本风险。 |

## 审计整改记录（T042-T043）

本节记录 2026-09-12 全工作区只读审计后的整改。审计首先在 `resources/app` 上执行，随后按用户要求"复用 1.0.2 主题皮肤并修复检测出的问题"实施。

### 主题皮肤（T042）

`resources\app\plugins\installed\taskhive-surfaces\dsh\client.js` 的 1.0.2 与 1.0.3 差异为 498 行：T034 曾把整套 TaskHive 皮肤替换为单一的"删除 DeepSeek 图标"。本轮把 1.0.2 的皮肤函数全部移植回来，但**没有**恢复 1.0.2 的 `setInterval(scrub, 250)` 全页扫描，而是接到 1.0.3 的 `scheduleScrub` 增量队列上，并给每个遍历 `innerText`/`getBoundingClientRect` 的辅助函数加了 `textContent` 廉价前置判断。恢复内容：

| 能力 | 标记/函数 |
|---|---|
| 侧栏品牌按钮替换为 TaskHive 图标+文字 | `ensureBrandButton`、`data-taskhive-workbench-brand` |
| 折叠栏图标替换（同时移除原生 DeepSeek 图形标记） | `ensureCollapsedRailIcon`、`data-taskhive-sidebar-rail-icon` |
| 输入区品牌替换 | `replaceComposerBrand`、`data-taskhive-composer-brand` |
| 权限/访问模式重复项隐藏 | `hideComposerDuplicate`、`data-taskhive-composer-permission` |
| 内测/预览提示自动关闭 | `dismissInternalPreviewNotice` |
| 公开推理摘要（不新建或记录隐藏思维链） | `syncDeepDivingDisclosures`、`__TASKHIVE_SYNC_DEEP_DIVING__` |
| 无障碍名称回填 | `backfillAccessibleNames` |

`alpha.2` 会在认证后剥离 `taskhiveIcon` 查询参数，因此品牌图标改为经 `window.taskhive.harnessUrl()` 回取（`resolveTaskhiveBrandIcon`），取回后重新触发一次皮肤扫描。

### 代码缺陷整改（T043）

| 编号 | 文件 | 缺陷与修复 |
|---|---|---|
| A1 | `app/main.js` | `writeDshPatch()` 只为 distill 生成 `config`，其他插件的 `cordis.patch.yml` 配置整体丢失。新增 `declaredInsertConfig()` 解析并保留缩进，使 `dsh-mnemon` 的 `recallMode: off` / `writebackMode: off` / `routingGuidance: false` 真正生效。 |
| A2 | `app/main.js` 等 5 个文件 | `terminal:*`、`codesys:input-*`、`codesys:native-host-detach` 无发送方校验；`codesys:input-direct` 由调用方数据自批准。新增 `isTrustedSender()`；AI 输入新增主进程侧 `codesys:input-arm` 门控，必须由 shell 的真实用户手势开启，停止监视即解除。 |
| A3 | `app/main.js` | 两个带 preload 的窗口没有导航守卫，且 `harness:url` 返回带 token 的 URL。新增 `guardWorkbenchNavigation()`（`will-navigate` + `setWindowOpenHandler`，只允许 file/about/devtools/localhost harness）。 |
| A4 | `app/main.js` | 启动 promise 无 `.catch`，`uncaughtException` 只记日志后继续。新增 `reportFatal()`；`unhandledRejection`/`uncaughtException` 记日志+弹窗+`app.exit(1)`。 |
| A5 | `app/main.js` | 无单实例锁，双实例并发写同一 profile。新增 `app.requestSingleInstanceLock()`（smoke 模式豁免）。 |
| A6 | `app/main.js` | DSH 启动失败后仍继续 `createWindow()`，且"正在加载工作区"覆盖了失败态 splash。改为失败即抛出并给出可操作错误。 |
| A7 | `app/main.js` | `ensureLayout()` 在模块加载期写程序目录，只读安装会静默死亡且无日志。新增 `reportBootstrapProblem()`，`mkdir`/模型目录写盘改为非致命。 |
| A8 | `app/harness-runtime.js` | `start()` 存在 check-then-await 竞态可拉起两个 DSH；`stop()` 不清 `url` 导致失败后仍加载死地址；spawn 无 `error` 监听。分别用 `starting` promise、清理地址、`error` 监听修复。 |
| A9 | `app/win-window-monitor.ps1`、`app/windows-monitor.js` | capture 模式无 HWND 身份校验且 `CopyFromScreen` 回退会截取任意屏幕内容。已加 `IsWindow`+`-ExpectedPid`+进程名校验，**移除** `CopyFromScreen`，并在 PID 变化时失效窗口缓存。 |
| A10 | `app/renderer/renderer.js` | 15 分钟轮询循环的停止条件会被重建的 DOM 重置，且每秒 spawn 一个 PowerShell。改为 generation token + 进程消失 90 秒即退出 + 每轮 surface 校验。另修 `startStream` 重入、`setInterval` 代际复查、多处 await 后 DOM 空引用。 |
| A11 | `app/directory-manifest.js` | junction 被计为文件（清单 127217/16306 → 实际 96212/16307/31009 联接）；每次刷新同步重算 225 MB exe 的 sha256；整根目录监听见易变目录也触发全量重扫；`statSync` 对消失条目抛错。均已修复并加 `linkCount` 列。 |
| A12 | `plugins/.../taskhive-codex-model/dsh/index.js` | spawn 的 CLI 子进程与 stdin 无 `error` 监听（ENOENT/EPIPE 可杀进程）；模型可见性读不到 catalog 时 fail-open 暴露 `gpt-5.6-*`；stderr 上限按块而非累积；Ollama 端点硬编码。均已修复。 |
| A13 | `plugins/.../taskhive-surfaces/dsh/index.js` | `knowledge/cards.json` 无锁非原子读改写且无上限。改为临时文件+`renameSync`、promise 队列串行、上限 500 并优先保留未终结状态卡片。 |
| A14 | `plugins/.../taskhive-surfaces/dsh/client.js` | `new MutationObserver(publish)`/`new ResizeObserver(publish)` 把 entry 数组当作 `force` 参数，双帧稳定逻辑从未生效；右栏折叠检测只匹配中文；`__TASKHIVE_SKIN_DISPOSE__` 从不被调用；新增图片时升级为全文档扫描；smoke 探针在生产无条件暴露。均已修复。 |
| A15 | `app/main.js`、`app/renderer/index.html` | 图标 v1/v2/v3 三代共存且 v1 仍被模板引用。已把 `index.html` 与 `main.js` 的 v1 引用迁到 v3，旧代图标现全部无引用。 |
| A16 | `resources/app/package.json` | 5 个脚本指向不存在的文件（`tools/package-release-exe.ps1`、`tests/portable-links.js`、3 个 `.mjs`）。已改为指向真实文件并新增 `clean:release`。 |
| A17 | `release-manifest.json` | 带 UTF-8 BOM，严格 `JSON.parse` 会抛错。已去 BOM。 |
| A18 | `app/main.js` | 错误文案硬编码 `1.1.1`。新增 `APP_VERSION` 常量（读 package.json），消除版本漂移。 |
| A19 | `app/harness-runtime.js` | `--expose-internals` 被当作可选项移除后，DSH 插件树解析全部失败（见下）。已恢复并注释为必需。 |
| A20 | `app/main.js` | `--smoke` 无条件写 `ok:true`。改为断言 Harness ready + 主窗口存活 + splash 已回收，轮询至稳定（上限 30 s），并据此设置退出码。 |
| A21 | `app/main.js` | `fs-ext` 补丁是 pnpm store 内的裸改，`pnpm install` 会静默还原。新增开机自愈 `repairHarnessRuntimeFsExt()`（幂等，已验证对已打补丁的 slot 为空操作）。 |
| A22 | `harness/runtime/slot/manifest.json` | 清单声称 `productionEligible:false` / `electronSmoke: failed-fs-ext-native-module`，与文档"已验证"矛盾；payload 计数与实际不符；SBOM 是旧 slot 的副本；`IMMUTABLE` 仍是旧闭包哈希。已按实测重写计数、更正闸门为 `passed` 并附证据、标注 SBOM 陈旧与未决项；`IMMUTABLE` 刻意未改写以免伪造。 |

### 关键教训：`--expose-internals` 是必需项

审计曾把 `harness-runtime.js` 里的 `--expose-internals` 判为应当移除的过度授权。移除后 `TaskHive.exe --smoke` 从 `ok:true` 变为**致命失败**：

```
Error: dsh: plugin tree failed to load: failed to apply loader entry include (cordis:include)
Error: failed to import loader entry taskhive-codex-model (taskhive-codex-model):
  Cannot find package 'taskhive-codex-model' imported from .../cordis-plugin-loader/lib/index.js
```

五个通过 patch `insert` 挂载的插件全部解析失败，`cordis:include` 阶段中止，DSH 进程退出，工作台页面无法加载。恢复该 flag 后两次连续 smoke 均 `ok:true`（约 14 s，退出码 0）。这同时解释了历史记录的 21–82 秒冷启动：那些时间花在插件树反复重试上；插件树正常加载后 `ready elapsedMs` 降到约 4.9 秒。

**该 flag 不得移除**，除非重跑 `TaskHive.exe --smoke` 验证。此结论已写入代码注释与 slot manifest。

### 验证证据（T042-T043）

| 日期 | 检查 | 结果 | 证据 |
|---|---|---|---|
| 2026-09-12 | `node --check` 全部改动文件 | 通过 | `main.js`、`harness-runtime.js`、`preload.js`、`renderer.js`、`windows-monitor.js`、`directory-manifest.js`、`client.js`、`index.js`、`win-window-monitor.ps1`（PowerShell 语法树解析 `PARSE OK`） |
| 2026-09-12 | `npm test`（`tests/run-contracts.js`） | 通过 | 19 个合同全部通过，退出码 0 |
| 2026-09-12 | 皮肤合同重写 | 通过 | `skin-performance-contract.js` 现同时断言"1.0.2 主题已安装"与"T029/T037 性能性质未被破坏" |
| 2026-09-12 | 后台上下文合同加强 | 通过 | 现断言生成的 patch 必须携带 mnemon config，而不只是插件自身声明 |
| 2026-09-12 | `TaskHive.exe --smoke` 连续两次 | 通过 | `electron-smoke.json`：`ok:true`、`runtime.state=ready`、取得 `authUrl`、`mainAlive:true`、`splashAlive:false`、`windows:1`；两次退出码 0，约 13.5 s / 14.1 s |
| 2026-09-12 | 实时 profile patch 校验 | 通过 | `%APPDATA%\TaskHive\runtime\profiles\dsh\taskhive.patch.yml` 含 `dsh-mnemon` 完整 config（`recallMode: off`、`writebackMode: off`、`routingGuidance: false` 及嵌套 `recallQuality`） |
| 2026-09-12 | 清理工具 dry-run | 通过 | `clean-release.ps1` 报告 7876 个目标 / 29292 个文件 / 1026.0 MB 可回收，图标前置校验通过（21 个已无引用）；未删除任何文件 |
| 2026-09-12 | 目录清单生成器 | 通过 | 重算为 96212 文件 / 16307 目录 / 31009 联接，`文件+目录+联接 = 143528` 与独立遍历完全一致；exe 长度与 sha256 与 `release-manifest.json` 一致 |

### 仍未完成

1. **slot closure/SBOM**：本检出不含产出原闭包哈希的 `taskhive-harness-closure` 工具，因此 `closure.sha256` 未填、`sbom.cdx.json` 仍为旧 slot 副本。不得用替代值填入这些字段（提升闸门把它当身份使用）。已写入 `manifest.json` 的 `openItems`。
2. **`IMMUTABLE`** 仍保存旧 slot 闭包哈希 `0bd8dace…`；刻意未改写，因为本检出无法计算新值。
3. **凭据轮换**：被移除的 18 份 QA profile 内含真实 DSH 会话密钥与 127.0.0.1 认证 cookie。文件删除不等于失效，若该包曾分发须轮换。
4. **AppData 共享**：1.0.1 / 1.0.2 / 1.0.3 共用 `%APPDATA%\TaskHive\runtime`，`workspace-path-repair.log` 记录路径在三个版本间来回翻转。按版本隔离 runtimeRoot 会迁移用户会话与知识库，属产品决策，未擅自更改。
5. **真实 CODESYS 验收**：capture 身份校验、AI 输入 arming、皮肤在真实长会话下的手感仍需人工在真实 CODESYS 工程上确认。
6. **目录清单全量扫描**：单次刷新仍约 10 秒（14 万条目同步扫描）。已消除易变目录触发的重复重扫，但非易变目录变更触发的重扫仍会占用主线程。

## Harness 版本决策

- 当前安装：所有核心 `@deepseek-ai/dsh*` 包为 `0.1.0-rc.8`，`@deepseek-ai/cordis` 为 `4.0.1`。
- 上游：本轮通过 `git ls-remote` 实测，最新稳定候选仍为 `dsh-v0.1.2-rc.1`；远端 `HEAD` 已是 `dsh-v0.1.3-alpha.1`，属于预发布 alpha，不作为生产升级目标。
- 当前执行：用户已明确要求升级，T026 目标已落实为 npm `@deepseek-ai/dsh@0.1.3-alpha.2`（alpha dist-tag）。已完成完整依赖族升级；Windows `fs-ext` 启动阻断、token URL、工作区快照、会话归档、完整隔离 UI smoke 及 T034 品牌图标移除均已验证。closure/SBOM 与发布哈希仍是发布前项。

## 当前进行项

T034：已验证。DSH 保持原始布局、配色、图标和输入区；仅移除了原生 `sidebar.brand.mark` 图形标记，不插入 TaskHive 标识或折叠恢复控件。t057 最终截图和品牌探针均通过。

T035-T038：审计中可安全落地的优化已完成。皮肤插件由全页扫描改为局部增量处理；模型目录与默认路由统一为已验证的 `codex-cli/gpt-5.5`；请求失败提供超时、未知模型和流式断线的明确错误；四类自定义适配器已适配 DSH alpha.2 的 `prepareCall` 生命周期；测试入口恢复并覆盖模型、性能和关闭确认框焦点管理。关闭确认框的圆角和字距也已与应用紧凑工具界面统一。

T039：已接入当前 Codex 目录使用的 `gpt-6-astra`，显示名为 `GPT-6 Astra`，同时保留 `GPT-5.5` 默认路由。隔离模型烟测确认二者均出现在输入框模型目录；桌面端不会热更新已启动窗口，因此现有窗口需要完整重启后才会显示新项。

T040：可清理候选须先迁出或归档再复测：`harness/runtime/slot-before-dsh-0.1.3-alpha.2`（约 70.9 MB 的升级前备份）、根目录 `_qa_runtime_t007` 至 `_qa_runtime_t044`（隔离 QA profile）、`resources/app/logs`（测试证据和运行日志）、根目录历史任务清单。图标暂不删除：主进程使用 `taskhive-icon-v3-*`，Electron 外壳仍使用旧 `taskhive-*.png`，需统一引用后才能安全清理旧资源。

T041：插件入口仅在原生右栏实际处于折叠状态时才展开它；不再把共享的左栏折叠标记当作右栏状态。右栏切换后客户端强制重新发布稳定边界，主进程因此不会保留知识库打开前的 78px 右栏预留。原生折叠图标继续保留，插件点击不再自动打开底部终端。

## 修改文件索引

| 日期 | 任务编号 | 文件 | 变更摘要 |
|---|---|---|---|
| 2026-09-07 | T016/T024 | `TASKHIVE-1.0.3-MASTER.md` | 建立 1.0.3 权威清单；记录上下文插件诊断和 Harness 升级决策。 |
| 2026-09-07 | T017 | `resources/app/plugins/installed/taskhive-codex-model/dsh/index.js` | 请求改为分层、受字符预算的历史构造；旧 CODESYS 上下文不再重放。 |
| 2026-09-07 | T018 | `resources/app/app/main.js` | 保存独立的紧凑模型上下文文件，并在请求记录中返回受控路径。 |
| 2026-09-07 | T018 | `resources/app/plugins/installed/taskhive-surfaces/dsh/client.js` | CODESYS 聊天消息只携带临时上下文引用；工程审计快照留在本地。 |
| 2026-09-07 | T017/T018 | `resources/app/tests/context-budget-contract.js` | 新增上下文预算与临时 CODESYS 上下文合同。 |
| 2026-09-07 | T025 | `TASKHIVE-1.0.3-MASTER.md` | 追加 T001-T025 全部任务总览，记录本轮 Harness 实测版本与不直接升级决定。 |
| 2026-09-07 | T019 | `resources/app/plugins/installed/distill/lib/index.js` | 默认关闭自动复盘；profile 显式配置 `enabled: false`。 |
| 2026-09-07 | T020 | `resources/app/plugins/installed/dsh-mnemon/cordis.patch.yml` | 关闭自动召回、自动写回、路由提示和空闲复查路径。 |
| 2026-09-07 | T021 | `resources/app/plugins/installed/taskhive-surfaces/dsh/index.js` | 关闭普通会话自动知识 sink，保留专家显式结果沉淀。 |
| 2026-09-07 | T022 | `resources/app/plugins/installed/taskhive-surfaces/dsh/index.js` | 增加专家团队上下文预算常量并收紧任务、上游结果和知识召回上限。 |
| 2026-09-07 | T019-T022 | `resources/app/tests/background-context-contract.js` | 新增后台上下文开关与专家预算合同测试。 |
| 2026-09-07 | T026 | `TASKHIVE-1.0.3-MASTER.md` | 登记并更新 DeepSeek Harness 升级任务；目标落实为 npm `0.1.3-alpha.2`，记录原生模块阻塞与备份路径。 |
| 2026-09-08 | T027 | `resources/app/harness/runtime/slot/payload/node_modules/.pnpm/@deepseek-ai+dsh-session-pe_daffd0ccc7727ecb254d38694ee5384f/node_modules/@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js` | Windows 启动时跳过强制 `fs-ext` 导入，改用 Win32 semaphore 锁。 |
| 2026-09-08 | T028 | `resources/app/harness-runtime.js`; `resources/app/app/main.js` | 捕获并保留 DSH alpha.2 的 token URL，追加 TaskHive 查询参数时不丢失认证令牌。 |
| 2026-09-08 | T031 | `resources/app/plugins/installed/taskhive-surfaces/dsh/client.js` | alpha.2 认证后清除页面查询参数时，经只读 Electron 桥重新取得主进程生成的默认工作区路径；为工作区初始化增加并发抑制和 session 状态订阅。 |
| 2026-09-08 | T031 | `resources/app/plugins/installed/taskhive-surfaces/dsh/client.js` | 将认证后无查询参数时使用的 surface 回退描述同步到权威插件目录：CODESYS、插件管理、知识库、专家均作为左侧真实入口，避免 CODESYS 入口消失。 |
| 2026-09-08 | T032 | `resources/app/plugins/installed/dsh-mnemon/lib/index.js`; `resources/app/plugins/installed/taskhive-surfaces/dsh/client.js` | 为 alpha.2 使用 `snapshotEvents()` 的会话对象增加只读事件兼容层；为隔离烟测暴露原生重命名操作，以可靠定位真实会话行。 |
| 2026-09-08 | T032 | `resources/app/app/main.js` | 修复会话归档烟测注入脚本中的嵌套模板字符串语法错误；归档测试名改为普通字符串拼接，避免阻断桌面主进程加载。 |
| 2026-09-08 | T032 | `resources/app/plugins/installed/taskhive-surfaces/dsh/client.js`; `resources/app/app/main.js` | 将隔离归档烟测接入 DSH alpha.2 官方 `uiWorkspace.archiveSession()`；验证工作区归档投影和真实侧栏行消失，不再依赖悬停菜单的内部 DOM 结构。 |
| 2026-09-08 | T032 | `resources/app/app/main.js` | 修正 alpha.2 归档烟测断言：归档会话会保留在控制器会计索引，验收改为归档集合回显、当前会话保持不变及侧栏行消失。 |
| 2026-09-08 | T033 | `resources/app/plugins/installed/taskhive-surfaces/dsh/client.js`; `resources/app/app/main.js` | 补回 alpha.2 URL 归一化后丢失的浏览器 descriptor；侧栏探针复用真实 surface 就绪合同并记录失败原因。 |
| 2026-09-08 | T033 | `resources/app/app/renderer/renderer.js` | 串行化嵌入 surface 渲染，防止初始 chat 异步渲染覆盖首次 CODESYS 打开请求。 |
| 2026-09-08 | T034 | `resources/app/app/main.js`; `TASKHIVE-1.0.3-MASTER.md` | 品牌验证优先定位左侧栏无文案 `_toggle` 控件，并写入触发器与收起后几何证据；待隔离 packaged UI smoke。 |
| 2026-09-09 | T035 | `TASKHIVE-1.0.3-MASTER.md` | 登记全功能审计范围：点击性能、UI/UX、可访问性、测试覆盖及发布内容清理；本轮仅进行只读诊断。 |
| 2026-09-09 | T035 | `TASKHIVE-1.0.3-MASTER.md` | 写入审计结论和实施顺序：增量皮肤渲染、统一 UI 权属、校正模型配置、恢复测试入口、发布闭包与归档清理。 |
| 2026-09-09 | T035/T038 | `resources/app/app/preload.js`; `resources/app/package.json`; `resources/app/tests/run-contracts.js`; `resources/app/tests/*-contract.js` | 修复关闭确认框焦点隔离和视觉细节；恢复合同测试入口，新增模型路由、适配器兼容、皮肤性能和关闭确认框可访问性检查。 |
| 2026-09-09 | T036 | `resources/app/app/main.js`; `resources/app/profiles/model-catalog.json`; `resources/app/plugins/installed/taskhive-codex-model/dsh/index.js` | 默认路由统一为 `codex-cli/gpt-5.5`；增加 120 秒请求超时、未知模型和流式断线错误分类，补齐 DSH alpha.2 `prepareCall` 兼容，隐藏未验证的 5.6 路由。 |
| 2026-09-09 | T037 | `resources/app/plugins/installed/taskhive-surfaces/dsh/client.js` | 将皮肤 DOM 处理改为相关根节点的排队增量处理，移除主观察器的字符数据监听和全页文本遍历。 |
| 2026-09-09 | T039/T040 | `TASKHIVE-1.0.3-MASTER.md` | 记录 GPT-6 后端拒绝证据及发布前归档、closure/SBOM/hash 和 packaged smoke 的清理顺序。 |
| 2026-09-09 | T034 | `resources/app/plugins/installed/taskhive-surfaces/dsh/client.js`; `resources/app/app/main.js`; `resources/app/tests/skin-performance-contract.js` | 撤销对原生 DSH 的品牌、输入区、预览、模式、思考和侧栏折叠覆盖；仅删除小尺寸 DeepSeek 品牌容器中的图标，并将 smoke 探针改为验证无覆盖注入和无可见品牌图标。 |
| 2026-09-09 | T034 | `resources/app/plugins/installed/taskhive-surfaces/dsh/client.js`; `resources/app/app/main.js`; `resources/app/tests/skin-performance-contract.js` | 将目标收窄为 DSH alpha.2 原生 `sidebar.brand.mark` SVG；新增最终品牌检查，避免 React 重绘后图标回显。 |
| 2026-09-09 | T039 | `resources/app/profiles/model-catalog.json`; `resources/app/app/main.js`; `resources/app/plugins/installed/taskhive-codex-model/dsh/index.js`; `resources/app/tests/model-routing-contract.js` | 接入 `gpt-6-astra`，显示为 `GPT-6 Astra`，并保留 `GPT-5.5` 作为默认路由。 |
| 2026-09-09 | T041 | `resources/app/plugins/installed/taskhive-surfaces/dsh/client.js`; `resources/app/tests/skin-performance-contract.js` | 右栏状态改为读取原生右栏按钮；右栏展开后强制重新发布稳定几何，修复知识库覆盖右栏菜单。 |
| 2026-09-15 | T081 | `resources/app/plugins/installed/taskhive-surfaces/dsh/client.js` | 工作台改为三行带紧凑布局：「当前工程」并进顶栏，「代码任务」去掉输入框只留一个交给 AI 的按钮，「工程写入」压成一行（状态+核对+重新检测+确认写入）；项目树默认份额 0.42→0.52；图例/状态/安全声明各收成一行，省下的高度全给代码编辑器。 |
| 2026-09-15 | T081 | `resources/app/tests/codesys-workbench-compact-layout-contract.js` | 新增紧凑布局合同：三行带结构、当前工程归属顶栏、代码任务无输入框、工程写入单行、树份额默认值、图例不换行、安全声明单行；并断言被移除的功能区不得回潮。 |
| 2026-09-15 | T081 | `resources/app/tests/codesys-project-tree-contract.js` | 树份额默认值断言从 0.42 更新为 0.52（T081 提高项目树占用比例）。 |
| 2026-09-15 | T082 | `resources/app/plugins/installed/taskhive-surfaces/dsh/client.js` | 第三行错位根因修复：`代码任务`（裸按钮 30px）与 `工程写入`（带框 38px）合并为**一条** `taskhive-codesys-commandbar`（单边框、单基线、等高），状态色移到这条上；底部 `status` + `safety` 由两行并成一行 `taskhive-codesys-statusrow`，安全声明收成右侧 `ⓘ 安全边界`；删除 `全展开/全折叠`。 |
| 2026-09-15 | T082 | `resources/app/tests/codesys-workbench-compact-layout-contract.js` | 按合并后的单条命令条与单行小字更新断言，并新增「两个盒子不得回潮」「status/safety 不得再各自成带」「全展开/全折叠不得回潮」。 |
| 2026-09-15 | T082 | `resources/app/tests/codesys-project-tree-contract.js` | 删除 2 条「expand-all/collapse-all must exist」断言，改为断言 `data-codesys-tree-expand` 不再出现。 |
| 2026-09-15 | T083 | `resources/app/plugins/installed/taskhive-surfaces/dsh/client.js` | 命令条文案缩短：`代码任务 · 交给 AI`→`代码任务`、`工程写入`→`写入`、`已核对差异`→`已核对`、`确认写入工程（离线编译）`→`确认写入`（完整含义全部保留在各自 title）；条内间距 6px→5px；状态词改为 `可写入／等待 AI 改动／不可写入`，**不可写入的原因**改由可伸缩的 detail 文案承载；`title`/`data-*` 钩子全部不变。 |
| 2026-09-15 | T083 | `resources/app/tests/codesys-workbench-compact-layout-contract.js` | 更新为缩短后的文案断言，并新增「确认按钮的完整动作必须留在 title」「状态词必须是短词」「阻塞原因必须在可伸缩 detail 里」三条断言。 |
| 2026-09-15 | T084 | `resources/app/plugins/installed/taskhive-surfaces/dsh/client.js` | 顶栏折行根治：新增 `codesysActionIcon()`（5 个内联 SVG）；复制/定位/回退改为 26px 纯图标按钮（`aria-label`+`title` 保留全文），刷新/选择工程保留文字并在窄栏退化为图标；标题缩短为 `代码工作台`（全名进 tooltip）；删掉冗余的「当前工程」字段名；「离线工程」徽章与联动徽章长文案在窄栏隐藏，联动徽章新增短文案变体；工作台根节点加 `container-type:inline-size`，用 `@container taskhive-codesys` 分四档（≥620 / <620 / <380 / <340）。 |
| 2026-09-15 | T084 | `resources/app/app/main.js` | 工作台诊断 `pathButtons` 原本按按钮 `textContent` 匹配，图标化后文字为空会静默漏掉这些按钮；改为同时读 `aria-label` 与 `title`。**注意该段位于模板字符串内，禁止再嵌反引号**（本轮一度因此把外层模板提前结束，`node --check` 立即报错）。 |
| 2026-09-15 | T084 | `resources/app/tests/codesys-workbench-compact-layout-contract.js` | 新增顶栏断言：容器声明、三档窄栏查询、恰好 3 个纯图标 + 2 个带文字动作、5 个动作各有 `aria-label`、5 个图标存在、字段名不再渲染、徽章短文案、裁决下拉独占整行；并新增**顶栏宽度预算断言**（CJK=1em、Latin≈0.55em 的宽度模型），把"一行"变成可测量、可回归的检查。 |
| 2026-09-15 | T085 | `resources/app/plugins/installed/taskhive-surfaces/dsh/client.js` | 删除命令条内 `data-codesys-write-recheck`「重新检测」按钮及其 CSS（它与顶栏 `刷新` 同为 `detectCurrentProject({ force: true })`）；顶栏 `刷新` 的 title 补上「ScriptEngine 与写入权限」并声明它是唯一检测入口；命令条注释同步更新。 |
| 2026-09-15 | T085 | `resources/app/tests/codesys-workbench-compact-layout-contract.js` | 断言改为"重复按钮与其 CSS 必须保持删除"，并新增**命令条宽度预算断言**：默认 400px 侧栏下可伸缩的原因文案必须拿到 ≥80px。 |
| 2026-09-15 | T086 | `resources/app/plugins/installed/taskhive-surfaces/dsh/client.js` | 「代码任务」→ 顶栏命名命令「AI 审核」（品牌浅色描边 + 6 号图标 `review`），`CodesysTaskComposer` 移入顶栏操作排；按下时发出的消息从"整份管道说明书"缩成 `命令 + <taskhive-codesys-context path=…/>`；底部命令条去掉 AI 入口与分组竖线，`aria-label` 改为「工程写入状态」；窄栏标题缩成「工作台」、联动徽章缩成小圆点（●/○/● N）；同步修正 8 处仍指向旧按钮名的引导文案（『刷新当前工程』→『刷新』、『选择 .project 文件』→『选择工程』）。 |
| 2026-09-15 | T086 | `resources/app/plugins/installed/taskhive-surfaces/dsh/index.js` | 宿主系统提示段 `taskhive:codesys-workbench` 补齐 T086 从按钮消息里移除的契约：交付方式二选一（`taskhive_codesys_workbench_propose` 或回复中的 JSON 代码块）、操作枚举、以及 `<taskhive-codesys-context>` 临时快照约定（不写入历史/记忆/知识库）。同一契约只保留这一处权威来源。 |
| 2026-09-15 | T086 | `resources/app/tests/codesys-workbench-compact-layout-contract.js` | 断言改为「AI 入口必须在顶栏、不得回到写入条」「按下发送的必须是被点击动作的忠实复述」「不得再出现伪造的『用户要求：』」；顶栏/命令条宽度预算模型同步加上 `AI 审核`、减去移走的按钮（结果：顶栏 354/380，原因文案 183px）。 |
| 2026-09-15 | T086 | `resources/app/tests/codesys-workbench-ui-contract.js` | 原「T018 保证必须在 client 里」的断言改为在**宿主** `index.js` 里断言，并新增「每次点击的消息不得再复述 JSON 结构与工具名」。 |
| 2026-09-15 | T087 | `resources/app/plugins/installed/taskhive-surfaces/dsh/client.js` | `buildCodesysTaskSnapshot` 口径改为「全部有代码对象 + 按 28000 字符上限截断」：删掉提示词词频打分与"最多 6 个 / 退化最大 4 个"筛选，命名匹配只用于**排序**（保证被点名对象活过截断），`selection` 改为 `all-code-objects`，新增 `codeObjectCount`/`namedObjectCount`/`includedCount`，截断时置 `textTruncated: true`，全部对象的 `index` 元数据始终保留；`submit()` 的消息补回一句硬指令「请先读取它再动手，不要凭猜测回答」。 |
| 2026-09-15 | T087 | `resources/app/plugins/installed/taskhive-surfaces/dsh/index.js` | 系统提示段的上下文约定由"按需读取即可"改为"**必须先读取它再回答**"，并写明快照在工作区外、本会话可直接读绝对路径、`textTruncated` 为真时用 `index` 核对缺失对象。 |
| 2026-09-15 | T087 | `resources/app/tests/codesys-workbench-ui-contract.js` | 新增 8 条断言锁住快照口径（必须从全部代码对象出发、命名只排序不筛选、截断必须如实上报、元数据索引始终保留），并把消息断言改为「命令 + 读取指令 + 上下文引用」。 |
| 2026-09-15 | T088 | `resources/app/plugins/installed/taskhive-surfaces/dsh/client.js` | 新增 `codesysObjectsSignature()`（工程对象的廉价钱签名）；用 `React.useMemo([projectSnapshotSignature])` 只在工程对象变化时重建 `buildCodesysTaskSnapshot(…, '')` 快照；发布时**仅在签名变化**才附带 `projectSnapshot`（避免每次选区/输入停顿重发几十 KB）；把签名并入 `liveStateFingerprint` 使新 inspect 触发重发；新增 `publishedSnapshotRef`。 |
| 2026-09-15 | T088 | `resources/app/plugins/installed/taskhive-surfaces/dsh/index.js` | `publishWorkbenchState` 由整体替换改为**字段合并**（否则后续不带快照的发布会把它清掉，显式 null 仍可清空）；`workbenchToolPayload(sessionId, include)` 支持 `include='project-snapshot'`，返回 `projectSnapshot` + `projectSnapshotNote`（拿不到时明说原因，避免被当成"工程里没有代码"）；`taskhive_codesys_workbench` 增加 `include` 枚举参数与说明，并转发 `args.include`；系统提示把工具路径标为**优先做法**，消息里的文件路径保留为等价退路。 |
| 2026-09-15 | T088 | `resources/app/tests/codesys-workbench-ui-contract.js` | 新增 12 条断言锁住乙的链路：签名/记忆化/条件附带/指纹接线、工具参数与转发、`projectSnapshotNote`、发布必须合并、系统提示必须宣传工具路径。 |
| 2026-09-15 | T089 | `resources/app/plugins/installed/taskhive-surfaces/dsh/client.js` | 新增**状态续期心跳**：`CODESYS_STATE_KEEPALIVE_MS = 5 分钟` + 插件级 `codesysStateKeepAlive` + `scheduleCodesysStateKeepAlive()`，只把工作台已持有的状态原样重发（不重新读工程、不启 ScriptEngine、不改 UI、不重新生成快照）；`publishCodesysState` 负责记录状态并启动心跳；定时器在**插件层**，所以工作台标签关闭后仍然续期。同时修复 T088 缺陷：`sendSnapshot` 的 `Boolean(projectSnapshot) &&` 前置条件会让换绑工程后新快照为 null 时**不发字段**，而宿主是字段合并 → 上一个工程的代码被当成当前工程。改为 `snapshotChanged` 即发（显式 null 可清空）。 |
| 2026-09-15 | T089 | `resources/app/tests/codesys-workbench-ui-contract.js` | 新增断言：心跳节奏为 5 分钟、状态存在插件层（声明位置早于组件）、原样重发、单一实例、`publishCodesysState` 必须启动它；并**按切片断言心跳体内不含** `detectCurrentProject`/`ScriptEngine`/`inspect(`，确保 T069"禁止定时引擎探测"不被回退；另加「签名一变就必须发快照字段（含 null）」的断言。 |
| 2026-09-15 | T090 | `resources/app/plugins/installed/taskhive-codex-model/dsh/index.js` | `readCodesysTaskContext` 两处修复：(a) 该回合的消息会被**替换**成内联快照，现在先把用户自己的话摘出来并按 `USER REQUEST:` 拼在**最前面**（保头部截断下必然存活），`PROMPT_BUDGET.taskCommandChars = 2000`；(b) 大小判定由 `stat.size > 64 * 1024`（**字节**）改为按**字符**判上限 `CODESYS_CONTEXT_MAX_CHARS = 40000` + 字节粗上限 512KB，且**任何失败路径都返回命令文本而不是空字符串**（空字符串会让上层 `if (!content) continue` 把整个回合丢掉）。 |
| 2026-09-15 | T090 | `resources/app/plugins/installed/taskhive-surfaces/dsh/client.js` | 底部状态行新增 `.taskhive-codesys-linkstate`（`● 已联动到会话 xxx` / `○ 未连接会话`，`data-codesys-linkstate=linked|unlinked`，完整会话 id 与待确认数量在 `title`），新增 `codesysSessionLabel()` 取前 8 位；新增 `@container (max-width:439px)` 只留圆点。 |
| 2026-09-15 | T090 | `resources/app/tests/prompt-budget-contract.js` | 新增 6 条检查：CODESYS 任务回合必须带用户命令、必须内联快照、**CJK 密集（实测 72KB > 旧 64KB 上限）的快照不得因字节数被丢弃**、提示词仍不超 `totalChars`、超限快照仍保留命令、快照不可读时回合不得变空。 |
| 2026-09-15 | T090 | `resources/app/tests/codesys-workbench-compact-layout-contract.js` | 新增 6 条断言锁住底部联动指示：必须存在、必须指名会话或无会话时明说、长 id 必须缩短、不得抢状态文字宽度、窄栏只留圆点、status/linkstate/safety 仍共用一行。 |
| 2026-09-15 | T091 | `resources/app/plugins/installed/taskhive-surfaces/dsh/client.js` | 品牌失效根因修复：MutationObserver 增加 **`removedNodes`** 分支（`isOurBrandNode` + 品牌区域判定）并只做局部重注入；新增 `resize`/`visibilitychange` 时 `reconcileSidebarBrand`（并在 `__TASKHIVE_SKIN_DISPOSE__` 里解绑）；两个品牌槽由 `querySelector` 改为 `querySelectorAll` 全量品牌化；`ensureSidebarBrandMark` 改为"每轮都重新隐藏 vendor + 缺少我们的节点才插入"。 |
| 2026-09-15 | T091 | `resources/app/tests/skin-performance-contract.js` | 新增 9 条断言锁住 T091 根因与性能边界（必须响应 removedNodes、必须认识四个品牌标记、resize 监听必须注册且被 dispose、removal 分支**不得**升级为 whole-document scrub、两个槽都要 `querySelectorAll`）。 |
| 2026-09-15 | T092 | `resources/app/plugins/installed/taskhive-surfaces/dsh/index.js` | 新增会话记录文件层能力：`dshSessionsRoot()` / `listSessionRecords()` / `purgeSessionRecords()`，并在受信任的 `/taskhive/api` 前缀下新增 `sessions.list` 与 `sessions.purge` 两个方法（purge 缺 `confirm:true` 直接 400 拒绝）；导出三个纯函数供合同测试真跑。 |
| 2026-09-15 | T092 | `resources/app/plugins/installed/taskhive-surfaces/dsh/client.js` | 新增 `sessionRecordsApi()` 与 `SessionRecordsPanel`（列出工作区分桶/会话/大小/时间、全选与取消、当前会话不可选、确认框、先官方归档再删文件、显示回收量与根目录），并通过官方 `service.registerTab` 注册为「会话记录」标签（`taskhive:sessions`，order 9）——不注入 DSH 的 React 菜单。 |
| 2026-09-15 | T092 | `resources/app/tests/session-records-purge-contract.js` | 新增合同：在临时 `DSH_HOME` 上**真实执行**删除，验证根目录解析、列表只认含 `session.v3.jsonl*` 的目录、5 种越界名字全被 `invalid-name` 拒绝且根外旁证文件不受影响、拒绝当前活动会话、拒绝非会话目录、合法目标被删除且回收字节正确、另一个会话不受影响、根目录缺失时拒绝删除、以及路由与客户端接线。 |
| 2026-09-15 | T093 | `resources/app/plugins/installed/taskhive-surfaces/dsh/index.js` | `purgeSessionRecords` 支持"只给会话 id"的目标：在全部工作区分桶里唯一解析，`ambiguous-session` / `session-not-found` 一律拒绝。 |
| 2026-09-15 | T093 | `resources/app/plugins/installed/taskhive-surfaces/dsh/client.js` | `installTaskHiveSkin(ctx)` 传入 ctx；新增会话菜单「彻底删除」注入（克隆现成归档项保样式；`resolveSessionByRow` 要求标题唯一匹配；运行中/当前会话拒绝；捕获阶段点击绑定行；只在点过行后注入；dispose 解绑）。 |
| 2026-09-15 | T093 | `resources/app/tests/session-records-purge-contract.js` | 追加"只给会话 id"的真实用例（唯一命中删除 / 两桶同名拒绝 / 未知 id 拒绝）与 14 条注入方式静态断言。 |

## 验证记录

| 日期 | 任务编号 | 检查 | 结果 | 证据 |
|---|---|---|---|---|
| 2026-09-07 | T016 | 1.0.3 运行目录与上下文插件静态诊断 | 通过 | 已识别固定 32 条/90,000 字符模型历史、CODESYS 快照写入会话、自动 distill/mnemon/知识沉淀和按需专家上下文。 |
| 2026-09-07 | T024 | 安装包与上游版本核对 | 通过 | 内置 DSH `0.1.0-rc.8`；GitHub 最新 rc 为 `0.1.2-rc.1`，最新 alpha 为 `0.1.3-alpha.1`；核心插件与 rc.8 注入契约耦合。 |
| 2026-09-07 | T025 | 上游 Git 标签、本地全量 DSH 包及插件依赖复核 | 通过 | `git ls-remote` 显示稳定 `dsh-v0.1.2-rc.1`、HEAD=`dsh-v0.1.3-alpha.1`；本地所有运行时 `@deepseek-ai/dsh*` 均为 `0.1.0-rc.8`，`dsh-mnemon` 开发依赖为 `0.1.1-rc.2`。 |
| 2026-09-07 | T019-T022 | JS 语法与后台上下文合同 | 通过 | `node --check` 通过 `distill/lib/index.js`、`taskhive-surfaces/dsh/index.js`；`background-context-contract.js` 输出 `background context contract passed`；既有 `context-budget-contract.js` 输出 `context budget contract passed`。 |
| 2026-09-07 | T026 | Harness alpha.2 升级与 packaged smoke | 部分通过/阻塞 | `pnpm install` 完成；`dsh --help/--version`、`--dump-config`、`node --check` 通过。桌面启动失败于 `session-persistence-jsonl` 缺失 `fs_ext.node`；`node-gyp rebuild` 报告未找到 Visual Studio。 |
| 2026-09-08 | T027 | Windows `fs-ext` 兼容修复 + `TaskHive.exe --smoke` | 通过 | `node --check` 通过；`resources/app/logs/electron-smoke.json` 为 `ok:true`，Harness `state=ready`，并记录 `smoke-autoclose`。 |
| 2026-09-08 | T028 | DSH token URL 捕获 + `TaskHive.exe --smoke-ui --smoke` | 部分通过 | `harness-runtime.log` 记录 `dsh web: http://127.0.0.1:<port>/?token=...` 及带 token 的 ready URL；UI smoke 启动但未形成新通过证据，现有 `sidebar-plugin-labels-probe.json` 仍为 `bridge-unavailable`/空标签。 |
| 2026-09-08 | T031 | 隔离 `--smoke-ui --smoke` 根因诊断 | 已定位 | 修复快照方法绑定后工作台已渲染，但 alpha.2 认证完成会将 `location.href` 归一化为无查询参数 URL，导致旧插件读取不到 `taskhiveWorkspace`；快照仍为空工作区/会话。已改用预加载桥的 `harnessUrl()` 取回主进程权威 URL，待真实 smoke 验证。 |
| 2026-09-08 | T026-T033 | t040 隔离 `TaskHive.exe --smoke-ui --smoke`、语法和上下文合同 | 通过 | `electron-smoke.json`：`ok:true`、Harness `ready`、单窗口、splash 关闭；`plugin-right-sidebar-probe.json`：CODESYS/Web AI/知识库/专家均 `ok:true`；`session-delete-probe.json`：`ok:true`；`context-budget-contract.js` 与 `background-context-contract.js` 均通过。`ui-branding-probe.json` 为 `ok:false`，已拆分为 T034。 |
| 2026-09-08 | T034 | t043 隔离 `TaskHive.exe --smoke-ui --smoke`、UI 截图和语法检查 | 主界面恢复；折叠自动探针待继续 | `node --check` 通过；`electron-smoke.json` 为 `ok:true`、Harness `ready`、单窗口、splash 关闭；`plugin-right-sidebar-probe.json` 为 `ok:true`。`ui-chat.png` 显示品牌、会话、四个插件入口和底部输入框。探针已点击左侧 `hHd-Xa_iconButton hHd-Xa_toggle`，但 alpha.2 在无头 smoke 中未改变左栏宽度，故 `ui-branding-probe.json` 仍为 `ok:false`；这不是空白界面或输入区故障。 |
| 2026-09-09 | T035 | 只读架构、性能、UI/UX、可访问性与发布目录审计 | 进行中 | 已识别全页 DOM scrub、双层 UI、模型配置不一致、端到端和性能回归缺口，以及 QA/runtime/log 历史内容混入发布目录；待输出按优先级的实施建议。 |
| 2026-09-09 | T035 | 现有测试、已归档 packaged smoke 与只读代码审计 | 已完成审计；发现测试入口损坏 | `npm test` 首项 `codesys-launch` 通过后因缺失 `tests/portable-links.js` 终止；逐一运行 12 个实际 JS 合同，10 通过，`codesys-permission-inject-contract.js` 与 `codesys-workbench-ui-contract.js` 因断言 alpha.2 升级前字符串而失败。既有 t043 packaged smoke 显示 Harness ready、四插件入口和会话归档通过；品牌折叠探针仍未通过。 |
| 2026-09-09 | T036 | 隔离 Codex 适配器请求 | 通过 | `gpt-5.5` 返回 `TASKHIVE_ADAPTER_PROBE`，并生成有效的 DSH `block-start`、`text-delta`、`block-end`、`usage` 和 `finish` 事件。 |
| 2026-09-09 | T037/T038 | 语法检查、完整合同测试与隔离 packaged UI smoke | 通过 | `node --check` 通过主进程、预加载、Codex 适配器和皮肤客户端；`npm test` 全部通过；t044 `TaskHive.exe --smoke-ui --smoke` 的 `electron-smoke.json` 为 `ok:true`，Harness ready、单窗口、splash 已关闭，四个插件探针与会话归档探针均通过。 |
| 2026-09-09 | T039 | 本机 Codex GPT-6 探测 | 受阻 | `codex-cli 0.153.4` 返回 `Model metadata for 'gpt-6' not found` 和 `Model 'gpt-6' is not supported`；目录未加入该 ID。 |
| 2026-09-09 | T035 | t045 隔离 `TaskHive.exe --smoke-ui --smoke` | 通过 | 修改关闭确认框样式后，`electron-smoke.json` 为 `ok:true`；Harness `ready`、单窗口、splash 已关闭，CODESYS surface bounds 为 `908x784`。 |
| 2026-09-09 | T036/T038 | t046 隔离 `TaskHive.exe --smoke-ui --smoke` | 通过 | 修复 `prepareCall` 后，`electron-smoke.json` 为 `ok:true`；Harness `ready`、单窗口、splash 已关闭。新 `ui-chat.png` 显示 GPT-5.5 工作台，原 `registration.adapter.prepareCall is not a function` 错误已消失。 |
| 2026-09-09 | T034 | t057 隔离 `TaskHive.exe --smoke-ui --smoke`、最终截图与全量合同测试 | 通过 | `electron-smoke.json` 为 `ok:true`；`ui-branding-probe.json` 为 `ok:true`、`visibleDeepSeekBrandIcons:0`、`taskHiveOverlayNodes:0`。`ui-chat.png` 显示 DeepSeek 文字标识保留、左侧图形标记已移除；`npm test` 全部通过。 |
| 2026-09-09 | T039 | 隔离 `TaskHive.exe --smoke-isolated --smoke-model` | 通过 | `model-smoke.json` 确认模型目录同时显示 `GPT-6 Astra`、`GPT-5.5` 以及 Claude Opus、Sonnet、Haiku；首次模型目录打开约 63ms。 |
| 2026-09-12 | T044 | 发布清理归档与执行 | 通过 | 清理前把 `resources/app/logs` 归档为 `resources/app/docs/qa-evidence-t040-archive-2026-09-12.zip`（3.4 MB → 1.9 MB，47 个条目）；`clean-release.ps1 -Apply` 删除 7876 个目标 / 29292 个文件 / 1026.0 MB，0 失败；安装体积 1952 MB → 925.7 MB；清理后立即 `TaskHive.exe --smoke` 通过（`ok:true`、`ready`、`mainAlive:true`、`splashAlive:false`、退出码 0）。 |
| 2026-09-12 | T045 | slot closure / SBOM 生成与门禁 | 通过 | 新增 `resources/app/tools/harness-slot-closure.js`；`--write` 后 `--check` 为 21 PASS / 0 FAIL、退出码 0；连续两次 `--write` 的 `closure.json`、`IMMUTABLE`、`sbom.cdx.json` 字节一致（幂等）；SBOM 为 CycloneDX 1.6、618 个组件、`metadata.component=@deepseek-ai/dsh@0.1.3-alpha.2`，618 个组件全部能对应到真实 `package.json`（0 虚构、0 漏计）。 |
| 2026-09-12 | T046 | 版本取自 slot、owner 标记、slot/manifest 一致性检查 | 通过 | `harness-runtime.js` 改用 `readSlotVersion()`，`status().runtime` 不再硬编码；`logs/harness-slot-check.json` 在闭包与 SBOM 就绪后为 `problems: []`；`runtime-owner.json` 记录版本 `1.1.0` 与 DSH `0.1.3-alpha.2`；跨安装路径改写改为只修复确实不存在的路径（`kept-live-paths`）。 |
| 2026-09-12 | T047 | 自定义 API 端点 + DeepSeek/Anthropic 直连 + Claude API 适配器 | 通过（真实凭据待验收） | 适配器侧：`AnthropicApiAdapter`（`${endpoint}/v1/messages`、`x-api-key`、`anthropic-version`，无 `authorization`），由 `protocol: "anthropic"` 选择；以伪 Anthropic 端点验证事件序列、AUTH/TRANSPORT/EMPTY_RESPONSE/MODEL_NOT_FOUND 分类与端点归一化。主进程侧：`models:add-custom` 持久化 `endpoint`/`apiKeyEnv`/`protocol`，`models:set-credential` 保存/清除凭据并重启 Harness，凭据只存 `profiles/api-credentials.json` 并注入 Harness 子进程环境；`models:list` 用 `decorateProviderCredentials` 只回传掩码。 |
| 2026-09-12 | T048 | 流畅度与终端弹窗 | 通过 | 目录清单整树扫描移入 worker 线程：worker 路径 4117 ms / 66 次定时器回调，同步路径 5260 ms / 0 次（同步路径会完全冻结事件循环）；`bottomPanelAutoTerminal` 宿主 schema 默认值由 `true` 改为 `false`（客户端层本就是 `false`，宿主 `true` 覆盖了它），并新增面板折叠逻辑消除"C 层只 CSS 隐藏、切回 chat 又露出来"的残留。 |
| 2026-09-12 | T043-T048 | 全量合同测试 + packaged smoke | 通过 | `tests/run-contracts.js` 21 个合同全部通过、退出码 0；`TaskHive.exe --smoke` 退出码 0、`runtime.state=ready` 且取得 `authUrl`、`mainAlive:true`、`splashAlive:false`、`windows:1`、约 14.6 s；`ready elapsedMs` 从历史 3849–81299 ms 降到约 3975 ms；smoke 结束无遗留 DSH 进程。 |

---

# T044-T048 实施记录（2026-09-12 第二轮）

## T044 发布清理与凭据处置

`clean-release.ps1` 在 dry-run 确认 7876 个目标后以 `-Apply` 执行，删除：

| 类别 | 目标 | 文件 | 大小 |
|---|---:|---:|---:|
| 根目录隔离 QA profile | 42 | 10388 | 595.6 MB |
| `resources/app` 内隔离 QA profile | 18 | 1853 | 224.4 MB |
| 插件 `node_modules` 内构建产物（`.pdb`/`.map`） | 7788 | 7788 | 131.5 MB |
| 升级前 slot 备份 | 1 | 8932 | 70.9 MB |
| QA 日志与探测证据 | 1 | 47 | 3.4 MB |
| 插件 smoke 夹具 / staging / 开发文件 | 22 | 263 | 0.2 MB |
| 被取代的图标代次 | 21 | 21 | 0.04 MB |

删除前把 `resources/app/logs` 归档为 `resources/app/docs/qa-evidence-t040-archive-2026-09-12.zip`，历史证据仍可审计。安装体积 1952 MB → 925.7 MB。

**凭据处置**：被删除的 18 个 QA profile 各含一条真实 `profiles\dsh\.credentials.yaml` 会话密钥（18 个互不相同）与一个 127.0.0.1 DSH 认证 cookie。文件已从本副本移除，但**删除不等于失效**：若该包曾分发给他人，这些密钥必须轮换。生产 profile（`%APPDATA%\TaskHive\runtime`）不在发布目录内，未受影响。

## T045 可复现的 closure / SBOM / IMMUTABLE

原 `taskhive-harness-closure-v2-final-path-links` 工具不在本检出内，其行编码与排除集未知。因此**没有**用替代值去填 `closure.sha256`，而是新增了一个自洽、有明确定义、可重复的生成器 `resources/app/tools/harness-slot-closure.js`：

- `taskhive-slot-closure-v3-final-path-links`：对排序后的 `F\0相对路径\0大小\0文件sha256\n`、`D\0相对路径\n`、`L\0相对路径\0链接目标\n`、`O\0相对路径\0大小\n` 行求 sha256；`lstat` 遍历，junction 记录但不进入；排除 `manifest.json`/`closure.json`/`sbom.cdx.json`/`IMMUTABLE` 以保证重复运行稳定。
- `taskhive-payload-content-graph-v1`：同一编码，根为 `payload/`，不排除任何内容。
- 真实 CycloneDX 1.6 SBOM：618 个组件，全部对应磁盘上真实的 `package.json`；`serialNumber` 由闭包摘要确定性派生。
- `IMMUTABLE` 写入本 slot 的 v3 摘要。

**必须如实说明**：v3 取代 v2 但**不复现** v2；`23ea46a3…` 不得被当作原 v2 工具会产出的值，也不得交给期望 v2 身份的消费者。`closure.json` 记录 `supersedes.reproducibleInThisCheckout: false`。上一 slot 的 v2 摘要 `0bd8dace…` 本检出无法确认。

`--check` 为 21 项 PASS / 0 FAIL（含 manifest 交叉校验）。**SBOM 仅通过结构校验，未通过官方 CycloneDX 1.6 JSON Schema 校验**（离线无校验器）。

## T046 DeepSeek Harness 作为权威底层架构 + 可重复升级

1. **版本来自 slot 而非源码**：`harness-runtime.js` 新增 `readSlotVersion()`，依次读 `payload/node_modules/@deepseek-ai/dsh/package.json` → `payload/package.json` → 根 `package.json`，失败返回 `unknown`，绝不回落到硬编码字面量。此前 `status().runtime` 写死 `'0.1.3-alpha.2'`，升级后所有诊断都会说谎。
2. **slot/manifest 一致性检查**：`assertHarnessSlotConsistency()` 在启动时比较 manifest `source.version` 与实际 payload 版本，并检查 `payload.sha256`/`closure.sha256` 是否已填、SBOM 是否标为陈旧、`electronSmoke` 闸门、`bin.js` 是否存在；结果写入 `logs/harness-slot-check.json`，有问题时同时写入 `errors.log` 与 harness 事件。首次运行报 3 项（closure/payload/SBOM 未就绪），T045 完成后为 `problems: []`。
3. **runtime owner 标记**：`%APPDATA%\TaskHive\runtime\runtime-owner.json` 记录版本、安装路径、DSH 版本与启动时间；当另一个 TaskHive 安装拥有同一 runtime 时写入 `shared-runtime-warning`，明确提示不要同时运行多个安装。
4. **消除跨版本路径互踩**：`repairPersistedDefaultWorkspacePaths()` 原本会把任何 `…\resources\app\workspaces\harness-default` 改写成本安装的路径——即使该路径**仍然存在**。三个安装共用同一 profile，于是每次启动都互相覆盖，日志记录过 14 轮。现在只修复确实不存在的路径，仍存在的记 `kept-live-paths` 并放行。这才是"支持升级"的关键：升级或并行安装不再改变正在运行客户端的 workspace 身份。
5. **升级流程**：`tools/harness-slot-closure.js --check` 可作为提升门禁（不匹配即退出 1，约 10–14 s）；替换 slot 后重新 `--write` 并复跑 `TaskHive.exe --smoke`。

## T047 模型支持与自定义 API 接口

### 修复前的事实

- `models:add-custom` 只接受 `providerId`/`modelId`/`name`/`kind`/`state`/`visible`——**不接受也不持久化** `endpoint`、`apiKey`、`apiKeyEnv`。
- 适配器 `CatalogModelAdapter.stream()` 需要 `entry.endpoint`，且只在 provider id 恰为 `ollama-local`（785 行）或 `deepseek-api`（786 行）时才有回退，否则抛 `UNCONFIGURED`；即使有地址，`apiKeyEnv` 为空也会抛 `AUTH`。
- `models:list` 从不对 `deepseek-api` 重算状态，它永远是文件里的字面量 `'unconfigured'`，于是 `models:select` 直接拒绝。

**结论：修复前用户无法添加任意自定义 OpenAI 兼容端点并对话，也无法仅凭 API Key 使用 DeepSeek API。**

### 本轮实现

| 层 | 变更 |
|---|---|
| 凭据存储 | 新增 `profiles/api-credentials.json`（主进程独占）；`readApiCredentials`/`writeApiCredentials`/`apiKeyEnvName`/`effectiveProviderEndpoint`/`maskApiKey` |
| 就绪判定 | `resolveConfiguredState()`：`local` 有地址即 `ready`；`api` 需地址 + 凭据；`models:list` 与 `models:select` 都据此重算 |
| 自定义端点 | `models:add-custom` 现接受并持久化 `endpoint`/`apiKeyEnv`/`protocol`/`contextWindow`；`kind=api` 必须提供地址；`kind=cli` 明确拒绝（此前会创建一个永远不会被注册的提供方） |
| 凭据管理 | 新增 `models:set-credential`（设置/清除地址与 Key），保存后调用 `writeDshPatch()` + `harnessRuntime.restart()`，因为适配器只从 Harness 子进程环境读取密钥 |
| 环境注入 | Harness 启动环境新增 `...apiCredentialEnvironment()`，把存在的密钥映射为 `<apiKeyEnv>` 变量 |
| 密钥保密 | `decorateProviderCredentials()` 只回传 `hasApiKey` 与掩码；界面永不接收原始密钥 |
| Claude | 新增 `AnthropicApiAdapter`（Anthropic Messages API），由 `protocol: "anthropic"` 选择；`anthropic-api` 成为内置提供方 |
| 界面 | 设置 → 模型：每个 api/local 提供方新增"服务地址 + API Key + 保存凭据"一行（Key 为 password 输入）；添加自定义模型时新增地址、Key 与协议（OpenAI 兼容 / Anthropic 兼容）选择 |

`anthropic-api` 与 `deepseek-api` 的内置条目现在自带 `endpoint`/`protocol`/`apiKeyEnv`（`ensureLayout` 补齐），因此 DeepSeek 只需要填 Key。

**仍待用户验收**：本机没有任何真实 API Key，所有端点验证都走本地伪服务器。真实 `api.deepseek.com`、`api.anthropic.com` 与用户自定义端点的调用尚未发生；Anthropic 适配器为单次非流式 `messages` 请求，未实现 SSE 逐 token 流式，也未映射 `stop_reason`（与其它适配器一致）。

## T048 流畅度与终端弹窗

### 目录清单扫描移出主线程

整树扫描约 14 万条目。新增 `app/directory-manifest-worker.js` 与 `refreshDirectoryManifestAsync()`；自动/定时刷新改走 worker，显式 `--update-directory-manifest` 仍用同步实现（命令行必须在退出前写完）。实测对照（50 ms 定时器计数）：

| 路径 | 耗时 | 事件循环回调 |
|---|---:|---:|
| worker（`refreshDirectoryManifestAsync`） | 4117 ms | **66** |
| 同步（`generateDirectoryManifest`） | 5260 ms | **0**（完全冻结） |

### 终端弹窗根因

`bottomPanelAutoTerminal` 在**宿主** schema 里是 `z.boolean().default(true)`，而客户端各层（`lib/client.js`、`lib/client-registry.js`、`src/prefs-shared.ts`）都是 `false`。客户端信任宿主返回的任意布尔值，于是宿主的 `true` 覆盖了客户端默认值，等于给每个新 profile 重新打开了已被移除的"首次展开底部面板即开终端"行为，且没有界面开关可以关掉它。已把宿主 schema 默认值改为 `false`。

另有一处残留：插件界面下底部面板只是 `visibility: hidden`，而侧栏按会话持久化并恢复 `bottomOpen`，所以之前开过的面板会在切回 chat 的瞬间重新出现——这正是"切换界面弹出终端"的可见症状。现在 `setPluginSurfaceMode()` 在进入插件界面时**真正折叠**底部面板（仅在面板确实展开时才点击，因此不会变成 toggle）。

### 本轮发现并修复的自身回归

接入 Anthropic 适配器时，`anthropic-api` 被注册了两次（显式注册 + 目录循环），触发 `DUPLICATE_ADAPTER`，整个插件树加载中止、DSH 进程退出、工作台无法加载。收紧后的 smoke 断言（主窗口存活 + splash 已回收 + 退出码）首先暴露了它。现在 `apply()` 用 `registered` Set 保证每个 provider id 只注册一次。同时修掉 smoke 结束时用 `app.exit()` 跳过 `before-quit` 导致 DSH 子进程成为孤儿、进而让下一次启动失败的问题。

## 仍未完成

1. **真实模型凭据验收**：DeepSeek / Anthropic / 自定义端点的真实调用需用户提供 Key 后验证（见 T047）。
2. **三个未运行闸门**：`harnessAbi`、`pluginCompatibility`、`dataMigrationDryRun` 仍未运行，`promotion` 仍为 `forbidden-in-m0`。
3. **CycloneDX 合规性**仅结构校验，未过官方 Schema。
4. **v2 closure 不可复现**：`0bd8dace…` 本检出无法确认；v3 是取代而非复现。
5. **AppData 共享**：1.0.1/1.0.2/1.0.3 仍共用 `%APPDATA%\TaskHive\runtime`。已加 owner 标记与告警、并停止跨版本改写存活路径，但按版本隔离 runtimeRoot 会牵动用户会话与知识库，属产品决策，未擅自更改。
6. **真实 CODESYS 验收**：capture 身份校验、AI 输入 arming、皮肤在真实长会话下的手感仍需人工确认。
7. **非易变目录变更**仍会触发一次整树重扫（约 4–5 s）；已移出主线程，但仍有开销。

---

# T049-T051 实施记录（2026-09-12 第三轮）

## T049 勾选 gpt-5.6 后输入框模型目录不显示

### 根因（已取证）

不是可见性问题，而是**刷新缺失**。逐层核对：

1. `profiles/model-catalog.json` 里 `visibility["codex-cli::gpt-5.6-sol|terra|luna"]` 已是 `true`（用户在设置里勾选的结果已正确落盘）。
2. 适配器 `visibleModels()` 每次调用都重新读该文件，过滤条件是「目录声明了该模型」且「visibility 不为 false」。直接复算得到 5 个模型全部通过：
   `["gpt-6-astra","gpt-5.6-sol","gpt-5.6-terra","gpt-5.6-luna","gpt-5.5"]`
3. 但 `models:set-visible` 只写文件后返回，**既没有 `writeDshPatch()` 也没有重启 Harness**；而 DSH 的模型注册表是在插件树加载时一次性建立的。对比 `models:select` 与 `models:set-credential`——它们都会重启运行时。可见性变更漏掉了这一步，输入框因此一直显示旧列表。

### 修复

新增 `scheduleModelCatalogRefresh()`：写入目录后延迟 1.2 s 执行 `writeDshPatch()` + `harnessRuntime.restart()`，并记录 `model.catalog.refreshed` 事件。**批量合并**，连点多个模型只重启一次。`models:add-custom` 与 `models:remove-custom` 也改为调用它（它们此前只返回 `needsRestart` 而从不真正重启，新提供方永远拿不到适配器）。设置界面同时给出「模型目录将在约 1 秒后刷新」的提示。

### 验证（真实界面）

`TaskHive.exe --smoke-isolated --smoke-model`，`model-smoke.json`：

```
ok                : true
visibleCodexCount : 5
nativeGptModels   : ["GPT-6 Astra","GPT-5.6 Sol","GPT-5.6 Terra","GPT-5.6 Luna","GPT-5.5"]
nativeClaudeModels: ["Claude Opus","Claude Sonnet","Claude Haiku"]
nativeWebModels   : 8     nativeLocalModels: 4
nativeModelPicker : true  | nativeModelPane: true
visibilityRoundTrip: true | customRoundTrip: true
firstCatalogOpenMs: 42
```

输入框模型目录现在同时列出全部三个 5.6 变体。

**顺带修正两处把"临时产品决定"写死的断言**：`model-routing-contract.js` 原本硬断言 `visibility['codex-cli::gpt-5.6-*'] === false`（T036 的"隐藏未验证路由"决定）；`--smoke-model` 原本硬断言 `nativeGptModels.length === 2`。二者都会让"用户自行勾选"必然失败。现在分别改为断言**机制**：每个已声明模型都有显式 visibility 条目、目录不可读时 `CATALOG_HIDDEN_ROUTES` 仍失败关闭；以及**输入框模型数必须等于应用上报的可见路由数**（默认安装 2 个、用户开启后 5 个都成立，同时仍能抓住刷新回归）。

## T050 左侧栏品牌

### 取证（从运行中的 frame 直接 dump DOM）

真实结构与 T034/T042 的假设完全不同：

```html
div.hHd-Xa_logoRow                                  (展开 256x60 / 折叠 35x36)
  button.hHd-Xa_brand.hHd-Xa_wide                   (展开；aria-label=新建会话)
    span.hHd-Xa_brandIdentity > span.hHd-Xa_brandMark
      div[data-slot="sidebar.brand.mark"]           ← DeepSeek 鲸鱼 SVG
      span.hHd-Xa_brandName > div[data-slot="sidebar.brand.name"]
        <svg width="156" height="24" viewBox="26 0 156 24"> ← "DeepSeek Harness" 字形轮廓
  button.hHd-Xa_iconButton.hHd-Xa_toggle            (折叠；aria-label=打开侧边栏)
    span.hHd-Xa_railMark > div[data-slot="sidebar.brand.mark"]   ← 同一元素被 React 重新挂载
```

两个关键事实：

1. **"DeepSeek Harness" 不是文本**，而是 `sidebar.brand.name` 槽位里一段 **SVG 字形轮廓**（`aria-hidden`，156×24）。因此任何基于 textContent 的检测/替换都永远匹配不到——这解释了为什么此前所有"删除品牌文字"的尝试都无效，也让探测器的 `logoRowText` 一直显示为空字符串。
2. **品牌区在插件初始化很久之后才渲染**，且每次折叠/展开都被 React 重新挂载。原实现只在初始化那一次文档级扫描里做品牌处理（`if (isDocument)`），因此**从未生效**——`sidebarRailIcon:false`、`brandButtonTaskHiveIcon:false` 就是证据。

### 修复

1. `reconcileSidebarBrand()` 改为**每次扫描都执行**（不是仅文档级首扫）。它只做 3 次 `querySelector` 与一次小的文本比较，成本可忽略，与下方按根节点做的工作量不在一个量级。
2. `ensureSidebarGlyph()`：把 `[data-slot="sidebar.brand.mark"]` 内的厂商 logo 换成**普通侧栏图标**（圆角面板 + 分隔线，无箭头——箭头会让人误读为折叠控件，而厂商 logo 根本不是导航符号）。
3. `ensureSidebarWordmark()`：整体替换 `[data-slot="sidebar.brand.name"]` 的内容为 TaskHive 文字，因为原内容是 SVG 而非文本。
4. 保留 `rebrandSidebarText()` 作为文本兜底，并加 1.2/3/6 s 三次廉价重试，覆盖"首次绘制较慢且未产生可观察变更"的情况。

### 验证（真实界面 + 结构断言）

`ui-branding-probe.json` 现为 `ok:true`，新增两个结构判据：

```
railGlyphApplied : true     (折叠与展开均为 data-taskhive-sidebar-rail-icon 的普通侧栏图标)
wordmarkReplaced : true
foreignWordmark  : false    (brand.name 槽位不再有厂商 SVG)
foreignRailIcons : 0        (brand.mark 槽位不再有厂商 logo)
visibleDeepSeek  : false
```

探测器同时 dump 了展开/折叠两种状态的 `logoRow`、`railMark`、`railSvg`、`toggleAria`，作为后续回归的结构基线。

## T051 任务拆解与多模型分发（专家插件定位）——已取证，待决策

### 结论：核心 Harness 已经具备这套能力，且当前是开启状态

从**实际启动的 slot** 读到 `@deepseek-ai/dsh-agent-presets/presets/cordis/agent.cordis.yml`：

```yaml
- id: delegation
  name: cordis:group
  config:
    - id: tool-subagent-control
      name: '@deepseek-ai/dsh-tool-subagent-control'
    - id: tool-subagent-list-agents
      name: '@deepseek-ai/dsh-tool-subagent-control/list-agents'
    - id: tool-subagent
      name: '@deepseek-ai/dsh-tool-subagent'
      config:
        provider: spawn
        toolName: subagent
        modelSelectionSettings: true      # ← 多模型分发的开关
        backgroundMode: continuable
    - id: tool-subagent-fork
      name: '@deepseek-ai/dsh-tool-subagent'
      config:
        provider: fork
        toolName: subagent_fork
        backgroundMode: continuable
    - id: tool-subagent-codex        # provider: codex        disabled: true
    - id: tool-subagent-claude-code  # provider: claude-code  disabled: true
```

`@deepseek-ai/dsh-tool-subagent` 的包描述即「Model-facing subagent delegation tool over the ctx.subagents seam」。据其 README：

- **`modelSelectionSettings: true`** → 每个新顶层 Session 读取宿主的 `subagent-model-selection` 偏好；工具随后公开可选的 `provider`、`model`、`reasoning_effort` 字段，并注册共享的 `list_subagent_models` 工具。子 Session 继承该记录，后续设置编辑不改变它。**这就是"多模型任务分发"**：父 Agent 可以给不同子任务指定不同 provider/model。
- `providers` 支持 `spawn` / `fork` / `acp`；子 agent 可后台运行（`continuable`），父级可用 `dsh-tool-subagent-control` 对其发消息、中断、列举。
- `maxDepth` 默认 3；`persona` 与 `toolFilter` 可按子 agent 配置。
- **唯一限制**：每子 agent 的路由要求 subagent **后端**声明 `agentOptions`。两个进程内后端（spawn/fork）与 DSH SDK 支持；**ACP、Codex、Claude Code 会拒绝而非忽略**。预设因此把 codex/claude-code 子代理 provider 保持 `disabled`。

同时确认 TaskHive 的补丁**没有**干扰它：生成的 `taskhive.patch.yml` 只动 `agent-default-model` 并 `disabled` 掉 `llm-deepseek` 与 `web-search-deepseek`，未触及 delegation 组。

### 对"专家插件有必要存在吗"的回答

**作为并行编排层：没有必要，而且不应保留。** 依据：

1. `plugins/installed/experts/` 只是一个 **0.4 KB 的界面桩**（`plugin.json`，`entry: central-surface`，capabilities `hybrid` / `expert.agent-teams` / `expert.knowledge-recall`），没有自己的运行时。
2. 真正的执行逻辑是 `taskhive-surfaces/dsh/index.js` 里的 `taskhive_expert_run` 工具：按 T022 的预算（任务 4000 字符、上游结果 4000、知识 3000、最多 3 条检索）跑**一次显式调用**，不提供模型选择、不可续、不能并行、不能中途追加指令。
3. 而 DSH 原生 `subagent` 已经提供：任务拆分、并行子 agent、**每个子任务独立 provider/model/reasoning_effort**、后台续跑、`send_message` 追加工作、`list-agents` 列举、`maxDepth` 递归、`persona` 与 `toolFilter`。按 MASTER 规则 4（唯一 Agent 生命周期），自建第二条编排路径是倒退。

因此"专家真实启用以后应该是多模型工作"恰好是 `modelSelectionSettings: true` 的既有行为，但**当前那个私有工具做不到**。

### 建议（三选一，需用户决定，未擅自改动）

| 方案 | 做法 | 影响 |
|---|---|---|
| A（推荐） | 保留 `experts` 界面用于**专家配置与知识绑定**，但其"运行"改为组装一次原生 `subagent` 调用（把 persona / model / 工具范围传进去），删除 `taskhive_expert_run` 的私有执行路径 | 获得多模型并行、可续、可追加；不再有第二套编排 |
| B | 直接移除 `experts` 插件与 `taskhive_expert_run`，完全依赖原生 `subagent` / `subagent_fork` | 最干净，但用户现有的专家配置与知识绑定界面会消失 |
| C | 维持现状，只把 A 作为后续任务登记 | 无风险，但"专家多模型工作"仍然做不到 |

另需注意：**多模型分发的前提是路由可见**。T049 的修复（可见性变更后刷新 Harness）正是这个前提——在此之前，即使勾选了 5.6，子 agent 也无法被路由到它。

### 验证

新增 `tests/subagent-delegation-contract.js`（现已纳入 `npm test`，共 22 个合同），断言：cordis 预设确实挂载 `subagent`（spawn）与 `subagent_fork`（fork）、`modelSelectionSettings: true`、`backgroundMode: continuable`、控制类工具在场；codex/claude-code 子代理 provider 保持 `disabled`；TaskHive 生成的补丁**不**禁用 delegation 组且只禁用 `llm-deepseek`/`web-search-deepseek`；至少两条可见路由存在；可见性变更必须触发刷新；TaskHive 不得自建 Agent Loop。

## T049-T051 验证证据

| 日期 | 检查 | 结果 | 证据 |
|---|---|---|---|
| 2026-09-12 | `npm test`（22 个合同） | 通过 | 退出码 0，新增 `subagent-delegation-contract.js` |
| 2026-09-12 | `TaskHive.exe --smoke-isolated --smoke-model` | 通过 | `model-smoke.json`：`ok:true`、`nativeGptModels` 含全部三个 5.6 变体、`visibleCodexCount:5`、`visibilityRoundTrip:true`、`customRoundTrip:true`、`firstCatalogOpenMs:42` |
| 2026-09-12 | `TaskHive.exe --smoke-isolated --smoke-ui --smoke` | 通过 | `ui-branding-probe.json`：`ok:true`、`railGlyphApplied:true`、`wordmarkReplaced:true`、`foreignWordmark:false`、`foreignRailIcons:0`、`visibleDeepSeek:false`，退出码 0 |
| 2026-09-12 | `TaskHive.exe --smoke` | 通过 | `electron-smoke.json`：`ok:true`、`state:ready`、`mainAlive:true`、`splashAlive:false`、`windows:1`，退出码 0 |
| 2026-09-12 | DOM 结构取证 | 完成 | 展开/折叠两种状态的 `logoRow` / `railMark` / `railSvg` 已落盘到 `ui-branding-probe.json`，确认厂商字样是 `sidebar.brand.name` 内的 SVG 字形轮廓 |

---

# T052-T053 实施记录（2026-09-12 第四轮）

## 重要更正：T051 对专家执行路径的判断有误

T051 的结论曾写道专家运行是"一次显式调用，不能选模型、不可续、不能并行、不能中途追加指令"。**这条描述是错的**，写入时依据的是 T022 的预算文字而非实际代码。逐行复核 `taskhive-surfaces/dsh/index.js` 后确认，`runExpertTeam` 早已是原生 subagent 委派：

```js
run = await ctx.subagents.start('spawn', {
  label: `${expert.name} · ${stage.id}`,
  prompt: [{ type: 'text', text: expertPrompt(...) }],
  parent: exec.agent,                       // 挂在真实会话上
  signal: exec.signal,
  maxDepth: 1,                              // 子节点不可再递归
  toolFilter: { allow: [ ...只读工具 ] },   // 只读工具范围
  persona: `${expert.systemPrompt || ...}`,
  agentOptions: { provider: route.provider, model: route.model, ... },  // ← 每专家独立模型
})
const result = await run.result
...
} finally { if (run) await run.dispose() }
```

并且 `runExpertTeam` 的返回体已声明 `execution: 'harness-subagents'`、`agentLoop: 'Harness/DSH'`；`expertDispatch` 声明 `harness-single-session-dispatch-plan`。也就是说**方案 A 的架构意图此前已经实现**，专家本就是依赖 DSH 原生 seam 的受限子节点，不是第二套 Agent Loop。T051 的"专家插件是平行编排层"定性同样不成立。

## T052 方案 A 的真实缺口与修复

复核后真正阻止"专家多模型工作"的是三处具体缺陷：

### 缺陷 1：`routeMode` 默认 `inherited`，配置的模型根本不会被使用

```js
const routeMode = args.routeMode === 'configured' ? 'configured' : 'inherited'   // 旧
const routeMode = args.routeMode === 'inherited' ? 'inherited' : 'configured'    // 新
```

旧默认下，除非调用方显式传 `routeMode: 'configured'`，每个专家都继承父会话模型——一个 6 人团队等于同一个模型跑 6 次，"多模型"只是名义上的。现已改为配置优先。

### 缺陷 2：配置的路由解析失败被空 `catch` 吞掉

旧代码：
```js
try { await ctx.llm.resolveModelInfo(expert.providerId, expert.model, signal); return {...} } catch {}
```
空 catch 让"专家配了模型但解析失败"静默退化为父会话模型，用户完全看不到。现改为：保留回退（不让整轮跑挂），但把失败原因写进 `fallbackReason`，并在每个 run 上带出 `requestedProvider` / `requestedModel` / `routeDiagnostic`。

### 缺陷 3：配置里的 provider id 与注册表不匹配

实测用户配置：

| 专家 | providerId | model |
|---|---|---|
| PLC 电气总工程师 / 安全与证据审核专家 | `ollama` | `qwen3:4b` |
| 其余 5 位 | `ollama` | `qwen3:0.6b` |

而 LLM 注册表注册的是 **`ollama-local`**，且 `qwen3:*` 不在目录的 ollama 模型列表（`qwen2.5-coder`、`deepseek-coder-v2`）中。因此 `resolveModelInfo('ollama', ...)` 必然失败，再叠加缺陷 2 的空 catch，实际效果是**全部 7 位专家都在用父会话模型**。

新增 `PROVIDER_ALIASES`（`ollama`→`ollama-local`、`deepseek`→`deepseek-api`、`anthropic`→`anthropic-api`、`claude`→`claude-code`、`codex`/`openai`→`codex-cli`、`web`/`browser`→`web-ai`）与 `resolveRegisteredProviderId()`；解析失败时错误信息会列出全部已注册提供方，让用户能直接看出该填什么。

### 新增：多模型可验证 + 可调用方指定

- `routeSummary`：报告 `mode`、`distinctRoutes`、`multiModel`（去重路由数 > 1）、`routes`、`perExpert`、`fallbacks`。团队是否真的多模型化现在是返回值的一部分，不再需要从 runs 里推断。
- `taskhive_expert_run` 新增可选参数 `provider` / `model` / `reasoningEffort`，允许调用方（模型）按次覆盖路由，与原生 `subagent` 的模型可选字段对齐。
- 输出 schema 同步加入 `routeSummary`（该 schema 为 `additionalProperties: false`，不加入会被校验剥掉）。

### 新增：专家模型路由可在界面修改

此前**只有"新建专家"表单有模型下拉**，已有专家无法编辑，所以种子里的 `ollama` 永远改不掉。`renderer.js` 的专家卡片现在每人带一个"模型路由"下拉：

- 选项来自**就绪**提供方的模型目录；
- 当前值若不在目录中，会显示为 `xxx ⚠ 不在可用模型目录` 并保持选中，把问题摆到台面上而不是渲染成空白；
- 变更经 `window.taskhive.updateExpert({ id, providerId, model })` 持久化。

## T053 界面主题

### 取证

TaskHive 的品牌色不是黑灰，而是**靛蓝→蓝渐变**，来自 `app/assets/taskhive-icon-v3.svg`：

```xml
<linearGradient id="taskhive-v3" x1="36" y1="28" x2="220" y2="228">
  <stop stop-color="#7168F6"/>
  <stop offset="1" stop-color="#3188EB"/>
</linearGradient>
```

外壳 `app/renderer/styles.css` 也早已使用蓝色系：accent `#3569e8`、深色 `#315fbd`/`#3563c8`、浅底 `#edf3ff`、描边 `#d5e0fb`，页面底色 `#f7f8fb`，正文 `#172033`。

但插件皮肤**强制**黑白灰，并写着：

```
/* Harness palette is black/white/gray only; these declarations intentionally
   win over any host theme variables that are injected after the plugin. */
...{border-color:#cfcfcf!important;background:#f7f7f7!important}
...{color:#444!important}
...{border-left-color:#666!important;color:#171717!important;background:#f7f7f7!important}
```

这就是"黑白 UI 不好看"的来源：TaskHive 自己的界面（CODESYS 工作台、设置、模型、专家、知识库）被一段 `!important` 规则压在灰度里，而周围外壳是蓝色产品。

### 修复

1. 注入 TaskHive 主题令牌（取值落在图标渐变与外壳 accent 之间，使内嵌界面与外围 chrome 同属一个产品）：

| 令牌 | 值 | 用途 |
|---|---|---|
| `--th-brand` | `#4f6ef2` | 主色 |
| `--th-brand-strong` | `#3f5ce0` | hover/active |
| `--th-brand-ink` | `#2f47b8` | 浅底上的文字 |
| `--th-brand-tint` | `#eef2fe` | 浅色填充 |
| `--th-brand-line` | `#d3dcfb` | 浅色描边 |
| `--th-ink` / `--th-ink-2` / `--th-ink-3` | `#1b2233` / `#4b5567` / `#79839a` | 正文三级 |
| `--th-surface` / `-2` / `-3` | `#ffffff` / `#f7f8fb` / `#eef1f7` | 表面 |
| `--th-line` / `--th-line-strong` | `#dde2ec` / `#c8d0de` | 描边 |
| `--th-ok` / `--th-warn` / `--th-danger` | `#2f7d5b` / `#a86a12` / `#c0392b` | 语义色 |

2. **结果状态改为语义色**，不再一律灰：可写入面板=成功绿、被阻断面板/提案=琥珀、变更文件=品牌蓝。原先把成功、警告、变更全部涂成同一个灰，本身也是信息损失。
3. 编辑器 chrome（meta 条、行号栏、代码区）与"打开浏览器登录"按钮改用令牌；`surfaceStyles.button` 从"透明+近黑"改为品牌浅底+品牌字。
4. 保留 `var(--dsw-*, fallback)` 形式的回退——那些 fallback 只在宿主未定义变量时生效，不影响主题。

### 验证（真实界面）

`ui-branding-probe.json` 现为 `ok:true`，并新增主题判据：

```
themeProbe : {"brandToken":"#4f6ef2","brandTint":"#eef2fe","inkToken":"#1b2233","forcedMonochromeRules":0}
```

`forcedMonochromeRules: 0` 表示运行时的样式表里已不存在 `#cfcfcf!important` / `background:#f7f7f7!important` 这类强制灰规则，且 `--th-brand` 在 DOM 中真实解析为 `#4f6ef2`。

## 本轮发现并修复的自身回归

1. **`harness-runtime` 重启竞态**：我在 T049 引入的 `scheduleModelCatalogRefresh()` 可能在启动尚未完成时调用 `restart()`。旧 `restart()` 直接 `stop()`，把 `this.process` 置空，而仍在轮询就绪的 `launch()` 还在读它，抛出 `Cannot read properties of null (reading 'exitCode')`。修复：`restart()` 先 await 在途的 `starting`；`launch()` 用局部 `child` 绑定并在每次循环校验 `this.process === child`，被取代时给出明确错误。
2. **smoke 失败不可诊断**：`smoke-ui-error.json` 只写 `error.message`，一旦抛出的不是 Error 就得到一份没有任何信息的证据。现在总是写入 `String(error)`、可枚举字段与 stack。正是这个改动让下一处 bug 立刻显形。
3. **探针里误删 `primarySurface` 定义**：插入 `themeProbe` 时覆盖掉了 `primarySurface` 的声明，导致 `ReferenceError`。已恢复。
4. **`--smoke-model` 又一处写死状态**：`nativeWebModels.length === 8`、`nativeLocalModels.length === 4` 同样是硬编码的临时状态。实测本机目录只有 2 个网页模型可见（用户自行隐藏了 6 个），断言因此对一个完全正确的配置失败。现在探针从应用上报的目录自行推导期望值（`expected.gpt/web/local`），断言"输入框列出的恰好是可见模型"。当前实测：codex 5 / web 2 / local 4，与原生选择器完全一致。
5. **结果状态语义化后 `!important` 选择器拆分**：原先一条规则同时给"就绪/被阻断/详情"三种元素上同一种灰色；拆分时若只改颜色不改结构会互相覆盖，已按语义拆成三条。

## T052-T053 验证证据

| 日期 | 检查 | 结果 | 证据 |
|---|---|---|---|
| 2026-09-12 | `npm test`（22 个合同） | 通过 | 退出码 0；`subagent-delegation-contract.js` 新增专家多模型默认、别名、回退上报、`routeSummary` schema、界面路由编辑等断言；`model-routing-contract.js` 改为断言"不写死任何模型数" |
| 2026-09-12 | `TaskHive.exe --smoke-isolated --smoke-model` | 通过 | `model-smoke.json`：`ok:true`；期望 codex/web/local = 5/2/4，原生选择器实际 5/2/4，Claude 3；`nativeVisibilityRoundTrip`/`localUiRoundTrip`/`customRoundTrip` 均为 true |
| 2026-09-12 | `TaskHive.exe --smoke-isolated --smoke-ui --smoke` | 通过 | 退出码 0；`ui-branding-probe.json` `ok:true`，`themeProbe.forcedMonochromeRules:0`、`brandToken:#4f6ef2` |
| 2026-09-12 | `TaskHive.exe --smoke` | 通过 | 退出码 0，`state:ready`、`mainAlive:true`、`splashAlive:false` |
| 2026-09-12 | slot closure 门禁 | 通过 | `result: PASS`（本轮只改 `resources/app` 内的应用与插件文件，未触及 slot payload） |

## 仍未完成

1. **真实模型路由验收**：专家多模型路由已可用且可配置，但真实效果需要你为专家选择可用模型（当前配置的 `ollama`/`qwen3:*` 不在注册表内；若本机未安装 Ollama，建议改用 `codex-cli`、`claude-code` 或已配置的 API 提供方）后实际运行一次团队确认。
2. **专家子代理为一次性**：原生 `subagent` 预设是 `continuable`（可 `send_message` 追加）。TaskHive 的专家 run 仍是 `run.result` + `dispose()` 的一次性模式。若要在专家上做追问式多轮，需要改为 `ctx.subagents.startContinuable()` 并接上控制工具——这属于新增能力，未擅自改动。
3. 前几轮遗留项（真实凭据验收、三个未运行闸门、CycloneDX 官方 Schema、v2 闭包不可复现、AppData 跨版本共享、真实 CODESYS 验收）保持不变。

---

# T054-T055 实施记录（2026-09-14）

## 必须先记录的两项自身错误

### 1. 我的 `--smoke-isolated` 从未真正隔离

`main.js` 的隔离逻辑是 `process.argv.includes('--smoke-isolated') ? process.env.TASKHIVE_RUNTIME_ROOT : ''`——**必须同时设置 `TASKHIVE_RUNTIME_ROOT` 环境变量**。我此前只传了 `--smoke-isolated` 而没有设置该变量，所以那十几次"隔离"运行**全部写进了用户的真实 profile**：创建/重命名/归档探测会话（侧栏一度出现 `TASKHIVE_DELETE_SESSION_PROBE`、`TASKHIVE_HISTOR…`），并产生 13+ 个 `taskhive-path-backup-*` 文件。

后果不止是污染：`probe-sidebar-plugin-labels` 开始在真实 profile 上失败（`nav: null`、`body.className: ""`，客户端未挂载），我因此一度误判是图标改动导致的，并据此改了两轮代码。**用 `TASKHIVE_RUNTIME_ROOT` 指向临时目录后，同样的代码通过了所有先前失败的阶段。** 已确认正确用法并只在后续验证中使用它。

教训：隔离开关依赖环境变量时，工具/流程必须一并设置，否则"隔离"运行会静默污染生产数据。

### 2. 在模板字符串里连续踩了三次转义/反引号

向 `executeJavaScript` 的模板字符串里注入代码时：

| 错误写法 | 实际发出的代码 | 症状 |
|---|---|---|
| 注释里写 `` `\/` `` 等反引号 | 模板提前结束 | `SyntaxError: missing ) after argument list`（main.js 本身解析失败） |
| 正则 `/^data:image\//` | `/^data:image//.test(...)` | `Uncaught SyntaxError: Unexpected token '.'`，报在注入脚本第 87 行 |
| 注释里写 `` `visibility` `` | 模板提前结束 | 同上 |

已修正：模板内注释一律不用反引号；正则转义写成 `\\/`（模板会折成 `\/`）。定位方法值得保留：把 `executeJavaScript` 的模板抽出来单独 `node --check`，并按 Electron 报的行号对回注入脚本行。

## T054 左侧栏品牌图标改为程序图标

用户反馈："左侧栏上方 TaskHive 旁边的图标不对，应该为程序图标"。

T053 之前我把 `[data-slot="sidebar.brand.mark"]` 换成了中性的"面板+分隔线"侧栏图形，理由是"厂商 logo 不是导航符号"。用户要的是**程序图标**——品牌位（展开时紧邻 "TaskHive" 字样、折叠时独占）应当显示 TaskHive 自己的图标。

改为渲染宿主通过 `taskhiveIcon` 传来的 `taskhive-icon-v3-64.png`（base64 data URL）。这是唯一可行通道：该帧由 `http://127.0.0.1:<port>/` 提供，访问不到应用资源目录。图标尚未解析时回退到带标记的占位 SVG，延迟重试会把真图标换入。

### 关键实现约束（都是调试出来的）

1. **不能删除厂商节点**。该槽位由 React 组件 `OfficialBrandMark` 渲染；删除 React 认为自己拥有的节点会破坏其 reconciliation。改为**就地隐藏**（`display:none!important`），只删除我们自己的占位节点。
2. **React 每次重绘都会恢复厂商节点**——尤其是侧栏折叠/展开。原先只靠空闲调度的 scrub 重新应用，中间存在"厂商 logo 又出现"的窗口。现在观察器在检测到品牌相关变更时**同步**调用 `reconcileSidebarBrand()`（回调在 React 提交后的微任务里执行），窗口被关掉。
3. 探针改为**轮询等待皮肤应用完成**再读取，而不是读一次——单次读取会与 React 重绘竞争，读到被恢复的厂商 logo。

### 验证

`ui-branding-probe.json`（真正隔离运行）：`ok: true`，`expandedSidebar.brandMarkTag: "IMG"`、`brandMarkSrc: "data:image/png;base64,"`、`logoRowText: "TaskHive"`、`foreignRailIcons: 0`、`foreignWordmark: false`、`themeProbe.brandToken: "#4f6ef2"`。

## T055 专家追问式多轮（startContinuable + 控制工具）

按要求把专家从"一次性委派"扩展为**可续子代理**：

- `continuable: true` 时对每个阶段调用 `ctx.subagents.startContinuable({ provider: 'spawn', label, request, signal })`，**不调用 `dispose()`**，并回传 `childId`/`messageId`；
- 结果新增 `children: [{stageId, expert, childId, provider, model}]` 与 `followUp: { tool: 'send_message', note }`，以及 `continuation: { requested, active, reason }`；
- 追问走**原生控制工具**（`dsh-tool-subagent-control` 已由 cordis agent preset 挂载：`send_message` / `list-agents` / `interrupt`），TaskHive 不新增第二套编排；
- 提供方不支持 `prepareContinuable` 时按阶段记录 `continuable: false` 与 `continuable 委派失败：…`，其余阶段继续；
- 可续模式下不写入知识候选（此时还没有任何输出，空候选只会污染审核队列）。

### 为什么是可选项而不是默认

`startContinuable` 按契约在**收件箱接受时**结算，不返回结果。而流水线依赖"上游阶段输出喂给下游提示词"，这必须等待首轮完成。因此 `continuable: true` 返回的是"已派发 + 子 id 供追问"，而不是一份完成的分析。默认仍是一次性流水线。

### 独立验证（44 项断言全通过，并发现我 3 个缺陷）

用 mock `ctx` 驱动真实插件，在隔离临时根上跑真实团队配置（1 队 / 7 专家 / 9 阶段）：

- 可续派发：`status: "dispatched"`、`active: true`、`children` 6 个、`start` 调用 0 次、`dispose()` 调用 **0** 次，每次调用的 `provider/label/request.parent/maxDepth/toolFilter/persona/agentOptions` 均正确（`agentOptions.provider` 已由别名解析为 `ollama-local`）；
- 一次性路径未变：5 次 `start`、5 次 `dispose`、`status: "completed"`；
- 无 `startContinuable` 时优雅退化，不抛错；
- 单阶段拒绝时其余阶段照常派发。

同时暴露我的 3 个缺陷，均已修复：

1. `runs.some(run => run.stopReason !== 'completed')` 把 `'dispatched'` 当成失败，导致**每次可续运行都会多启动"故障接管"专家**；
2. `failedCount` 同理把已派发计为失败（显示 6 个"失败"）；
3. 拒绝分支的注释声称"回退到一次性运行"，但实际没有 `start()` 调用。

修复：抽出共享判定 `const isFailure = (run) => run.stopReason !== 'completed' && run.stopReason !== 'dispatched'`，同时用于 `failedCount` 与 failure-only 阶段的触发；并改正注释。已加合同断言锁定这三处。

### 仍未验证

真实 DSH `subagents.startContinuable` seam、真实子代理执行、真实 `send_message` 往返、真实模型解析（`llm` 是 mock）均未跑；需要在真实会话里设 `continuable: true` 跑一次团队，再用 `send_message` 向返回的 `childId` 追问确认。

## T054-T055 验证证据

| 日期 | 检查 | 结果 | 证据 |
|---|---|---|---|
| 2026-09-14 | `npm test`（22 个合同） | 通过 | 退出码 0；`subagent-delegation-contract.js` 新增可续派发、不 dispose、拒绝上报、`isFailure` 判定等断言；`skin-performance-contract.js` 改为断言程序图标与"就地隐藏厂商节点" |
| 2026-09-14 | 可续派发独立验证（mock ctx，隔离根） | 通过 | 44 项断言全通过；`status: dispatched`、`children` 6、`dispose` 0 次、`start` 0 次；一次性路径 5/5 dispose 不变；无 `startContinuable` 时优雅退化 |
| 2026-09-14 | `TaskHive.exe --smoke-isolated --smoke-ui --smoke`（**设置 `TASKHIVE_RUNTIME_ROOT`**） | 通过 | 退出码 0；`ui-branding-probe.json` `ok:true`，`brandMarkTag: IMG`、`brandMarkSrc: data:image/png;base64,`、`logoRowText: TaskHive`、`foreignRailIcons:0`、`themeProbe.brandToken:#4f6ef2` |
| 2026-09-14 | `TaskHive.exe --smoke` | 通过 | 退出码 0，`state:ready`、`mainAlive:true`、`splashAlive:false`、`windows:1` |
| 2026-09-14 | slot closure 门禁 | 通过 | `result: PASS` |

## 待办

1. **真实可续追问验收**（同 T055"仍未验证"）。
2. **真实 profile 清理建议**：我的非隔离运行在 `%APPDATA%\TaskHive\runtime\profiles\dsh\storages` 留下了探测会话与 13+ 个 `taskhive-path-backup-*`。这些是备份文件和探测会话，删除前请确认你不需要它们；建议由你确认后再清理。
3. 前几轮遗留项不变。
| 2026-09-09 | T041 | 隔离 `TaskHive.exe --smoke-isolated --smoke-ui --smoke`、`npm test` | 通过 | `plugin-right-sidebar-probe.json` 为 `ok:true`；CODESYS、浏览器、知识库、专家四项均为 `right=885`、`rightSidebarCollapsed:false`，知识库菜单未被覆盖且底部终端未出现。 |

---

# T056 重点问题日志与白屏故障根因（2026-09-14）

## 本轮自身失误（先记录）

1. **定位顺序错了。** 用户报"打开后什么都没有"时，我因为时间上与自己的改动相邻，先查自己的代码，走了很长弯路（宿主插件树、客户端合并 bundle、冒烟探针……）。实际根因与我的改动**完全无关**。教训：先取"窗口内的页面到底收到了什么"这一手证据（导航状态 / 文档长度），再谈嫌疑。
2. **一度误信"服务正常"。** `Invoke-WebRequest` 不带 Cookie，返回 200/26KB，掩盖了浏览器侧的 431。判断健康必须区分「服务能响应」与「浏览器能渲染」。
3. 排查中误杀了 node 进程（含 harness 辅助进程），并因内联 CDP 脚本未退出卡住过一条命令。后续进程清理只按名称精确定位。

## 根因（T056-1 白屏）

宿主 DSH **每次启动铸造一个** `dsh-auth-<token>` Cookie（约 173B，作用域 `127.0.0.1`，**Cookie 忽略端口**），从不过期也从不清理 → 每次请求携带全部历史 Cookie → 超过宿主 Node 默认 16KB 请求头上限 → **每个请求返回 431、响应体为空** → 窗口内为空文档、白屏。**不需要任何代码改动即可触发**，只要启动次数够多。

## 交付物

| 文件 | 作用 |
|---|---|
| `resources/app/docs/KNOWN-ISSUES.md` | 重点问题日志（索引 + 逐条：症状 / 30 秒定位 / 根因 / 为什么难查 / 触发条件 / 修复 / 验证证据 / 复发信号 / 相似现象区分 / 新增模板） |
| `resources/app/tools/inspect-workbench.mjs` | 一条命令定位白屏：导航状态、文档渲染量、Cookie 负载、渲染进程报错，并给出 `WORKBENCH OK` / `WORKBENCH EMPTY (status 431)` 结论 |
| `resources/app/app/main.js` | ① `createWindow()` 在 `loadURL` 前清理陈旧 `dsh-auth-*` Cookie（根因修复）；② `diagnoseBlankWorkbench()` 在 `did-finish-load` 后测量文档，为空则把导航状态 / Cookie 数 / 头长度写入 `errors.log` 并指向档案（自动报警）；③ 修正失效的渲染进程错误日志（改用 Electron 30+ 的 details 对象签名） |

## 验证证据

| 日期 | 检查 | 结果 | 证据 |
|---|---|---|---|
| 2026-09-14 | 修复前现场 | 复现 | `navStatus=431`、`bodyHtmlLength=0`、`scripts=0`、`__ModuleLoader__` 不存在；Cookie 56 个全在 `127.0.0.1`、头≈12768B |
| 2026-09-14 | 修复后连续两次启动 | 通过 | `navStatus=200`、`bodyHtmlLength≈111899`、`scripts=7`、`surfaces=true`；Cookie 稳定 1 个 / ≈228B |
| 2026-09-14 | 完整冒烟 `--smoke-isolated --smoke-ui --smoke` | 通过 | 10 阶段全部完成；`electron-smoke.json ok:true`；`dsh-frame-probe.json` 3795B→202800B；`ui-chat.png` 145KB |
| 2026-09-14 | **安全网故意复现**（注入 110 个 `dsh-auth-VERIFY*`，头≈21128B） | 通过 | 工具输出 `WORKBENCH EMPTY (status 431)` 并指向档案；`errors.log` 自动写入 `workbench rendered an empty document: HTTP 431 ... cookies=111 dsh-auth=111 authHeaderBytes≈21128` |
| 2026-09-14 | `npm test`（全量合同，含本轮新增） | 通过 | 28 个测试文件，退出码 0 |

## 复发时的定位路径（两步）

1. 看 `logs/errors.log`：出现 `workbench rendered an empty document: HTTP 431 ...` 即为本条，日志已直接给出根因与档案指针。
2. 或 `TaskHive.exe --remote-debugging-port=9222` 后运行 `node resources/app/tools/inspect-workbench.mjs`。

## 同日更早、当时未登记的改动（补记）

| 项 | 内容 | 主要文件 | 契约测试 |
|---|---|---|---|
| 模型目录 live 刷新 | 目录变更由宿主插件 `fs.watch` + `handle.replace()` 广播 `llm/adapters-updated`，客户端就地重取；不再整页重载、不再重启进程（原实现每次变更都重载页面或重启 Harness） | `plugins/installed/taskhive-codex-model/dsh/index.js`、`app/main.js` | `model-catalog-live-refresh-contract.js`（14 项） |
| 提示词预算修复 | 各分项上限之和超过总预算，导致尾部（**当前用户问题**）被截断；web-ai 反向切头会丢 system；`webTotalChars: 32000` 是从未生效的死配置；`visionContext`（ModLens）无上限可挤掉 system 与当前问题 | 同上 | `prompt-budget-contract.js`（19 项） |
| 推理展示 | 只展示、有上限（每轮 1200 字符）、**绝不回放**（`textOfBlock` 排除 reasoning，两条 prompt 路径共用）；codex / catalog / anthropic / claude 四条路由接通；`usage` 上报 `reasoningTokens` 但**不请求** extended thinking | 同上 | `reasoning-context-isolation-contract.js`（16 项）、`reasoning-display-contract.js`（27 项）、`reasoning-cli-routes-contract.js`（15 项，假 CLI 端到端） |

---

# T057 上下文窗口修正 + 思考过程实时显示（2026-09-14）

## T057-1 声明的上下文窗口比真实值小 2.4 倍（B）

**用户观察**：只问了一句"现在几点了"，上下文占用显示 34%。

**实测**（解出该会话记录 `session-2fbdb8a7`，路由 `codex-cli/gpt-5.6-sol`）：
provider 真实用量 `uncachedIn=38619 / out=214` → `usageTokens = 38833`；`38833 ÷ 114000 = 34.06%` —— 与界面显示一致，说明**读数本身准确**，偏高是因为**声明值错了**。

**权威依据**：本机 Codex CLI 二进制内置 `models.json`，TaskHive 路由的每个 slug 都写着
`"context_window": 272000`（5.6 家族 `max_context_window: 872000`；`gpt-5.5` 为 272000）。
TaskHive 原写死 **114000**，比真实值小 2.4 倍。

**影响（比读数更重要）**：DSH 用声明值算压缩阈值 `contextWindow × 0.8`，所以阈值是 91,200 —— **历史被过早压缩**。修正后为 217,600。

**修复**：
1. `CodexCliAdapter` / `ClaudeCodeAdapter` / `WebAiAdapter` 的 `resolveModel` 改为 **catalog 驱动**
   （`Number(catalogProvider(provider)?.contextWindow) || 默认值`），与既有 catalog/anthropic 两条一致；
   codex 默认 **272000**，claude 200000，web-ai 仍保守 64000。
2. `profiles/model-catalog.json` 的 `codex-cli` / `claude-code` / `web-ai` 条目显式写入 `contextWindow`，
   使每个安装可按网关实际能力调整而无需改代码。

**效果**：同样 38,833 tokens 从 **34% → 14%**；压缩阈值 91,200 → 217,600。

**风险评估**：声明大于网关真实窗口时，provider 报 `CONTEXT_WINDOW_EXCEEDED` 会触发 DSH 的
overflow 压缩路径（该路径绕过常规阈值），因此不会静默溢出。

## T057-2 思考过程改为"思考中"实时显示（A）

**原状**：只有 `web-ai` 在轮次开始就发 reasoning；`codex-cli` / `claude-code` 把 CLI 输出读完后
才发出整块思考；`catalog` / `anthropic` 用 `stream: false`，provider 一次性返回，无中间态。

**界面侧本来就支持**：Think 行有 `data-state="running"` 扫光态，流式 reducer 逐条累积 `reasoning-delta`。

**修复（CLI 两条）**：
- 新增 `createReasoningStream(index)`：按累积差值增量 yield `reasoning-delta`，**沿用 1200 字符上限**
  （超限后钳制文本不再变化，自动停止追加），空推理不建块。
- `CodexCliAdapter.stream`：读取循环从"detached Promise + 轮末统一发射"改为**逐行竞速**
  （`iterator.next()` 与 spawn/stdin 失败、请求超时竞速；取消仍经 `cancellation.race` 终止进程树），
  每行折叠后立即 `yield*` 增量。
- `ClaudeCodeAdapter.stream`：新增 `createClaudeFolder()` 增量折叠（`foldClaudeStream` 改为复用它，
  保持兼容），`run` 改为 async generator，逐行折叠并即时 yield。
- 答案文本仍不流式：codex 的答案是协议 JSON，非用户可见输出。

**未做**：`catalog` / `anthropic` 的实时显示需要改 `stream: true` + 自写 SSE 解析（改动面最大），
仍为轮末统一发射。

## T057 验证证据

| 日期 | 检查 | 结果 | 证据 |
|---|---|---|---|
| 2026-09-14 | Codex 二进制模型元数据 | 取证 | 内置 `models.json`：所路由 slug 均 `context_window: 272000`，5.6 家族 `max_context_window: 872000` |
| 2026-09-14 | 会话真实用量 | 取证 | `session-2fbdb8a7`：`uncachedIn=38619`、`out=214`、`reasoning=99`；`38833/114000=34%` |
| 2026-09-14 | `context-window-contract.js`（新增 8 项） | 通过 | catalog 覆盖三条路由生效；无 catalog 时 codex 默认 272000、claude 200000、web-ai 64000；出货 catalog 显式声明；38,833 读数为 14% 而非 34% |
| 2026-09-14 | `reasoning-cli-routes-contract.js`（18 项，含新增 2 项实时性断言） | 通过 | 假 CLI 分阶段输出：**codex 首个 delta 在 CLI 仍运行时到达**（delta@<500ms，答案块晚 ≥400ms）；**claude 同理**；delta 拼接等于落定块；回退与限流路径不变 |
| 2026-09-14 | `npm test`（全量 28 个测试文件） | 通过 | 退出码 0 |

## T057 待办

1. `catalog` / `anthropic` 的实时思考（需 `stream: true` + SSE 解析）。
2. 真实 Claude CLI 那条路由的实时思考尚未用真实 CLI 复验（仅假 CLI）。
3. `codex-cli` 的 272000 取自 CLI 内置元数据；若第三方网关（`ai.discover-42.com`）实际更小，
   请在 catalog 的 `codex-cli.contextWindow` 上按实际值调整。

---

# T058 "看不到思考"与提示词长度的取证结论（2026-09-14）

## 结论一：codex-cli 在这条网关上**拿不到思考内容**（非显示问题、非本次改动）

三份独立证据：

1. **会话记录**（`tools/inspect-session.mjs --blocks`，新增工具）：最近两轮 assistant 的 `content` **只有 `text`，没有任何 `reasoning` 块**
   （seq=14 `text(44)`、seq=25 `text(53)`）——适配器没有内容可展示；而同两轮 usage 里确实有 reasoning tokens（99 / 81）。
2. **CLI 自带元数据**：`gpt-5.6-sol` 的 `default_reasoning_summary = "none"`（Codex CLI 内置 `models.json`）——默认不请求也不转发思考摘要。
3. **真实 CLI 复验**：`codex exec --json ... -c model_reasoning_summary=detailed`（真实调用一次，退出码 0）事件里只有
   `thread.started / turn.started / item.completed(agent_message) / turn.completed`，**无任何 reasoning item**；
   改 `model_reasoning_effort=high` 复验时该网关调用挂住（已强杀），说明该链路本身不可靠。

**可用替代**：`llm-pi-ai` 的 deepseek 路由（`settings.yaml` 已配置）由 DSH 原生适配器处理，会把 provider 的 `thinking`
映射为核心 `reasoning` 块并**流式**下发（`dsh-llm-pi-ai` 发 `block-start{blockType:"reasoning"}` + `reasoning-delta`）。
T057 的适配器改动不适用于该路由。

## 结论二：提示词不长的不是 TaskHive，是 Codex CLI

实测用户那一轮的分解（`codex-cli/gpt-5.6-sol`，provider 报告输入 38,619 tokens）：

| 组成 | 量级 | 是否可控 |
|---|---|---|
| TaskHive 组装的 prompt（`promptFor` 实测输出） | **7,589 字符 ≈ 1,898 tokens** | ✅（上限 44,000 字符） |
| DSH 的 46 个工具 schema | 42,683 字符 ≈ 10,671 tokens | **不发给模型**（只把紧凑清单 ≤7,000 字符塞进 prompt） |
| **Codex CLI 自身的系统提示 + 工具定义** | **≈36,700 tokens（95%）** | ❌ TaskHive 看不到也改不了 |

所以"一开始占用高"是 CLI 类路由的固有开销；改用不经 CLI 的路由（pi-ai / API 类）即无此层。
结合 T057-1 把声明窗口改为 272,000，同样绝对量显示为 14%。

## 本轮新发现的缺陷（已记录，未修）

**`codex-cli` 路由没有把 UI 上的 reasoning effort 传给 CLI**：`stream()` 的 `args` 里没有任何 effort 参数，
CLI 固定使用 `config.toml` 的 `model_reasoning_effort`。因此档位选择器对该路由**无效**，且低档位下模型只思考几十 token。
未修原因：实测 `model_reasoning_effort=high` 时该网关调用挂起，需要在真实环境确认 CLI 侧行为后再接，
避免在默认路由上引入挂起风险。

## 交付物

| 文件 | 作用 |
|---|---|
| `resources/app/tools/inspect-session.mjs` | 解多帧 zstd 会话日志：路由、工具面、每轮用量、**每个 assistant turn 的 content 块构成**（判断"没思考"是源头还是显示） |
| `resources/app/docs/KNOWN-ISSUES.md` | 新增**问题 #2「看不到模型的思考过程」**：30 秒定位、三类根因（源头 / 时机 / 档位）、可用替代、复发信号 |

## T058 验证证据

| 日期 | 检查 | 结果 | 证据 |
|---|---|---|---|
| 2026-09-14 | 会话块构成 | 取证 | `session-2fbdb8a7` 两轮：`blocks=[text(44)]`、`blocks=[text(53)]`，无 reasoning 块；usage reasoning 99 / 81 |
| 2026-09-14 | 真实 CLI + `model_reasoning_summary=detailed` | 取证 | 退出码 0；事件仅 thread/turn/agent_message，无 reasoning item |
| 2026-09-14 | 提示词分解实测 | 取证 | TaskHive prompt 7,589 字符 ≈ 1,898 tokens；其余 ≈36.7k 为 Codex CLI 自身 |
| 2026-09-14 | `dsh-llm-pi-ai` 思考能力 | 取证 | 代码发 `block-start{blockType:"reasoning"}` + `reasoning-delta`（实时） |
| 2026-09-14 | `npm test` | 通过 | 28 个测试文件，退出码 0（本轮未改适配器代码） |

---

# T059 思考行无法折叠收回（2026-09-14）

## 现象与定性

用户报告：**思考行一旦展开就收不回去**（点收起会被立刻重新展开）。

**定性：T057-2 的实时思考改动暴露了 TaskHive 客户端既有缺陷，不是流式本身的问题。**

## 根因

`plugins/installed/taskhive-surfaces/dsh/client.js` 的 `syncDeepDivingDisclosures` 按
`shouldExpand = (data-state === 'running')` **强制**展开/收起，用 `trigger.click()` 纠正。
其重试上限**形同虚设**：`isExpanded === shouldExpand` 分支把计数清零，于是自动点击成功 → 计数归零 →
用户每次手动折叠都触发新一轮自动点击 → 自动驱动**永远抢在用户前面**。

**为什么现在才明显**：思考块以前轮末一次性到达（`running` 只闪一下），抢点击窗口极短；T057-2 改为实时流式后
`running` 覆盖整个思考期，抢点击成为持续状态。

## 修复

`taskhive-surfaces/dsh/client.js`：

1. **手动点击永久优先**：trigger 上挂捕获相位 click 监听，只认 `event.isTrusted === true` 的**真实点击**
   （seam 自身的 `trigger.click()` 为 `isTrusted=false`，不会误判），置 `dataset.taskhiveManualDisclosure`，
   其后该 disclosure 一律跳过自动驱动；手动控制下标签文案描述**真实**展开状态。
2. **去掉"匹配即清零"**：重试计数只在 `state` 变化时重置，使每状态最多 2 次的上限真正生效
   （仍保留其防 MutationObserver 死循环的作用）。

## 验证证据

| 日期 | 检查 | 结果 | 证据 |
|---|---|---|---|
| 2026-09-14 | `skin-performance-contract.js`（新增 3 条断言） | 通过 | 只认真实点击、手动后停止自动驱动、不得恢复"匹配即清零" |
| 2026-09-14 | `npm test`（全量 28 个测试文件） | 通过 | 退出码 0 |
| 2026-09-14 | 运行时实测 | **未做** | 需真实思考块；codex 路由拿不到（T058），需在 pi-ai 路由上人工确认一次 |

## 顺带发现的不一致（未改，待决策）

`probeDeepDivingDisclosure`（`app/main.js`）断言页面**不得存在** `[data-taskhive-deep-diving]` /
`[data-taskhive-public-reasoning]`，而该 seam 恰恰会给 Think 行打上这两个标记。当前 smoke 通过仅因为
**codex 路由没有思考块**，标记路径未被走到；一旦有真实思考块，该断言即失败。
需先决定预期行为：改探针，或改标记名（后者破坏 1.0.2 公共 seam）。

## 待办

1. 在 pi-ai 路由上人工确认折叠行为（本修复的运行时验证）。
2. 决定上述 smoke 断言与 seam 标记的取舍。

---

# T060 codex effort 透传 + 使用量分桶修正 + catalog/anthropic 实时思考（2026-09-14）

## T060-1 codex-cli 的 reasoning effort 现在真的传给 CLI（含对 `high` 挂起的定论）

**T058 待确认项定论**：`high` 挂起**不是参数问题**。带上限探针（同一句提示，各一次真实调用）：

| effort | 结果 | 耗时 |
|---|---|---|
| `high` | 退出码 0 | **46.2s** |
| `medium` | 退出码 0 | 52.4s |

且 Codex 接受的枚举为 `none|minimal|low|medium|high|xhigh|max|ultra`（二进制内取证），
TaskHive 的 `EFFORTS = ['low','medium','high','xhigh','max','ultra']` **已是其子集，无需映射**。
先前那次 5 分钟挂起判定为网关偶发，不是非法取值。

**修复**：`CodexCliAdapter.stream` 在选中的 effort 属于 `EFFORTS` 时追加
`-c model_reasoning_effort=<effort>`；未选择时不添加任何参数（维持 CLI 自身配置）。
此前该路由**完全没有传 effort**，UI 档位对 codex 无效。

## T060-2 使用量分桶：缓存字段按提供方约定拆分

探针暴露（真实 Codex 载荷）：`input_tokens:13834, cached_input_tokens:13056, output_tokens:5`。
TaskHive 原先只读 `input_tokens`，导致面板"未缓存输入"显示 13834（实际 778）、"缓存读取"恒为 0。

两种约定按字段区分，**避免重复计数**：
- Anthropic：`input_tokens` 为未缓存量，`cache_read_input_tokens` / `cache_creation_input_tokens` 为**可加**桶；
- OpenAI/Codex：`input_tokens` 为**总量**，`cached_input_tokens` 是它的**子集** → 必须相减。

**不变量**：拆分后 `input + cacheRead + cacheWrite + output` 与拆分前**总量一致**（已断言）。

## T060-3 catalog / anthropic 两条路由改为实时思考

`stream: true` + 流式解析，思考按 delta 立即下发（此前是 `stream: false`，provider 一次性返回、无中间态）：

- 新增 `readResponseLines()`（按行读响应体）、`streamPayload()`（SSE `data:` / Ollama NDJSON 同一解码）、
  `isEventStream()`（按 content-type 判定）。
- `CatalogModelAdapter`：`api` 走 SSE（`delta.reasoning_content` / `delta.reasoning`），`local` 走 NDJSON
  （`message.thinking`）；正文仍累积后在末尾解析协议对象，**只有思考实时**。
- `AnthropicApiAdapter`：SSE 的 `message_start` / `content_block_delta`（`thinking_delta` 实时、
  `text_delta` 累积）/ `message_delta`（usage）/ `message_stop`；`error` 事件直接抛错。
- **回落保护**：网关若忽略 `stream: true` 而返回单个 JSON 体，`isEventStream()` 为假 → 走原有缓冲路径，
  因此开启流式**不会**让这类路由变成空回复。
- 思考块在**校验答案之前**就 close，保证流式 Think 行即使整轮失败也是完整块。

## T060 验证证据

| 日期 | 检查 | 结果 | 证据 |
|---|---|---|---|
| 2026-09-14 | effort 探针（真实 CLI） | 取证 | `high` 46.2s / `medium` 52.4s，均退出码 0；枚举含 xhigh/max/ultra |
| 2026-09-14 | `reasoning-cli-routes-contract.js`（22 项） | 通过 | 从**假 CLI 的真实 argv** 断言 `model_reasoning_effort=high` 已透传、未选择时不添加；缓存拆分 `input=778/cacheRead=13056` 且总量不变 |
| 2026-09-14 | `reasoning-display-contract.js`（38 项，新增 11 项流式断言） | 通过 | 流式 OpenAI/Anthropic：**思考在响应体结束前到达**（delta@<500ms，答案块晚 ≥300ms）；正文由累积 delta 解析；usage 帧保留；请求带 `stream: true` |
| 2026-09-14 | `npm test`（全量 28 个测试文件） | 通过 | 退出码 0 |

## T060 待办

1. 真实流式端点（DeepSeek API / 自定义网关）复验：目前流式路径由假端点验证，真实网关的 SSE 细节
   （是否返回 usage、`[DONE]` 形式）需一次真实调用确认。
2. 流式路径下若网关不返回 usage，用量面板会退回估算（这是不带 `stream_options.include_usage` 的取舍，
   因为该字段会被部分网关拒绝）。

---

# T061 "模型运行失败"根因：请求超时撞上慢网关（2026-09-14）

## 现象与取证

用户报告提问后**整轮无产出**。会话原始事件（`tools/inspect-session.mjs --raw`）：

```
[13] assistant/attempt stream finish{reason:{kind:'error',failure:{message:'Codex 模型在 120 秒内未完成'}}}
[15] turn/end reason:{kind:'error',error:{message:'Codex 模型在 120 秒内未完成'}}
```

即**该路由的请求超时**（`MODEL_REQUEST_TIMEOUT_MS`，原 120000）触发；会话里有 `user/message` 与
`request/header` 但**没有任何 `assistant/message`**。

## 为什么超时：网关延迟（真实测量）

同一句"回复 OK"，经 Codex CLI 走 `ai.discover-42.com`：

| effort | 耗时 |
|---|---|
| high | 46.2s |
| medium | 52.4s |
| low | 79.4s / >100s / >150s |

**波动极大且常在 100 秒以上**，而超时是 120 秒 → 普通提问会随机失败。

## 排除"参数非法"（重要，避免误判）

同期 T060-1 新增了 `-c model_reasoning_effort=<档位>` 透传，看似可疑，但：

- 该模型自带元数据 `supported_reasoning_levels` **明确包含 `low`**（low/medium/high/xhigh/max/ultra 全含）；
- 同一 `low` 参数重复三次结果为"超时 / 超时 / 79 秒成功"——是**网关延迟波动**，不是非法取值。

即：透传本身正确（修好了"档位对 codex 无效"的缺陷），但让此前从未生效的 `low` 真正生效；
而 **120 秒的余量对这个网关本来就太紧**（最早一次 `high` 探针甚至挂满 5 分钟）。

## 修复

`plugins/installed/taskhive-codex-model/dsh/index.js`：超时默认 **120s → 300s**，支持按安装覆盖
`TASKHIVE_MODEL_TIMEOUT_MS`（≥10000 才采纳）。保留上限的意义是"真正卡住的子进程不能永远占住这一轮"，
而用户随时可取消，放宽默认安全。

## 验证证据

| 日期 | 检查 | 结果 | 证据 |
|---|---|---|---|
| 2026-09-14 | 会话事件取证 | 取证 | `turn/end` reason 与 `assistant/attempt` failure 均为 `Codex 模型在 120 秒内未完成` |
| 2026-09-14 | 真实 CLI 计时（3 档 × 多次） | 取证 | high 46.2s、medium 52.4s、low 79.4s/>100s/>150s |
| 2026-09-14 | 模型元数据 | 取证 | `supported_reasoning_levels` 含 low…ultra；`default_reasoning_summary="none"` |
| 2026-09-14 | `reasoning-cli-routes-contract.js`（24 项，新增 2 项） | 通过 | 超时默认 ≥300000 且含 `TASKHIVE_MODEL_TIMEOUT_MS` 覆盖 |
| 2026-09-14 | `model-routing-contract.js` | 通过 | 更新原先写死 `120000` 的断言（改为断言可覆盖 + 默认 300000） |
| 2026-09-14 | `tools/inspect-session.mjs --raw` | 新增 | 逐事件输出，并单独汇总 `--- WHY THIS RUN FAILED ---` |
| 2026-09-14 | `npm test`（全量 28 个测试文件） | 通过 | 退出码 0 |

## 待办

1. 该网关（`ai.discover-42.com`）一句寒暄需 45–150 秒，若仍影响体感，建议切到 `llm-pi-ai` 的 deepseek
   路由（不经 CLI）；本机已配置。
2. `model_reasoning_effort` 透传对 `llm-pi-ai` 路由不适用（那是 DSH 原生适配器）。

---

# T062 T059 折叠修复无效，改为"永不点击思考行"（2026-09-14）

## 现象

用户反馈：T059 之后**展开思考行依然收不回去**。

## T059 的修法为什么无效（自身错误记录）

T059 把"用户已手动操作"记在 **DOM 节点**上：`dataset.taskhiveManualDisclosure` 标记 + 以节点为键的
`WeakMap` 重试计数。但 DSH 的 `ReasoningRow`（`data-variant="think"`，`useState` 切换）在**流式期间会被 React 重建**——
每个 reasoning delta 都触发该子树重渲染，于是**标记与计数一起丢失**：新节点的 `manual` 为假、计数归零，
自动驱动继续点击 → 用户每次折叠都被重新展开。

结论：**任何"挂在节点上的用户意图"在这类流式重渲染下都不可靠**。

## 修复（当前）

`taskhive-surfaces/dsh/client.js`：该 seam **彻底不再点击思考行**——删除 `trigger.click()`、手动标记监听、
`deepDivingAttempts` 计数簿记，只保留文案/摘要改写与可访问性标签；标签改为描述**真实**的展开状态。

依据：DSH `ReasoningRow` 的 `collapsedContent` 在折叠状态下**本来就会渲染 running 摘要**
（`latestLine(text)`），所以"不自动展开"**不丢任何进度信息**，也就从根本上不可能再与用户抢。

契约断言改为更强的不变量（`skin-performance-contract.js`）：
- `syncDeepDivingDisclosures` 函数体内**不得出现 `.click()`**；
- `deepDivingAttempts` 不得回归。

## 验证证据

| 日期 | 检查 | 结果 | 证据 |
|---|---|---|---|
| 2026-09-14 | `skin-performance-contract.js`（含 3 条新不变量） | 通过 | 函数体内无 `.click()`；簿记已移除 |
| 2026-09-14 | `npm test`（全量 28 个测试文件） | 通过 | 退出码 0 |
| 2026-09-14 | 运行时实测 | **未做** | 需页面存在真实思考行；codex 路由无 reasoning 块。若仍复现，用 `--remote-debugging-port=9222` 读该行状态定位 |

## 待办

1. 运行时复验折叠行为（用户重启后确认）。
2. 若仍不能折叠，优先怀疑 **DSH 自己的 turn-process 折叠**：其开合状态按 `(turn, answerStep)` 存于 store，
   turn 推进导致 `answerStep` 变化时会重新展开——需用调试端口确认是哪一行再定方案。

---

# T063 删除思考过程展示 + Codex 300 秒超时改为"先重试"（2026-09-14）

**用户请求原文**（上一会话 turn 22，该轮因上下文超限中断，本轮续做）：
> 现在删除这个思考思考展示，解决：本轮运行失败Codex 模型在 300 秒内未完成

## T063-1 删除思考过程展示（撤销 T057-2 / T060-3 的显示链路）

**决策**：T057/T060 接通的"思考实时展示"从四类适配器上整体撤除。保留以下三项**非展示**行为：

| 保留项 | 原因 |
|---|---|
| `textOfBlock` 继续排除 `reasoning` | 这是**上下文隔离**（T056 补记），不是展示：`llm-pi-ai` 原生路由仍会把 provider 的 thinking 落进会话，排除后它才不会在下一轮被回放并挤掉真实对话 |
| `usage` 继续上报 `reasoningTokens` | 真实用量读数，与展示无关 |
| web-ai 的进度播报行 | **既有行为**（T057 记录"原来只有 web-ai 在轮次开始就发 reasoning"），是任务状态播报不是模型思考；本轮未动 |

**删除内容**（`plugins/installed/taskhive-codex-model/dsh/index.js`，1555 → 1367 行）：

- 常量：`REASONING_DISPLAY_LIMIT`、`REASONING_TRUNCATION_NOTICE` 及其预算说明块。
- 帮手：`reasoningForDisplay`、`reasoningChunks`、`createReasoningStream`、`reasoningEvent`、`createReasoningCollector`。
- T060-3 为流式思考新增、随后因回退而**已无人调用**的 SSE/NDJSON 解码器：`STREAM_DONE`、`readResponseLines`、`streamPayload`、`isEventStream`。
- `createClaudeFolder` / `foldClaudeStream` 里的 thinking 折叠（Claude 转写只再需要 `result` 事件）。
- 导出表中的四个帮手。
- `CodexCliAdapter` / `ClaudeCodeAdapter` / `CatalogModelAdapter` / `AnthropicApiAdapter` 早在中断前已停止发射 reasoning；本轮确认四条路由**均不再出现** `blockType: 'reasoning'`，答案块回到 index 0。

**测试同步**：

- 删除 `tests/reasoning-display-contract.js`（整份文件都在断言被删除的展示行为）。
- `tests/reasoning-cli-routes-contract.js` 改写为**反向不变量**：假 CLI 仍然吐出 reasoning item / `reasoning_summary` / `reasoning_delta`，断言适配器**一个都不发射**、答案仍在 index 0、思考不泄漏进答案；effort 透传、用量分桶、超时配置、Claude 回退与限流分类全部保留（15 → 26 项）。
- `tests/reasoning-context-isolation-contract.js` 保留（隔离仍然成立），仅更新头部说明。
- `tests/model-routing-contract.js` 的超时断言随默认值/下限调整更新，并新增"超时必须重试"的源码不变量。

## T063-2 "Codex 模型在 300 秒内未完成"：一次超时不等于失败

T061 已把上限从 120s 提到 300s，但用户仍撞上一次失败——因为这条网关的延迟本身就是长尾（同一句寒暄实测 46.2s / 52.4s / 79.4s，也出现过 >100s、>150s，最早一次 `high` 探针挂满 5 分钟）。

**修复**：把"超时"从**终止条件**改成**重试条件**。

- `CODEX_REQUEST_ATTEMPTS`：默认 **2**，可用 `TASKHIVE_MODEL_ATTEMPTS` 覆盖（1–5，越界回落）。
- 只有 `code === 'TIMEOUT'` 且还有余次时才重试；其它错误照旧直接失败（避免把真实故障重复计费）。
- 超时下限 `>= 10000` 放宽到 `>= 1000`，使安装侧与合同测试都能用短超时驱动这条路径。
- 被放弃的那次尝试由 `runCodexOnce` 的 `finally → cancellation.cleanup()` 用 `taskkill /PID <pid> /T /F` 杀掉整棵进程树后才进入下一次，因此不会出现两个并发的模型调用（这一点由下面的假 CLI 实测证明：第一次进程仍在 `sleep 30000`，第二次立刻返回）。

**剩余风险（明确记录）**：重试把最坏耗时推到 2×300s；若该网关继续长尾，建议把默认路由切到不经 CLI 的 `llm-pi-ai` deepseek 路由（T061 待办 1）。

## T063 验证证据

| 日期 | 检查 | 结果 | 证据 |
|---|---|---|---|
| 2026-09-14 | `reasoning-cli-routes-contract.js`（26 项，含重试实测） | 通过 | 假 Codex CLI 发送 `reasoning`/`reasoning_summary`/`reasoning_delta`：全部 0 发射、答案在 index 0；`TASKHIVE_MODEL_TIMEOUT_MS=1500` 下第一次超时被放弃、第二次成功，`retry.log` 恰为 2 行 |
| 2026-09-14 | `model-routing-contract.js` | 通过 | 断言更新为"默认 300000 + 可覆盖 + 只重试超时 + 有次数上限" |
| 2026-09-14 | 残留引用扫描 | 通过 | 上列帮手/常量在插件与 `tests/` 中 0 引用；仅剩 web-ai 进度行与 `reasoningTokens` |
| 2026-09-14 | 语法解析（`vm.SourceTextModule`） | 通过 | 插件与客户端脚本均可解析（不执行） |
| 2026-09-14 | `npm test`（28 个测试文件） | 通过 | `run-contracts exit=0`；无 FAIL |
| 2026-09-14 | 真实网关下的 2×300s 最坏情况 | **未做** | 需一次真实长尾请求；重试路径本身已由假 CLI 实测 |

## T063 待办

1. 用户重启 TaskHive 后确认：普通提问不再出现思考行，且不再出现"300 秒内未完成"。
2. 若该网关长尾依旧，改默认路由到 `llm-pi-ai` deepseek（不经 CLI，无 CLI 自身 ~36.7k tokens 系统提示开销）。

---

# T064 修复切换 DeepSeek 模型后输入框模型选择消失/变成 TaskHive（2026-09-14）

**用户请求原文**（T063 执行中追加）：
> 另外我把模型切换成deepseek后 输入框模型选择直接消失变成taskhive了

## 根因：品牌清理把"模型名"当成了"厂商品牌"

`taskhive-surfaces/dsh/client.js` 的皮肤 seam 要把厂商字样（DeepSeek Harness / 厂商 logo）从 chrome 里去掉并换成 TaskHive 品牌。问题在于**输入框的模型座位渲染的就是所选模型自己的名字**——选了 DeepSeek 模型之后，厂商名就出现在了控件里，而三条清理机制**只按文本判断**，于是把模型选择本身当成品牌处理：

| # | 机制 | 后果 |
|---|---|---|
| 1 | `replaceComposerBrand` 命中输入框标语（`探索未至之境`）后执行 `container.innerHTML = brandSpanMarkup()` | 标语与模型座位**同一行**，整行被覆盖 → 模型选择被删除，原地只剩 TaskHive 字标 |
| 2 | 通用 vendor finder 用 `/deepseek/i` 匹配**任意**含该词的节点（宽 40–360、高 <100），命中后 `target.style.display='none'` 并插入 TaskHive 字标 | 模型座位/其所在行被隐藏并被替换 |
| 3 | `hideResidualBrandText` 的裸词规则 `^(deepseek\|harness)$` | 文本恰为 "deepseek" 的模型标签被直接隐藏 |

**旁证（本轮真实取证）**：隔离 packaged smoke 会沿用用户 `~/.dsh/settings.yaml` 的默认模型
（`deepseek-official/deepseek-v4-flash`），因此这次冒烟的 `ui-branding-probe.json` 恰好抓到了**真实 DOM 上的模型座位**：

```json
{ "text": "DeepSeek V4 Flash", "visible": true,
  "parent": { "tag": "BUTTON", "cls": "_7KE1Ra_trigger",
              "aria": "选择模型，当前 DeepSeek V4 Flash，推理等级 Default",
              "title": "DeepSeek V4 Flash · Default", "w": 189, "h": 28,
              "html": "<span class=\"_7KE1Ra_triggerLabel\">DeepSeek V4 Flash</span><span class=\"_7KE1Ra_triggerEffort\">Default</span><svg …" } }
```

这个 BUTTON **逐条满足**旧 vendor finder 的谓词：`textContent` 含 "deepseek" ✅、宽 189（40–360）✅、高 28（<100）✅
——机制 2 在真实页面上被证实；再加上用户"消失并变成 taskhive"的描述与机制 1/3 的同向效果，根因链闭合。
值得注意的是同一份探针里该按钮 `visible: true`，而 `before.composerBrandVisible=true / composerBrandText='TaskHive'`
——即**在修复后的客户端上，模型座位保留、输入区品牌照常生效**（见验证证据表）。

## 修复（`taskhive-surfaces/dsh/client.js`）

1. **豁免名单**：新增 `BRAND_SCRUB_EXEMPT = 'button,[role="button"],[role="combobox"],[aria-haspopup],[role="listbox"],[role="menu"],[role="dialog"],[aria-modal="true"],[data-slot*="model" i]'`。
2. **只替换命中节点**：`replaceComposerBrand` 改为 `original.innerHTML = brandSpanMarkup()`，不再碰 `container`；标记也落在被替换的节点上（冒烟探针查的 `[data-taskhive-composer-brand="true"]` 语义不变）。
3. **严格厂商词表**：新增 `VENDOR_BRAND_TEXT = /^deepseek(?:\s+(?:harness|preview|beta))?$/i`，通用 vendor finder 由"包含 deepseek"改为"**就是**厂商词"，并要求该节点既不在豁免控件内、也不包含豁免控件。
4. **裸词规则加豁免**：`^(deepseek|harness)$` 分支先 `node.closest(BRAND_SCRUB_EXEMPT)` 再隐藏。
5. 侧栏文字改写（`rebrandSidebarText`）本就只在 `logoRow` 内，保持不动。

## T064 验证证据

| 日期 | 检查 | 结果 | 证据 |
|---|---|---|---|
| 2026-09-14 | 隔离 packaged smoke 的真实 DOM（`ui-branding-probe.json`） | 取证 | 模型座位为 `BUTTON._7KE1Ra_trigger`（189×28，`aria-label="选择模型，当前 DeepSeek V4 Flash…"`，内含叶子节点 `DeepSeek V4 Flash`）——满足旧 finder 全部条件 |
| 2026-09-14 | 同一份探针上的修复效果 | 通过 | 该按钮 `visible: true`（未被隐藏）；`composerBrandVisible: true` / `composerBrandText: 'TaskHive'`（品牌替换仍生效，说明把标记从 container 移到命中节点没有破坏冒烟探针语义） |
| 2026-09-14 | `tests/brand-scrub-safety-contract.js`（新增 15 项） | 通过 | 从源码抽出 `VENDOR_BRAND_TEXT` 正则做**行为断言**：接受 `DeepSeek Harness` / `DeepSeek` / `deepseek`，拒绝 `DeepSeek V4 Flash` / `DeepSeek Chat` / `deepseek-reasoner` / `DeepSeek Coder V2`；并断言三条机制都已带豁免、`replaceComposerBrand` 不再写 `container` |
| 2026-09-14 | 语法解析 | 通过 | `client.js` 可解析（不执行） |
| 2026-09-14 | `npm test`（28 个测试文件） | 通过 | `run-contracts exit=0` |
| 2026-09-14 | 该次 smoke 的其余阶段 | **失败（与本轮无关）** | 止于 `probe-session-deletion`：`SessionAlreadyOwnedError: session "session-c22bb756…" is already owned by an active write handle`——用户正在运行的 TaskHive 持有同一会话写句柄（AppData 共享，见 T043 已知风险）；同理启动时出现磁盘缓存 `拒绝访问 (0x5)`。13:56 那次无并发实例的 smoke 是完整通过的 |
| 2026-09-14 | 用户自身窗口的复验 | **未做** | 客户端脚本改动不会热更新到已打开的窗口；见待办 |

## T064 交付物

| 文件 | 作用 |
|---|---|
| `resources/app/plugins/installed/taskhive-surfaces/dsh/client.js` | 四处修复（豁免名单 / 只替换命中节点 / 严格厂商词表 / 裸词豁免） |
| `resources/app/tools/inspect-branding.mjs` | 新增：一条命令判断"模型选择器是不是被品牌清理吃掉了"——列出模型控件、注入的品牌节点、**当前 vendor finder 会命中的节点**、被隐藏的 DeepSeek 节点，并给出 `NO VISIBLE MODEL CONTROL` / `VENDOR FINDER RISK` 结论 |
| `resources/app/docs/KNOWN-ISSUES.md` | 新增**问题 #5**（症状 / 30 秒定位 / 三条根因 / 触发条件 / 修复 / 证据 / 复发信号 / 相似现象区分），索引同步 |
| `resources/app/tests/brand-scrub-safety-contract.js` | 新增 15 项回归断言 |

## T064 待办

1. 重启 TaskHive（客户端插件脚本不会热更新到已打开的窗口）→ 切到 DeepSeek 模型 → 确认输入框模型选择**存在且显示模型名**，同时左栏/侧栏品牌仍是 TaskHive。
2. 若仍复现：`TaskHive.exe --remote-debugging-port=9222` 后运行 `node tools/inspect-branding.mjs`（或读 `logs/ui-branding-probe.json` 的 `deepSeekTextNodes`），它会直接指出是哪一条 seam 还在动手——详见 `docs/KNOWN-ISSUES.md` 问题 #5。
3. 并发实例会污染冒烟：用户窗口开着时 `--smoke-isolated` 仍会共享 AppData，`probe-session-deletion` 会以 `SessionAlreadyOwnedError` 失败（本轮实测）。发布前的完整冒烟应在没有其它 TaskHive 实例时跑。

---

# T065 修复 T064 的副作用：对话标题又出现 DeepSeek 图标（2026-09-14）

**用户请求原文**：
> 对话界面标题修复，出现了deepseek图标

## 根因：厂商图标本来只是"附带损害"，不是被专门处理的

DSH 的 `HeroShell`（`dsh-client-ui-conversation/lib/client.js`，`renderSlot` 处）把**厂商图标、标题文案、预览版徽标放在同一个 `div.headline` 里**：

```js
div.headline
  ├─ span.fishHitbox  → renderSlot("conversation.hero.brand.mark", {size:34}, { fallback: HeroFish })  ← 厂商图标
  ├─ span.headlineText → t("hero.headline")                                                             ← "探索未至之境"
  └─ span.previewBadge → t("hero.preview")                                                              ← "预览版"
```

`replaceComposerBrand` 命中的正是 `span.headlineText`（唯一 textContent 恰为标语的元素），而修复前它执行的是
`container.innerHTML = brandSpanMarkup()`，container = **`div.headline`** —— 整行被换掉，
所以**厂商图标是被"顺手"删掉的**。T064 把它改成"只重写命中的标语节点"之后，图标就回来了。

结论：**该图标消失从来不是那条 seam 的功劳，只是它的附带损害**；它需要一个自己的处理路径。

## 修复（`taskhive-surfaces/dsh/client.js`）

**第一次（不完整，已废弃）**：只把该槽位的厂商子节点 `display:none`，不插自己的图标，指望同行标语 seam 补上品牌。

**为什么不行（真实 DOM 实测）**：`span.fishHitbox` 为 `display:flex; width:34px`，隐藏子节点后**留下 34×34 空洞**
（`{x:389,y:271,w:34,h:0}`）；而标语 seam 把 `<img 24px>` 写进 `span.headlineText`，那是 `display:block` 的**网格项**，
于是图标**叠在文字上方**（图标 y=260、文字 y=283）。这正是用户说的"图标没放在正确位置"。

**最终修复**：把 TaskHive 图标放进厂商刚腾出的那个槽位，尺寸取 DSH 自己传给该槽位的 `size`：

- 新增 `HERO_MARK_SIZE = 34` 与 `heroMarkMarkup()`（有真实图标用 `<img>`，否则把中性字形缩放到 34）；
- `ensureHeroBrandMark()`：隐藏厂商子节点（**不删除**，React 协调安全）→ 我们的图标不是 `IMG` 时
  `insertAdjacentHTML('beforeend', heroMarkMarkup())`（只删自己上一轮的占位）；
- `replaceComposerBrand` 改为只写文字标记 `brandWordmarkMarkup`，不再把 `<img>` 塞进文字节点（网格行会把它叠到文字上方）；
- 全部挂进 `reconcileSidebarBrand()` —— 每轮 scrub 头部 / 品牌相关 mutation / 1200·3000·6000ms 重试都覆盖。
  行内布局恢复为与厂商同构：`[TaskHive 图标 34px][TaskHive 文字]`（原为 `[鱼 34px][探索未至之境]`）。

## T065 验证证据

| 日期 | 检查 | 结果 | 证据 |
|---|---|---|---|
| 2026-09-14 | DSH 客户端源码取证 | 取证 | `HeroShell` 把 `conversation.hero.brand.mark`（`size:34`）与 `hero.headline` 文案放进同一个 `div.headline`；旧 seam 的整行 `innerHTML` 替换是那个图标消失的唯一原因 |
| 2026-09-14 | **隔离实例 + CDP 实测 DOM（修复后）** | 通过 | `span.fishHitbox {x:389,y:271,w:34,h:34}`；槽位子节点 `[<svg display:none>, <img 34×34 display:block @389,271>]`；`span.headlineText` 仅 `TaskHive` 文字 `{x:433,y:272,w:103,h:32}`；`previewBadge display:none` |
| 2026-09-14 | 同一实测里的修复前状态 | 取证 | 空洞 `{x:389,y:271,w:34,h:0}`；图标 24×24 在 `headlineText` 内、文字被压到下一行（y=260 vs 283，行高 56） |
| 2026-09-14 | `tests/brand-scrub-safety-contract.js`（20 → 24 项） | 通过 | 新增：必须写入 `heroMarkMarkup()`、尺寸必须 34、只删自己的占位、中性字形同尺寸替换、`replaceComposerBrand` 只写文字 |
| 2026-09-14 | `npm test`（28 个测试文件） | 通过 | `run-contracts exit=0` |
| 2026-09-14 | 用户窗口复验 | **未做** | 需重启后看 hero；见待办 |

## T065 待办

1. 重启 TaskHive → 空白对话的标题行应为 `[TaskHive 图标][TaskHive]`，图标在厂商图标原来的位置、34px，无空洞、不叠字，且"预览版"徽标仍隐藏。
2. 若仍有偏差：`node tools/inspect-branding.mjs` 的 `conversation hero row` 会打印槽位每个子节点
   （`tag=visible/hidden`，本程序标记标 `(ours)`）与整行 HTML + 各元素 rect，可直接比对位置与尺寸。

---

# T066 专家界面只保留团队模式（移除"个人"）（2026-09-14）

**用户请求**：
> 专家界面团队和个人有区别吗？这个功能只保留团队

## 取证结论：团队 vs 个人，**运行上没有区别**

三处独立证据：

1. **界面层**：`renderer.js` 里 `expertMode` 的**唯一**用途是一行
   `teamSelect.disabled = expertMode === 'individual'`（把"团队"下拉置灰）。它不改流水线、不改路由、不改提示词。
2. **数据层**：个人模式里选中的专家写进 `experts/experts.json` 的 `activeExpertId` / `activeExpertIds`。
   全仓检索（排除 `node_modules`/`harness`）只有三处引用：
   `experts/config-store.js`（读、写、校验归属团队）、`experts/experts.json`（持久化）、
   `renderer.js:887`（用来预选下拉项）。**没有任何执行路径读它。**
3. **执行层**：`taskhive_expert_run` → `runExpertTeam` 遍历所选团队的 `workflow.stages`，
   每个阶段取 `stage.owner` 的专家执行（再按该专家的 provider/model 路由）。
   团队始终是执行单位，与"个人"模式无关。

因此"个人"模式是一个**装饰性开关**：它承诺的"单独选一个专家执行"从未实现。用户要求只保留团队，
正好与运行时行为一致。

## 修改

| 文件 | 改动 |
|---|---|
| `app/renderer/renderer.js` | 移除"个人"按钮；模式行改为静态标签「团队协作」+ 说明文字；删除 `expertMode` 状态、`[data-expert-mode]` 点击接线；团队下拉改为仅在"没有任何团队"时禁用（`teamSelect.disabled = expertConfig.teams.length === 0`） |
| `app/renderer/renderer.js`（续） | **同时移除"具体专家"下拉**：它是同一种装饰性个人选择（写 `activeExpertId`、运行时无人读）。列标题改为「团队与阶段」，状态行改为报告该团队的阶段数而非"具体专家：由团队自动选择"；`fillExpertOptions` / `expertSelect.onchange` 删除；团队切换仍显式 `expertId: ''` 清掉遗留的个人选择 |
| `app/renderer/ui-overrides.css` | 静态标签 `cursor:default`（不再假装可点）+ `.expert-mode-hint` 样式 |
| `app/main.js` | 专家探针：`modes === 2` → `=== 1`；等待条件与证据字段去掉 `#expert-active`；`expertsOk` 去掉 `active === true` |
| `tests/expert-team-only-contract.js` | 新增 12 项：无 `individual`、模式标记恰为 1 且是 `team`、标记是标签而非 tab、无 `expertMode` 残留、团队下拉不由模式控制、探针断言为 1、**无 `#expert-active`**、探针不再引用被移除的控件、状态行报告阶段流水线、团队切换清空个人选择、执行路径按 `stage.owner`、执行路径不读 `activeExpertId` |

## T066 验证证据

| 日期 | 检查 | 结果 | 证据 |
|---|---|---|---|
| 2026-09-14 | 源码取证（三处交叉） | 取证 | `expertMode` 只控制下拉禁用；`activeExpertId` 仅被 config-store / renderer 预选引用；`runExpertTeam` 按 `stage.owner` 执行 |
| 2026-09-14 | **隔离实例 + CDP 实测专家面板** | 通过 | `modeCount=1`、文本「团队协作」、`SPAN/no-role`（不再是 `role="tab"`）、`#expert-team` 未禁用、`#expert-enabled` 可读、`#expert-config-status` 正常（"当前团队：PLC 电气专家团队…"） |
| 2026-09-14 | 移除"具体专家"下拉后的全仓检索 | 通过 | `expert-active` / `expertSelect` / `fillExpertOptions` 在应用代码中 **0 引用** |
| 2026-09-14 | `tests/expert-team-only-contract.js`（12 项） | 通过 | 见上表断言 |
| 2026-09-14 | `npm test`（30 个测试文件） | 通过 | `run-contracts exit=0` |
| 2026-09-14 | 语法检查 | 通过 | `node --check app/renderer/renderer.js`、`app/main.js` 均为 0 |

## T066 待办

1. （已执行）"具体专家"下拉作为同一种装饰性个人选择一并移除；若以后要做"个人专家单独执行"，
   需要改 `runExpertTeam`（让 `activeExpertId` 真正覆盖阶段 owner），届时再把控件加回来。
2. 输入框下面那个「专家」按钮的行为已在 **T067** 落地（点击打开插件 + 双向同步）。

---

# T067 输入框「专家」按钮改为"打开专家插件"，并修掉两边状态不同步（2026-09-14）

**用户请求（原始反馈）**：
> 对话区输入框底下的专家插件不能点击打开，专家插件内部打开关闭和这个逻辑冲突吗？

**取证结论**（T066 已记录）：那不是"打开"按钮，而是与插件内 `#expert-enabled` **同一开关的另一端**
（同一个 `experts/experts.json`）。逻辑上不冲突，但存在真实缺陷：输入框那个按钮只在挂载时读一次状态，
外部改动不会推给它 —— 实测中插件显示"专家已关闭"时，输入框按钮仍显示"专家已开启"。

## 修改

| 文件 | 改动 |
|---|---|
| `plugins/installed/taskhive-surfaces/dsh/client.js` | `ExpertToggle` 改为**点击即 `openSurface('experts')`**；删除本地 toggle/`busy`/`disabled`；保留 `data-enabled` 并把状态写进 `aria-label`/`title`（"打开专家插件；当前专家已开启/已关闭，开关在插件里"）；新增 `aria-haspopup="dialog"`（不再是 `aria-pressed`，因为它现在打开对话框而不是切换）；订阅 `window.taskhive.onExpertStatus` 实时刷新 |
| `app/preload.js` | 新增 `onExpertStatus`：`ipcRenderer.on('experts:changed')` + 返回取消订阅函数（与既有 `onWebAiState` 同构） |
| `app/main.js` | 新增 `publishExpertStatus()`：每次专家配置变更（set-enabled / set-selection / create / update / remove）都向**所有** webContents 推送 `experts:changed`；electron 导入补 `webContents`；冒烟探针 `probeExpertShortcut` 从"点两次断言开关翻转"改为"点一次断言**插件面板被打开**、且开关状态**不变**、随后回到 chat" |
| `plugins/installed/taskhive-surfaces/dsh/client.js`（皮肤 CSS） | 补 `[data-taskhive-expert-toggle]:hover` / `:focus-visible`：它以前是开关，唯一的反馈是状态文字，所以指针是 pointer 但按钮悬停**没有任何变化**；现在它是"打开"按钮，必须有和旁边原生控件一致的悬停反馈 |
| `app/main.js`（探针） | `probeExpertShortcut` 的相邻间距断言 `<= 8` → `> 0 && <= 20`：实测 alpha.2 的输入框卡片对**所有**控件统一 16px 间距（BUTTON→BUTTON、BUTTON→完全权限、完全权限→专家 均为 16px），旧上限早于该布局 |
| `tests/expert-shortcut-contract.js` | 新增 9 项契约 |

## T067 验证证据

| 日期 | 检查 | 结果 | 证据 |
|---|---|---|---|
| 2026-09-14 | **隔离实例 + CDP 端到端实测** | 通过 | ① 点击输入框的「专家」→ `body[data-taskhive-plugin-surface-active]=true` 且专家插件窗口出现；② 点击**不改变**开关（`data-enabled` 仍为 `false`）；③ 在插件里点 `#expert-enabled`（"专家已关闭"→"专家已开启"）后，输入框按钮同步变为 `data-enabled=true`、`aria-label="打开专家插件（专家已开启）"`；④ 用 API 改回 `false` 后按钮立即回到"已关闭"（双向同步）；⑤ 结束后已切回 chat |
| 2026-09-14 | `tests/expert-shortcut-contract.js`（9 项） | 通过 | 控件必须 `openSurface('experts')` 且不得出现 `setExpertEnabled`；必须订阅 `onExpertStatus`；preload 必须暴露该订阅；主进程 5 个变更入口全部 `publishExpertStatus`；插件仍持有开关；冒烟探针断言"打开"而非"翻转" |
| 2026-09-14 | 语法检查 | 通过 | `node --check app/main.js`、`app/preload.js`；`client.js` 用 `vm.SourceTextModule` 解析通过 |
| 2026-09-14 | **悬停反馈实测**（CDP 真实鼠标移动） | 通过 | 按钮悬停前 `background-color: rgba(0,0,0,0)`（全透明、无反馈）→ 悬停后 `rgba(38, 49, 72, 0.06)`（主题悬停色）、`matches(':hover')=true` |
| 2026-09-14 | **输入框控件间距实测** | 取证 | 输入框卡片（`uV2eYG_card`）内相邻控件间距一律 **16px**：`BUTTON→BUTTON`、`BUTTON→完全权限`、`完全权限→专家` 均为 16px → 旧断言 `<= 8` 早于该布局 |
| 2026-09-14 | packaged 冒烟 `expert-shortcut-probe.json` | 通过 | `ok: true`（`opened: true`、`after.enabled === initial.enabled`、`popup: dialog`、`restoredToChat: true`） |
| 2026-09-14 | `npm test`（30 个测试文件） | 通过 | `run-contracts exit=0` |
| 2026-09-14 | 专家开关状态 | 未被改动 | 实测前 `false`、实测后仍 `false`（测试脚本自带还原） |

## T067 待办

1. 重启 TaskHive 后在真实窗口确认：点输入框的「专家」直接打开插件面板；在插件里开关后，输入框按钮立刻跟着变。
2. 冒烟探针的新断言（`result.opened === true` / `result.after?.enabled === result.initial?.enabled`）依赖 `body[data-taskhive-plugin-surface-active]`；
   该标记只在"非 chat/settings 插件面"时置位，若以后插件面打开方式改变需同步更新。

## 本轮附带发现与顺带修正

1. **探针曾把专家开关留在"已开启"**：`--smoke-isolated` 的 `probeExpertShortcut` 会在 `finally` 里
   `expertConfig.setEnabled(original.enabled)` 还原，但本轮我为了跑别的探针**在探针执行途中强杀了实例**，
   `finally` 没跑到，开关被留在"已开启"。已用 `setEnabled(false)` 改回你原来的值（本来就是 `false`）。
   正常退出（含抛错）都会还原；只有进程被强杀/崩溃才会残留。
2. **探针 `expert-shortcut-probe.json` 长期 `ok:false`（非门禁，但一直是红的）**：两条视觉断言与实际不符——
   ① 要求悬停背景为非透明深色，而这个按钮内联 `background:transparent` 且没有任何悬停样式（实测
   `rgba(0,0,0,0)`）；② 要求与左侧控件间距 `<= 8`，而实测 alpha.2 的输入框卡片对**所有**控件统一 **16px**。
   本轮补了悬停/焦点样式（实测悬停后 `rgba(38,49,72,0.06)`），并把间距断言改为 `>0 && <= 20` 并写明依据。
   现在该探针 `ok:true`。

---

# T068 专家开关只保留输入框，移除插件内的重复开关（2026-09-14）

**用户请求**：
> 去除专家界面的开关，开关只保留输入框内的开关

## 决策与来回（记录清楚，避免以后再翻）

| 轮次 | 输入框「专家」按钮 | 插件内的开关 | 插件怎么打开 |
|---|---|---|---|
| T055 起 | 开关（toggle） | 也有一套 `#expert-enabled`（同一状态） | 左侧栏「专家」 |
| T067（我的选择） | 改为"打开插件" | 唯一开关 | 输入框按钮 |
| **T068（用户指定）** | **恢复为唯一开关** | **移除** | **左侧栏「专家」** |

T067 与 T068 是一对相反的选择；以用户口径为准：**开关只存在于输入框**，插件只负责配置（团队、阶段、专家、
模型路由、知识库），不再持有第二个开关。

## 修改

| 文件 | 改动 |
|---|---|
| `plugins/installed/taskhive-surfaces/dsh/client.js` | `ExpertToggle` 恢复为开关：`onClick` 调 `setExpertEnabled(!enabled)`，`aria-pressed` 回到切换语义（去掉 `aria-haspopup`），`title`/`aria-label` 变为"点击开启/关闭专家协作；团队与阶段在专家插件中设置"；**保留** `window.taskhive.onExpertStatus` 订阅（外部/其他窗口改动即时同步）与 T067 加的悬停/焦点样式 |
| `app/renderer/renderer.js` | 移除 `#expert-enabled` 按钮、`enabledButton` 引用及其 `onclick`；模式行只留静态标签「团队协作」+ 提示「开关在输入框的「专家」按钮上；这里只配置团队与阶段」 |
| `app/renderer/ui-overrides.css` | 删除 `.expert-mode-row #expert-enabled` 死样式 |
| `app/main.js` | `probeExpertShortcut` 回到"点击翻转 → 再点击还原"的往返断言，并新增 `aria-pressed` 与状态一致；repository 探针的 `enabled` 字段改为 `enabledSwitchInPlugin`，`expertsOk` 断言它 **=== false**（插件里不得再有开关） |
| `tests/expert-shortcut-contract.js` | 重写为 11 项：控件是开关（不得出现 `openSurface('experts')`）、`aria-pressed` 切换语义、保留 `onExpertStatus` 订阅、preload 暴露订阅、五个变更入口都广播、**插件无开关**、无死样式、探针断言往返、repository 探针断言插件无开关 |

## T068 验证证据

| 日期 | 检查 | 结果 | 证据 |
|---|---|---|---|
| 2026-09-14 | **隔离实例 + CDP 实测**：开关往返 | 通过 | 点击前 `data-enabled=false / aria-pressed=false / aria="专家协作已关闭，点击开启"` → 点击后 `true/true/"专家协作已开启，点击关闭"`，`expertStatus()` 同步为 `enabled:true` |
| 2026-09-14 | 同上：主机推送 | 通过 | 外部 `setExpertEnabled(false)` 后按钮自动回到 `false/false`（证明 `experts:changed` 推送链路仍生效） |
| 2026-09-14 | 同上：插件面板 | 通过 | `hasSwitch:false`、`hasAnyEnabledButton:false`（面板内任何按钮都不再带开启/关闭文案）；模式行 =「团队协作 · 开关在输入框的「专家」按钮上；这里只配置团队与阶段」；团队下拉与 9 个阶段正常 |
| 2026-09-14 | 状态无副作用 | 通过 | 实测前 `false`、实测后 `false`（脚本自带还原） |
| 2026-09-14 | `tests/expert-shortcut-contract.js`（11 项）、`tests/expert-team-only-contract.js`（12 项） | 通过 | 见上表 |
| 2026-09-14 | `npm test`（30 个测试文件） | 通过 | `run-contracts exit=0` |
| 2026-09-14 | packaged 冒烟 | 通过 | `electron-smoke.json ok:true`、无 `smoke-ui-error`；`expert-shortcut-probe.json` `ok:true`（往返翻转+还原）；`repository-ui-probe.json` 的 `enabledSwitchInPlugin:false` |
| 2026-09-14 | 语法检查 | 通过 | `node --check app/main.js`、`app/renderer/renderer.js` |

## T068 待办

1. 重启 TaskHive 后在真实窗口确认：输入框的「专家」按钮点击即开/关（标签与描述跟着变），专家面板里**没有**开关，
   面板只显示团队与阶段；插件仍从**左侧栏「专家」**打开。

## T069 消除 CODESYS 代码工作台的定时自动刷新并建立对话联动

### 现象与根因（只读诊断 + 运行日志）

1. `plugins/installed/taskhive-surfaces/dsh/client.js` 的 `CodesysWorkbench` 内固定 `setInterval(..., 15000)` 轮询当前工程。每轮开始即
   `setBusy(true)` 并重写状态文案，而提示词框、代码编辑器、刷新当前工程、确认写入等控件都是 `disabled: busy`——每 15 秒整块控件禁用再恢复，
   正在输入时按键会被丢弃。
2. 去重条件依赖 `activeProject?.activeGui`。手工/离线绑定（`bindSourceProject(path, null)` → `activeProject === null`）或识别路径变化时，
   每一轮都会重跑 `bind-project` + `inspect-project`：清空 `proposal/assistantText/reviewAccepted`，并由 `useEffect([selectedKey, proposal])`
   覆盖用户正在编辑的代码——这就是"整块自动刷新"。
3. 识别链路每次都 spawn 一个 `powershell.exe`（`win-window-monitor.ps1` 内含 `Add-Type` C# 编译）并递归扫描 `%ProgramData%\CODESYS` 下
   ≤256 个 `.opt`（每个 ≤8 MB）；命中 `cached-plugin-owned-process` 时这些开销被丢弃。
   证据：`logs/trajectory.jsonl` 中 `codesys.current-project.detected` 在 2026-09-15 02:15:08–02:21:40 连续 26 次、间隔 14–16 秒，
   93 次里 56 次 `found:false`。
4. 同一时段没有 harness 重启或整页 reload 事件，因此刷新确实来自该轮询，而不是页面重载。

### 修改

| 文件 | 改动 |
|---|---|
| `plugins/installed/taskhive-surfaces/dsh/client.js` | 删除 15 秒硬轮询；改为事件驱动（挂载 / 窗口重新获得焦点 / 回到可见 / 手动刷新）+ 120 秒静默兜底，且仅在工作台真正可见（`IntersectionObserver`）时运行。`detectCurrentProject({ silent, force })`：静默探测不碰 `busy`、不写状态文案、只在值真正变化时 setState；用规范化绝对路径判定"同一工程"，同一工程只刷新身份与写权限，绝不重读工程树。瞬时漏检不再清除已绑定工程（手工绑定同样受保护）。`probingRef` 保证同一时刻只有一次探测，显式刷新可强制穿透节流与桌面端缓存 |
| 同上 | 新增对话联动：`window.__TASKHIVE_CODESYS_WORKBENCH__` 只读实时状态；会话订阅改为"任何新的助手消息里出现结构化代码提案就应用"，按 seq 水位线只消费一次、打开工作台时不回放历史；调用宿主 `/taskhive/api/codesys.workbench.*` 发布实时状态并在回合结束时领取排队提案；`loadedEditorRef` 记录编辑器自身基线，手写未保存的代码永不被提案覆盖，改为出现「载入 AI 建议」按钮 |
| 同上 | 变更着色：项目树 `data-change-state`（agent=蓝 / manual=琥珀 / written=绿 / pending-create）+ 圆点 + 状态文案，附图例与"已修改 N"计数；展开文件用行高亮层（`taskhive-codesys-editor-highlights`，与 textarea 滚动同步、按状态着色）逐行显示改动，代码窗格标题随状态变色；写入成功后保持绿色标记，回滚清空 |
| `plugins/installed/taskhive-surfaces/dsh/index.js` | 新增宿主能力：带 loopback/同源栅栏的 `/taskhive/api/codesys.workbench.publish|pending` 路由（会话隔离、状态 15 分钟 TTL、提案 30 分钟 TTL、512 KB 体积上限）；新增工具 `taskhive_codesys_workbench`（读实时状态：工程、当前对象完整代码 + 磁盘基线、已改动对象、待确认差异、返回契约与 PLC 禁令）与 `taskhive_codesys_workbench_propose`（把结构化差异排队交给工作台，绝不写文件；未绑定工程时直接报错）；新增 `systemPrompt.section`（order 3050）一句话契约，使**在对话里**提出的请求也能命中工作台 |
| `app/main.js` | `codesys:current-project` 增加 6 秒 memo 与并发去重，`force:true` 绕过（用户点"刷新当前工程"必为新鲜探测）；日志增加 `forced` 字段 |
| `app/preload.js` | `currentCodesysProject(input)` 透传 `{ force }` |
| `app/codesys-current-project.js` | `recentCodesysProjectPaths` 按根目录 mtime 记忆 15 秒，避免每轮重扫 `.opt` |
| `tests/codesys-workbench-link-contract.js` | 新增合同：禁止 15 秒定时刷新与 busy 闪烁、路径级去重、手写保护、双向链路、着色属性、桌面 memo；并用 mock 宿主上下文**真实验证** publish → 读工具 → propose → pending 领取 → 会话隔离 → 跨站 403 → 空提案拒绝 |

### T069 验证证据

| 日期 | 检查 | 结果 | 证据 |
|---|---|---|---|
| 2026-09-15 | `node tests/codesys-workbench-link-contract.js` | 通过 | 静态不变量 + mock 宿主端到端往返全部断言通过 |
| 2026-09-15 | `node tests/run-contracts.js` | 通过（1 项环境受限） | 除 `reasoning-cli-routes-contract.js` 因本沙箱禁止带管道 spawn 而 `spawn EPERM`（改动前同样失败，与本轮无关）外全部通过 |
| 2026-09-15 | `node --check` | 通过 | `app/main.js`、`app/preload.js`、`app/codesys-current-project.js`、`taskhive-surfaces/dsh/client.js`、`taskhive-surfaces/dsh/index.js` |
| 2026-09-15 | 宿主插件模块加载 | 通过 | `import('./plugins/installed/taskhive-surfaces/dsh/index.js')` 成功，导出 `apply,inject,name` |
| 2026-09-15 | 旧合同回归 | 通过 | `codesys-workbench-ui-contract`、`context-budget-contract`、`skin-performance-contract`、`codesys-*` 全部通过 |

### T069 待办（需真实界面验收）

1. 重启 TaskHive，打开 CODESYS 面板 →「代码任务」，静置 3 分钟：状态栏与所有按钮**不得**再自行变化或闪烁（旧行为：每 15 秒一次）。
2. 在**对话**里直接说「改一下工作台里打开的这段代码」：模型应先调用 `taskhive_codesys_workbench` 读到当前对象完整代码，再用
   `taskhive_codesys_workbench_propose`（或直接返回 JSON 块）把差异送回工作台；工程树与展开文件应出现蓝色高亮，点击"确认写入工程（离线编译）"后转为绿色。
3. 在编辑器里手写改动的同时让 AI 返回提案：手写内容不得被覆盖，应出现「载入 AI 建议」按钮。
4. 真实验收前不得把本任务改为"已验证"。

## T070 工作台项目树改为真实 CODESYS 多级树

### 现象与根因（用真实 inspect 产物取证）

1. `codesys-monitor/scriptengine.cjs` 的 `inspect-project` 只调用 `project.get_children(True)` 取**扁平**列表：既没有父节点、深度、路径，也没有类别信息，客户端因此只能渲染一层平铺行，"设备 vs 代码"无从区分。
2. 真实产物证据（`workspaces/codesys-scriptengine/jobs/direct-1788240547276-c81d1bfc/runs/inspect-project-*/result.json`，68 个对象）：
   `obj.type` 返回的是**对象类型 GUID**，不是可读类型名——`6f9dac99-…` = POU（PLC_PRG / FB_5DOF_Platform_Move / Syslog_FB …）、`2db5746d-…` = DUT、
   `225bfe47-…` = 设备（Device / LC10E_V1_04_* / EtherCAT_Master_SoftMotion）、`639b491f-…` = Application、`adb5cb65-…` = Library Manager、
   `ae1de277-…` = Task Configuration、`98a2708a-…` = Task、`40b404f9-…` = Plc Logic、`738bea1e-…` = 文件夹（ServoMotor）、`085766fd-…` = 轴（AXIS_X…）。
   该列表的顺序也不是深度优先（子节点出现在父节点之前），因此**单靠顺序无法还原层级**。
3. 顺带发现 `probeCodesysWorkbenchProject` 仍在断言早已被移除的差异面板（`[data-codesys-code-diff]` 的 `role="row"` 与语法着色 token），
   而工作台现在只有可编辑 textarea —— 该断言在当时已经必失败（`logs/codesys-workbench-project-probe.json` 缺失）。

### 修改

| 文件 | 改动 |
|---|---|
| `plugins/installed/codesys-monitor/scriptengine.cjs` | `inspect-project` 改为逐层遍历：新增 `object_children`（仅直接子节点，兼容 `get_children(False)` 与关键字形式）与 `object_class`，每个对象新增 `parentGuid`、`parentName`、`depth`、`path[]`、`hasChildren`、`className`；`project.get_children(True)` 仍作为覆盖率兜底，walk 未覆盖的对象以 `ungrouped: true`、`parentGuid: ''` 追加，保证对象数量与写入链路不退化；新增 `hierarchy: {roots, grouped, ungrouped}` 汇总 |
| `plugins/installed/taskhive-surfaces/dsh/client.js` | 新增对象类型 GUID → 类别表（设备/轴/轴池/任务/任务配置/应用/PLC 逻辑/工程设置/文件夹/POU/GVL/DUT/库管理器/跟踪/文本列表）与 `codesysKindOfObject`（未知 GUID 按 flag 与声明关键字兜底，`ungrouped` 绝不猜成设备）；新增 `buildCodesysTree`（按 parentGuid、AI 待新增对象按 parentName 挂载，含环路保护）与 `codesysTreeVisibleKeys`（过滤时保留完整层级）、`codesysTreeChangeStates`（未展开的祖先聚合显示子项改动，`data-change-scope="subtree"` 用点状左框） |
| 同上 | 项目树改为真实多级渲染：行内缩进、`▸/▾` 折叠按钮、按类别着色的类型方块与非代码类别标签、子节点计数；`role="treeitem"` + `aria-level`/`aria-expanded` + 键盘 Enter/空格选择与左右方向键展开折叠；工具条新增「全部 / 仅代码 / 设备·容器」过滤与「全展开 / 全折叠」；选中对象自动展开其祖先；选中设备/容器时编辑器给出说明而不是空白编辑器；`window.__TASKHIVE_CODESYS_WORKBENCH__` 增加 `kindOf`/`buildTree`/`filterKeys` 纯逻辑探针口 |
| 同上 | 发布给宿主的实时状态新增 `hierarchy`、`kindCounts` 与当前对象的 `kind`/`path`/`parentGuid` |
| `plugins/installed/taskhive-surfaces/dsh/index.js` | 读工具返回 `hierarchy`、`kindCounts` 与 `openObject.treePath`（设备/应用/… 路径），使模型能定位并说明对象在真实项目树中的位置 |
| `app/main.js` | `probeCodesysWorkbenchProject` 改为与当前 DOM 一致：断言真实代码编辑器内容（`PROGRAM PLC_PRG`）与行高亮层；GUID 断言只看对象行（分组行没有 GUID）；新增 `treeStructureVerified`（层级/类别/分组）、`treeInteractionVerified`（真实点击折叠按钮与过滤器后行数与 `aria-expanded` 变化并还原）、`seamVerified`（用合成 CODESYS 数据在真实页面运行 `kindOf`/`buildTree`/`filterKeys`，断言深度 3、类别序列与过滤计数）；引擎未能返回父节点时按"扁平兜底"记录并跳过层级断言 |
| `tests/codesys-project-tree-contract.js` | 新增合同：静态不变量 + **执行**客户端纯逻辑（分类/建树/过滤/改动聚合，含真实 GUID 数据）+ **执行**引擎生成的 Python（用假 CODESYS 对象断言父节点、深度、路径、`hierarchy` 计数与未覆盖对象的兜底保留）+ 用 Python 编译生成的脚本（该检查可捕获模板字符串破坏 Python 的问题） |

### T070 验证证据

| 日期 | 检查 | 结果 | 证据 |
|---|---|---|---|
| 2026-09-15 | `node tests/codesys-project-tree-contract.js` | 通过 | 客户端纯逻辑在 Node 中执行：设备/应用/库管理器/文件夹分类、深度 3 层级、待新增对象挂到 parentName、`仅代码`=7 行含祖先、`设备·容器`=6 行、祖先聚合改动状态；引擎生成的 Python 用假对象执行：8 个对象全部保留、`hierarchy={roots:2,grouped:7,ungrouped:1}`、`PLC_PRG` 路径 `['Device','Plc Logic','Application','PLC_PRG']` |
| 2026-09-15 | 生成的 ScriptEngine Python 编译 | 通过 | `python -m py_compile offline-action.py` / `probe.py`（Python 3.14；源码保持 IronPython 2.7 风格） |
| 2026-09-15 | `node tests/run-contracts.js` | 通过（1 项环境受限） | 除 `reasoning-cli-routes-contract.js` 因本沙箱禁止带管道 spawn 报 `spawn EPERM` 外全部通过 |
| 2026-09-15 | `node --check` | 通过 | `app/main.js`、`plugins/installed/codesys-monitor/scriptengine.cjs`、`taskhive-surfaces/dsh/client.js`、`taskhive-surfaces/dsh/index.js` |
| 2026-09-15 | 真实工程产物比对 | 通过（离线） | 以上分类表与层级判定依据 `jobs/direct-1788240547276-*` 的 154 KB 真实 `inspect-project` 产物（68 个对象）建立 |

### T070 待办（需真实界面验收）

1. 重启 TaskHive，打开 CODESYS 面板 →「代码任务」，绑定真实工程：项目树应显示 `Device → Plc Logic → Application → {Library Manager, Task Configuration, POU/GVL/DUT…}` 多级结构，
   POU/GVL/DUT 用不同颜色方块标记，设备/应用/库管理器显示类别标签。
2. 点击 `▸/▾` 逐级展开与折叠、「全展开」「全折叠」应即时生效；「仅代码」只保留 POU/GVL/DUT 及其祖先路径；「设备·容器」只保留非代码节点。
3. 选中设备/应用/文件夹时，代码区应给出说明而不是空白编辑器；选中代码对象后应可编辑并继续联动的差异高亮。
4. 真实工程上确认层级与 CODESYS 自身项目树一致（尤其多设备/EtherCAT 从站与 SoftMotion 轴池）；如某类对象分类不符，记录其 `type` GUID 以补表。
5. 真实验收前不得把本任务改为"已验证"。

## T071 修复 T070 实测反馈（读取慢 / 不能折叠 / 点不到 / 顶层平铺）

### 现象与根因（用真实会话产物取证）

用户实测反馈四条：读取当前工程特别慢且没等到；展开的列表不能折叠回去；一开始的几个切换点击不到；是否需要切换才能全部正常显示。
取证与结论：

1. **读取慢的量化**：`logs/codesys-scriptengine-offline-workbench.json` 显示最近一次 `inspect-project` 的
   `timings = {jobRead:7, requestNormalize:0, scriptEngineProcess:31852, metadataWrite:1, total:31869}`——**31.5 秒全部花在启动 CODESYS ScriptEngine 进程**上，
   与对象数量无关（该工程 66 个对象）。之前只有内存缓存（进程内），重启后必然再付一次 31 秒。
2. **不能折叠**：T070 新增的"选中对象自动展开其祖先"效果依赖 `objectTree`，而 `objectTree` 每次渲染都是新对象 → 该 effect **每次渲染都运行**，
   于是用户刚折叠的分支立刻被重新展开（选中项在其中的情况下永远折不上）。
3. **点不到 / 需要切换才正常显示**：对象窗格新增了过滤工具条与图例行（4 个子元素），代码窗格新增提示行，但 1.0.2 的共享规则仍只声明
   `grid-template-rows:auto minmax(0,1fr)` 两行 → 多出来的子元素落入隐式行并被 `overflow:hidden` 裁剪，项目树被挤到可视区之外（切换界面触发重排后才偶然可见）。
4. **顶层平铺**：用真实产物核对（`jobs/direct-1789447655608-0b3f9afd/runs/inspect-project-*/result.json`，66 个对象）发现
   `project.get_children(False)` 会把 **12 个 POU 与 1 个工程级 GlobalTextList、1 个工程级重复 Library Manager** 报为工程级子对象，
   而它们在 IDE 里位于 Application 之下；T070 直接把这些对象当成根 → **顶层出现 18 行**，看起来仍然像平铺列表。
   另有 `__VisualizationStyle`（内部对象）与类型 GUID `413e2a7d-…`（任务下的 POU 调用项，12 个）此前不在分类表中。

### 修改

| 文件 | 改动 |
|---|---|
| `plugins/installed/codesys-monitor/scriptengine.cjs` | inspect 遍历后新增**归属修正**：把"工程级、且类型属于 Application 作用域（POU/GVL/DUT/GlobalTextList/Trace/Library Manager）、在 Application 下无同名子对象"的孤儿对象挂到 active application 名下（`reparented`）；`__` 开头的内部对象与"与 Application 现有子对象同名的工程级重复对象"标记为 `internal`（附 `internalReason`）；`depth/path` 改为按**最终**父子链重算；`hierarchy` 增加 `reparented`/`internal` 并按可见根重算 `roots` |
| 同上 | 新增**磁盘 inspect 缓存**（`cache/codesys-inspect/<源 .project sha256>.json`，最多 8 个按 mtime LRU）：命中即跳过 ScriptEngine 启动（`status: 'verified-disk-cached'`、`durationMs: 0`），并把 job 相关字段（`projectPath`/`project.path`/`sourceProjectPath`/`inspectionMode`/`activeProject`）改写为当前 job 的值；键是保存后 .project 的 sha256，因此内容变化必然失效 |
| `plugins/installed/taskhive-surfaces/dsh/client.js` | 修复折叠：`revealedSelectionRef` 保证"自动展开祖先"只在**选中项变化时**执行一次，不再每次渲染把用户折叠的分支顶开；修复布局：为对象窗格与代码窗格补 `grid-template-rows:auto auto minmax(0,1fr) auto!important`；`internal` 对象默认隐藏并可一键显示（工具条显示数量），分类表新增 `internal`；新增读取进度提示：busy 时显示"已等待 N 秒（首次读取需启动 CODESYS ScriptEngine，约 20–40 秒，请保持工作台打开）"，绑定后先给出分阶段文案再读取；"选择 .project 文件"按钮在尚未读到任何对象时即出现（不再要求 `!sourcePath`） |
| `tests/codesys-project-tree-contract.js` | 扩充：假 CODESYS 对象新增"工程级 POU 孤儿""`__` 内部对象""工程级重复 Library Manager"，断言 re-parent 到 Application、内部标记、`hierarchy` 四个计数与最终 depth/path；新增客户端断言（reveal-once、两窗格行模板、busy 计时、内部开关、手动选择可达）与引擎断言（磁盘缓存读写与命中状态） |

### T071 验证证据

| 日期 | 检查 | 结果 | 证据 |
|---|---|---|---|
| 2026-09-15 | `node tests/codesys-project-tree-contract.js` | 通过 | 引擎生成脚本执行：11 个对象全部保留、`hierarchy={roots:3,grouped:10,ungrouped:1,reparented:1,internal:2}`、`JogX` 由工程级重挂到 Application（depth 3、path 正确）、`__VisualizationStyle` 与重复 Library Manager 被标记为 internal、未知类型对象仍保留为根；客户端纯逻辑与 T070 断言继续通过 |
| 2026-09-15 | 生成的 ScriptEngine Python 编译 | 通过 | `python -m py_compile`（仓库内 `py_compile` 由合同测试执行） |
| 2026-09-15 | `node tests/run-contracts.js` | 通过（1 项环境受限） | 除 `reasoning-cli-routes-contract.js` 的沙箱 `spawn EPERM` 外全部通过 |
| 2026-09-15 | 真实耗时取证 | 已完成 | 最近一次 inspect 的 `scriptEngineProcess=31852ms`（66 对象），据此确定"首读慢在进程启动"并据此选择磁盘缓存方案 |

### T071 待办（需真实界面验收）

1. 重启 TaskHive → 绑定同一工程**两次**：第一次仍约 20–40 秒（进度条会显示已等待秒数），第二次应**秒开**（`verified-disk-cached`）。
2. 展开任意分支后逐级折叠、点「全折叠」：不得再自动弹回。
3. 对象窗格顶部的过滤按钮/展开按钮与树行在读取期间即可点击；切换界面后布局应与切换前一致（不再需要"切一下才显示"）。
4. 项目树顶层应只剩 `Device`、`ServoMotor`（文件夹）、以及真正的未知对象；12 个 Jog/轴 POU 应出现在 `Application` 之下。
5. 真实验收前不得把本任务改为"已验证"。

## T072 修复"工程打开很久但项目树一直不加载"

### 现象与根因（本轮实际运行取证）

用户报告：工程已打开很久，项目树始终没有加载出来。取证（`logs/trajectory.jsonl` + 现场窗口/文件枚举）：

1. TaskHive 于 13:43:56 启动；13:44:13 触发 `codesys.open-program`（插件新开了一个 CODESYS 实例，PID 10016）；
   13:45:24 / 13:47:24 / 13:49:24 / 13:49:46 连续四次 `codesys.current-project` 均返回
   **`{"found":false,"detection":"ambiguous-project-path"}`** → 工作台拿不到 `sourcePath`，因此永远没有对象、没有项目树。
2. 现场窗口枚举（用插件自带的 `win-window-monitor.ps1 -Mode list`）：
   `pid=10016 usable=True  fourDofPlatform -ui+io调整阻尼测试.project* - CODESYS`
   `pid=33120 usable=False SEVENDofPlatform-DOOR_V2.project* - CODESYS`
   —— 用户"打开很久"的那个工程窗口被判定 **usable=false（最小化/被原生宿主挂起）**，而旧逻辑先按 `usable !== false` 过滤，
   直接把持有工程的窗口排除掉；剩下窗口的标题与 CODESYS"最近工程"列表（`%ProgramData%\CODESYS\**\*.opt`）的 basename 匹配不上就返回
   `ambiguous-project-path`（该名称还把"没找到文件"和"匹配到多个"混为一谈），用户既不知道原因也看不到可点的下一步。
3. 关键发现：CODESYS 会为**正在打开**的工程在工程文件旁边写 `<工程名>.~u` 占用标记，内容为 4 行
   （用户名 / 机器名 / **持有该工程的 CODESYS 进程 PID** / 时间戳）。现场实测：
   `fourDofPlatform -ui+io调整阻尼测试.~u` → PID 10016，`SEVENDofPlatform-DOOR_V2.~u` → PID 33120，与窗口 PID 完全对应。
   这是唯一不依赖标题字符串与最近工程列表的确定性配对信号。

### 修改

| 文件 | 改动 |
|---|---|
| `app/codesys-current-project.js` | 新增 `decodeUlock`（解析 `.~u` 的用户/机器/PID/时间戳）、`openProjectsFromLocks`（从最近工程目录里找 `.~u` 并还原 `.project` 路径，兼容工程名本身以 `.project` 结尾）；`resolveCurrentCodesysProject` 改为三级判定：①窗口 PID ↔ 占用标记 PID（`project-lock+window-pid`，确定性）；②窗口标题 ↔ 最近工程列表（原逻辑，保留为回退）；③只有一个占用工程时直接采用（`project-lock`）。**不再用 `usable !== false` 过滤身份**（可用性只应影响画面采集，不影响"哪个工程是打开的"）；失败时返回具体原因（`no-project-window` / `no-matching-project-file` / `ambiguous-project-path` / `ambiguous-open-projects`）以及 `candidates`（窗口）与 `openProjects`（正在使用中的工程 + PID） |
| `plugins/installed/taskhive-surfaces/dsh/client.js` | 新增 `codesysDetectFailureHint`（把 detection 原因翻成用户能懂的中文）与 `detectFailure` 状态；**空项目树只解释原因并指向上方控件**（"用上方「当前工程」一行的…"）——最初版本曾在树里重复放了「重新检测当前工程」「选择 .project 文件」两个按钮，用户当即指出"项目树里边为什么会有检测工程和打开文件？工作台不是已经具备这个功能了？"，因此把动作**只保留在「当前工程」一行**；多工程歧义的选择改为该行的「正在使用中的工程」下拉（`data-codesys-open-projects`，仅在有候选时出现），选中即绑定；检测成功后清空失败态 |
| `tests/codesys-current-project.js` | 新增行为断言：`.~u` 解析（PID/机器/时间戳）、从占用标记还原工程路径、**改名工程不在最近列表也能识别**、`usable:false` 窗口仍能配对、单一占用工程无窗口时采用、两个占用工程时返回 `ambiguous-open-projects` 且带 2 个候选 PID、标题无对应文件时返回 `no-matching-project-file` |

### T072 验证证据

| 日期 | 检查 | 结果 | 证据 |
|---|---|---|---|
| 2026-09-15 | 现场窗口 + 占用标记实测 | 通过 | 用插件自带脚本枚举到两个 CODESYS 窗口（PID 10016 usable=True / PID 33120 usable=False）；两个 `.~u` 的 PID 与窗口 PID 一致 |
| 2026-09-15 | 现场复现新判定 | 通过 | 以真实窗口列表调用 `discoverCurrentCodesysProject` → `found:true`、`detection:'project-lock+window-pid'`、`sourcePath=...\fourdof\fourDofPlatform -ui+io调整阻尼测试.project`、`lockOwnerPid=10016`（旧逻辑在此之前刚刚返回 `ambiguous-project-path`） |
| 2026-09-15 | `node tests/codesys-current-project.js` | 通过 | 7 组占用标记/窗口配对断言全部通过 |
| 2026-09-15 | 控件去重（用户反馈后修订） | 通过 | `codesys-project-tree-contract.js` 新增断言：树内不得再出现 `data-codesys-empty-detect` / `data-codesys-empty-select` / `taskhive-codesys-empty-actions`，空树只保留 `taskhive-codesys-empty-pointer` 指向既有控件；歧义候选改为「当前工程」行的 `data-codesys-open-projects` 下拉 |
| 2026-09-15 | `node tests/run-contracts.js` | 通过（1 项环境受限） | 除 `reasoning-cli-routes-contract.js` 的沙箱 `spawn EPERM` 外全部通过 |

### T072 待办（需真实界面验收）

1. 重启 TaskHive，打开 CODESYS 面板 →「代码任务」：即使目标 CODESYS 窗口被最小化或被原生宿主挂起，也应自动绑定到该窗口正在使用的工程（日志里 `detection` 应为 `project-lock+window-pid`）。
2. 若同时打开多个工程：项目树应显示"检测到正在使用中的工程"并列出候选（含 PID），点选即可读取；「选择 .project 文件」始终可用。
3. 真实验收前不得把本任务改为"已验证"。

## T073 修复"等待时间不正常"：完整结果被进程结束丢弃 + 耗时分解 + 缓存预热

### 现象与根因（用户提问"目前等待时间正常吗？"后实测）

1. 历史基线（不同工程、不同日期共 5 次 `inspect-project`）：**31.5 / 33.2 / 33.3 / 35.5 / 35.8 秒**，`timings` 显示几乎全部是 `scriptEngineProcess`（例如 `{jobRead:7, requestNormalize:0, scriptEngineProcess:31852, metadataWrite:1, total:31869}`）→ **首次读取 30~36 秒属于正常**，价格是"必须启动一个 CODESYS 进程打开工程"。
2. 本次实测（14:39:09 检测成功 → 14:41:09 写出完整 result.json，14:41:10 报错）：**耗时约 120 秒且最终失败**。`logs/trajectory.jsonl`：
   `tool.result {"name":"codesys.scriptengine.inspect-project","ok":false,"error":"Command failed: C:\\...\\CODESYS.exe --profile=... --noUI --runscript=..."}`，stderr/stdout 均为空。
   根因：`invokeOfflineScript` 的 `actionOk = Boolean(payload?.ok) && !processError` —— 脚本已在 **14:41:09 写出完整结果（62 个对象、complete=true）**，CODESYS `--noUI` 宿主没有退出，
   120 秒上限在 14:41:10 杀掉进程，于是"**结果完整但进程报错**"被当成失败整体抛出，用户白等两分钟且项目树为空。
3. 同一份 payload 证明 T070/T071 的树修正已在真实工程生效：`objectCount=62`、
   `hierarchy={grouped:62, internal:2, reparented:14, roots:2, ungrouped:0}`（14 个工程级对象被重挂到 Application，2 个内部/重复对象被隐藏）。

### 修改

| 文件 | 改动 |
|---|---|
| `plugins/installed/codesys-monitor/scriptengine.cjs` | `invokeOfflineScript`：新增"完整结果优先"判定 —— `payloadComplete`（`ok` 且 inspect 需 `complete && !textTruncated`）成立时 `actionOk = payloadComplete`，**进程报错只记为 `warnings=[{code:'CODESYS_PROCESS_ERROR_AFTER_RESULT'}]`、状态 `verified-with-process-warning`**，不再丢弃已完成的工作；payload 不完整或无 payload 时照旧抛错。默认进程上限 120 s → **180 s** |
| 同上 | inspect 脚本新增**阶段计时**（`import time`；`result['timings'] = {walkMs, coverageMs, totalMs, objects}`），以便区分"CODESYS 启动慢"与"树遍历慢"；`readInspectDiskCache` 命中时仍不启动进程 |
| `plugins/installed/taskhive-surfaces/dsh/client.js` | 读取结果的状态行现在自报成本：`· 读取耗时 X 秒（其中工程树 Y 秒）` 或 `· 已使用缓存（跳过 ScriptEngine 启动）`；若走了恢复路径则显示 `· CODESYS 进程被结束但结果完整`；有 warning 时附首条说明。`inspect()` 返回 `waitSuffix`，`bindSourceProject` 把它拼进最终状态 |
| `tests/codesys-scriptengine-recovery-contract.js` | 新增合同：用注入的进程运行器**真实调用引擎**，断言①完整 payload + 进程被杀 → `ok:true`、`verified-with-process-warning`、payload 原样返回且 error 记入 `processError`；②payload 不完整 + 进程失败 → 仍抛错；③无 payload → 仍抛错；④正常结束 → `verified` 且无 warning |
| `plugins/installed/taskhive-surfaces/dsh/client.js`（补充） | 用户把原始报错 `Error invoking remote method 'codesys:scriptengine-action': Error: Command failed: C:\Program Files\...\action.py` 直接贴了回来，说明该文案对用户没有任何可操作信息：新增 `codesysScriptEngineErrorMessage()`，把 `Command failed + CODESYS.exe` 映射为"进程超时未结束或异常退出；若已写出完整结果本轮会直接采用，否则请关闭多余 CODESYS 实例后重试"，`未就绪`/`NOT_OWNED` 各自映射，其余保留 240 字符原文尾部；`当前工程自动绑定失败`/`工程读取失败` 两条 catch 均改用该映射 |
| `cache/codesys-inspect/59b6a3e3….json`（运行数据，非源码） | 用本次**已验证完整**的真实产物预热磁盘缓存（键为工程 sha256），使该工程下一次读取直接跳过 ScriptEngine 启动 |

### T073 验证证据

| 日期 | 检查 | 结果 | 证据 |
|---|---|---|---|
| 2026-09-15 | 历史耗时取证 | 完成 | 5 次 inspect 分别在 31.5/33.2/33.3/35.5/35.8 秒，`scriptEngineProcess` 占绝对多数 → 首次 30~36 秒为正常 |
| 2026-09-15 | 本次异常耗时定位 | 完成 | result.json 于 14:41:09 写全（113,549 字节），14:41:10 触顶被杀 → 结果完整但被丢弃；`error` 无 stderr/stdout 即 `execFile` 超时被杀特征 |
| 2026-09-15 | `node tests/codesys-scriptengine-recovery-contract.js` | 通过 | 4 条恢复/失败/正常路径全部通过 |
| 2026-09-15 | 缓存预热校验 | 通过 | `readInspectDiskCache('<工程 sha256>')` 返回 `objects=62 complete=true hierarchy={grouped:62,internal:2,reparented:14,roots:2,ungrouped:0}` |
| 2026-09-15 | 修复尚未生效的确认 | 完成 | 用户报错里的 run 目录为 14:39 的 `direct-1789454349732-…`，而运行中的 TaskHive 启动于 **14:28:48**、T073 文件写于 **14:44:42/14:44:55** → 该报错来自修复前的版本；重启后才会生效 |
| 2026-09-15 | `node tests/codesys-project-tree-contract.js` | 通过 | 新增报错文案映射断言（`codesysScriptEngineErrorMessage`、超时说明、两条 catch 均已改用它） |
| 2026-09-15 | `node tests/run-contracts.js` | 通过（1 项环境受限） | 除 `reasoning-cli-routes-contract.js` 的沙箱 `spawn EPERM` 外全部通过 |

### T073 待办（需真实界面验收）

1. 重启 TaskHive 后读取 `fourDofPlatform -ui控制程序.project`：应**秒开**并显示"已使用缓存（跳过 ScriptEngine 启动）"。
2. 读取任一**未缓存**工程：状态行应显示"读取耗时 X 秒（其中工程树 Y 秒）"，据此判断慢在 CODESYS 启动还是树遍历。
3. 若某次读取超过 180 秒被结束：项目树仍应完整出现，状态行显示"CODESYS 进程被结束但结果完整"。
4. 建议同时运行的 CODESYS 实例不超过 1~2 个（现场同时有 3 个实例，约 1GB/进程，会显著拖慢 ScriptEngine 启动）。
5. 真实验收前不得把本任务改为"已验证"。

## T074 工程识别严格限定在本插件打开的 CODESYS 实例

### 现象与根因（用户提问"ScriptEngine 不应该只检测我程序打开的 CODESYS 程序吗？为什么要检测其他程序？"）

1. 工作台既有契约是"工作台只能绑定由当前插件打开的 CODESYS 窗口"（`CODESYS_WORKBENCH_WINDOW_NOT_OWNED`），
   且 `monitor.listWindows()` 已经通过 `codesysWindowOwnership.filterWindows()` **只返回本插件启动过的 HWND**（`windows-monitor.js` 中 `this.ownership.filterWindows(enumerated)`）——窗口这一半本来就是限定范围的。
2. 但 T072 新增的 `.~u` 占用标记扫描**没有做同样的限定**：它遍历"最近工程"目录下所有 `*.~u`，因此把**用户自己另外打开的 CODESYS 实例**正在使用的工程也算进来，
   表现就是候选列表里出现不是本插件打开的工程，甚至在"只有一个占用工程"的回退分支里可能直接绑定外部实例的工程。
3. 现场实测该机器同时存在两个 CODESYS 实例（一个由插件启动、一个用户自己打开），两个 `.~u` 的 PID 都在扫描结果里 —— 与用户预期不符。

### 修改

| 文件 | 改动 |
|---|---|
| `app/codesys-current-project.js` | `discoverCurrentCodesysProject(windows, preferredWindowId, options)` 新增 `options.ownedPids`：占用标记扫描结果**按插件拥有的 PID 过滤**，并返回 `scope = {pluginOwnedPids, ownedWindows, openProjects}` 供日志与探针核对；不传 `ownedPids` 时保持原行为（兼容既有调用与测试） |
| `app/main.js` | `codesys:current-project` 传入 `{ ownedPids: codesysWindowOwnership.snapshot().launchedPids }`；`codesys.current-project.detected` 事件追加 `scope` 与 `openProjects`（名称）便于事后审计 |
| `plugins/installed/taskhive-surfaces/dsh/client.js` | 失败提示改写为明确说明作用域："工作台只识别由本插件「打开 CODESYS」启动的窗口，当前没有这样的窗口（你自己另开的 CODESYS 不计入）。请点上方「打开 CODESYS」，或用「选择 .project 文件」直接读取现有工程。" |
| `tests/codesys-current-project.js` | 新增作用域断言：插件 PID 的占用工程可正常配对；外部 PID 的占用标记被过滤出 scope；只存在外部工程时 `found:false`、候选为空、`scope.openProjects === 0`；不传 `ownedPids` 时两条都可见（证明该限定是显式 opt-in） |
| `plugins/installed/taskhive-surfaces/dsh/client.js`（补充） | 用户确认走"点「打开 CODESYS」→ 工作台自动绑定该实例工程"这条路径。原有缺口：若工作台先打开、用户后打开工程，兜底轮询是 120 秒一次，最长要等两分钟。改为**自调度探测**：尚未绑定（`!jobId`）且距首次未命中不超过 5 分钟时每 6 秒一次（仍受 15 秒节流，实际约每 15 秒一次真实探测），绑定成功或超时后回落到 120 秒；等待态文案明确说明"已检测到本插件打开的 CODESYS 窗口（N 个），但其中还没有已保存的工程…约每 15 秒重试" |

### T074 验证证据

| 日期 | 检查 | 结果 | 证据 |
|---|---|---|---|
| 2026-09-15 | `node tests/codesys-current-project.js` | 通过 | 作用域/过滤/回退/兼容共 4 组新断言全部通过 |
| 2026-09-15 | `node tests/run-contracts.js` | 通过（1 项环境受限） | 除 `reasoning-cli-routes-contract.js` 的沙箱 `spawn EPERM` 外全部通过 |
| 2026-09-15 | 代码路径核对 | 完成 | `windows-monitor.js` 的 `listWindows()` 经 `ownership.filterWindows()` 已只返回插件拥有窗口；本次补齐的是标记扫描侧 |
| 2026-09-15 | 「打开 CODESYS → 自动绑定」链路核对 | 完成 | `app/main.js:1725` `codesysWindowOwnership.registerPid(launch.pid, …)` 使新实例成为插件拥有；`app/main.js:1861` `codesysPreferredWindowId = String(target.id)` 由「代码任务」按钮传入并仅接受插件拥有窗口；随后检测按 `ownedPids` 限定 + `.~u` PID 配对 |
| 2026-09-15 | `node tests/codesys-project-tree-contract.js` | 通过 | 新增等待节奏断言（6 秒/5 分钟上限、自调度取代固定 setInterval、等待态文案） |

### T074 待办（需真实界面验收）

1. 重启 TaskHive 后：若本插件没有打开任何 CODESYS 窗口，项目树应显示"只识别由本插件打开的窗口…"并引导「打开 CODESYS」或「选择 .project 文件」，**不应**自动绑定你自己另开的实例。
2. 点「打开 CODESYS」并在其中打开/保存工程后，应自动绑定该实例的工程（`detection=project-lock+window-pid`）；若工作台已先打开，应在约 15 秒内自动跟上，等待期间状态行显示"已检测到本插件打开的 CODESYS 窗口（N 个），但其中还没有已保存的工程…"。
3. 已知边界：窗口归属登记只存在于当前 TaskHive 进程内。**重启 TaskHive 后**，上一次由插件启动、现在仍在运行的 CODESYS 不再被视为"本插件打开"，需要重新点「打开 CODESYS」或用「选择 .project 文件」。若用户希望跨重启继续认领，需要单独做"显式重新认领"（记录 PID+进程启动时间，由用户点击确认后纳入），不得默认自动采纳。
4. 真实验收前不得把本任务改为"已验证"。

## T075 代码区拆分为「声明」与「实现」两个编辑区

### 现象与根因（用户反馈）

用户指出："CODESYS 的代码编辑分声明区和代码区，代码工作台没有区分明细，行号和实际代码行号对应不上。"

根因在客户端把两个编辑区**并成了一个 textarea**：

1. `oldCode = declaration + "\n\n" + implementation` —— 一个编辑器、一条行号栏从中连续编号，于是**实现区的行号整体偏移了"声明行数 + 1"**，与 CODESYS 实现编辑器从第 1 行开始的编号必然对不上。
2. 更严重的是**写回逻辑**：手写修改靠 `String(editedCode).split(/\n\s*\n/)` 取第一段当声明、其余当实现。声明里只要出现空行（`VAR` 块之间很常见），拆分点就会落在声明内部，**把声明的后半段当成实现写回工程**——不只是显示问题，是会写坏代码的缺陷。
3. 引擎侧本来就把 `declaration` / `implementation` 分开返回（`object_row`），是前端把它们揉在了一起。

### 修改

| 文件 | 改动 |
|---|---|
| `plugins/installed/taskhive-surfaces/dsh/client.js` | 单编辑器改为**按 CODESYS 分区**：`editedCode` → `editedDeclaration` + `editedImplementation`；每个分区有独立的行号栏、独立的改动行着色层（`codesysChangedLineNumbers(section.base, section.value)`）、独立滚动同步（`declarationRefs` / `implementationRefs`），**各自从第 1 行编号**；分区表头显示"声明（Declaration）／实现（Implementation）"与该区改动行数；GVL/DUT 只显示声明区，POU/FB/FUN 显示两个区；手写改动**直接由两个分区字段拼装** `manualChange`（`declaration`/`implementation` 分别按是否改动决定是否提交），彻底删除 `editedParts` 空白行拆分；`manifest` 对比改为分区比较（`declarationDiff` / `implementationDiff`，元数据行显示"声明 N 行 · 实现 M 行"并新增 `data-changed-lines-implementation`）；发布给宿主的状态新增 `declaration/implementation/baseDeclaration/baseImplementation`，`code/baseCode` 保留为合并视图 |
| `plugins/installed/taskhive-surfaces/dsh/index.js` | 读工具 `openObject` 改为分别返回 `declaration`/`implementation` 与其磁盘基线，并在 note 里明确"两个编辑区各自从第 1 行编号，行号不要跨区累加" |
| `app/main.js` | 打包探针改为读取两个分区（`[data-editor-part="declaration"|"implementation"]`）并新增 `sectionNumberingVerified`：每个分区的**行号栏首行必须是 1 且行号数量等于该区文本行数**；`PROGRAM PLC_PRG` 断言改到**声明区**（它本来就在声明里，合并文本时代才碰巧命中） |
| `tests/codesys-project-tree-contract.js`、`tests/codesys-workbench-link-contract.js` | 更新/新增断言：分区存在与独立 refs、分区各自的改动行、`editedParts` 必须消失、手写改动必须来自两个分区字段、发布状态分区化、探针读取两区并校验行号起始与数量 |

### T075 验证证据

| 日期 | 检查 | 结果 | 证据 |
|---|---|---|---|
| 2026-09-15 | `node --check` | 通过 | `taskhive-surfaces/dsh/client.js`、`taskhive-surfaces/dsh/index.js`、`app/main.js` |
| 2026-09-15 | 宿主插件模块加载 | 通过 | `import('./plugins/installed/taskhive-surfaces/dsh/index.js')` 成功 |
| 2026-09-15 | `node tests/codesys-project-tree-contract.js` | 通过 | 客户端纯逻辑 + 引擎生成脚本执行 + 新的分区/行号/写回断言全部通过 |
| 2026-09-15 | `node tests/codesys-workbench-link-contract.js` | 通过 | 手写保护断言改为分区语义后仍成立 |
| 2026-09-15 | `node tests/run-contracts.js` | 通过（1 项环境受限） | 除 `reasoning-cli-routes-contract.js` 的沙箱 `spawn EPERM` 外全部通过 |

### T075 待办（需真实界面验收）

1. 选中一个 POU：应看到上下两个编辑区，标题分别为"声明（Declaration）"和"实现（Implementation）"，**两区行号都从 1 开始**，且与 CODESYS 两个编辑器里的行号一致。
2. 选中 GVL / DUT：只显示声明区。
3. 只在声明区改一行 → 确认写入后，工程里只有声明变化；声明中包含空行时也不得把内容写进实现区（旧版本会）。
4. AI 提案同时改两区时，两区各自显示改动行数并分别高亮；「载入 AI 建议」应恢复两个分区。
5. 真实验收前不得把本任务改为"已验证"。

## T076 工作台只跟随"当前监视窗口"

### 现象与根因（用户反馈）

用户指出："codesys 代码工作台的逻辑应该只检测当前 codesys 监视窗口。"

T072/T074 之后，识别范围已限定在"本插件启动的窗口/实例"，但仍会在多个插件窗口之间**自动挑选**：优先窗口没有工程时，会退回到另一个插件窗口的工程（`project-lock` / 单占用工程回退分支），等于替用户改了监视目标。而 CODESYS 面板的窗口下拉本来就是"当前监视窗口"的唯一来源。

### 修改

| 文件 | 改动 |
|---|---|
| `app/codesys-current-project.js` | 只要传入了 `preferredWindowId`（= 面板当前监视窗口），就进入**严格模式**：只在该窗口内做判定 —— 窗口自身的 `.~u` 占用标记（`monitored-window+project-lock`）或窗口标题 ↔ 最近工程（`monitored-window+title`）；绝不再看其他窗口。该窗口没有工程 → `monitored-window-no-project`（附候选窗口/工程供显式选择）；窗口已不存在 → `monitored-window-closed`。未传 `preferredWindowId` 时保持原行为（兼容既有调用） |
| `app/main.js` | 新增 IPC `codesys:preferred-window`：面板切换监视窗口时更新 `codesysPreferredWindowId`（经归属过滤的 `monitor.resolveWindow` 校验，非插件窗口直接拒绝），并向 Harness 帧推送 `codesys.workbench.window` |
| `app/preload.js` | 暴露 `setCodesysPreferredWindow` |
| `app/renderer/renderer.js` | 窗口下拉 `onchange` 在设置 `state.selectedWindow` 后调用 `setCodesysPreferredWindow`，使工作台立即跟随 |
| `plugins/installed/taskhive-surfaces/dsh/client.js` | 监听 `codesys.workbench.window` → 通过 `codesysWorkbenchControl.detect({force:true})` 立即重检测；新增 `monitored-window-no-project` / `monitored-window-closed` 的提示文案（明确"当前监视窗口"与如何改选） |
| `tests/codesys-current-project.js` | 新增断言：监视窗口有工程 → 绑定它（`monitored-window+project-lock`）；监视窗口无工程而另一插件窗口有 → **found:false**，另一窗口只作为候选出现，绝不自动替换；监视窗口已关闭 → `monitored-window-closed` |

### T077 TaskHive 退出时关闭自己启动的 CODESYS 实例

### 现象与根因（用户反馈）

用户指出："之前由程序打开的 codesys 工程关闭程序后会一直在留存后台。"

现场核对：14:41 时该机器同时运行 3 个 CODESYS（各约 0.7~1.0 GB），分别启动于 13:56 / 14:11 / 14:29，跨 TaskHive 重启持续存活。根因是设计使然但缺收尾：面板按钮文案写着"只有你手动关闭才会结束"，`shutdownApplication()` 只做 `codesysNativeHost.detach()`、停 Harness 与终端，**从不结束自己启动的 CODESYS**；而窗口归属登记只存在于内存，崩溃或退出后无从追溯。

### 修改

| 文件 | 改动 |
|---|---|
| `app/codesys-launched-registry.js`（新增） | 记录本应用启动过的实例（`logs/codesys-launched.json`：PID、exe 路径、profile、启动时间戳 + `cleanExit` 标志）；纯函数 `classifyLaunchedInstance` 给出处置裁决；`processStartMatches` 做 PID 复用判定 |
| `app/main.js` | `codesys:open-program` 启动后 `record()`；`shutdownApplication()` 在分离原生宿主后调用 `closeLaunchedCodesysInstances('application-shutdown', pending())` 并 `markCleanExit()`；启动时若上一次会话未干净退出，则做 `startup-sweep`；`before-quit` 改为 `event.preventDefault()` + 清理完成后 `app.quit()`（否则退出会早于清理）；新增 `processStartTimeMs()`（PowerShell 读取进程启动时间） |
| 同上（生命周期契约） | `codesysExternalProgramLifecycle` 由 `persistsAfterTaskHiveExit: true / taskHiveMayCloseProgram: false / closePolicy: 'manual-user-close-only'` 改为 `false / true / 'taskhive-closes-launched-instances-unless-unsaved'`；打包探针断言改为 `launchedProgramClosePolicyLabel` |
| `app/renderer/renderer.js` | 「打开 CODESYS」按钮提示改为："切换插件或会话不会关闭；退出 TaskHive 时会自动关闭本插件启动的实例（工程有未保存改动时保留）" |
| `tests/codesys-launched-cleanup-contract.js`（新增） | 行为断言：已退出→跳过；无窗口→保留；**标题带 `*`（未保存）→保留**；已保存→关闭；PID 复用（启动时间不符）→保留；启动时间未知→按窗口判定；注册表 `record/pending/markCleanExit` 语义（含崩溃残留与重复记录去重）；并断言 main.js 的四处接线与生命周期契约文案 |

### 安全边界（明确记录）

关闭动作**只会**作用于"本应用记录过的 PID" 且 ① 该 PID 仍拥有一个正在运行的 CODESYS 窗口、② 进程启动时间与记录一致、③ 窗口标题不含未保存标记。任一条件不满足即保留实例并写入 `logs/desktop.log`。**本功能上线前已存在的遗留实例不在记录中，因此不会被自动清理**（现场那一个 `SEVENDofPlatform-DOOR_V2.project*` 还带有未保存改动，按规则本就应该保留，需用户自行保存并关闭一次）。

### T076/T077 验证证据

| 日期 | 检查 | 结果 | 证据 |
|---|---|---|---|
| 2026-09-15 | `node tests/codesys-current-project.js` | 通过 | 监视窗口语义 4 组新断言 + 既有归属/占用标记断言全部通过 |
| 2026-09-15 | `node tests/codesys-launched-cleanup-contract.js` | 通过 | 12 项裁决/注册表/接线断言全部通过 |
| 2026-09-15 | `node --check` | 通过 | `app/main.js`、`app/preload.js`、`app/renderer/renderer.js`、`app/codesys-current-project.js`、`app/codesys-launched-registry.js`、`taskhive-surfaces/dsh/client.js` |
| 2026-09-15 | `node tests/run-contracts.js` | 通过（1 项环境受限） | 除 `reasoning-cli-routes-contract.js` 的沙箱 `spawn EPERM` 外全部通过 |
| 2026-09-15 | 现场实例核对 | 完成 | 当前仅剩 1 个 CODESYS（PID 19356，标题 `SEVENDofPlatform-DOOR_V2.project*` = **未保存**）→ 新规则下会被保留，符合"绝不丢用户改动"的边界 |

### T076/T077 待办（需真实界面验收）

1. 面板窗口下拉切到另一个插件窗口 → 工作台应在约 1 秒内改绑该窗口的工程（日志 `detection=monitored-window+project-lock`）；若该窗口没有工程，应显示"当前监视的那个 CODESYS 窗口里还没有已保存的工程"，**不得**自动跳到别的窗口。
2. 关闭正在监视的 CODESYS 窗口 → 提示"当前监视的 CODESYS 窗口已关闭"，重新选择后「刷新当前工程」应恢复。
3. 用「打开 CODESYS」启动实例、在其中打开工程并**保存**，然后退出 TaskHive：该 CODESYS 应随之关闭；若工程**未保存**，则应保留并在 `logs/desktop.log` 记 `kept ... unsaved-changes`。
4. 强杀 TaskHive（不留退出流程）后重新启动：上次启动的实例（已保存的）应被 `startup-sweep` 关闭。
5. 真实验收前不得把本任务改为"已验证"。

## T078 修复 `workbench_propose` 返回 accepted 但提案未进入工作台读模型

### 现象与复现（用户报告，含具体 id）

| 项 | 值 |
|---|---|
| 会话 | `session-701cb6b6-545f-4c8e-a90b-4f13aedcd915` |
| 工程 | `fourDofPlatform -ui控制程序.project` |
| jobId | `direct-1789461579960-68202b30` |
| 复现 | `taskhive_codesys_workbench_propose(create-pou, objectName="test")` → `accepted:true, proposalId:"codesys-proposal-1789462573583-f679dd"`；紧接着 `taskhive_codesys_workbench` → `pendingProposal:null, changedObjects:[], objectCount:62` |
| 稳定性 | 三次提交（3814fe / 40add0 / f679dd）结果一致；第三次在**关闭并重开工作台之后**仍复现 |
| 排除读通道 | 重开后 `updatedAt` 能从 08:46:06Z 刷新到 08:55:19Z、`openObject` 可切换 → 读通道正常，问题在 propose 的写入侧未落到读模型 |

### 根因

**读模型只读了两份状态中的一份。** `taskhive_codesys_workbench_propose` 把提案写进**宿主内存队列**（`workbenchProposals`），而 `taskhive_codesys_workbench` 的 `pendingProposal` / `changedObjects` 只读**页面发布的状态**（`workbenchStates`）。两者之间只有页面主动调用 `/taskhive/api/codesys.workbench.pending`（领取）才会打通，而客户端此前**只在会话出现新的助手消息时**才领取——同一轮里 propose 之后立刻读取，页面还没领取，于是 `accepted:true` 的提案在读模型里完全不可见。三次复现完全一致，正是因为该时序是确定性的。

### 修改

| 文件 | 改动 |
|---|---|
| `plugins/installed/taskhive-surfaces/dsh/index.js` | 读工具改为**宿主队列 ∪ 页面状态**：新增 `queuedProposals`（未领取）、`deliveredProposals`（已领取，带 `claimedAt`）与 `deliveryState`（`queued-awaiting-workbench` / `shown-in-workbench` / `none`）；`pendingProposal` 在页面未应用时回退为队列中最新一条（带 `source:'host-queue'`、`delivered:false`、`id`）；`changedObjects` 合并队列目标（`state:'agent-queued'`，同名不重复）；工作台从未发布状态时（未打开/未绑定）也照常报告 `queuedProposals`，不再表现为"提交凭空消失"；`note` 明确"已排队，工作台会在数秒内自动领取，无需重复提交" |
| 同上（propose 工具） | 返回值新增 `delivered:false` 与 `deliveryState:'queued-awaiting-workbench'`，输出 schema 的 `required` 同步更新；`claimWorkbenchProposals` 增加投递轨迹（`workbenchDelivered`，保留最近 8 条） |
| `plugins/installed/taskhive-surfaces/dsh/client.js` | 新增 `CODESYS_CLAIM_POLL_MS = 4000` 的**领取轮询**（仅在工作台可见且有会话时运行，纯本地 HTTP、不探测引擎）：工作台挂载/可见即领取一次，之后每 4 秒一次，使工具提交的差异在数秒内出现，而不必等整轮结束；`applyAgentProposal` 增加内容签名去重，避免"队列 + 回复 JSON"双通道导致重复重置审阅勾选 |
| `tests/codesys-workbench-link-contract.js` | 按报告场景新增断言：propose 后**立即**读取必须看到同一 `proposalId` 的 `pendingProposal`（`delivered:false, source:'host-queue'`）、`queuedProposals` 与 `changedObjects` 中的 `agent-queued` 条目（且不重复已有对象）；领取后队列清空但 `deliveredProposals` 记录同一 id；propose 返回值必须声明 `delivered:false`；客户端必须具备领取轮询 |

### T078 验证证据

| 日期 | 检查 | 结果 | 证据 |
|---|---|---|---|
| 2026-09-15 | `node tests/codesys-workbench-link-contract.js` | 通过 | propose → 立即读取看到同一 `codesys-proposal-…` id、`deliveryState=queued-awaiting-workbench`、`agent-queued` 目标；领取后 `queuedProposals=0`、`deliveredProposals=1`；重复领取仍为 0 |
| 2026-09-15 | `node --check` / 宿主模块加载 | 通过 | `taskhive-surfaces/dsh/index.js`、`.../client.js` 语法通过；`import()` 宿主插件成功 |
| 2026-09-15 | `node tests/run-contracts.js` | 通过（1 项环境受限） | 除 `reasoning-cli-routes-contract.js` 的沙箱 `spawn EPERM` 外全部通过 |
| 2026-09-15 | **真实端到端收据**（用户按修复后流程复跑） | 通过 | 工具提交 `codesys-proposal-1789463928850-8c1a2e` → `queued-awaiting-workbench` → 工作台约 4 秒内领取 → 用户确认 → `apply-changes` ok、`changeCount=1`、`durationMs=32956`（`scriptEngineProcess=33329`、`sourceCommit=17`）→ 源工程 `C:\Users\29925\Downloads\FiveDofPlatform0909.project` 由 1,327,360 变为 **1,359,792 字节**（mtime 17:20:44）→ 离线 `build` **errorCount=0** → 写后重新 inspect **objectCount 62 → 63**（新增 Test POU 已进入项目树） |
| 2026-09-15 | 交付轨迹日志（新增） | 通过 | 宿主插件在入队/领取时各写一行 `codesys.workbench.proposal.queued|claimed`（含 id/session/changes），使"提案是否真的送达"可服务端追溯；`tests/codesys-workbench-link-contract.js` 捕获 `console.log` 并断言这两行 |
| 2026-09-15 | T077 安全边界在真实退出中生效 | 通过 | `logs/desktop.log`：`codesys-instances-cleanup reason=application-shutdown closed=0 kept=1 {"kept":[{"pid":19676,"reason":"unsaved-changes","title":"fourDofPlatform -ui控制程序.project* - CODESYS"}]}` —— 退出时正确保留带未保存改动的实例 |

### T078 待办（需真实界面验收）

1. 重启 TaskHive，用同一会话/工程复现原步骤：`workbench_propose` 后**立即**调用 `taskhive_codesys_workbench`，应看到 `pendingProposal.id` 与 `proposalId` 一致、`deliveryState=queued-awaiting-workbench`、`changedObjects` 含该对象。
2. 工作台界面应在约 4 秒内出现该差异（项目树/编辑器高亮），无需等待整轮结束；若工作台未打开，`queuedProposals` 仍应在读模型中出现，打开后随即领取。
3. 真实验收前不得把本任务改为"已验证"。

## T079 去掉代码编辑区点击时的黑框

### 现象与根因（用户反馈）

用户反馈："在工作台的代码编辑器里面点声明或实现不应该出现一个黑框提示我，这个太突兀了。"

两个来源都会在点击编辑区时出现突兀的深色方框：

1. **原生 tooltip**：T075 给两个编辑区 textarea 写了 `title`（"CODESYS 的声明（Declaration）部分；直接修改后可在下方确认写入工程"），鼠标停在/点进编辑区即弹出系统 tooltip（深色气泡）；即使不写，皮肤的无障碍补全 `backfillAccessibleNames` 也会把 `aria-label` 复制成 `title`，对所有含 `aria-label` 的控件（含 AI 提示词输入框）生效。
2. **黑色 focus 内环**：1.0.2 遗留规则 `.taskhive-codesys-code-editor:focus{box-shadow:inset 0 0 0 2px var(--dsw-alias-accent-primary,#171717)}`，在 DSH 主题未定义 `--dsw-alias-accent-primary` 时回退为 **#171717 纯黑**，点进声明/实现编辑区就画出一圈黑色内框。

### 修改

| 文件 | 改动 |
|---|---|
| `plugins/installed/taskhive-surfaces/dsh/client.js` | 移除两个编辑区 textarea 的 `title`，改为 `data-no-native-tooltip="true"`（`aria-label` 保留，无标题不影响可访问名称）；`backfillAccessibleNames` 增加作用域判断 `tooltipAllowed`：**工作台内的控件只补 `aria-label`，不再自动补 `title`**（tooltip 不再落到正在编辑的代码上）；新增主题块覆盖 focus 样式：鼠标聚焦用 `inset 0 0 0 1px var(--th-brand-line)`（品牌浅边），键盘 `:focus-visible` 保留 `2px var(--th-brand)` 清晰焦点环（可访问性不回退），并让聚焦分区边框变为品牌浅色 |
| `tests/codesys-project-tree-contract.js` | 新增断言：编辑区 textarea 不得带 `title`、必须带 `data-no-native-tooltip`、`backfillAccessibleNames` 必须区分工作台作用域、鼠标 focus 不得再用黑色内环、键盘 focus 必须保留可见环 |

### T079 验证证据

| 日期 | 检查 | 结果 | 证据 |
|---|---|---|---|
| 2026-09-15 | `node --check plugins/installed/taskhive-surfaces/dsh/client.js` | 通过 | 另核对新规则位于样式模板内部（第 1539-1540 行，模板在第 1552 行 `document.head.appendChild(style)` 之前） |
| 2026-09-15 | `node tests/codesys-project-tree-contract.js` | 通过 | 5 项新断言（无 title / 显式 opt-out / 作用域判断 / 鼠标 focus / 键盘 focus）全部通过 |
| 2026-09-15 | `node tests/run-contracts.js` | 通过（1 项环境受限） | 除 `reasoning-cli-routes-contract.js` 的沙箱 `spawn EPERM` 外全部通过 |
| 2026-09-15 | 可访问性不受影响 | 已核对 | `probeInteractiveMetadata` 判定"缺失"的条件是 `!title && !aria`；编辑区保留 `aria-label`，因此工作台帧（`requireMetadata:false`）与既有 a11y 断言都不受影响 |

### T079 待办（需真实界面验收）

1. 点击「声明」「实现」编辑区：不应再出现任何深色方框或提示气泡；鼠标聚焦只显示品牌浅色边，键盘 Tab 聚焦仍应有清晰焦点环。
2. 悬浮 AI 提示词输入框也不应再弹出原生 tooltip。
3. 项目树行仍保留悬浮提示（含 GUID/路径，属有意保留的信息）；若同样觉得突兀，可再按同一方式移除。
4. 真实验收前不得把本任务改为"已验证"。

## T080 编辑区点击零提示 + 可拖拽分隔条（可挤压其他区域至极限）

### 现象与根因（用户反馈）

用户反馈两点：
1. "我点击代码编辑区不需要看到提示框，我在编辑什么我自己清楚。"
2. "调整代码编辑器高度不好用，现在我调整不了，应该可以继续扩大挤压其余功能区 ui 直到极限。"

核对：`client.js` 的改动时间是 **17:04:41**，而当前 TaskHive 启动于 **17:13:27**，所以 T079 的改动**已经在运行中生效** —— 点击后剩下的"提示"其实是**焦点装饰**：T079 把黑色内环换成了品牌浅色 1px 内环，并让聚焦分区的边框变为品牌色（`section:focus-within`），点进去仍会出现一圈彩色方框。

"高度调不了"的原因：1.0.2 的 `.taskhive-codesys-code-editor{resize:vertical}` 是 textarea 的原生拖拽角，而 T075 之后该 textarea 被 `height:100%!important` 钉在网格里，**拖拽角什么也改变不了**（还会显示一个无用的抓手）；同时对象树/代码区宽度是固定 CSS 比例（`132px .42fr`），声明/实现高度也是固定比例，用户没有任何可拖的把手。

### 修改

| 文件 | 改动 |
|---|---|
| `plugins/installed/taskhive-surfaces/dsh/client.js` | **点击零提示**：`:focus` 改为 `box-shadow:none!important;outline:none!important;border-color:var(--th-line)!important`（鼠标点入不画任何框），`:focus-visible` 保留键盘焦点环，分区高亮改用 `:has(...:focus-visible)` 只在键盘聚焦时出现；同时移除代码窗格标题里 `title={guid}` 的悬浮提示（工作台编辑面不再有原生 tooltip） |
| 同上 | **两条可拖拽分隔条**：对象树↔代码区（竖向 9px 把手，`data-codesys-split="tree"`）与 声明↔实现（横向 9px 把手，`data-codesys-split="declaration"`）；`beginCodesysDrag` 用 window 级 pointermove/pointerup 保证指针移出把手也不中断；比例经 `CODESYS_LAYOUT_LIMITS` 夹取（树最小 132px、编辑器至少留 170px；声明最小 56px、实现至少留 90px），可一直挤压到下限；把手支持键盘（←/→、↑/↓）与双击复位；比例写入 `localStorage`（`taskhive.codesys.layout.*`）以便下次保持；网格列改为 `minmax(132px,var(--th-tree-fr)) 9px minmax(170px,var(--th-code-fr))`，两个分区按拖拽比例分配 `flex`；`.taskhive-codesys-editor-body` 补 `flex:1 1 auto` 使其填满代码窗格（否则分区没有可分配的高度）；代码编辑器 textarea 改为 `resize:none!important`（原生抓手已无用且误导） |
| `tests/codesys-project-tree-contract.js` | 断言：鼠标 focus 不得画任何框、键盘 focus 保留环、两条把手存在且为 `role="separator"`、拖拽与夹取逻辑存在、最小/保留像素值、比例持久化与网格变量接线、分区 flex 由拖拽比例决定、编辑器不再有原生 resize 抓手 |

### T080 验证证据

| 日期 | 检查 | 结果 | 证据 |
|---|---|---|---|
| 2026-09-15 | `node --check plugins/installed/taskhive-surfaces/dsh/client.js` | 通过 | 另核对新 CSS 仍位于样式模板内部 |
| 2026-09-15 | `node tests/codesys-project-tree-contract.js` | 通过 | 12 项新断言（焦点、把手、夹取、持久化、接线）全部通过 |
| 2026-09-15 | `node tests/run-contracts.js` | 通过（1 项环境受限） | 除 `reasoning-cli-routes-contract.js` 的沙箱 `spawn EPERM` 外全部通过 |
| 2026-09-15 | T079 已生效的时间线核对 | 完成 | `client.js` mtime 17:04:41 < TaskHive 启动 17:13:27 → 本轮残留的"提示"不是 tooltip 而是焦点装饰，据此修改 |

### T080 待办（需真实界面验收）

1. 点击「声明」「实现」编辑区：**不应出现任何方框、描边或气泡**（鼠标）；用 Tab 键盘进入时仍应看到清晰焦点环。
2. 拖动对象树与代码区之间的竖线：树变窄、编辑器变宽，最多把树压到约 132px；拖动声明与实现之间的横线：可把声明压到约 56px 以放大实现；双击把手复位；←/→、↑/↓ 也能调整。
3. 重启 TaskHive 后，上次拖出的比例应保持。
4. 真实验收前不得把本任务改为"已验证"。

## T081 提高项目树占比 + 顶栏合并 + 代码任务/工程写入压成一行

### 现象与根因（用户反馈）

用户原话：

> "提高代码项目树的占用比例，把当前工程功能块移到 codesys 代码工作台同一行，刷新当前工程等可以调整为一行显示；缩小代码任务和工程写入功能块高度，可以改成一行显示，代码任务不需要保留输入框，代码任务实际功能是和 ai 模型对接；空出来的区域都给代码编辑器；或者考虑把代码任务和工程写入也迁移到工作台上面一行，可以以图标展示；你觉得那种好？或者有更好的方案告诉我"

核对当前实现（`client.js` T080 之后的状态）：工作台根节点是多个功能带纵向堆叠——顶栏、`当前工程` 卡片（标签+路径+会换行的操作按钮）、可伸缩编辑器行、`代码任务` 卡片（含 4 行 textarea，上限 132px）、`工程写入` 卡片（标题行+详情行+按钮行，上限 132px）、提案、状态、安全声明。编辑器上下两侧一共被占掉约 5 个功能带、其中两个各预留 132px，而面板默认宽度只有 `PANEL_DEFAULT = 400px`（Better Sidebar，最小 280px），真正的代码区因此被压得很小。

另有两处隐性浪费：颜色图例 `flex-wrap:wrap` 在 400px 宽下折成 2–3 行（约 45px），状态行与安全声明各占 2–3 行。

### 方案选择（回答用户"哪种好"）

- **方案 A（用户的第一种）：全部压成行 + 输入框去掉。** 采纳为基础。
- **方案 B（用户的第二种）：把「代码任务」「工程写入」整体搬到顶栏，只留图标。** 只部分采纳。
- **最终方案：三行带 + 只把"能安全单行化"的东西搬上去。** 理由：
  1. `确认写入工程（离线编译）` 是整个面板唯一不可逆的动作（创建恢复快照 → 写磁盘 → 离线编译）。它一旦变成工具栏图标，既容易被误点，又会让"为什么现在不能写"（`writeBlockReason`）退化成没人看的 tooltip。安全模型依赖这个原因就摆在按钮旁边，所以它必须留在一个可见的行里。
  2. `代码任务` 才是真正适合收成按钮的那一个——它的职责只是把工作台上下文交给模型，而"要改什么"本来就该在 Harness 对话里说（那里有历史、模型选择、专家和多轮追问）。原来自带的迷你输入框是对话输入框的弱化重复。
  3. `当前工程` 的路径与刷新/选择/复制/定位/回退放在顶栏同一行是自然的（它们本来就是"这个工程"的属性），不会损失安全性。
  4. 图标化只用在**低风险**动作上：会话号小字直接隐藏（联动徽章已在表达同一状态），其余动作保留文字标签，避免"一排看不懂的图标"。

### 修改

| 文件 | 改动 |
|---|---|
| `plugins/installed/taskhive-surfaces/dsh/client.js` | **当前工程并进顶栏**：`h('section',{className:'taskhive-codesys-project'})` 从工作台根节点的直接子元素移入 `h('header',{className:'taskhive-codesys-header'})`，顺序为 标题 → 当前工程（标签/路径/操作） → 联动与工程徽章；全部 `data-codesys-*` 钩子（`project-path`/`detect-project`/`select-project`/`open-projects`/`copy-project-path`/`reveal-project`/`rollback`）逐字保留，桌面探针不受影响 |
| 同上 | **代码任务去掉输入框**：`CodesysTaskComposer` 不再渲染 `textarea.taskhive-codesys-prompt`，改为一个 `代码任务 · 交给 AI` 按钮。点击时按当前选择推导提示词（开着对象时＝审查该对象并给出可直接写入的完整代码；没有选择时＝阅读整个工程上下文挑最值得改的对象），走原有 `onSubmitRef` → `binding.session.prompt(..., 'queue')` 链路；按钮 `title` 明说会替用户写下哪句要求，不搞隐式提示词。T018/T069 的临时上下文与对话联动逻辑完全未动 |
| 同上 | **工程写入压成一行**：去掉 `taskhive-codesys-write-heading`/`write-detail`/`write-actions` 三层嵌套，`工程写入`、状态、详情、核对勾选、`重新检测`、`确认写入工程（离线编译）` 改为单行 flex 子元素；详情与禁用理由改用 `title` 悬浮说明。核对勾选框（原在提案区）移入这一行并改名 `已核对差异`，新增 `data-codesys-review-accepted` 供探针识别；提案区只留结论与阻塞原因 |
| 同上 | **树份额提高**：`readStoredFraction(CODESYS_LAYOUT_KEYS.tree, 0.42)` → `0.52`，CSS 回退值 `var(--th-tree-fr,0.42fr)` → `0.52fr`。用户手动拖过的比例仍优先（localStorage 键未动） |
| 同上 | **CSS 三行带**：根网格改为 `grid-template-columns:auto minmax(0,1fr)` / `grid-template-rows:auto minmax(0,1fr) auto auto auto`，行1=顶栏、行2=对象树\|拖动条\|编辑器（唯一可伸缩行）、行3=`代码任务`按钮 \| `工程写入`单行条；顶栏内部操作区与命令条都允许换行，最窄 280px 侧栏不溢出；图例改 `flex-wrap:nowrap`；状态行改单行省略号、仅在出现 `busy-timer` 时允许两行；安全声明改单行省略号并把全文放进 `title`/`aria-label`；助手/提案文本上限 200/70px → 64px |
| 同上 | 会话号小字（`Harness 会话：xxx`）在紧凑布局里隐藏——联动徽章已在表达同一状态，不再重复占宽 |
| `tests/codesys-workbench-compact-layout-contract.js` | 新增：三行带结构、`当前工程` 必须位于 header 且顺序在徽章之前、不得再有 `> .taskhive-codesys-project` 直接子选择器、代码任务无 textarea 且推导提示词走原提交链路、工程写入无 `write-actions` 行且四个钩子齐全、核对框单行化、顶栏与命令条可换行、树份额默认 0.52、图例不换行、安全声明带 `title` 单行 |
| `tests/codesys-project-tree-contract.js` | T080 的树份额默认值断言由 `0.42` 更新为 `0.52`（T081 提高项目树占比）；拖动下限 `floorPx: 132, otherFloorPx: 170` 未改，280px 侧栏的最小宽度契约不变 |

### T081 验证证据

| 日期 | 检查 | 结果 | 证据 |
|---|---|---|---|
| 2026-09-15 | `node --check plugins/installed/taskhive-surfaces/dsh/client.js` | 通过 | ESM 语法检查 exit 0（本轮第一次替换后曾因 header 少一个右括号报 `missing ) after argument list`，已修正） |
| 2026-09-15 | `node tests/codesys-workbench-compact-layout-contract.js` | 通过 | 新增断言全部通过 |
| 2026-09-15 | `node tests/codesys-workbench-ui-contract.js` | 通过 | T018 直接上下文与单列提案合同未受影响 |
| 2026-09-15 | `node tests/codesys-workbench-link-contract.js` | 通过 | 对话联动、提案领取、写入确认链路未受影响 |
| 2026-09-15 | `node tests/codesys-project-tree-contract.js` | 通过 | 项目树、分隔条、分区编号、焦点合同全部通过（含更新后的 0.52 断言） |
| 2026-09-15 | `node tests/run-contracts.js` | 通过（1 项环境受限） | 除 `reasoning-cli-routes-contract.js` 的沙箱 `spawn EPERM`（T080 已记录的环境限制）外全部通过 |
| 2026-09-15 | 桌面探针钩子核对 | 完成 | `main.js` 只依赖 `data-codesys-workbench/project-path/detect-project/select-project/project-tree/workbench-status/line-gutter/highlight-row`，本轮全部保留；`codesys-workbench-link-contract.js` 的 `main.includes(...)` 断言亦全部通过 |

### T081 待办（需真实界面验收）

1. 打开 CODESYS 面板 →「代码任务」：顶栏应是**一行**（标题 · 工程路径 · 刷新当前工程/选择 .project 文件/复制路径/资源管理器/一键回退到绑定基线 · 联动徽章）；窄侧栏下允许换行，但不得出现横向溢出或按钮被裁掉。
2. 工作台中部应只剩「项目对象树 ‖ 代码编辑器」，且树默认比改动前明显更宽（400px 侧栏下约 0.52 份额）。
3. 底部命令条应是一行：左侧 `代码任务 · 交给 AI`，右侧 `工程写入 · <状态> · 已核对差异（有待写入差异时） · 重新检测 · 确认写入工程（离线编译）`。悬停状态文字应看到完整原因。
4. 点 `代码任务 · 交给 AI`：当前 Harness 会话应收到一条带工作台上下文的代码任务（按钮 title 里写明了提示词），AI 返回的修改仍按原色标进入项目树与逐行高亮，`确认写入工程（离线编译）` 仍需勾选 `已核对差异` 才可用。
5. 确认写入、一键回退、重新检测、刷新当前工程、选择 .project 文件的行为与改动前一致。
6. 真实验收前不得把本任务改为"已验证"。

## T082 修复第三行错位 + 底部两行小字并成一行 + 删除全展开/全折叠

### 现象与根因（用户反馈）

用户原话：

> "第三行没有对齐ui，其次下面还有两行小字，能不能把第三行压缩，把小字也放到这一行；或者底下只留一行小字，把代码任务和工程写入放进项目对象-全部/折叠区域，同时删除全部折叠的功能按键，我不需要；你先对比一下怎么做让我确认在执行，你有更好方案也告诉我"

**"第三行没对齐"的根因不是间距，是结构**：T081 那一行是**两个性质不同的盒子**并排——左边 `form.taskhive-codesys-composer`（`padding:0`、无边框，里面一个 30px 按钮），右边 `section.taskhive-codesys-write-panel`（1px 边框 + `padding:3px 8px` + 30px 内容 = 38px）。根网格 `gap:6px` 且两个格子默认 `align-self:stretch`，行高取 38px，于是左边 30px 的按钮顶在格子上沿，比右边低 8px 起跳，而且一个没框一个有框。怎么调 gap 都消不掉。

**"下面还有两行小字"** = `taskhive-codesys-status`（运行状态）与 `taskhive-codesys-safety`（永久禁止事项声明）各占一行。

### 方案对比（用户要求先对比再执行，已确认）

用户提出两条路线，经核对后**它们的共识是**：底栏不再有两行小字、第三行压紧；**唯一分歧**是 `代码任务` + `工程写入` 放哪。

| 方案 | 做法 | 核对结果 |
|---|---|---|
| A（已选用） | 两者留在底部，合并成一条对齐的 bar；底部只留一行小字 | 风险最低，根治错位 |
| B（已否决） | 把两者塞进「项目对象」工具栏那一行 | **否决**：该工具栏在对象树**自己的列**内，默认 400px 面板下树列只有约 195px（可用约 181px）。现有 `全部/仅代码/设备·容器/内部 N` 已约 196px（占 2 行），再加 `代码任务`(≈110) + `工程写入`(≈50) + 状态(≈90) + `已核对差异`(≈70) + `重新检测`(≈55) + `确认写入工程（离线编译）`(≈150) 共约 +525px，会折成 4 行左右（约 110px），而这 110px 是**从对象树身上扣的**（`object-pane` 网格为 `auto auto minmax(0,1fr) auto`，工具栏是第 2 行 `auto`）。另外把唯一不可逆的「确认写入工程」与"看树的方式"混进同一排小按钮，误点风险上升 |
| B′（备选，未采用） | 把这排工具栏从树列里提出来，变成树/编辑器上方一整宽带 | 可行（可用宽度 384px，折 2 行约 56px；树列因失去自己的工具栏反而多回约 28px，净高度基本打平），但要改 `object-pane` 网格结构，且语义上把"过滤视图"和"写入工程"混在一排，本轮不采用 |

`全展开 / 全折叠` 的处置与 A/B 无关：删除后默认 400px 侧栏下工具栏由约 196px 降到约 142px，常见情况回到一行，约 20px 还给对象树。用户确认删除（"这个区域的全按键删除，都不需要"）。核对：这两颗按键**没有被桌面探针使用**（`main.js` 只点击 `data-codesys-tree-filter`），只有 `tests/codesys-project-tree-contract.js` 里 2 条断言引用它们。

### 修改

| 文件 | 改动 |
|---|---|
| `plugins/installed/taskhive-surfaces/dsh/client.js` | **合并成一条命令条**：新增 `section.taskhive-codesys-commandbar`，把 `CodesysTaskComposer` 与原来独立成格的工程写入内容变成它的**同级子元素**（`代码任务` → 1px `command-sep` 分隔线 → `工程写入`/状态/详情/核对/重新检测/确认写入）。`is-ready`/`is-blocked` 状态类从内层条移到命令条本身，`data-codesys-write-panel` 钩子保留在命令条上，`data-codesys-write-state`/`write-reason`/`write-recheck`/`confirm-write`/`review-accepted` 全部不变 |
| 同上 | 根网格回到单列：`grid-template-columns:minmax(0,1fr)` / `grid-template-rows:auto minmax(0,1fr) auto auto`；行1 顶栏、行2 工作区（唯一伸缩）、行3 命令条、行4 起为助手/提案/小字 |
| 同上 | **底部两行小字并成一行**：新增 `footer.taskhive-codesys-statusrow`，左边 `taskhive-codesys-status`（`flex:1 1 auto` + 省略号 + `title` 全文），右边 `taskhive-codesys-safety` 改成可聚焦的 `ⓘ 安全边界`（`tabIndex:0`，全文在 `title`/`aria-label`）。读取工程时才出现的「已等待 N 秒…」仍在，用 `:has(.taskhive-codesys-busy-timer)` 单独放行换行 |
| 同上 | **删除「全展开 / 全折叠」**两颗按键，工具栏 `aria-label` 由「项目树过滤与展开」改为「项目树过滤」；`data-codesys-tree-filter`（全部/仅代码/设备·容器）与 `data-codesys-tree-internal` 保持不变 |
| 同上 | 清理失效选择器：主题块里针对已消失的 `.taskhive-codesys-write-panel.is-ready/.is-blocked` 的 3 条规则移除（状态色现在由命令条承载），`.taskhive-codesys-proposal` 部分保留 |
| `tests/codesys-workbench-compact-layout-contract.js` | 更新为单列四行带 + 单条命令条断言；新增「两个盒子不得回潮」「composer 组在条内必须去掉自己的框」「status/safety 不得再各自成带」「`data-codesys-tree-expand` 不得回潮」「工具栏只剩过滤」 |
| `tests/codesys-project-tree-contract.js` | 删除 `expand-all must exist` / `collapse-all must exist` 两条断言，改为断言 `'data-codesys-tree-expand'` 不再出现 |

### T082 验证证据

| 日期 | 检查 | 结果 | 证据 |
|---|---|---|---|
| 2026-09-15 | `node --check plugins/installed/taskhive-surfaces/dsh/client.js` | 通过 | exit 0 |
| 2026-09-15 | 渲染树结构扫描（括号/字符串感知） | 通过 | 工作台根节点由 8 个子节点降为 **6** 个：header / commandbar / editor / assistant(条件) / proposal(条件) / statusrow；`代码任务` 已并入 commandbar，`status`+`safety` 已并入 statusrow |
| 2026-09-15 | `node tests/codesys-workbench-compact-layout-contract.js` | 通过 | 更新后的单条命令条与单行小字断言全部通过 |
| 2026-09-15 | `node tests/codesys-project-tree-contract.js` | 通过 | 过滤与 twisty 合同保留，expand/collapse-all 断言已按删除更新 |
| 2026-09-15 | `node tests/run-contracts.js` | **全部通过（exit 0）** | 本轮沙箱策略改为完整访问后，此前受 `spawn EPERM` 限制的 `reasoning-cli-routes-contract.js` 也一并通过，全套无例外 |
| 2026-09-15 | 失效渲染引用扫描 | 通过 | 渲染层已无 `className: 'taskhive-codesys-write-panel' / -prompt / -write-actions / -composer-heading'` |

### T082 待办（需真实界面验收）

1. 第三行应是**一条**边框完整的命令条：`代码任务 · 交给 AI` │ `工程写入 · 状态 · 已核对差异 · 重新检测 · 确认写入工程（离线编译）` 与左侧按钮**同高、同一基线**，不再出现"左边矮 8px、右边有框"的错位。
2. 底部应**只剩一行小字**：左边运行状态（过长用省略号，悬停看全文），右边 `ⓘ 安全边界`（悬停或键盘 Tab 聚焦看完整声明）。
3. 已知宽度行为（需实机确认）：默认 400px 侧栏下这条命令条**仍会折成 2 行**——因为 8 个控件的最小宽度合计约 538px，而可用宽度只有约 366px。**这不是回归**：T081 同样是 2 行，只是当时错位。把侧栏拖宽到约 560px 以上即为一行。若希望 400px 下也压成一行，需要缩短按钮文字（例如 `确认写入工程（离线编译）` → `确认写入`，离线编译说明移到 title）——**该决定留给用户**，本轮未擅自削弱写入按钮文字。
4. 「项目对象」工具栏应只剩 `全部 / 仅代码 / 设备·容器`（有内部对象时多一个 `内部 N`），`全展开 / 全折叠` 不再出现；逐节点仍可用 twisty 折叠/展开，选中对象仍会自动展开到它的层级。
5. 真实验收前不得把本任务改为"已验证"。

## T083 缩短命令条按钮文案，让默认 400px 侧栏下不再折行

### 现象与根因

T082 之后命令条在默认 400px 侧栏下**仍会折成 2 行**：8 个控件的最小宽度合计约 538px，可用宽度只有约 366px（400 − 根内边距 16 − 条内边距 16 − 边框 2）。用户据此要求"缩短按钮文字"。

核算后发现真正浪费的不是按钮，而是**状态词**：`不可写入：<原因>` 把最长、最需要读的"原因"塞进了**固定宽度**的状态词里，结果原因先被省略；而旁边本可伸缩的 detail 拿的却是通用提示句，宽度反而空转。

### 修改（只动文案与宽度分配，不动任何钩子）

| 位置 | 原文案 | 新文案 | 完整含义去哪了 |
|---|---|---|---|
| 代码任务按钮 | `代码任务 · 交给 AI` | `代码任务` | `title` 仍写明"交给当前 Harness 会话里的 AI 处理：<推导出的提示词>" |
| 写入组标题 | `工程写入` | `写入` | 命令条 `aria-label` 为"工作台命令条与工程写入状态"，按钮为"确认写入" |
| 状态词 | `可确认写入当前工程` / `已绑定工程，等待 AI 代码差异` / `不可写入：<原因>` | `可写入` / `等待 AI 改动` / `不可写入` | **原因改由可伸缩 detail 承载**（`title` 仍带全文） |
| 核对勾选 | `已核对差异` | `已核对` | `title` 仍为"写入前必须逐行核对项目树标记与代码差异；未勾选时确认按钮保持禁用" |
| 确认按钮 | `确认写入工程（离线编译）` | `确认写入` | `title` 仍为"创建恢复快照后写入当前工程并执行离线编译" |
| 条内间距 | `gap:6px` | `gap:5px` | — |

`writeStateLabel` / `writeStateDetail` 重新分工：状态词只回答"能不能写"，detail 回答"为什么 / 下一步"。这比原来更好——**不可写入的原因现在落在可伸缩的那一格**，而不是被挤在固定宽度的状态词里。`data-codesys-write-state` / `data-codesys-write-reason` / `data-codesys-confirm-write` / `data-codesys-review-accepted` 钩子全部保留。

### T083 验证证据

| 日期 | 检查 | 结果 | 证据 |
|---|---|---|---|
| 2026-09-15 | `node --check plugins/installed/taskhive-surfaces/dsh/client.js` | 通过 | exit 0 |
| 2026-09-15 | `node tests/codesys-workbench-compact-layout-contract.js` | 通过 | 含 3 条新断言：完整动作必须留在 title、状态词必须是短词、阻塞原因必须在可伸缩 detail 里 |
| 2026-09-15 | `node tests/codesys-workbench-link-contract.js` | 通过 | 其中 `/确认写入工程/.test(queued.note)` 断言的是**宿主插件写进模型提示的 note**（`index.js`），与按钮文案无关，不受本次缩短影响 |
| 2026-09-15 | `node tests/codesys-project-tree-contract.js` / `-ui-contract.js` | 通过 | 树、焦点、直接上下文合同未受影响 |
| 2026-09-15 | 宽度核算（CJK = 1em、Latin ≈ 0.55em 估算） | 完成 | 缩短后固定项合计约 289.5px + 7×5px 间距 = 约 324.5px < 可用 366px，因此默认 400px 侧栏下这条不再折行；detail 得约 41px，并随侧栏变宽而增长 |
| 2026-09-15 | `node tests/run-contracts.js` | **1 项与本轮无关的失败** | 仅 `model-routing-contract.js:17`（`catalog.visibility['codex-cli::gpt-5.5'] === true`）失败；见下文"无关失败说明" |

### 无关失败说明（`model-routing-contract.js`）

本轮全套测试出现 1 项失败，**与本轮及 T081/T082 的改动无关**，证据：

1. 失败断言是 `model-routing-contract.js:17` 的 `catalog.visibility['codex-cli::gpt-5.5'] === true`，读取的是 `profiles/model-catalog.json`。
2. 该文件是**用户可编辑的可见性状态**（测试自己在第 18–22 行注明"visibility is user-editable state that persists across launches, so the contract must not pin a particular boolean"）。当前值为 `codex-cli::gpt-5.5 = false`。
3. `profiles/model-catalog.json` 的 mtime 是 **18:59:51**，而本轮我只改了 `client.js`(19:03:09) / `codesys-workbench-compact-layout-contract.js`(19:03:52) / `codesys-project-tree-contract.js`(18:57:21) / 本清单(19:04:31)。我**从未写入**该 catalog，写入者只能是运行中的 TaskHive（设置里的模型显隐开关）。
4. 同一套测试在本轮改动前（19:00 之前）曾完整通过。

**同时发现一处真实不一致（非本轮引入，供用户处置）**：`catalog.defaultRoute` 仍是 `{ providerId: 'codex-cli', modelId: 'gpt-5.5' }`（第 13 行断言通过），而 `gpt-5.5` 的可见性现在是 `false`——**默认路由指向了一个已被隐藏的模型**。这与 T049（"勾选 gpt-5.6 后输入框模型目录不显示"）和 T064（"切换模型后输入框模型选择消失"）是同一类现象，建议单独开一项核对；本轮**未改动**模型目录与契约，以免掩盖真实回归。

### T083 待办（需真实界面验收）

1. 默认 400px 侧栏下，第三行应**不再折行**；`代码任务 │ 写入 不可写入 原因… 重新检测 确认写入` 全在一行内。悬停任一控件都能看到被截掉的完整含义。
2. 写入受阻时先看状态词（`不可写入`），紧挨着的一小段就是原因（越窄越省略，悬停看全文）。
3. **一个可选的进一步压缩（本轮未做，等确认）**：命令条里的 `重新检测` 与顶栏的 `刷新当前工程` 调用的是**同一个函数、同一个参数**（`detectCurrentProject({ force: true })`），是一处真实重复。删掉条内那颗可再释放约 59px，把"不可写入的原因"从约 41px 提升到约 100px（约 10 个汉字），代价是检测入口只剩顶栏一处。
4. 真实验收前不得把本任务改为"已验证"。

## T084 修复顶栏（第一行）折行：低频操作图标化 + 容器查询分档

### 现象与根因

用户反馈："第一行的ui为什么乱了，现在变成两行了"。

只读核对 `client.js` 的全部顶栏 CSS 后确认：**规则没有被改坏**，是内容放不下被 `flex-wrap:wrap` 折行。

T081 **之前**顶栏里只有 标题 + 会话号 + 2 个徽章（约 255px），400px 侧栏下天然一行。T081 把「当前工程」整块并进顶栏后，内容变成：

| 顶栏内容 | 估算宽度 |
|---|---|
| `CODESYS 代码工作台` @12.5px | ~116px |
| `当前工程` 字段名 @9.5px | ~38px |
| 工程路径（`min-width:96px`） | ≥96px |
| `刷新当前工程` / `选择 .project 文件` / `复制路径` / `资源管理器` / `一键回退到绑定基线` | ~378px |
| `对话联动已就绪` + `当前工程` 徽章 | ~139px |
| 间距 | ~30px |
| **合计** | **≈800px** |

可用宽度只有 **384px**（400 − 左右内边距 16）。关键：即使把侧栏拖到最大 640px（可用 624px），装了工程时也还有约 700px 内容，**照样折行**——所以这不是"侧栏太窄"，是这块内容量本身就超过一行。这是 T081 只把「当前工程」**搬上来**、没把它**压下去**的欠账。用户看到的就是两层 `flex-wrap` 叠加后的随机断点：标题一行、徽章被 `margin-left:auto` 推到右边缘、之后路径与按钮再二次折行。

### 方案选择（用户确认）

| 方案 | 结论 |
|---|---|
| A 响应式图标化（容器查询） | **采用**。窄面板自动切图标、宽面板保留文字，零信息删除 |
| B 直接全部图标化 | 未采用（宽面板也享受不到文字） |
| C 工程操作另起一条全宽工具行 | 未采用（功能带 4→5 条） |

可图标化的范围由用户指定：**只有 `复制路径` / `资源管理器` / `一键回退` 图标化**；`刷新当前工程` / `选择 .project 文件` 保留文字（窄档才退化为图标）。

### 修改

| 文件 | 改动 |
|---|---|
| `plugins/installed/taskhive-surfaces/dsh/client.js` | 新增 `CODESYS_ACTION_ICONS` + `codesysActionIcon(id)`：5 个 15px 内联 SVG（顺时针刷新 / 文件夹+加号 / 双矩形复制 / 文件夹+放大镜定位 / 逆时针回退），全部 `aria-hidden`，语义由按钮的 `aria-label` + `title` 承担 |
| 同上 | 复制 / 定位 / 回退 → `taskhive-codesys-action-icononly`（26px 见方，无文字）；刷新 / 选择工程 → `taskhive-codesys-action-text`（图标 + 短文案 `刷新` / `选择工程`，图标在显示文字时隐藏）。**5 个动作全部补上 `aria-label`**（纯图标按钮没有可读文本） |
| 同上 | 删除冗余的「当前工程」字段名（所在 `section` 已有 `aria-label="当前 CODESYS 工程"`，输入框也有 `aria-label`）；标题由 `CODESYS 代码工作台` 缩为 `代码工作台`，全名进 `header-copy` 的 `title`；联动徽章新增短文案变体（`对话联动已就绪` → `已联动`、`对话联动 · N 处待确认` → `待确认 N`、`对话联动 · 已写入 N` → `已写入 N`、`对话未连接` → `未连接`） |
| 同上 | 工作台根节点加 `container-type:inline-size;container-name:taskhive-codesys`，用 `@container taskhive-codesys` 分四档：**≥620px** 显示「离线工程」徽章、路径 `min-width:120px`、徽章长文案；**<620px** 隐藏离线徽章/字段名并切徽章短文案；**<380px** 连刷新/选择工程也退化为 26px 图标、路径 `min-width:44px`、操作间距 3px；**<340px**（接近 280px 最小侧栏）隐藏标题与徽章 |
| 同上 | 唯一允许顶栏出现第二行的状态：`detectFailure.openProjects` 需要用户裁决"用哪个正在使用中的工程"时，该下拉 `flex:1 1 100%` **刻意独占整行**（工程名 + PID 挤不进一行，随机折行比整行更乱）。动作只出现一次、留在「当前工程」行，符合 T071/T081 已确立的决定 |
| `app/main.js` | 工作台诊断 `pathButtons` 原本按按钮 `textContent` 匹配，图标化后文字为空会**静默漏掉**这些按钮；改为同时读 `aria-label` 与 `title`。⚠️ 该段位于 `executeJavaScript` 的模板字符串内：本轮第一次改写时嵌了反引号，直接把外层模板提前结束，`node --check app/main.js` 立刻报 `missing ) after argument list`，已改为字符串拼接 |
| `tests/codesys-workbench-compact-layout-contract.js` | 新增顶栏断言：容器声明、`@container` 三档窄栏 + 宽面板路径规则、恰好 3 个纯图标 + 2 个带文字动作、5 个动作各有 `aria-label`、5 个图标齐备、字段名不再渲染、徽章短文案、裁决下拉独占整行；并新增 **顶栏宽度预算断言**，把"一行"从口头承诺变成可测量、可回归的检查 |

### 宽度预算（合同里的实测输出）

宽度模型：CJK = 1em，Latin/数字/空格 ≈ 0.55em；按钮 = 文字宽 + 12px 内边距 + 2px 边框；纯图标 26px。

| 分档 | 需要 | 可用 | 结果 |
|---|---|---|---|
| 宽面板 ≥620px（长文案全可见） | 512px | 620px | ✅ |
| 默认 400px 侧栏（容器约 384px） | 358px | 380px | ✅ |
| 窄栏 <380px（刷新/选择 也图标化） | 306px | 340px | ✅ |
| 最窄 280px 侧栏（隐藏标题与徽章） | 198px | 280px | ✅ |

### T084 验证证据

| 日期 | 检查 | 结果 | 证据 |
|---|---|---|---|
| 2026-09-15 | `node --check plugins/installed/taskhive-surfaces/dsh/client.js` | 通过 | exit 0 |
| 2026-09-15 | `node --check app/main.js` | 通过（修正后） | 首次因模板字符串内嵌反引号报 `missing ) after argument list`，改为字符串拼接后 exit 0 |
| 2026-09-15 | 渲染树扫描（括号/字符串感知） | 通过 | 工作台根节点仍为 6 个子节点，顶栏仍是第 1 行 |
| 2026-09-15 | `node tests/codesys-workbench-compact-layout-contract.js` | 通过 | 含顶栏宽度预算输出 `512/620, 358/380, 306/340, 198/280`，四档全部有余量 |
| 2026-09-15 | `node tests/codesys-project-tree-contract.js` / `-ui-contract.js` / `-link-contract.js` | 通过 | 所有 `data-codesys-*` 钩子（`project-path`/`detect-project`/`select-project`/`open-projects`/`copy-project-path`/`reveal-project`/`rollback`）逐字保留，探针与联动链路未受影响 |
| 2026-09-15 | `node tests/run-contracts.js` | **1 项与本轮无关的失败** | 仅 `model-routing-contract.js:17`（用户的模型可见性状态 `codex-cli::gpt-5.5 = false`），见 T083 的"无关失败说明"；其余全部通过 |

### T084 待办（需真实界面验收）

1. 默认 400px 侧栏下，第一行应**只有一行**：`代码工作台 [工程路径…] ⟳刷新 📂选择工程 ⧉ 📁 ↺ ●已联动`。图标按钮悬停应看到完整中文名（如"在资源管理器中定位当前工程"）。
2. 把侧栏拖宽到 620px 以上：应出现「离线工程 / 当前工程」徽章、路径变宽、联动徽章回到长文案（`对话联动已就绪`）。
3. 把侧栏拖到 380px 以下：`刷新`/`选择工程` 也应变成图标；再窄到 340px 以下时标题与联动徽章消失，但**路径与 5 个操作仍然一行**。
4. 唯一例外（需确认可接受）：当检测到多个正在使用中的工程时，裁决下拉会刻意独占第二行。这是唯一允许的第二行状态。
5. 键盘 Tab 依次经过 5 个图标按钮时，焦点环与可读名称（`aria-label`）都应正常。
6. 真实验收前不得把本任务改为"已验证"。

## T085 删除命令条内与顶栏重复的「重新检测」

### 事实核对

命令条里的 `data-codesys-write-recheck`「重新检测」与顶栏 `data-codesys-detect-project`「刷新」：

```js
// 命令条（T081 引入）
onClick: () => detectCurrentProject({ force: true }), title: '重新检测当前 CODESYS 工程、ScriptEngine 和写入权限'
// 顶栏（原有）
onClick: () => detectCurrentProject({ force: true }), title: '重新检测当前 CODESYS 窗口中已打开的工程'
```

**同一个函数、同一个参数**，只有 tooltip 文案不同——同一面板里两个入口做同一件事。T083 核算命令条宽度时发现：删掉条内那颗可释放约 59px（按钮 54px + 5px 间距），而这 59px 正好是"不可写入的原因"最需要的地方。

引用面核对（删除前的完整影响面）：
- `main.js`：**0** 处引用 `data-codesys-write-recheck`（桌面探针用的是顶栏的 `data-codesys-detect-project`，路径不变）。
- `taskhive-surfaces/dsh/index.js`（宿主）：**0** 处。
- `tests/`：仅本轮新增的紧凑布局合同 1 条断言。
- `重新检测` 字样：只在被删按钮与顶栏 `刷新` 的 title 里；宿主下发的 `writeBlockReason` 文案**没有任何一条**要求用户去按某颗按钮（都是"未检测到当前打开并保存的 .project 工程""当前工程暂不可跨进程写入"这类事实陈述）。

### 修改

| 文件 | 改动 |
|---|---|
| `plugins/installed/taskhive-surfaces/dsh/client.js` | 删除命令条内「重新检测」按钮及其 CSS 规则 `.taskhive-codesys-write-recheck`；顶栏 `刷新` 的 `title` 合并为"重新检测当前 CODESYS 窗口中的工程、ScriptEngine 与写入权限；这是工作台唯一的检测入口（T085 起命令条不再重复一颗）"，能力不丢、入口唯一；更新命令条结构注释 |
| `tests/codesys-workbench-compact-layout-contract.js` | 原断言改为"重复按钮与其 CSS 必须保持删除"+「顶栏刷新必须声明完整检测范围」；新增**命令条宽度预算断言**，要求默认 400px 侧栏下可伸缩的原因文案 ≥80px |

### 宽度效果（合同里的实测输出）

| | 删除前 | 删除后 |
|---|---|---|
| 命令条固定项 | ≈324.5px | ≈265.5px |
| 「不可写入的原因」可得宽度 | ≈55px（约 5 个汉字，实际会被压成省略号） | **≈114px**（约 11 个汉字）✅ 超过 80px 下限 |

### T085 验证证据

| 日期 | 检查 | 结果 | 证据 |
|---|---|---|---|
| 2026-09-15 | `node --check plugins/installed/taskhive-surfaces/dsh/client.js` | 通过 | exit 0 |
| 2026-09-15 | `node tests/codesys-workbench-compact-layout-contract.js` | 通过 | 输出 `command bar reason room: 114px` 与 `header budget: 512/620, 358/380, 306/340, 198/280` |
| 2026-09-15 | 渲染树扫描（括号/字符串感知） | 通过 | 工作台根节点仍为 6 个子节点，结构未变 |
| 2026-09-15 | 失效引用扫描 | 通过 | `client.js` 中已无 `data-codesys-write-recheck` 与 `.taskhive-codesys-write-recheck`；`app/main.js` 本就 0 引用 |
| 2026-09-15 | `node tests/run-contracts.js` | **1 项与本轮无关的失败** | 仅 `model-routing-contract.js:17`（用户的模型可见性状态 `codex-cli::gpt-5.5 = false`，见 T083"无关失败说明"）；其余全部通过 |

### T085 待办（需真实界面验收）

1. 命令条应只剩：`代码任务 │ 写入 <状态> <原因…> [☑已核对] 确认写入`——**不应再有「重新检测」**。
2. 写入受阻时，`不可写入` 后面那段原因应比之前明显更长（默认 400px 侧栏下约 11 个汉字），悬停仍可看全文。
3. 需要重新检测时用顶栏的 `⟳ 刷新`（唯一入口）；悬停应看到它同时检测 ScriptEngine 与写入权限。
4. 真实验收前不得把本任务改为"已验证"。

## T086 「代码任务」改为命名命令「AI 审核」并移到顶栏；底部条变为纯写入条

### 现象与根因（用户反馈）

用户原话：

> "代码任务感觉和最后一行的ui感觉有割裂感不是很美观，其次点击代码任务只是告诉ai要调用什么工具，读取什么文件，而不是现在直接进行代码审核操作；如果你有不一样的想法先告诉我，先不要修改"

**（一）割裂感的根因**：底部条里放了两个**同款蓝色实心主按钮**——`代码任务`（`taskhive-codesys-submit`）与`确认写入`（`taskhive-codesys-submit taskhive-codesys-confirm-write`）——却分属两个域（AI 入口 / 落盘写入），中间还有一条 1px 分组竖线，条的 `aria-label` 也叫"工作台命令条与工程写入状态"。**一个盒子里装了两件事**。

**（二）"只是告诉 AI 要调用什么工具、读取什么文件"的取证**：按下时 `submit()` 拼出的消息（T081 起）是：

```
你正在处理 TaskHive CODESYS 专属代码任务。当前 Harness 会话启用 danger-full-access……
本次代码上下文只在此任务调用中从本地临时文件读取，不会写入后续普通对话历史。
<taskhive-codesys-context path="…/modelContext.json" />
用户要求：<T081 自己编的那句"审查……">
请直接根据临时上下文修改，只返回一个 JSON 代码块。修改已有对象使用：{"operation":"update-text",…}
新增 POU 使用：{"operation":"create-pou",…}……总格式：{"summary":"说明","changes":[…]}。
仍然禁止 PLC 登录、下载、在线修改、变量写入、启停、复位、调试、断点与 Force。
```

消息主体是**管道说明书**，代码审核只是附在末尾的一句。而且 `用户要求：` 后面那句是 **T081 凭空生成的**——用户从没说过，却被标成"用户要求"。

**（三）关键取证：那一大段是重复的。** 宿主的系统提示段 `taskhive:codesys-workbench`（`index.js:1040`）本来就已经写明：先用 `taskhive_codesys_workbench` 读实时状态、再用 `taskhive_codesys_workbench_propose` 提交"complete declaration/implementation 文本 + 快照中的 objectGuid"、必须由用户点"确认写入工程"、以及全部 PLC 禁列；两个工具各自的 description 又重复了一遍。**按钮再讲一遍，唯一独有的信息只有那个临时上下文文件路径。**

### 决策（用户确认）

| 问题 | 选项 | 用户选择 |
|---|---|---|
| 「代码任务」点下去到底是什么 | 甲：按钮就是一次代码审核／乙：只做上下文桥不自动发任务／丙：一组命名命令 | **甲** |
| 放哪里才不割裂 | 顶栏同排／留在原地降级为描边／移到代码编辑器窗格标题行 | **移到顶栏** |

### 修改

| 文件 | 改动 |
|---|---|
| `plugins/installed/taskhive-surfaces/dsh/client.js` | **按钮改成命名命令**：文案 `代码任务 · 交给 AI` → `AI 审核`，`aria-label` = "AI 审核当前打开的代码对象"，`title` 明写它会发出的那句话；`derivedPrompt` → `reviewCommand`，措辞从"审查…给出完整代码"改为这次点击的**忠实复述**（有对象＝审核该对象；无对象＝审核整个工程） |
| 同上 | **消息只留命令 + 上下文引用**：`const instruction = \`${taskPrompt}\n<taskhive-codesys-context path="${request.modelContextPath}" />\``。JSON 结构、操作枚举、objectGuid 规则、PLC 禁列、上下文标签约定全部移出，改由宿主系统提示承担（仍是 T018 的隔离：完整快照只留本地，对话里只放临时路径）。不再出现伪造的 `用户要求：` |
| 同上 | **搬到顶栏**：`CodesysTaskComposer` 现在渲染在 `taskhive-codesys-project-actions` 里（`刷新`/`选择工程` 之后、图标组之前），类名为 `taskhive-codesys-action taskhive-codesys-action-text taskhive-codesys-action-ai` + 新图标 `review`（四角星＋小星）。它用品牌浅色描边而非实心蓝，避免再次出现"两个同款主按钮" |
| 同上 | **底部条变成纯写入条**：移除 AI 入口与 1px 分组竖线，`aria-label` 改为「工程写入状态」。条内只剩 `写入 <状态> <原因…> [☑已核对] 确认写入`，省下的宽度自动归给可伸缩的原因文案 |
| 同上 | **腾出顶栏宽度**：标题改长短两版（宽面板 `代码工作台`／窄栏 `工作台`），联动徽章在窄档缩成**小圆点**（`●` 已联动 / `○` 未连接 / `● N` 有待确认，完整句子仍在 `title` 里）——这是把约 34px 让给 `AI 审核` 的来源 |
| 同上 | **修正 T084 遗留的文案不一致**：8 处引导文案仍在引用已改名的按钮，全部改为指向可见标签（`『刷新当前工程』`→`『刷新』`、`『选择 .project 文件』`→`『选择工程』`、`点"刷新当前工程"`→`点「刷新」`）。这些字符串没有任何测试依赖，但会让用户去找不存在的按钮 |
| `plugins/installed/taskhive-surfaces/dsh/index.js` | 系统提示段补齐 T086 从按钮消息里拿走的契约：**交付方式二选一**（调用 `taskhive_codesys_workbench_propose`，或直接在回复里给一个 JSON 代码块，含示例与 `create-pou/create-gvl/create-dut` 枚举）、以及 **`<taskhive-codesys-context>` 临时快照约定**（按需读取，不写进对话历史/记忆/知识库，不在后续普通对话里重放）。同一契约只保留这一处权威来源 |
| `tests/codesys-workbench-compact-layout-contract.js` | 断言改为「AI 入口必须在顶栏、不得回到写入条」「按下发送的必须是被点击动作的忠实复述」「不得再出现伪造的 `用户要求：`」「6 个顶栏动作各有 aria-label 与 6 个图标」；顶栏与命令条**宽度预算模型同步更新**（加上 `AI 审核`、去掉移走的按钮） |
| `tests/codesys-workbench-ui-contract.js` | 原「T018 保证必须在 client.js 里」的断言改为在**宿主 `index.js`** 里断言（`不要把它写进对话历史、记忆或知识库`、`交付方式二选一`、`create-pou/create-gvl/create-dut`），并新增三条"每次点击的消息不得再复述 JSON 结构与工具名"的断言 |

### 宽度效果（合同里的实测输出）

| | T085 后 | T086 后 |
|---|---|---|
| 顶栏（默认 400px 侧栏，容器约 384px） | 358/380 | **354/380**（含新的 `AI 审核`，靠标题/徽章缩短腾出） |
| 「不可写入的原因」可得宽度 | 114px | **183px** |

### T086 验证证据

| 日期 | 检查 | 结果 | 证据 |
|---|---|---|---|
| 2026-09-15 | `node --check plugins/installed/taskhive-surfaces/dsh/client.js` | 通过 | exit 0。⚠️ 本轮两次踩到**模板字符串内嵌反引号**：CSS 注释里写了 \`代码工作台\`、\`.taskhive-codesys-action-*\`，直接把外层 CSS 模板提前结束并报 `Unexpected identifier`。已改为「」并在这两段注释里写明"本段位于模板字符串内，注释里禁止出现反引号" |
| 2026-09-15 | `node --check plugins/installed/taskhive-surfaces/dsh/index.js` | 通过 | exit 0 |
| 2026-09-15 | 渲染树扫描（括号/字符串感知） | 通过 | 工作台根节点仍为 6 个子节点；`codesysActionIcon('review')` 与 `CodesysTaskComposer` 均在 `header` 段内，写入条内已无 AI 入口 |
| 2026-09-15 | `node tests/codesys-workbench-compact-layout-contract.js` | 通过 | 输出 `command bar reason room: 183px`、`header budget: 567/620, 354/380, 276/340, 227/280` |
| 2026-09-15 | `node tests/codesys-workbench-ui-contract.js` | 通过 | 断言已从 client 迁到宿主，并锁住"不再复述 schema" |
| 2026-09-15 | 其余 codesys 合同（link / project-tree / renderer-lifecycle / active-project / current-project / launched-cleanup / scriptengine-recovery / window-fit / window-ownership / capture / path-authorization / launch / skin-performance） | 全部通过 | — |
| 2026-09-15 | `node tests/run-contracts.js` | **1 项与本轮无关的失败** | 仅 `model-routing-contract.js:17`（用户的模型可见性状态 `codex-cli::gpt-5.5 = false`，见 T083"无关失败说明"）；其余全部通过 |

### T086 待办（需真实界面验收）

1. 底部条应只剩写入：`写入 <状态> <原因…> [☑已核对] 确认写入`，**不应再看到同款的第二个蓝色主按钮**，"割裂感"应消失。
2. 顶栏应出现 `✦ AI 审核`（浅色品牌描边，与两侧的工程管道按钮明显不同），位置在 `选择工程` 之后、图标组之前。
3. 点 `AI 审核`：对话里应只出现一句审核命令 + 一行 `<taskhive-codesys-context path=… />`；**不应**再出现"你正在处理 TaskHive CODESYS 专属代码任务""用户要求：""只返回一个 JSON 代码块"这类管道说明。
4. AI 返回的修改仍应照旧进入项目树与逐行高亮，`确认写入` 仍需先勾选 `已核对`。
5. 悬停顶栏右侧那个小圆点应看到完整的联动状态句子（`●`/`○`/`● N`）。
6. 真实验收前不得把本任务改为"已验证"。

## T087 修复 T086 的"盲审"风险 + 工程快照改为全量口径

### 用户提问与取证

用户原话：

> "我没有搞清楚，ai审核有什么意义？ 没有代码任务模型是怎么知道我的代码"

先把"模型怎么知道你的代码"逐条查清（两条独立通道）：

**通道 A —— 读工具（不需要点任何按钮）**
宿主注册的 `taskhive_codesys_workbench`（`index.js:945`）返回工作台实时发布的状态（`client.js` 的 `publishCodesysStateRef`），其中 `openObject.declaration`/`.implementation`/`.code` 是**当前打开对象的完整代码**（含未写入的手写修改），另有 `baseDeclaration`/`baseImplementation` 磁盘基线、`changedObjects`、`pendingProposal`、`projectPath`、层级与种类计数。系统提示本来就命令模型"当用户提到工作台或要求改 CODESYS 代码时，先用 `taskhive_codesys_workbench` 读取"。
→ **对象级审核根本不依赖那个按钮**；但读工具**只有当前打开的那一个对象**的代码，没有整个工程。

**通道 B —— 临时工程快照文件（按钮唯一独有的东西）**
`buildCodesysTaskSnapshot(sourcePath, objects, prompt)` → `main.js:1958` 写成 `<jobRoot>/model-context.json`，路径即消息里的 `<taskhive-codesys-context path="…"/>`。

### 两个真实缺陷（本轮修复）

**缺陷 1：T086 把"必须读快照"的指令删掉了。**
T086 之前消息里有"请直接根据临时上下文修改"；T086 之后只剩一个路径标签，系统提示里是"按需读取即可"这种软话。后果：

| 场景 | 通道 A 够不够 | 结论 |
|---|---|---|
| 审核**当前打开的对象** | 够 | 可靠 |
| 审核**整个工程**（未选对象） | **不够**（读工具只给计数与层级） | **模型可能不读快照就"盲审"** |

连带问题：T086 连"本会话可直接读绝对路径"的提醒也一起删了，模型可能不敢读工作区外的那个路径。

**缺陷 2：快照口径是"提示词词频打分取最多 6 个对象，没匹配时退化取最大 4 个"。**
后果：`审核整个工程` 永远只能看到工程的一小部分；换了措辞（例如把命令改写成通用句子）就匹配不到目标对象，退化成"最大的 4 个"。**这正是用户感觉"AI 好像没看全我的工程"的根源。**

### 决策（用户确认）

| 问题 | 用户选择 |
|---|---|
| 工程级上下文怎么交给模型 | **甲 + 随后做乙**：甲＝补回一句硬指令并把约定写硬；乙＝让读工具支持按需取快照（工具调用比"请读这个文件"可靠） |
| 快照装哪些对象 | **全部有代码的对象，按上限截断** |

### 本轮已做（甲）

| 文件 | 改动 |
|---|---|
| `plugins/installed/taskhive-surfaces/dsh/client.js` | `submit()` 的消息由"命令 + 路径标签"改为"命令 + **读取指令** + 路径标签"：`` `${taskPrompt}\n本次工程上下文（含工程内全部有代码对象的声明与实现）在下面的路径里，请先读取它再动手，不要凭猜测回答：\n<taskhive-codesys-context path="…" />` ``。仍然**不复述** schema 讲稿——工具名、JSON 结构、操作枚举、PLC 禁列、标签约定继续由宿主系统提示与工具描述承担 |
| 同上 | `buildCodesysTaskSnapshot` 改为全量口径：删掉提示词词频打分与"最多 6 个 / 退化最大 4 个"的**筛选**；命名匹配降级为**排序**（被点名的对象排在最前，从而一定活过截断）；`selection` 改为 `all-code-objects`；新增 `codeObjectCount`/`namedObjectCount`/`includedCount`；截断发生时逐条 pop 并置 `textTruncated: true`；**全部对象的 `index` 元数据（名称/GUID/类型/两段字符数）始终保留**，让模型知道被截掉了哪些 |
| `plugins/installed/taskhive-surfaces/dsh/index.js` | 系统提示段的上下文约定由"按需读取即可"改为"**必须先读取它再回答**"，并补上三段信息：快照含工程内全部有代码对象的完整声明与实现；`textTruncated` 为真时用 `index` 字段核对缺失对象、需要时再单独读取；该文件通常在工作区之外，**本会话已启用全本地路径访问，可直接按绝对路径读取** |
| `tests/codesys-workbench-ui-contract.js` | 新增 8 条断言锁住快照口径（必须从全部代码对象出发、命名只排序不筛选、截断必须如实上报、元数据索引始终保留），并把消息断言改为「命令 + 读取指令 + 上下文引用」+ 宿主提示必须含"必须先读取它再回答" |

### 诚实边界（回答"AI 审核有什么意义"）

按钮**不负责**"让模型知道你的代码"——那是通道 A 常驻在做的事。它唯二的价值是：**① 在工作台里一键触发一次对话；② 附带工程级快照**（通道 A 给不了的那部分）。也就是说：对象级审核不点它也能做；这个按钮真正不可替代的只有"整个工程"这种范围。

### T087 验证证据

| 日期 | 检查 | 结果 | 证据 |
|---|---|---|---|
| 2026-09-15 | `node --check plugins/installed/taskhive-surfaces/dsh/client.js` | 通过 | exit 0 |
| 2026-09-15 | `node --check plugins/installed/taskhive-surfaces/dsh/index.js` | 通过 | exit 0 |
| 2026-09-15 | `node tests/codesys-workbench-ui-contract.js` | 通过 | 含 8 条新口径断言 + 消息/宿主提示断言 |
| 2026-09-15 | 其余 codesys 合同 | 全部通过 | compact-layout / link / project-tree 均已复跑 |
| 2026-09-15 | `node tests/run-contracts.js` | **1 项与本轮无关的失败** | 仅 `model-routing-contract.js:17`（用户的模型可见性状态，见 T083"无关失败说明"）；其余全部通过 |

### T087 待办

1. **甲 的真实验收**：重启 TaskHive → 打开工作台 → 点 `AI 审核` → 对话里应看到"命令 + 请先读取它再动手 + 路径"，且模型**先读该文件**再给结论；未选对象（审核整个工程）时尤其要确认它没有凭层级/计数空谈。
2. **乙（已由 T088 实施）**：给 `taskhive_codesys_workbench` 增加 `include: 'project-snapshot'`，由客户端把工程快照随**实时状态发布**给宿主，模型改用**工具调用**取上下文，消息里的文件路径降级为等价退路。
3. 真实验收前不得把本任务改为"已验证"。

## T088（乙）工程快照改为工具调用按需获取

### 前置与决策

T087 的甲已经让"按钮 → 消息里的文件路径 → 模型去读"这条链路可靠（用户已确认"没问题"）。但那仍然是**让模型去读一个工作区外的绝对路径**，天然有两处脆弱：模型可能不敢读工作区外的路径；路径依赖 `main.js` 每次点击写出的临时文件，只能在"点过按钮之后"存在。

乙的目标：让模型**用工具调用**拿同一份工程级快照。用户确认的组合是「甲 + 随后做乙」，快照口径为「全部有代码的对象，按上限截断」（T087 已实现）。

### 已有事实核对（实施前）

- 发布路由 `publishWorkbenchState(sessionId, state)` **不做字段校验**，给实时状态加字段是安全的。
- `WORKBENCH_MAX_BODY_BYTES = 512 * 1024`：快照被 28000 字符上限约束，UTF-8 下最多约 84 KB，远低于请求体上限。
- `WORKBENCH_STATE_TTL_MS = 15 * 60 * 1000`：状态 15 分钟内有效，足够一个对话回合使用。
- 读工具 `output.schema` 为 `additionalProperties: true`，新增返回字段不需要改 schema。

### 修改

| 文件 | 改动 |
|---|---|
| `plugins/installed/taskhive-surfaces/dsh/client.js` | 新增 `codesysObjectsSignature(sourcePath, objects)`：用「源路径 + 对象数 + 代码总字符数 + guid/名称/两段长度的 FNV-1a 哈希」做廉价钱签名。快照约 28000 字符，**绝不能**随每次选区/输入停顿重发 |
| 同上 | `projectSnapshot` 改用 `React.useMemo(..., [projectSnapshotSignature])` 重建，只有工程对象真正变化时才重新序列化 |
| 同上 | 发布时**仅在签名变化**才附带 `projectSnapshot`（`sendSnapshot`），并用新增的 `publishedSnapshotRef` 记录已发布签名 |
| 同上 | 把 `projectSnapshotSignature` 并入 `liveStateFingerprint`——否则新的 inspect 不触发发布，读工具会一直拿到上一次的快照 |
| `plugins/installed/taskhive-surfaces/dsh/index.js` | `publishWorkbenchState` 由**整体替换**改为**字段合并**（`{ ...previous.state, ...state }`）。这是配套前提：客户端只在变化时附带快照，若宿主整体替换，后续不带该字段的发布就会把它清掉。显式传 `null` 仍能清空字段（合并只保留"未出现"的键） |
| 同上 | `workbenchToolPayload(sessionId, include)` 支持 `include === 'project-snapshot'`，此时返回 `projectSnapshot` + `projectSnapshotNote`；拿不到快照时**明说原因**（未绑定/未读取/工作台未打开），避免模型把"没有快照"误当成"工程里没有代码" |
| 同上 | `taskhive_codesys_workbench` 增加 `include` 参数（`enum: ['state','project-snapshot']`，非必填）+ 描述说明"任务不局限于当前打开对象时就用它"，并把 `args.include` 转发给 payload |
| 同上 | 系统提示把**工具路径标为优先做法**，消息里的 `<taskhive-codesys-context>` 路径保留为**等价退路**（按用户选择的组合，甲那句兼容保留） |
| `tests/codesys-workbench-ui-contract.js` | 新增 12 条断言：对象签名函数、记忆化依赖、条件附带、指纹接线、工具参数与转发、`projectSnapshotNote`、发布必须合并、系统提示必须宣传工具路径 |

### T088 验证证据

| 日期 | 检查 | 结果 | 证据 |
|---|---|---|---|
| 2026-09-15 | `node --check plugins/installed/taskhive-surfaces/dsh/client.js` | 通过 | exit 0 |
| 2026-09-15 | `node --check plugins/installed/taskhive-surfaces/dsh/index.js` | 通过 | exit 0 |
| 2026-09-15 | `node tests/codesys-workbench-ui-contract.js` | 通过 | 含 12 条新断言 + T087 的 8 条口径断言 |
| 2026-09-15 | 其余 codesys 合同 | 全部通过 | compact-layout / link / project-tree 均已复跑 |
| 2026-09-15 | `node tests/run-contracts.js` | **1 项与本轮无关的失败** | 仅 `model-routing-contract.js:17`（用户的模型可见性状态，见 T083"无关失败说明"）；其余全部通过 |

### T088 待办（需真实界面验收）

1. 重启 TaskHive → 打开工作台并读取工程 → 在对话里问"工程里有哪些对象"，模型应能调用 `taskhive_codesys_workbench` 并传 `include:"project-snapshot"` 拿到 `projectSnapshot.objects`（**全部**有代码对象，而不是只有当前打开那一个）。
2. 未绑定工程时调用同一工具，应看到 `projectSnapshot: null` + 明确的 `projectSnapshotNote`，而不是静默缺失。
3. 输入/切换选区时**不应**出现体积异常的网络请求（快照只在工程对象变化时附带一次）；重新读取工程树后应再附带一次。
4. 真实验收前不得把本任务改为"已验证"。

## T089 状态续期心跳 + 修复 T088 的换绑残留旧快照缺陷

### 背景（用户提问）

> "每次都要我对话触发吗？ 不能做一个按键出来？"
> （澄清后）"我的意思是在对话里问『工程里有哪些对象』，还是说我根本不要问，直接告诉它我要改什么它就可以识别到我的工程"

逐条核对后确认：**不需要先问**。宿主系统提示（`index.js:1075`）本来就要求模型"当用户提到工作台、当前打开的 POU/对象/代码，或要求修改 CODESYS 工程代码时，先用 `taskhive_codesys_workbench` 读取工作台实时状态"，并在任务不局限于当前对象时带 `include:"project-snapshot"`。所以"把 PRG_1 的急停逻辑改成…"这种直接指令就够，模型自己去认工程。

同时暴露出一个真实限制：**宿主侧状态在最后一次发布后 15 分钟过期**（`WORKBENCH_STATE_TTL_MS`），而且没有任何续期机制——因为 T069 明确要求"消除 CODESYS 代码工作台的定时自动刷新"。用户把对话放久了再问，模型第一次会读不到工程。

### 决策（用户确认）

采用**只续期的轻量心跳**：工作台挂着时每 5 分钟把**已持有的状态**原样重发一次；**不重新读工程、不启动 ScriptEngine**。

关键区分（写进注释与断言）：T069 禁止的是**昂贵的定时工程探测**（`detectCurrentProject` → 启动 ScriptEngine，并让控件反复禁用/闪烁，即 T069 修掉的那次闪烁）。而这里每 5 分钟只做一次本地 HTTP POST，body 是工作台内存里现成的那份状态，零引擎工作、零 UI 变化。

### 修改

| 文件 | 改动 |
|---|---|
| `plugins/installed/taskhive-surfaces/dsh/client.js` | 新增 `CODESYS_STATE_KEEPALIVE_MS = 5 * 60 * 1000`、插件级 `codesysStateKeepAlive = { state, sessionId, timer }` 与 `scheduleCodesysStateKeepAlive()`：定时器每 5 分钟把 `codesysStateKeepAlive.state` **原样** `publish` 一次；`if (codesysStateKeepAlive.timer) return` 保证单实例 |
| 同上 | `publishCodesysState` 每次发布后记录 `state`/`sessionId` 并调用 `scheduleCodesysStateKeepAlive()`（首次发布即启动心跳）。心跳**不刷新** `updatedAt`——它重发的是已盖过时间戳的那份状态，所以"这份状态何时观测"不会被续期动作伪装成刚刚刷新过 |
| 同上 | 定时器放在**插件层**（声明位置早于 `function CodesysWorkbench`），因此**工作台标签被关掉之后仍然续期**——那正是用户在对话里提问的时刻 |
| 同上 | **修复 T088 缺陷**：原条件 `Boolean(projectSnapshot) && publishedSnapshotRef.current !== signature` 会导致"换绑工程后新快照暂时为 null → 不发字段"，而宿主 `publishWorkbenchState` 是**字段合并** → 上一个工程的代码被当成当前工程继续提供给模型。改为 `const snapshotChanged = publishedSnapshotRef.current !== projectSnapshotSignature` 后**只要签名变化就把 `projectSnapshot` 一并发出（显式 null 可清空）** |
| `tests/codesys-workbench-ui-contract.js` | 新增断言：心跳节奏 5 分钟、状态存插件层且声明早于组件、原样重发、单实例、`publishCodesysState` 必须启动它；并**按代码切片**断言心跳体内不含 `detectCurrentProject` / `ScriptEngine` / `inspect(`，确保 T069 的"禁止定时引擎探测"不会被回退；另加「签名一变就必须发快照字段（含 null）」的断言 |

### T089 验证证据

| 日期 | 检查 | 结果 | 证据 |
|---|---|---|---|
| 2026-09-15 | `node --check plugins/installed/taskhive-surfaces/dsh/client.js` | 通过 | exit 0 |
| 2026-09-15 | `node tests/codesys-workbench-ui-contract.js` | 通过 | 含 T089 心跳断言 + T088 快照清空断言 + 原有 T087 口径断言 |
| 2026-09-15 | `node tests/codesys-project-tree-contract.js` | 通过 | 其中 `!/setInterval\([^)]*detectCurrentProjectRef/` 与 `!/setInterval\([^)]*,\s*15000\s*\)/` 仍然成立——心跳用的是 5 分钟命名常量且不碰探测 |
| 2026-09-15 | `node tests/codesys-workbench-link-contract.js` | 通过 | `CODESYS_FALLBACK_DETECT_MS = 120000`、`CODESYS_DETECT_MIN_GAP_MS = 15000`、claim poll 等 T069 约定未被触碰 |
| 2026-09-15 | `node tests/run-contracts.js` | **1 项与本轮无关的失败** | 仅 `model-routing-contract.js:17`（用户的模型可见性状态，见 T083"无关失败说明"）；其余全部通过 |

### T089 待办（需真实界面验收）

1. 打开工作台并绑定工程后，把对话晾 **20 分钟以上**，再直接说"把 PRG_1 的急停逻辑改成…"，模型应仍能读到工程（旧行为：15 分钟后读不到）。
2. 心跳期间**不应**出现 ScriptEngine 启动、状态栏变化或控件闪烁（这是 T069 的红线）；占用应只有每 5 分钟一次的小体积本地请求。
3. **换绑工程后必须验证快照被换掉**：从工程 A 换绑到工程 B，然后让模型读 `include:"project-snapshot"`，`projectSnapshot.projectPath` 与对象必须是 B 的，绝不能残留 A。
4. 真实验收前不得把本任务改为"已验证"。

## T090 修复 CODESYS 任务回合的内容丢失 + 底部联动指示

### 用户提问

> "如果一个会话上下文占满了，那个会发送什么"
> "你还是没有明确告诉我，上下文长度满了，我是不是不能继续使用这个对话，是不是需要切换对话？"

### 一、先答清楚：上下文满了要不要换对话

**不需要。可以一直用。** 两种机制都保证会话不会中断：

| 机制 | 触发 | 后果 |
|---|---|---|
| DSH 自动压缩 | 达到声明窗口的 **80%**（`contextWindow × 0.8`，见 `context-window-contract.js`） | 历史被压缩成摘要，会话继续可用 |
| TaskHive 适配器每回合重拼 | 每回合 | 只取**最近 8 条**（`slice(-8)`）+ ≤4,500 字符旧对话摘要，总预算 44,000 字符（`PROMPT_BUDGET`） |

要点：

- **不会"满了发不出去"**——请求每回合从有界窗口重拼，永不超窗；
- **不会失去工程代码**——代码不进历史，每回合现取（内联快照或工具调用）；
- **会失去的是"更早对话的记忆"**——靠 ≤4,500 字符提取式摘要兜底，表现为"它忘了早先聊过的细节"。

所以"换不换对话"是**记忆质量**的选择，不是**能不能用**的问题：需要它对最近工作有完整记忆时才值得新开。

### 二、查这个问题时发现的两个真实缺陷

发送侧的实际逻辑（`taskhive-codex-model/dsh/index.js` 的 `newestMessagesForPrompt`）：

```js
const isCurrentCodesysTask = sourceIndex === latestUserIndex && isCodesysContextMessage(message)
const content = isCurrentCodesysTask ? readCodesysTaskContext(message) : textForPrompt(message)
if (isCodesysContextMessage(message) && !isCurrentCodesysTask) continue   // 更早的同类消息整条跳过
```

也就是说：**当前这条带 `<taskhive-codesys-context>` 的消息会被替换成"从磁盘读出的快照"**，更早的同类消息整条丢掉。

**缺陷 A（每回合都发生）**：`readCodesysTaskContext` 只返回快照，**丢掉用户自己的话**。模型拿到工程快照，却不知道要它做什么——连"审核当前打开的对象「PRG_1」"里的对象名都没有。

**缺陷 B（尺寸相关，更严重）**：文件守卫是 `stat.size > 64 * 1024`——**字节**数；而客户端按 **28,000 字符**截断。CJK 在 UTF-8 下 **3 字节/字符**，中文注释密集的工程快照可达 60–84 KB → 守卫成立 → `return ''` → 上层 `if (!content) continue` → **当前这一回合连同用户命令被整条丢掉**，模型收到的是一段"没有任何人提问"的提示词。这正是"点了 AI 审核像是没反应／答非所问"的直接原因，而且它在小工程/英文注释下正常、在中文大工程上失效——最难排查的一类。

### 三、修改

| 文件 | 改动 |
|---|---|
| `plugins/installed/taskhive-codex-model/dsh/index.js` | **缺陷 A**：先从消息文本里摘出用户的话（`raw.replace(CODESYS_CONTEXT_TAG,'')`），以 `USER REQUEST: …` 拼在**最前面**——整段之后还会被保头部的 `clipped()` 截断，放最前面才保证一定存活；新增 `PROMPT_BUDGET.taskCommandChars = 2000` |
| 同上 | **缺陷 B**：新增 `CODESYS_CONTEXT_MAX_CHARS = 40000`（与客户端同口径的**字符**判定）与 `CODESYS_CONTEXT_MAX_BYTES = 512 * 1024`（仅作粗上限）；并且**所有失败路径都返回命令文本而不是 `''`**——包括路径校验失败、文件过大、JSON 解析失败，都不允许把整个回合变空 |
| `plugins/installed/taskhive-surfaces/dsh/client.js` | **底部联动指示**：状态行最前面新增 `.taskhive-codesys-linkstate`，显示 `● 已联动到会话 <前8位>` / `○ 未连接会话`，`data-codesys-linkstate=linked|unlinked`，完整会话 id 与待确认数量放在 `title`；新增 `codesysSessionLabel()`；新增 `@container (max-width:439px)` 窄栏只留圆点 |
| `tests/prompt-budget-contract.js` | 新增 6 条检查（含**实测 72KB > 旧 64KB 上限**的 CJK 快照用例） |
| `tests/codesys-workbench-compact-layout-contract.js` | 新增 6 条断言锁住底部联动指示 |

### 四、T090 验证证据

| 日期 | 检查 | 结果 | 证据 |
|---|---|---|---|
| 2026-09-15 | `node --check plugins/installed/taskhive-codex-model/dsh/index.js` | 通过 | exit 0 |
| 2026-09-15 | `node --check plugins/installed/taskhive-surfaces/dsh/client.js` | 通过 | exit 0 |
| 2026-09-15 | `node tests/prompt-budget-contract.js` | 通过（25/25） | 其中 `a CJK-heavy snapshot is not rejected for its byte size` 的实测字节数为 **>64KB**——用例第一次只造出 60,122 字节（未越过旧上限），把 CJK 重复次数从 4000 提到 4800 后才真正覆盖该分支 |
| 2026-09-15 | `node tests/context-budget-contract.js` / `context-window-contract.js` | 通过 | 适配器改动未破坏既有预算与窗口合同 |
| 2026-09-15 | `node tests/codesys-workbench-compact-layout-contract.js` | 通过 | 底部联动指示 6 条断言通过；顶栏预算仍为 `567/620, 354/380, 276/340, 227/280` |
| 2026-09-15 | 渲染树扫描 | 通过 | 根节点仍 6 个子节点；statusrow 内为 linkstate + status + safety |
| 2026-09-15 | `node tests/run-contracts.js` | **1 项与本轮无关的失败** | 仅 `model-routing-contract.js:17`（用户的模型可见性状态，见 T083"无关失败说明"）；其余全部通过 |

### 五、T090 待办（需真实界面验收）

1. **点 `AI 审核` 后，模型必须既知道"要它做什么"也知道"工程长什么样"**——请特别验证**中文注释较多的工程**（旧实现在这类工程上会把整条消息丢掉）。
2. 底部那一行应显示 `● 已联动到会话 <短 id> · <状态文字> · ⓘ 安全边界`；悬停圆点可看到完整会话 id。切换会话后短 id 应随之变化。
3. 没有活动会话时显示 `○ 未连接会话`。
4. 侧栏窄于约 456px 时，会话号应收缩、只留 `●`/`○`，状态文字仍可读。
5. 真实验收前不得把本任务改为"已验证"。

## T091 左侧栏 TaskHive 品牌消失的根因修复

### 现象

> "我的程序现在左侧栏把 taskhive 图标和文字丢失了，再次打开就会恢复，但是为什么会消失？"

### 根因（代码级）

TaskHive 的品牌不是它自己的组件，而是在 DSH 侧栏 DOM 里**注入**的：

- 图标写进 `[data-slot="sidebar.brand.mark"]`，并把 DSH 原来的品牌节点用 `display:none !important` **藏起来**（代码注释写明：绝不能删除，删了会破坏 React reconciliation，整个侧栏会挂）；
- 文字是 `slot.innerHTML = '<span data-taskhive-brand-wordmark="true">TaskHive</span>'`。

**重新注入只有两个触发点**：启动后的三次一次性重试 `[1200, 3000, 6000]`（早已用完），以及 `MutationObserver` 里的 `reconcileSidebarBrand()`。而那个观察者的循环：

```js
for (const mutation of mutations) {
  if (mutation.type === 'attributes') { ...; continue }
  for (const node of mutation.addedNodes) { ... }   // ← 只看「新增」
}
```

**从来没有看过 `removedNodes`。** 于是：

1. React 重渲染品牌区（折叠/展开侧栏、布局变化等）；
2. React **丢掉它不认识的那个子节点**——也就是我们注入的 `<img data-taskhive-brand-mark>` / `TaskHive` span；这次 childList 变更里**只有 `removedNodes`，没有 `addedNodes`**；
3. 循环不看 `removedNodes` → `reconcileSidebarBrand()` 不会被调用；
4. DSH 原来的品牌节点是**被 React 复用的**，它身上还留着我们上次加的 `display:none !important`；
5. 结果：**槽里什么都没有 → 图标和文字一起空掉**。

"再次打开就恢复"也由此解释：任何**有新增节点**的渲染会命中 `addedNodes` 分支 → 触发一次 reconcile → 品牌被重新注入。

### 修改

| 文件 | 改动 |
|---|---|
| `plugins/installed/taskhive-surfaces/dsh/client.js` | 观察者新增 **`removedNodes`** 分支：`isOurBrandNode()` 识别四类注入标记（`-brand-mark` / `-brand-wordmark` / `-brand-text` / `-brand-icon`），配合 `brandTouched()` 覆盖"品牌区域内的移除"；命中就 `reconcileSidebarBrand()` 并把 scrub **限制在品牌行**（`[class*="logoRow"]`），**绝不升级为 whole-document scrub**（那是 T029/T037 修掉的性能回归） |
| 同上 | 新增 `resize` 与 `visibilitychange` 上的 `reconcileSidebarBrand`（折叠/展开是布局变化，观察者看不到"React 同时保留槽与 vendor 子节点"的重排）；并在 `__TASKHIVE_SKIN_DISPOSE__` 里解绑，避免泄漏 |
| 同上 | 两个品牌槽由 `querySelector` 改为 **`querySelectorAll`**：展开头部与折叠轨可能同时在 DOM 里，旧写法只品牌化第一个，另一个继续显示 vendor 图标 |
| 同上 | `ensureSidebarBrandMark` 改为"**每轮都重新隐藏 vendor 子节点**，只有确实缺少我们的节点时才插入"——旧写法在"我们的图标已在"时早退，会漏掉"React 新建了一个可见的 vendor 子节点"这种情况 |

### T091 验证证据

| 日期 | 检查 | 结果 | 证据 |
|---|---|---|---|
| 2026-09-15 | `node --check plugins/installed/taskhive-surfaces/dsh/client.js` | 通过 | exit 0 |
| 2026-09-15 | `node tests/skin-performance-contract.js` | 通过 | 新增 9 条断言：必须响应 `removedNodes`、必须认识四个品牌标记、resize 监听必须注册且被 dispose、removal 分支不得出现 `scheduleScrub(document)`、两个槽必须 `querySelectorAll` |
| 2026-09-15 | 渲染树扫描 | 通过 | 工作台根节点仍 6 个子节点 |
| 2026-09-15 | `node tests/run-contracts.js` | 1 项与本轮无关的失败 | 仅 `model-routing-contract.js:17`；`session records purge contract passed` 与 `skin performance contract passed` 均在套件内通过 |

### T091 待办（需真实界面验收）

1. 折叠再展开左侧栏（或改变窗口大小）多次：TaskHive 图标与 `TaskHive` 文字**不得消失**。
2. 反复切换会话、开关插件标签后再看左侧栏：品牌应始终在。
3. 观察是否还有**vendor（DeepSeek）图标**在任一折叠态下露出来。
4. 真实验收前不得把本任务改为"已验证"。

## T092 会话记录：真删除并回收磁盘

### 事实（决定了为什么必须自己在文件层做）

- DSH 的会话行菜单只有三项：`重命名` / `分叉会话` / **`归档会话`**（`dsh-client-ui-workspace/lib/client.js:933`，locale key `menu.archiveSession`）；
- 在所有 DSH UI 包里搜 `deleteSession` / `removeSession`：**0 命中**——它没有删除 API；
- 「归档」的语义：侧栏行消失、**记录文件与磁盘占用保留**（T032 已验证）；
- 实测存储布局：`<DSH home>/sessions/<工作区分桶>/<会话 id>/session.v3.jsonl.zstd`，会话目录名就是会话 id；
- 本机现状：`C:\Users\29925\.dsh\sessions` 下 4 个工作区分桶，其中任务工作区分桶 **21 个会话 / 18.22 MB**。

### 修改

| 文件 | 改动 |
|---|---|
| `plugins/installed/taskhive-surfaces/dsh/index.js` | 新增 `dshSessionsRoot()`（尊重 `DSH_HOME` / `DSH_CONFIG_HOME`，否则 `~/.dsh/sessions`）、`listSessionRecords()`、`purgeSessionRecords()`；在受信任的 `/taskhive/api` 前缀下新增 `sessions.list` / `sessions.purge` 两个 POST 方法（`purge` 缺 `confirm:true` 直接 400 `confirmation-required`）；三个纯函数导出给合同测试 |
| 同上 | **五条硬性安全约束**（不依赖调用方自觉）：① 每次删除都对目标取 `realpathSync` 并校验仍在 sessions 根的 realpath 之内（防符号链接/联接点逃逸）；② 分桶名与会话 id 必须是单层名字（不得含 `/`、`\`、`:`，不得是 `.`/`..`）；③ 目标目录里必须真的存在 `session.v3.jsonl*`；④ 拒绝调用方声明的**当前活动会话**（DSH 可能持有写句柄）；⑤ 必须显式 `confirm:true` |
| `plugins/installed/taskhive-surfaces/dsh/client.js` | 新增 `sessionRecordsApi()` 与 `SessionRecordsPanel`：按工作区分组列出会话（短 id / 最后修改时间 / 占用）、全选与取消、**当前会话不可勾选**（行上标注"当前会话"）、破坏性操作前 `window.confirm`、执行时**先对每个会话调用官方 `uiWorkspace.archiveSession()`**（让 DSH 列表干净摘行，失败也不阻断）**再**调 `sessions.purge` 删文件，最后显示回收量与总数并重新加载 |
| 同上 | 通过官方 `service.registerTab` 注册为「会话记录」标签（`id: 'taskhive:sessions'`, order 9, 常显）——**不注入 DSH 的 React 菜单**：那正是 T091 刚修完的那类脆弱做法 |

### T092 验证证据

| 日期 | 检查 | 结果 | 证据 |
|---|---|---|---|
| 2026-09-15 | `node --check` 两个文件 | 通过 | `index.js` / `client.js` 均 exit 0 |
| 2026-09-15 | `node tests/session-records-purge-contract.js` | 通过 | 在临时 `DSH_HOME` 上**真实执行删除**：列表只认含 `session.v3.jsonl*` 的目录；5 种越界名字（`..` 作会话名、`..` 作分桶名、`a/b`、`a\\b`、`C:`）全部被 `invalid-name` 拒绝且**根外旁证文件存活**；当前活动会话被 `active-session` 拒绝且文件仍在；无日志目录被 `not-a-session-directory` 拒绝且内容未动；合法目标被删除、`freedBytes === 4096`、另一会话不受影响；根目录缺失时拒绝删除 |
| 2026-09-15 | `node tests/run-contracts.js` | 套件内 `session records purge contract passed` | 全套仅 1 项与本轮无关的失败（`model-routing-contract.js:17`） |

### T092 待办（需真实界面验收）

1. 侧栏应出现「会话记录」标签：分组列出会话、显示占用与总占用、当前会话标注且不可勾选。
2. 勾选若干**非当前**会话 → 点「彻底删除」→ 确认框写明"不是归档、无法撤销" → 执行后应显示回收量，列表刷新，磁盘占用下降（可用资源管理器核对 `C:\Users\29925\.dsh\sessions\...`）。
3. 被删的会话应从 DSH 原生侧栏消失（官方归档步骤生效）；若仍看到幽灵行，刷新页面即可。
4. **当前正在对话的会话必须无法被删除**（勾选框禁用 + 即使绕过也由宿主拒绝）。
5. 真实验收前不得把本任务改为"已验证"。

## T093 会话行「…」菜单里的「彻底删除」

### 用户要求与我的错判

> "你的删除会话功能放在哪里了？我要的效果是点击会话的…会出现一个删除选项"

T092 我把入口做成了一个「会话记录」标签（列出全部会话 + 勾选删除），但用户要的是**在会话行的 `⋯` 菜单里出现删除项**。这一点我判断错了——不是把功能做出来就行，入口必须在他实际使用会话列表的地方。

### 为什么这里没有官方扩展点（先做的取证）

| 检查 | 结果 |
|---|---|
| 会话菜单项从哪来 | `dsh-client-ui-workspace/lib/client.js:933` 里**写死**的 `sessionMenuItems = [rename, fork, archive]`，由 `onSelect(id)` 分派 |
| 那个包声明了哪些插槽 | `contract/slots.d.ts` 只有 `sidebar.workspaces`（整个浏览区）与两个 `directoryFlow` 空洞——**没有会话菜单的任何扩展点** |
| 会话行的 DOM 有没有 id | **没有**。行是 `div[role="treeitem"][class*="sessionRow"]`，只有 `aria-selected` 与哈希类名；会话 id 只出现在 `onDragStart` 的 `dataTransfer.setData('text/plain', node.id)` 里 |
| 菜单是不是专用组件 | 不是。`Menu` 是共享原语，工作区菜单（`workspaceMenuItems`）用的是同一个，所以不能对任意 `[role="menu"]` 注入 |
| 有没有会话标题可用来定位 | 有：`sessions.list.getSnapshot().byId[id]` 是 `SessionSummary`，含 `title?`、`displayTitle`、`running`、`blank` |

结论：**只能注入 DOM**，而且必须靠"行标题 → 会话 id"的唯一匹配来定位目标。

### 修改

| 文件 | 改动 |
|---|---|
| `plugins/installed/taskhive-surfaces/dsh/index.js` | `purgeSessionRecords` 允许目标**只给 `session`**（会话行的菜单拿不到工作区分桶）：在全部桶里扫描该 id，**必须唯一命中**，否则以 `ambiguous-session` / `session-not-found` 拒绝——猜错就是删错一个不可恢复的会话 |
| `plugins/installed/taskhive-surfaces/dsh/client.js` | `installTaskHiveSkin()` → `installTaskHiveSkin(ctx)`（注入需要 `ctx.sessions` 与 `ctx.uiWorkspace`）；新增 `sessionMenuDelete` 状态与四个函数：`sessionSummariesById()`、`resolveSessionByRow()`、`injectSessionDeleteMenuItem()`、`runSessionDeleteFromMenu()`，以及一个**捕获阶段**的 `click` 监听 `rememberSessionRow`（用点击上下文绑定"是哪一行"，与语言无关，也不依赖本地化的 aria-label） |
| 同上 | **不猜样式**：菜单里找到那个文字恰好是 `归档会话` / `Archive session` 的项（既是"这是会话菜单"的指纹，也是样式模板），`cloneNode(true)` 克隆它、把标签文字换成 `彻底删除`、挂上点击处理，插到归档项后面。结构、类名、悬停行为全部自动一致 |
| 同上 | **拒绝规则**（都在删除之前）：标题读不到 / 标题匹配 0 个或 **>1** 个 / `running === true` / 是当前会话 → 一律 `alert` 说明并取消，且提示可改用「会话记录」标签。确认框写明"这不是归档、无法撤销"；执行仍是**先官方归档、再删文件** |
| 同上 | 注入只在 `sessionMenuDelete.row` 非空时进行（即刚点过会话行），避免每次 scrub 都全文档查菜单；`click` 监听在 `__TASKHIVE_SKIN_DISPOSE__` 里解绑 |

### T093 验证证据

| 日期 | 检查 | 结果 | 证据 |
|---|---|---|---|
| 2026-09-15 | `node --check` 两个文件 | 通过 | `index.js` / `client.js` 均 exit 0 |
| 2026-09-15 | `node tests/session-records-purge-contract.js` | 通过 | 新增真实用例：只给会话 id 时唯一命中并删除（回收 1024B、回显解析出的分桶）；**同一 id 出现在两个分桶 → `ambiguous-session` 且两份都保留**；未知 id → `session-not-found`；另有 14 条静态断言锁住注入方式（按归档项指纹识别会话菜单、克隆而非新建、唯一匹配、运行中拒绝、当前会话拒绝、确认文案、同一条 `confirm:true` 路由、点击上下文绑定、dispose 解绑、只在点过行之后注入） |
| 2026-09-15 | `node tests/run-contracts.js` | 套件内 `session records purge contract passed` | 全套仅 1 项与本轮无关的失败（`model-routing-contract.js:17`） |

### T093 待办（需真实界面验收）——**这一项有明确的验证缺口**

⚠️ 注入部分是**依赖 DSH 运行时标记**的，我无法在静态环境里验证它。请按下面顺序确认：

1. 鼠标悬停会话行 → 点 `⋯` → 菜单里应出现 **`彻底删除`**（在「归档会话」下面，样式应与其它项一致）。
2. 点它：确认框应写明会话标题与"不是归档、无法撤销"；确认后应弹出"已删除会话「…」，回收 X MB"，并且该行从侧栏消失。
3. **如果菜单里看不到 `彻底删除`**：说明三个依赖之一不成立——菜单文案不是 `归档会话`/`Archive session`、行标题节点不是 `[class*="title"]`、或 `byId` 里没有 `displayTitle`。请把菜单截图/把行的 `⋯` 菜单打开后告诉我，我按真实标记调整。
4. **如果点了却提示"无法安全定位这个会话"**：这是**预期的安全行为**（标题重复或对不上），不是崩溃；此时请用「会话记录」标签删除。**绝不能为了让它"能用"而放宽唯一匹配**——那会删错会话。
5. 「会话记录」标签保留为**保底入口**：它的目标是会话目录名（id），不依赖任何 DSH 运行时标记，因此永远可用。
6. 真实验收前不得把本任务改为"已验证"。

## T093b 现场实测后的定位修复

### 实测结果（用户截图）

菜单项**注入成功**：会话行的 `⋯` 菜单里出现了 `重命名 / 分叉会话 / 归档会话 / 彻底删除`，且克隆来的项与其它项样式一致（图标、间距、悬停都跟着走）。点下去却弹出：

> 无法安全定位这个会话：标题不唯一，无法确定是哪一个会话。已取消删除；可在「会话记录」标签里删除。

也就是说：**注入这条路是对的，卡住的是"行 → 会话 id"的定位**，而且正好落在 T093 自己加的安全闸门上（这比删错会话好得多，但不能停在死胡同里）。

### 两个真实原因

1. **标题会真实撞车**：`byId[*].displayTitle` 并不唯一——像 `1`、`新会话` 这类标题可以同时对应多个会话，唯一匹配必然失败。
2. **标题读错了节点**：`row.querySelector('[class*="title"]')` 是**后代**选择器，而 `HoverCard` 的内容（`SessionHoverContent`，里面也有标题/预览）与行挂在同一个容器里，所以读到的可能是**悬浮卡片的预览文字**，而不是这一行的标题。

### 修改

| 改动 | 说明 |
|---|---|
| **先走精确通道**：`probeSessionIdByDrag(row)` | DSH 的会话行**只在 `onDragStart` 里**把 `node.id` 写进 `dataTransfer`（`setData('text/plain', node.id)`），DOM 上没有任何 id 属性。现在合成一次 `dragstart` → 读 `transfer.getData('text/plain')` → 立刻派发 `dragend` 收尾，从而**完全不依赖标题**拿到精确 id；拿到后还要在 `byId` 里验证存在才使用 |
| **标题只作退路**，且读法收紧 | 改为遍历 `row.children`，只认**直接子节点**里类名含 `title` 的那个（`sessionRowTitle()`），彻底避开 HoverCard 的预览文字 |
| **拒绝时不再留死胡同** | 安全闸门命中时，除了说明原因与匹配数量，还会**自动打开「会话记录」标签**（`installTaskHiveSkin(ctx, openSessionRecordsTab)`，由 `service.openTab` 提供）——那条路按会话目录名（id）操作，不依赖任何 DSH 运行时标记，永远可用 |
| 拒绝文案更具体 | `标题「X」同时对应 N 个会话` / `标题「X」对不上任何会话记录`，便于现场判断 |

### T093b 验证证据

| 日期 | 检查 | 结果 | 证据 |
|---|---|---|---|
| 2026-09-15 | `node --check plugins/installed/taskhive-surfaces/dsh/client.js` | 通过 | exit 0 |
| 2026-09-15 | `node tests/session-records-purge-contract.js` | 通过 | 新增 9 条断言：必须存在 `probeSessionIdByDrag`、必须合成 `dragstart` 且读 `text/plain`、必须补发 `dragend`、探测到的 id 必须在 `byId` 里验证、标题退路必须是**直接子节点**且按类名匹配 title、拒绝路径必须调用 `openSessionRecordsTab`、skin 必须收到 tab opener |
| 2026-09-15 | `node tests/run-contracts.js` | 套件内 `session records purge contract passed` | 全套仅 1 项与本轮无关的失败（`model-routing-contract.js:17`） |

### T093b 待办（需真实界面验收）

1. 重启后再点会话 `⋯` → `彻底删除`：这次应直接进入确认框（不再报"标题不唯一"），确认后弹出回收量且行消失。
2. 若**仍**报"无法安全定位"：说明该构建里 `onDragStart` 未启用（`drag === undefined` 时 React 不会挂这个处理器）或 `DataTransfer` 构造被拒。请把弹出的文案发我——现在会写明是"读不到这一行的标题"、"同时对应 N 个会话"还是"对不上任何会话记录"，据此可以精确判断该走哪条路。
3. 点「确定」后应**自动切到「会话记录」标签**，那里可按大小/时间精确删除。
4. 真实验收前不得把本任务改为"已验证"。

## T094 现场实测修复：日志版本、删除顺序、应用内对话框

### 实测结果（用户截图 + 直接探测运行中的客户端）

截图里：会话行确实从侧栏消失了，但弹出 **"删除失败：宿主路由不可用。"** ——也就是说**界面看起来删掉了，磁盘一点没回收**（消失的是官方归档那一步的效果）。

为了不再猜，我直接探测了**运行中的 TaskHive**（`127.0.0.1:50955`，只读 POST）：

```
POST /taskhive/api/sessions.list  -> HTTP 200
{"root":"C:\\Users\\29925\\AppData\\Roaming\\TaskHive\\runtime\\profiles\\dsh\\sessions",
 "exists":true,"workspaces":[],"totalBytes":0,"sessionCount":0}
```

**路由是通的，根目录也对（应用自己的 DSH profile），但它报告 0 个会话。** 于是逐层查下去：

| 检查 | 结果 |
|---|---|
| 应用真实会话根 | `%APPDATA%\TaskHive\runtime\profiles\dsh\sessions`（DSH_HOME 就是这个），下面 5 个分桶 |
| 我此前引用的 `~\.dsh\sessions`（18.22 MB） | **不是应用的存储**，那是 CLI/npm profile 的库。**我此前把回收量报大了，实际应用库只有约 0.93 MB** |
| 会话目录里的日志文件名 | 应用写 **`session.v2.jsonl.zstd`**；CLI 写 `session.v3.jsonl.zstd` |
| 我的匹配规则 | `/^session\.v3\.jsonl(?:\.zstd)?$/i` —— **只认 v3** |

**根因**：日志版本号不是固定的，只认 v3 会让应用真实的会话**一个都找不到**（`sessionLogNames` 返回空 → 整个目录被当成 `not-a-session-directory`）。而 `archive` 那一步是**先执行**的，所以行消失了、文件还在——正是截图里那个自相矛盾的状态。顺带暴露两个问题：`window.alert/confirm` 是浏览器原生弹窗（用户明确说不要），以及"宿主路由不可用"这个提示在没有响应时指向了错误的原因。

### 修改

| 文件 | 改动 |
|---|---|
| `plugins/installed/taskhive-surfaces/dsh/index.js` | `sessionLogNames` 的匹配改为 **`/^session\.v\d+\.jsonl(?:\.zstd)?$/i`**：接受任意版本号（应用 v2 / CLI v3 都覆盖）。注释里写明版本号不固定这个事实 |
| `plugins/installed/taskhive-surfaces/dsh/client.js` | **顺序改为先删文件、后归档**（会话记录面板与菜单两条路都是）：只有**确实删掉了文件**的会话才会被 `archiveSession` 摘行——这样"行消失"就等价于"磁盘已回收"，不会再出现截图里那种假象 |
| 同上 | 新增 `showTaskHiveDialog()` / `noticeDialog()`：**应用内对话框**，样式沿用主进程关闭确认框同一组 `--dsw-alias-*` 令牌（8px 圆角、1px 边框、同一字体与间距），带 `role="dialog" aria-modal="true"`、焦点管理、Esc 取消、点遮罩取消。**插件里已无任何 `window.alert` / `window.confirm`** |
| 同上 | 删掉/覆写门径的提示全部改为说明**具体原因**：路由不可用时明确写"宿主插件可能还是旧版本，请重启 TaskHive"；删除失败时给出 `skipped` 原因并指路「会话记录」标签；当前会话、无法定位等各有自己的标题与解释 |
| 同上 | CODESYS 工作台的「一键回退到绑定基线」也一并改用应用内对话框（同一类原生弹窗） |

### T094 验证证据

| 日期 | 检查 | 结果 | 证据 |
|---|---|---|---|
| 2026-09-15 | `node --check` 两个文件 | 通过 | `client.js` / `index.js` 均 exit 0 |
| 2026-09-15 | **对应用真实存储的只读复核** | **修复有效** | 用 `DSH_HOME=%APPDATA%\TaskHive\runtime\profiles\dsh` 直接调用 `listSessionRecords()`：`sessions = 76`、`totalBytes = 0.93 MB`（`C\Users\29925\Documents` 23 个 / `…\harness\default` 53 个）。**修复前同样的调用返回 0 个** |
| 2026-09-15 | `node tests/session-records-purge-contract.js` | 通过 | 新增用例：`session.v2.jsonl.zstd` 必须被列出**且可删**（回收 2048B）；另有断言锁住"必须接受任意 `session.v<N>`"、"不得再出现 `window.alert(`/`window.confirm(`"、"归档只能针对**已删文件**的会话"（两条反向断言防止顺序回退）、"路由不可用必须给出准确解释" |
| 2026-09-15 | `node tests/run-contracts.js` | 套件内 `session records purge contract passed` | 全套仅 1 项与本轮无关的失败（`model-routing-contract.js:17`） |

### T094 待办（需真实界面验收）

1. **重启 TaskHive**（宿主插件也要一起重载；只刷新页面不够），打开「会话记录」标签：应能看到 **76 个会话**（此前是 0 个），并显示总占用约 0.93 MB。
2. 在会话行的 `⋯` 里点 `彻底删除`：**弹窗应是 TaskHive 自己的样式**（不是浏览器那种灰色小框），确认后应报出具体回收量，并且**只有文件真被删掉的会话才会从侧栏消失**。
3. 若提示"未能删除：<原因>"：说明文件没被动过、行也不该消失——把这个原因发我（`active-session` / `session-not-found` / `delete-failed: …` / `ambiguous-session`）。
4. 注意：**磁盘回收量比原先说的小得多**（应用库约 0.93 MB）。`~\.dsh\sessions` 那 18 MB 属于 CLI profile，应用不使用它；如需清理那部分，我可以另做（但需你确认那是你不用的 profile）。
5. 真实验收前不得把本任务改为"已验证"。

## T095 确认框只说确认 + 会话记录面板重做外观

### 用户口径

> "删除会话界面做的太粗糙了，而且只需要提示确认删除就行，不要有无关文本"

### 修改

| 改动 | 说明 |
|---|---|
| **确认框只问确认** | 菜单路径：`删除会话` / 「确认删除「X」？」/ 按钮 `删除`；面板路径：`删除会话记录` / 「确认删除选中的 N 个会话？」/ 按钮 `删除`。删掉了"这不是归档：会话日志文件会被真正删除，无法撤销"「先调用官方归档…存储根目录：…」这类无关文案 |
| **拒绝与结果提示压成一句** | `无法删除` / 「无法定位该会话（<原因>），已取消。」；`无法删除` / 「这是当前打开的会话。」；`删除失败` / 「宿主未响应，请重启 TaskHive 后重试。」；`未删除` / 「<原因>。」；`已删除` / 「回收 X。」。回退基线的确认同样只剩「确认恢复到本次绑定时的基线？」 |
| **面板重做外观** | 不再用内联样式硬拼：注入一份 `#taskhive-sessions-style`，令牌沿用 `--dsw-alias-*`。结构改为「头部（标题 + 统计/状态 + 工具按钮）／可滚动列表（分工作区分组卡片）／底部操作栏（已选 N 个 · X MB + 彻底删除）」。新增**行 hover、选中高亮、按钮 focus-visible 焦点环**、当前会话徽章、空状态、错误条 |
| **去掉正文里的噪声** | 存储根目录从正文段落改为统计文字的 `title` 悬浮提示 |
| 顺手修掉 | 面板与 `publishCodesysWorkbenchMirror` 之间被误删的换行（此前两行被拼在一起） |

### T095 验证证据

| 日期 | 检查 | 结果 | 证据 |
|---|---|---|---|
| 2026-09-15 | `node --check plugins/installed/taskhive-surfaces/dsh/client.js` | 通过 | exit 0 |
| 2026-09-15 | `node tests/session-records-purge-contract.js` | 通过 | 新增 12 条断言：确认文案必须只剩确认（两条）、`这不是归档` 必须消失、拒绝提示必须是短句、存储根目录必须进 `title`、必须存在 `installSessionPanelStyle` 与 `data-taskhive-sessions`、行必须暴露选中态、必须有独立操作栏、样式表必须定义 hover / 选中 / focus-visible |
| 2026-09-15 | `node tests/run-contracts.js` | 套件内 `session records purge contract passed`、`skin performance contract passed` | 全套仅 1 项与本轮无关的失败（`model-routing-contract.js:17`） |

### T095 待办（需真实界面验收）

1. 会话行 `⋯` → `彻底删除`：弹窗应只问「确认删除「X」？」，**没有任何解释性段落**。
2. 「会话记录」标签：分组卡片、行悬停有反馈、勾选后有高亮与底部「已选 N 个 · X MB」、删除按钮只在有选择时可用；键盘 Tab 能看到焦点环。
3. 真实验收前不得把本任务改为"已验证"。

## T096 CODESYS 工作台在线功能（扫描 / 登录 / 断开 / 下载 + 在线变量）

> 登记说明：这条工作线发生在 2026-09-20 14:00 → 2026-09-21 11:13，**当时没有登记进本清单**
> （本清单最后一次写入是 09-20 14:40）。本节按会话日志、文件时间戳、探针脚本与合同测试补登记，
> 只写有据可查的部分。

### 用户口径

> 「codesys 代码工作台在线功能都有什么，全功能都有什么」
> 「先实现功能 123，我测试成功之后再实现其他功能，给我方案确认开始工作」
> 「登录到 plc 之后，我的项目树和代码编辑器是不是可以和 codesys 一样显示在线数据？如果不能显示我登录有什么意义？」
> 「这个功能是我配置吗？不应该是和 codesys 一样直接搜索 plc 设备」
> 「扫描设备是不是单独按钮，未连接这个状态提示不需要，我登录到设备登录变成绿色醒目标识提示我登录就可以了」
> 「扫描设备除了刚刚扫出来的信息，能不能扫到设备 ip」
> 「把代码工站台缩短为工作台，把离线工程字样删除，把所有功能都放在第一行，宽度合适显示文字，宽度宽缩短为图标」
> 「暂时不需要这些额外的功能，先做 3 在做 2，ip 直连这个功能支持吗？」
> 「我 codesys 的网关是不是被插件占用了，现在插件能插到设备，我的 codesys 软件看不到东西」

### 交付内容

| 能力 | 落点 |
|---|---|
| 十二项 PLC 在线能力的盘点与定型：9 项可实现、3 项（debug / breakpoint / step）在本版本 ScriptEngine **没有任何 API** | `app/codesys-online-authorization.js`、`plugins/installed/codesys-monitor/scriptengine.cjs` |
| 会话绑定授权：一次点击手势同时开启授权；授权绑定**一个工作台窗口 + 一个工程文件**，切工程 / 关工作台 / 关 CODESYS 窗口即失效；危险动作（写变量 / 复位 / 强制）额外要求逐字确认词 | 同上 + `app/main.js` 的 `codesys:online-*` IPC |
| 常驻在线进程：第一次在线动作启动一个 `--noUI` worker，打开工程副本后用命令文件 + 编号结果文件服务后续动作（登录态活在 CODESYS 进程里，进程退出连接就没了） | `plugins/installed/codesys-monitor/online-session.cjs` |
| 扫描设备：独立按钮 + 独立弹窗，先列网关上次记录的设备再跑实时广播，可扫到设备 IP；已连接时禁用 | `client.js` 的扫描弹窗、`do_scan` |
| IP 直连：`set_gateway_and_ip_address` 纯字符串重载（API 有 8 个重载，**没有 getter**，所以界面上如实写明"设完读不回来"） | `do_set_target` + 目标选择弹窗 |
| 工作台顶栏一行动作：登录 / 断开 / 下载 永远渲染（只按状态置灰）、低频操作图标化 + 容器查询分档、绿色"在线"徽标 | `client.js` + `taskhive-workbench-compact-layout` 合同 |
| 在线变量（声明区逐行值） | T097，见下 |

### 安全模型（三层，缺一不可）

1. **能力层**：只有 `login / logout / download / online-change / write-variable / start / stop / reset / force` 可授予；`debug / breakpoint / step` 连 API 都不存在。授权是会话绑定的，不是计时器。
2. **动作层**：`start / stop / reset / write-variable / force` 作用在应用层，必须先有一次**传输型登录**（下载或在线修改）——那一步才确认过设备里跑的就是当前工程。
3. **确认层**：写变量 / 复位 / 强制要逐字输入确认词（`写入变量` / `复位设备` / `强制变量`），取消强制故意不设锁（摘掉 Force 是安全方向）。

### 关键事实：`OnlineChangeOption` 的四种取值（来自 CODESYS 官方 ScriptEngine 帮助原文）

`hh.exe -decompile` 解出的 `ScriptEngine.chm` → `T__3S_CoDeSys_OnlineUI_OnlineChangeOption.htm`：

| 值 | 官方原文 | 含义 |
|---|---|---|
| `Never` 0 | "Online change shall never be performed. **In that case a full download is forced.**" | 强制**完整下载**（= 我们的「下载」） |
| `Try` 1 | "Online change shall be tried. If not possible, a full download shall be performed." | 先在线修改，否则下载（= 我们的「在线修改」） |
| `Force` 2 | "Online change shall be forced. If not possible, the action is terminated with no change." | 不在允许范围，合同禁止出现 |
| `Keep` 3 | "**Try to login. Do not online update. Do not download. Keep as it is.**" | 只登录、不下载、不修改（= 「登录」必须用这个） |

> ⚠️ 这条必须留在清单里：**`login()` 本身就是"要不要传输程序"的开关**。用 `Never` 做「登录」，
> 点一次就会把当前工程完整下载进设备（机械会停）。T097 之前的设计正是因为怕误下载，才让
> 「登录」只做 `connect()`——代价就是登录了也读不到任何在线值。

### T096 验证证据

| 日期 | 检查 | 结果 | 证据 |
|---|---|---|---|
| 2026-09-20/21 | `node tests/codesys-online-gate-contract.js` | 通过 | 九项能力接通、三项无 API 能力不得有任何路径、授权/硬门控/审计 |
| 2026-09-20/21 | `node tests/codesys-workbench-compact-layout-contract.js`、`codesys-workbench-ui-contract.js`、`codesys-workbench-link-contract.js`、`codesys-project-tree-contract.js`、`codesys-scriptengine-recovery-contract.js` | 通过 | 顶栏宽度预算、扫描弹窗、树与联动 |
| 2026-09-20 | 只读探针（`cache/online-probe/`） | 完成 | `step0_reflect.py` / `step0b_members.py` / `step0c_device.py` 反射 API；`worker-check.py`；`ip-direct-probe.py`；`reachability-probe.js`；`live-status-check.js` |
| 2026-09-21 | `node tests/run-contracts.js` | 通过 | 35 项合同 exit 0（`cache/online-probe/contracts17.log`） |

### T096 待办（需真实界面验收）

1. 「扫描设备」独立弹窗：先出缓存列表、再跑实时广播；已连接时按钮置灰。
2. 顶栏一行内：登录 / 断开 / 下载 永远在，宽度够时显示文字、窄栏退化为图标。
3. IP 直连：填写 IP + 端口 → 应用 → 点「登录」验证（**IP 模式没有读回接口**，界面上已写明）。
4. 真实验收前不得把本任务改为"已验证"。

## T097 修复「登录上了却看不到在线变量」与「有延迟卡顿」

### 用户口径

> 「我已经网线直连设备，但是不能登录」
> 「有延迟卡顿，现在登录上了，但是不显示在线变量状态，这个是还没有做还是不能实现？」

### 根因（两条，都是实现缺陷，不是"做不到"）

| # | 根因 | 位置 |
|---|---|---|
| 1 | 「登录」只做 `onlineDevice.connect()`，**从不登录到应用**，于是 `is_logged_in` 始终为 `false`；而读在线值的前置条件正是它 | `online-session.cjs` 的 `do_login` / `do_monitor` |
| 2 | 界面把整段取值轮询挂在 `isLoggedIn === true` 上，于是**那段代码从上线起一次都没跑过** | `client.js` 的在线变量 effect |

顺带查出第三个隐患：即使登录修好，`permit` 这类 **PROGRAM 的局部量**在应用作用域里必须写成 `Jog.permit` 才读得到（实测裸名报"无效的表达式"），而界面此前一律发裸名。

### 修改

| 文件 | 改动 |
|---|---|
| `plugins/installed/codesys-monitor/online-session.cjs` | `do_login` 改为 **`connect()` + `login(OnlineChangeOption.Keep, False)`**：官方语义是"只登录、不下载、不在线修改"，既让 `is_logged_in` 变真，又**在协议层不可能**把程序写进设备。登录失败单独报 `applicationLoginError`，不掩盖"设备已连接"这个事实 |
| 同上 | 新增 `loginMode`（`keep` / `transfer`）：`download`、`online-change` 标记为 `transfer`，`logout` 清空；`status` 里带回界面 |
| 同上 | `require_logged_in()` 改为**只认传输型登录**：Keep 会话够读在线变量，但启停/复位/写变量/Force 仍必须先「下载」或「在线修改」（那时才确认过设备里跑的是当前工程）——原有安全姿态不变 |
| 同上 | 变量名解析：新增 `preferred_expression` / `expression_candidates` / `remember_expression`。先试限定名（`Jog.permit`），失败退回裸名（`HR_STATUS`），并把成功的写法记住供下一轮批量读使用；写变量 / 强制走同一条 `prepare_assignments`，定位失败**报错而不是静默跳过** |
| 同上 | 逐条读值加上限与时间预算（`MONITOR_PER_EXPRESSION_MAX = 24`、`..._BUDGET_SECONDS = 4.0`）：批量读失败时的 60 次往返会把串行命令队列占满，这正是"卡顿"的来源之一 |
| `plugins/installed/codesys-monitor/scriptengine.cjs` | `onlineMonitor(expressions, scope)` 把所选对象名透传给 worker |
| `app/main.js` | 在线监视改为按 **`login`** 能力授权（保留 `download` 作退路，老会话不受影响）；宿主自己校验 `loginMode`（不只信界面传来的 `loggedIn`）；把 `scope` 转交引擎 |
| `app/codesys-online-authorization.js` | `evaluateAppActionPreflight` 新增 `CODESYS_ONLINE_MONITOR_ONLY_LOGIN`：Keep 登录不得启停机械 |
| `plugins/installed/taskhive-surfaces/dsh/client.js` | ① 登录成功后明确提示「只登录、不传输；在线变量已开启」；② 危险动作在界面侧先挡住 Keep 会话；③ 取值轮询改为**单飞 + 值没变不重绘 + 慢读退避（1.5s→最多 6s）+ 页面不可见不读**；④ 声明区标题显示「在线值 / 在线中…」；⑤ 绿色徽标区分「在线」与「已连接」，并写明登录方式；⑥ 已连接时的状态探测 5s→8s 且不可见时不发 |
| `tests/codesys-online-gate-contract.js` | 新增断言：登录必须用 `Keep` 且登录函数体内不得出现 `Never` / `Try`；登录模式必须上报；应用层动作必须拒绝 Keep 会话；变量名两种写法都要试并记住；写/强制必须走解析；逐条读值必须有上限；界面必须单飞 / 去重 / 退避 / 不可见不读；`scope` 必须一路传到 worker |

### T097 验证证据（真实 PLC，GCAN-PLC-521C，全程只读：不下载、不修改、不写值、不强制、不启停）

`node cache/online-probe/keep-login-probe.js`（2026-09-21）：

```
[1] 会话就绪: true | 工程里配的目标: 0301.603A | 设备: Device_1 | 扫描名: GCAN-PLC-521C
[2] 登录(Keep): connected=true | isLoggedIn=true | loginMode=keep | 应用状态=已停止（STOP）
               | 标志=程序已加载·开机程序有效 | 耗时=29735 ms
[3] HR_STATUS="INT#107"  GVL.HR_STATUS="INT#107"  HR_SNAPSHOT_SEQ="INT#121"
    permit=""（无效的表达式）  Jog.permit="FALSE"   i=""（无效的表达式）  Jog.i="INT#0"
[5] 断开: 成功
```

`node cache/online-probe/scope-probe.js`（界面实际走的路径：带 `scope`）：

```
[1] 登录: isLoggedIn=true | loginMode=keep | 应用状态=已停止（STOP）
[2 Jog 第一轮] readMode=batch partial=false
      permit="FALSE"  i="INT#0"  HR_STATUS="INT#107"
[4 GVL 第一轮] readMode=batch partial=false
      HR_STATUS="INT#107"  HR_SNAPSHOT_SEQ="INT#121"
[5] 断开: 成功
```

| 日期 | 检查 | 结果 | 证据 |
|---|---|---|---|
| 2026-09-21 | `node --check` 四个改动文件 | 通过 | client.js / main.js / codesys-online-authorization.js / online-session.cjs 均 exit 0 |
| 2026-09-21 | `node tests/codesys-online-gate-contract.js` | 通过 | 新增 20 余条断言（见上表） |
| 2026-09-21 | `node tests/run-contracts.js` | 通过 | **35 项合同 exit 0**（`cache/online-probe/contracts17.log`） |
| 2026-09-21 | 真实 PLC 只读探针 ×2 | 通过 | 登录后 `isLoggedIn=true`、批量读到真值、零报错；`Keep` 未产生任何传输（应用状态与设备标志前后不变） |

### T097 待办（需真实界面验收）

1. **重启 TaskHive**（要重载 `app/main.js` 与插件；只刷新页面不够），然后：绑定工程 → 点「登录」。
2. 预期：顶栏绿色徽标出现「在线」，声明区标题出现绿色「在线值」，选中 POU 后**每行行尾显示该变量此刻的值**（值不变时不重绘）。
3. 点「断开」后徽标与在线值应同时消失。
4. 「有延迟卡顿」请在重启后复测：登录首次仍需 20–40 秒（要启动常驻在线进程，界面已有提示）；登录**之后**的编辑与滚动不应再有周期性卡顿。
5. 真实验收前不得把本任务改为"已验证"。

## T098 修复「扫描失败：EBUSY … online-worker.py」

### 用户口径

> 「扫描 PLC 设备 → 扫描失败：Error invoking remote method 'codesys:online-scan': Error:
> EBUSY: resource busy or locked, open
> '…\jobs\direct-1789962559760-4e86cd12\online\online-worker.py'」

（现场时间线：11:47 重启 TaskHive → 绑定工程 → 11:49:21 在线会话正常起来并答了 status →
点「扫描设备」→ EBUSY。）

### 根因

**"确保在线会话存在"这件事没有在途合并。**

`scriptengine.cjs` 的 `openOnlineSession` 是**先 `await session.start(...)`（20–40 秒）、成功之后才**
`this.onlineSession = session`。而调用它的入口有三个，彼此不知道对方在跑：

1. 绑定工程后"读目标"的后台准备（`client.js` 的 prepare effect）；
2. 「扫描设备」按钮（`main.js` 的 `codesys:online-scan` → `prepareOnlineSession`）；
3. 「登录」按钮（`runOnlineAction` → 会话不存在时自己 stop+open）。

于是这段窗口里第二次调用会认为"没有会话"，`stopOnlineSession('rebind')` 之后**再起一个
CODESYS 去写同一个目录**，而第一个 CODESYS 正把 `online-worker.py` 开着 —— Windows 直接
`EBUSY`。启动越久（20–40 秒）这个窗口越大，所以现场一点就中。

### 修改

| 文件 | 改动 |
|---|---|
| `plugins/installed/codesys-monitor/scriptengine.cjs` | 新增唯一入口 `ensureOnlineSession(job, timeoutMs)`：**同步占坑**（`this.onlineSessionPending`）再 await，同一个 job 的并发调用共享同一个启动 promise，绝不重复启动；`prepareOnlineSession` 与 `runOnlineAction` 都改走它，原来那段 `stopOnlineSession('rebind')` + `openOnlineSession()` 的裸序列已删除 |
| 同上 | 新增代数守卫 `onlineSessionGeneration`：启动期间若有人要求停止（例如点「释放在线会话」），那个刚起来的会话会被 `stop('superseded-start')` 收掉并抛 `CODESYS_ONLINE_START_SUPERSEDED`，不会变成一个谁也找不到的后台进程 |
| 同上 | 工程副本改为按运行令牌命名（`snapshots/online-session-<token>.project`）：CODESYS 会一直持有它打开的那份 .project，固定名字会在**同一个竞态**里换一个文件再 EBUSY 一次；启动时清掉上一轮遗留的副本 |
| `plugins/installed/codesys-monitor/online-session.cjs` | 运行令牌扩展到这个目录里**每一个**交换文件：worker 脚本 `online-worker-<token>.py`、命令/就绪/进度/停止文件也都带令牌。只给结果文件加令牌是不够的 —— 命令文件同名时，一个"上次崩溃没退干净、还在等命令"的旧进程会和新进程抢同一个命令文件，**同一条 login / download 会被执行两次** |
| 同上 | `stop()` 在 `child.kill()` 之后**再等一次退出**（有界）：杀进程是异步的，不等它落地，下一个会话就会去写/打开同一目录的文件 —— 这正是 EBUSY 的来源 |
| `tests/codesys-online-session-concurrency-contract.js` | 新增契约（36 项之一）：3 个并发 prepare 只起 1 个 worker；换 job 才重启；令牌覆盖所有交换文件；真的起两个会话时脚本名/命令文件/结果前缀必须不同；启动期间被停止 → 抛 SUPERSEDED 且那个会话被 kill；源码级禁止裸的 stop+open 序列回归 |

### T098 验证证据

| 日期 | 检查 | 结果 | 证据 |
|---|---|---|---|
| 2026-09-21 | `node tests/codesys-online-session-concurrency-contract.js` | 通过 | 用**假 CODESYS**驱动真实的 `ensureOnlineSession` + `CodesysOnlineSession.start()`：并发只起 1 个、令牌文件名互不相同、只留一份工程副本、被停止的启动会被 kill |
| 2026-09-21 | `node tests/run-contracts.js` | 通过 | **36 项合同 exit 0**（`cache/online-probe/contracts19.log`） |
| 2026-09-21 | **真实 CODESYS 并发探针**（`cache/online-probe/concurrent-prepare-probe.js`，同一个作业目录 —— 即现场失败的那条路径） | 通过 | 三个并发 prepare：`reused=false pid=42972` / `reused=true pid=42972` / `reused=true pid=42972`，**不同 worker 进程数 = 1**，总用时 42.2 秒（= 一次启动而不是三次串联）；`stop` → `graceful=true`；headless CODESYS 进程数前后都是 1（探针进程已退出，用户那个会话没受影响） |

### T098 待办（需真实界面验收）

1. **再重启一次 TaskHive**（`scriptengine.cjs` / `online-session.cjs` 只在启动时加载），然后正常操作：绑定工程 → 立刻点「扫描设备」。
2. 预期：不再出现 EBUSY；「扫描设备」弹窗先出缓存列表、再跑实时广播；多个入口同时触发也只起一个在线进程（任务管理器里不会多出第二个约 1 GB 的 CODESYS 进程）。
3. 真实验收前不得把本任务改为"已验证"。

## T099 为什么在线功能不稳定 + 「目标设备」必须先看见

### 用户口径

> 「为什么在线功能不稳定，我点击其他界面会停顿刷新，为什么不先通过扫描设备绑定设备在登录，
> 下载登录我怎么知道我登录那个设备」

### 一、"点其他界面就停顿刷新"的根因（有实测数据）

轨迹日志（`resources/app/logs/trajectory.jsonl`）按分钟统计：

| 调用 | 现场量级 | 单次代价 |
|---|---|---|
| `codesys.current-project`（重新探测当前工程） | **约 1 次/分钟 + 每次切窗口/标签页再来一次（成对出现）** | **约 2 秒**主进程忙 |
| `codesys.online.status`（在线状态轮询） | 1882 次 | 一次文件往返（已优化） |
| `codesys.scriptengine.inspect-project` / `bind-project` | 各 62 次 | **约 32 秒**（启动 ScriptEngine） |

`codesys.current-project` 每次会**起一个 PowerShell 进程做窗口枚举 + 扫 CODESYS 选项文件**
（`app/main.js` 的注释自己写着这句话），实测 `04:00:10.133 → 04:00:12.386` = 2.25 秒。
而工作台在**每次切回窗口/标签页**（`focus` / `visibilitychange`）都会重新探测一次，宿主
只缓存 6 秒 —— 于是"点一下别的界面就停顿刷新"。

第二层：常驻在线进程空闲 10 分钟会**自己退出**（刻意如此：它占约 700 MB），而"绑定工程后
自动准备"这个 effect 依赖 `[jobId, sourcePath]`，**每次切回工作台都会重新执行** → 又悄悄
起一个 700 MB 的 CODESYS（20–40 秒）→ 又卡一次。

第三层是已经修掉的两个真 bug（T097 登录不登录应用、T098 并发启动撞 `EBUSY`），它们让上面
两层显得更"不稳定"。

### 二、修改

| 文件 | 改动 |
|---|---|
| `plugins/installed/taskhive-surfaces/dsh/client.js` | `CODESYS_DETECT_MIN_GAP_MS` 15 秒 → **45 秒**（交互重检测节流）；`CODESYS_FALLBACK_DETECT_MS` 120 秒 → **300 秒**（后台兜底）；「刷新当前工程」仍是 `force` 真探、面板切窗口仍是事件驱动，都不受影响 |
| `app/main.js` | `CODESYS_CURRENT_PROJECT_TTL_MS` 6 秒 → **45 秒**：两次探测之间直接复用结果 |
| `client.js` | 新增 `codesysPreparedJobs`：**每个作业只自动准备一次**在线会话。空闲释放之后再回到工作台**不会悄悄重启**那个 700 MB 进程，而是明说「在线进程当前没有运行（空闲 10 分钟会自动释放，这是刻意的）。要重新启动请点「登录」或「扫描设备」，首次约 20–40 秒」 |
| `client.js` | 新增 `onlineTargetSource`（`工程配置` / `本次扫描选择` / `本次手动填写`）与**常驻「目标 …」栏**（底部状态行，窄栏省略不换行） |
| `client.js` | **登录前确认**：「登录到这台设备？」+ 设备名 / 标识 / IP·端口 / 网关 / 目标来源 + 「只建立连接并登录应用：不下载程序、不修改设备上的任何东西」；**下载前确认**：「把当前工程下载到这台设备？」+ 同样的设备信息 + 「会停止设备上正在运行的应用」 |
| `tests/codesys-online-gate-contract.js`、`codesys-workbench-link-contract.js` | 新增断言：三个节流常量、`codesysPreparedJobs` 与"不自动重启"的提示文案、目标栏与来源标签、登录/下载的确认框 |

### 三、"为什么不先扫描设备再登录"——流程本来就是这个，但目标没被看见

现有流程**已经是**：绑定工程 → 「扫描设备」（独立弹窗：先出网关缓存、再实时广播）→
选中一台 → **立即写成本次会话的在线目标**（`set-target`，只改工程副本的内存值，不动
`.project`）→ 点「登录」。问题出在可见性：

1. 目标只出现在**悬浮提示**和那个弹层里，平时看不见 → 现在底部**常驻「目标 …」栏**。
2. 在线进程没在跑时，"应用为在线目标"会报 `session-not-running`（现场见过这条）→ 现在
   准备策略改成"每个作业一次 + 明说没运行"，不会再出现"点了没反应"。
3. 「登录 / 下载」点下去时**不显示设备** → 现在两者都先弹确认框，把设备名、IP、网关、
   目标来源摆在眼前。

### T099 验证证据

| 日期 | 检查 | 结果 | 证据 |
|---|---|---|---|
| 2026-09-21 | `node tests/codesys-online-gate-contract.js`、`codesys-workbench-link-contract.js`、`codesys-workbench-compact-layout-contract.js` | 通过 | 节流常量、目标栏、确认框、顶栏宽度预算（底栏新增 chip 不破坏既有预算） |
| 2026-09-21 | `node tests/run-contracts.js` | 通过 | **36 项合同 exit 0**（`cache/online-probe/contracts20.log`） |

### T099 待办（需真实界面验收）

1. 重启 TaskHive 后：切到别的标签页再切回来，**不应再出现 2 秒左右的停顿刷新**；日志里
   `codesys.current-project` 的密度应从"约 1 次/分钟"降到"约 1 次/5 分钟"。
2. 底部状态行应常驻显示 `目标 <设备> · <来源>`；点「登录」和「下载」都应先出现写明设备的
   确认框。
3. 空闲 10 分钟后回到工作台：应看到"在线进程当前没有运行（空闲 10 分钟会自动释放…）"，
   **不应**自动再起一个 CODESYS。
4. 真实验收前不得把本任务改为"已验证"。

## T100 在线值对齐原生 CODESYS：FB 实例读成员 + 实现区也标值

### 用户口径

> 「为什么在线不是显示在视图（和原生 codesys 一样，代码编辑器显示在线变量和代码的值等等），
> 是不能实现吗？」（附截图：声明区只有 `stopExecute : BOOL;` 行尾有 `FALSE`，其余 9 行空的）

### 根因（两条，都是"没做"，不是"做不到"）

1. **FB 实例读不出值。** 截图那个 `Axis_Y_PRG` 的声明是 9 个 FB 实例 + 1 个 BOOL：
   `power : MC_Power;`、`position : MC_ReadActualPosition;` … 界面把这些变量名**原样**当表达式
   发出去，而 `Axis_Y_PRG.power` 这种"实例本身"不是可读表达式 → 全部为空；只有
   `stopExecute : BOOL` 读得到，所以看起来"只有一行有值"。
   原生 CODESYS 的做法是**展开实例看成员**（`power.Status`、`position.Position`…），
   而成员路径走的是和普通变量**同一条**读取路径 —— 这一点在 2026-09-21 的只读探针里已经
   证实过（`Jog.permit` = `FALSE`、`Jog.i` = `INT#0` 都是这么读到的）。
2. **实现区根本没接在线值**：`valueByLine` 只喂给 `declaration` 那一栏。

### 修改（`plugins/installed/taskhive-surfaces/dsh/client.js`）

| 改动 | 说明 |
|---|---|
| 新增 `codesysMonitorVariables()` | 从声明行解析出 `{ name, type }`；**必须 `trim()`**，否则真实工程里的缩进会让类型正则永远不匹配（这条是写测试时被抓出来的真 bug）。`ARRAY[1..7] OF LREAL` 只取到 `ARRAY`，正好落进"跳过"那一类 |
| 新增 `codesysMonitorExpressionsFor()` | 简单类型读它自己；FB 实例读成员；数组/结构整体跳过 |
| 新增成员表 | `MC_Power→Status/Busy/Error/ErrorID`、`MC_ReadActualPosition→Position/Valid/Error`、`MC_ReadStatus→Standstill/Disabled/Errorstop/Valid`、`MC_MoveAbsolute/MC_Stop/MC_Reset→Done/Busy/Error`、`TON/TOF/TP/TONR→Q/ET`、`CTU/CTD/CTUD→Q/CV`、`R_TRIG/F_TRIG→Q`…；认不出的 FB 退回 `Busy/Done/Error` |
| 表达式顺序 | **简单变量排在成员探测前面**，90 条上限先保住"一定能读到"的那些 |
| `onlineValueByName` | 一次把「表达式名 → 值」建成索引；空值不进去（读不到的成员不会显示成空括号） |
| `onlineValueByLine` | 简单变量显示自己的值；FB 行显示读到成员的短摘要，如 `Status=TRUE Busy=FALSE Error=FALSE` |
| `onlineValueByLineImpl`（新） | 实现区每行显示**这一行引用到的、本对象声明过的变量**的当前值（最多两个），与原生 CODESYS 在实现区标值的做法一致 |
| 两个区各自的值列 | 实现区的值更长（`power.Status=TRUE Error=FALSE`），单独给它更宽的列；区标题上的「在线值 / 在线中…」标记现在两区都有 |

### T100 验证证据

| 日期 | 检查 | 结果 | 证据 |
|---|---|---|---|
| 2026-09-21 | 解析与表达式生成的镜像测试（用截图里那类真实声明） | 通过 | 12 个变量 → 25 条表达式：`power→power.Status/Busy/Error/ErrorID`、`stopExecute→stopExecute`、`AxisList→(跳过)`、`myTimer→myTimer.Q/ET` |
| 2026-09-21 | `node tests/codesys-online-gate-contract.js` | 通过 | 新增 9d 段断言：类型解析（含缩进）、成员表、跳过数组、实现在线值、两区线映射 |
| 2026-09-21 | `node tests/run-contracts.js` | 通过 | **36 项合同 exit 0**（`cache/online-probe/contracts21.log`） |
| 2026-09-21 | 真实 PLC 只读探针（`cache/online-probe/fb-members-probe.js`） | **未完成** | 该轮登录报「网络错误：没有到达主机的路由」——探针跑的时候现场 PLC 不通（网线/设备状态），与代码无关。成员读取机制本身在 09-21 早些时候的探针里已证实（`Jog.permit`、`Axis_Y_PRG.stopExecute`） |

### T100 待办（需真实界面验收）

1. 重启 TaskHive → 确认设备在线 → 点「登录」→ 选中 `Axis_Y_PRG`。
2. 预期：声明区 9 个 FB 实例行尾出现成员摘要（如 `Status=TRUE Busy=FALSE Error=FALSE`），
   `stopExecute` 仍然是 `FALSE`；**实现区每一行**引用到的变量也在行尾显示当前值。
3. 若某行仍为空：那是该 FB 没有我们猜的那几个成员（认不出的 FB 只试 `Busy/Done/Error`）。
   把对象名 + 行号发我，我按它的真实成员补一张表。
4. 数组/结构整体（如 `AxisList : ARRAY[1..7] OF LREAL`）**读不出来**，所以不显示值 ——
   要看得把下标写出来（如 `AxisList[1]`），这是 CODESYS 表达式本身的限制，不是界面限制。
5. 真实验收前不得把本任务改为"已验证"。

## T101 「扫描设备」改为底部面板 + 扫描/进程启动计时

### 用户口径

> 「把扫描设备弹窗改成和编译一样的底部弹出，并且加入扫描时间提示以及启动 codesys 进程耗时时间」

### 修改

| 文件 | 改动 |
|---|---|
| `plugins/installed/taskhive-surfaces/dsh/client.js` | 删掉居中弹窗 `showCodesysScanDialog`（163 行），改成工作台内的底部面板：**复用「编译输出」的 `.taskhive-codesys-compile*` 外壳**（同一形态、同一收起按钮、同一行高），所以"和编译一样"不是相似，是同一套样式 |
| 同上 | 面板头部：`▾ 扫描设备 · <状态>` + 计时 + 「重新扫描 / 上次记录 / ×」；正文：状态行 + 可点选的设备行（点一下即写成本次会话的在线目标） |
| 同上 | 新增 `scanOpen` / `scanReport` / `scanSeconds`：扫描期间每秒走一格（"已用 N 秒"说的永远是**当前这一轮**），完成后显示四段计时 |
| 同上 | 计时分解：`进程 <启动耗时>`（或"复用（未重启）"）· `缓存 <秒回那一轮>` · `实时 <广播那一轮>` · `合计` |
| `app/main.js` | `codesys:online-scan` 真的测量两段：`prepareMs`（确保在线进程存在，含首次启动 20–40 秒）与 `scanMs`（网关广播本身），并把 `sessionReused` / `workerStarted` 一起返回；审计记录里也带上这两段 |
| `tests/*` | 契约同步钉住：面板标记、四段计时、`codesysFormatMs`、宿主两段测量、旧的 `data-codesys-scan-dialog` 不得回归 |

### T101 验证证据

| 日期 | 检查 | 结果 | 证据 |
|---|---|---|---|
| 2026-09-21 | `node tests/codesys-online-gate-contract.js`、`codesys-workbench-compact-layout-contract.js` | 通过 | 面板标记 / 计时断言 / 顶栏按钮仍打开扫描入口 |
| 2026-09-21 | `node tests/run-contracts.js` | 通过 | **37 项合同 exit 0**（`cache/online-probe/contracts22.log`） |

### T101 待办（需真实界面验收）

1. 重启 TaskHive → 点「扫描设备」：应在**底部**（「编译输出」旁边）弹出面板，而不是居中弹窗。
2. 首次扫描：状态行显示「正在准备在线会话并读取网关上次记录的设备… 已用 N 秒（首次要启动 CODESYS 在线进程…）」，完成后头部显示 `进程 21.3 s · 缓存 0.4 s · 实时 8.6 s · 合计 30.3 s` 这类分解。
3. 再点一次「上次记录」：应秒回，且 `进程 复用（未重启）`。
4. 真实验收前不得把本任务改为"已验证"。

## T102 插件改名「CODESYS 工作台」+ 统一图标

### 用户口径

> 「把插件名字改成 codesys 工作台，并且加入图标」

### 修改

| 文件 | 改动 |
|---|---|
| `plugins/catalog.json` | `codesys-monitor.name`: `CODESYS` → **`CODESYS 工作台`**（侧栏按钮与顶栏标题读的都是它） |
| `plugins/installed/codesys-monitor/plugin.json` | 同步改名，避免"清单和目录不一致" |
| `app/renderer/renderer.js` | `pluginLabels` 同时给了**插件 id** 与 **surface id** 两个键 —— 侧栏按钮查 `pluginLabels[item.id]`，顶栏标题查 `pluginLabels[surface id]`，只改一处会出现"侧栏叫 CODESYS 工作台、顶栏还写着 codesys" |
| 同上 | 新图标 `CODESYS_WORKBENCH_ICON`（窗口 + `<>` 代码 + 底座），替换原来那个和浏览器/知识库区分度太低的显示器方块；侧栏与设置里的插件列表共用这一枚 |
| 同上 | 设置 → 插件列表原本只有文字，现在也在名字左边渲染同一枚图标（`plugin-row-head`） |
| `app/renderer/ui-overrides.css` | 补 `.plugin-row-head` 的图标 + 文字排布 |
| `tests/plugin-identity-contract.js` | 新增契约（37 项之一）：目录/清单同名字；侧栏与顶栏两个键都在；图标必须是含 `rect`+`path` 的内联 SVG 且被侧栏与列表共同引用；列表容器必须真的被样式化 |

### T102 验证证据

| 日期 | 检查 | 结果 | 证据 |
|---|---|---|---|
| 2026-09-21 | `node tests/plugin-identity-contract.js` | 通过 | 名字三处一致、图标两处共用 |
| 2026-09-21 | `node tests/run-contracts.js` | 通过 | **37 项合同 exit 0** |

### T102 待办（需真实界面验收）

1. 重启 TaskHive：侧栏入口应显示「CODESYS 工作台」+ 新图标；打开该 surface 后顶栏标题也应显示「CODESYS 工作台」（此前是裸的 `codesys`）。
2. 设置 → 插件：`CODESYS 工作台` 一行左侧应出现同一枚图标。
3. 真实验收前不得把本任务改为"已验证"。

## T103 绑定即状态：「扫描设备」→「已绑定」，登录不再弹确认框

### 用户口径

> 「扫描设备绑定过设备之后应该把扫描设备变成已绑定，而不是登录的时候在弹出一个已连接单独提示」

### 根因（两处）

1. **绑定只是一次性动作**：选完设备后按钮仍然写着「扫描设备」，绑定状态只藏在底栏的小 chip 和悬浮提示里；而且目标只活在**当前那个在线进程**的内存里 —— 进程空闲 10 分钟退出、或重开工作台之后，"绑定过"这件事就没了。
2. **登录时弹确认框**：T099 为了回答"我登录的是哪台设备"，在点「登录」时弹了一个设备确认框。既然绑定状态本就该常驻显示，这个一次性弹框就是多余的（用户口径）。

### 修改

| 文件 | 改动 |
|---|---|
| `plugins/installed/codesys-monitor/scriptengine.cjs` | `onlineSetTarget` 把绑定写进**作业元数据**（`job.onlineTargetOverride`，含 `source` / `boundAt`）—— 写的是 `job.json`，**不是** `.project`（worker 侧照旧 `saved:false`）。没有在线进程时不再拒绝，而是返回 `deferred:true`（绑定先记下，起来时应用） |
| 同上 | `openOnlineSession` 启动完成后，如果作业里存过绑定，就把它**重新应用到新进程**（`set-target` 只改工程副本的内存值），并把 `targetSource` / `boundTarget` 回填进 ready；应用失败时写 `boundTargetError`（否则界面会显示"已绑定"而登录其实去了别处） |
| `app/main.js` | `codesys:online-set-target` 即便 `prepareOnlineSession` 失败也照样记录绑定（绑定是作业属性，不该因为这一次进程没起来就丢），审计里带上 `deferred` / `source` / `sessionReady` |
| `plugins/installed/taskhive-surfaces/dsh/client.js` | 「扫描设备」按钮变成状态：绑定后类名加 `is-bound`（品牌描边）、图标换成对勾、文案变「已绑定」；窄栏只剩图标也看得出状态。`data-codesys-online-bound` 暴露给探针 |
| 同上 | `onlineTargetSource` 改为"本地选择 ∪ 宿主回填"（`onlineReady.targetSource`），所以在线进程重启后仍然是「已绑定」；绑定未生效时按钮写「绑定未生效」 |
| 同上 | **登录不再弹设备确认框**（设备就写在「已绑定」那颗按钮上，登录状态行也会再说一遍）；「下载」前的设备确认**保留** —— 那是唯一会把程序写进设备的动作 |
| `tests/codesys-online-session-concurrency-contract.js` | 假 CODESYS 升级成"会应答命令"（读命令文件、写结果文件），于是可以真的验证：无会话时绑定 → `deferred` + 落盘；起会话 → 绑定被重新应用且 ready 回填；会话中再绑定 → 立刻应用且换掉旧值；再重启 → 拿到最新那次绑定 |

### T103 验证证据

| 日期 | 检查 | 结果 | 证据 |
|---|---|---|---|
| 2026-09-21 | `node tests/codesys-online-session-concurrency-contract.js` | 通过 | 绑定落盘 / 延迟应用 / 重启后回填 / 最新绑定生效；同时修掉两处测试自身的坑（`...value` 覆盖布尔标志、失败时计时器不清理导致挂住） |
| 2026-09-21 | `node tests/codesys-online-gate-contract.js` | 通过 | 绑定状态、按钮改名与换图标、样式、登录不再确认、下载仍然确认 |

### T103 待办（需真实界面验收）

1. 重启 TaskHive → 点「扫描设备」→ 选中一台设备：那颗按钮应立刻变成**「已绑定」**（对勾图标 + 品牌框），底栏 chip 同步显示 `目标 … · 已绑定（本次扫描选择）`。
2. **释放/等空闲**让在线进程退出，再点「登录」：仍应显示「已绑定」（宿主把绑定重新应用到新进程），登录**不再**弹设备确认框。
3. 换一台设备再绑定：按钮保持「已绑定」，内容换成新设备；登录应去新设备。
4. 真实验收前不得把本任务改为"已验证"。

## T104 「点侧栏入口显示空白」：工作台没有真正的错误边界

### 用户口径

> 「还有一个 bug 修复我点击底部侧栏，显示为空白」

### 根因（两条）

1. **窗口里加载的是半成品**。`logs/renderer-console.log` 在 14:02→14:19（本地时间）连续记录
   `Uncaught SyntaxError: missing ) after argument list`，URL 指向 `taskhive-surfaces/client.js`
   —— 那正是本轮做「扫描面板」时括号还没配平的中间态。DSH 把插件脚本拼成一个 bundle 请求，
   **其中一个文件语法错，整个 bundle 都不执行**：侧栏的标签注册、工作台组件全都没装上，
   点开就是空白。14:19 之后文件已修好，但窗口里仍是坏的那一版。
2. **工作台根本没有错误边界**。`CodesysWorkbenchBoundary` 只写了 `render()`，
   没有 `componentDidCatch` / `getDerivedStateFromError` —— 渲染一抛异常，React 直接把整块
   卸掉，**呈现给用户的就是"空白"**，连一句话都没有。这类空白无法自证，只能翻日志。

### 修改

| 文件 | 改动 |
|---|---|
| `plugins/installed/taskhive-surfaces/dsh/client.js` | `CodesysWorkbenchBoundary` 改成**真正的错误边界**：`getDerivedStateFromError` + `componentDidCatch`（同时 `console.error` 一份），失败时渲染可读的错误块（`data-taskhive-codesys-crash`）：标题「CODESYS 工作台渲染失败（这是崩溃，不是空白）」+ 错误文本 + **复制错误** / **重试渲染** 两个按钮 |
| 同上 | 顺手把工作台标签名从「CODESYS **专用**工作台」改成「CODESYS 工作台」，与 T102 的插件改名保持一致（侧栏入口与标签名不再是两个说法） |
| 同上 | 崩溃界面的样式（`.taskhive-codesys-crash*`）：浅红卡片 + 等宽错误文本，仍在工作台容器内，不遮住应用其他部分 |
| `tests/codesys-workbench-ui-contract.js` | 新增断言：必须有 `getDerivedStateFromError` / `componentDidCatch`、必须渲染可复制的错误块、必须有配套样式 |

### T104 验证证据

| 日期 | 检查 | 结果 | 证据 |
|---|---|---|---|
| 2026-09-21 | `node --check plugins/installed/taskhive-surfaces/dsh/client.js` | 通过 | 当前文件语法正确（14:19 的坏版本已修复） |
| 2026-09-21 | `logs/renderer-console.log` | 定位根因 | 14:02/14:03/14:04/14:05/14:06/14:10/14:14/14:18/14:19 各一条 `missing ) after argument list`（对应 `client.js` 的几个中间修订） |
| 2026-09-21 | **隔离 UI smoke 实跑**：`TaskHive.exe --smoke --smoke-ui --smoke-isolated`（`TASKHIVE_RUNTIME_ROOT` 指向临时目录；DSH 运行时仍从程序目录读，**不碰用户会话**） | **exit 0 / stage=complete** | `logs/smoke-ui-error.json` 被删除（成功路径）；`logs/codesys-workbench-render-probe.json` = `{ok:true, root:true, controls:2, crash:false, tabTitles:["CODESYS 工作台"], timedOut:false}` |
| 2026-09-21 | 同一轮 smoke 的侧栏证据 | 通过 | `logs/sidebar-plugin-labels-probe.json`：`CODESYS 工作台 / 浏览器 / 知识库 / 专家`，`text === title`、`fullyVisible=true`（T102 的改名在真实 UI 里生效） |
| 2026-09-21 | `node tests/run-contracts.js` | 通过 | **37 项合同 exit 0**（`cache/online-probe/contracts27.log`） |

### T104 新增的两条保险

1. **`probeCodesysWorkbenchRender`（新探针，已接入 `--smoke-ui`）**：走插件自己的
   `codesys.workbench.open` 消息打开工作台标签，然后区分三种结果 —— 根节点出现且有控件
   （ok）、命中崩溃兜底（`workbench-render-crash`，带错误文本）、30 秒什么都没出现
   （`workbench-not-rendered`，多半是插件 bundle 没执行）。此前**没有任何探针**验证工作台
   本身能不能渲染，所以"点开是空白"只能靠用户撞到。
2. **`probeSidebarPluginLabels` 不再硬编码插件名**：它原来写死 `text === 'CODESYS'`，
   T102 改名为「CODESYS 工作台」后整条 smoke 变红 —— 现在期望值从 `plugins/catalog.json`
   读取。这是"改名只改一半"的另一种形态：**探针里的名字也要跟着走**。

### T104 待办（需真实界面验收）

1. **刷新窗口（Ctrl+R）** 或重启 TaskHive，再点那个侧栏入口。
2. 若仍为空白：现在应该会显示红色错误块 —— 把里面的文字发我，那才是真正的故障信息。
3. 若刷新后正常：说明就是"窗口里跑着坏的那一版"，本条即闭环。
4. 需要复验工作台渲染时可直接跑（约 2 分钟，隔离、不动现有会话）：
   ```powershell
   $env:TASKHIVE_RUNTIME_ROOT='C:\Users\29925\Documents\TaskHive1.0.3\.taskhive-smoke-runtime'
   & 'C:\Users\29925\Documents\TaskHive1.0.3\TaskHive.exe' --smoke --smoke-ui --smoke-isolated
   ```
   证据：`logs/codesys-workbench-render-probe.json`、`logs/sidebar-plugin-labels-probe.json`。
4. 真实验收前不得把本任务改为"已验证"。

## T105 切屏即掉线（真实 bug）+ 登录没有提示 + 在线值的呈现方式

### 用户口径

> 「登录过程没有登录提示，在线数据掉线，难不成因为我切屏掉线？而且在线数据也没有显示，
> 在线数据是以什么样子的显示的，不是和 codesys 一样自己在代码上出现监视值吗？」

### 一、"切屏掉线"——是的，就是这条，而且是设计写死的

`plugins/installed/taskhive-surfaces/dsh/client.js` 里有一句：

```js
React.useEffect(() => () => { void window.taskhive?.disarmCodesysOnline?.({ reason: 'workbench-closed' }) }, [])
```

而宿主 `app/main.js` 的 `codesys:online-disarm` 是：

```js
const result = codesysOnlineAuthorization.disarm(reason);
void codesysScriptEngine.stopOnlineSession(`authorization-${reason}`).catch(() => {});
```

**组件一卸载（切标签、切界面、切会话）→ 解绑 → 直接杀掉常驻在线进程 → PLC 连接断掉。**
原意是"授权不能活得比它所属的界面久"，代价就是最主要的用法（登着看在线值、来回切着改代码）
根本没法用。

### 二、修改

| 文件 | 改动 |
|---|---|
| `plugins/installed/taskhive-surfaces/dsh/client.js` | **删掉卸载时的 disarm**（并在原处写明为什么不再这么做）。新的边界：授权仍绑定「工程 + CODESYS 窗口」——切工程、关 CODESYS 窗口、点「断开」或「释放在线会话」立即失效；危险动作本来就要逐条确认 + 逐字确认词，不靠"关界面"兜底；真没人用的会话由常驻进程**自己的空闲上限**（10 分钟无命令）收掉，不会因为切屏就一直占着 PLC 与约 700 MB 内存 |
| 同上 | **登录/下载等在线动作的可见提示**：新增 `onlinePending` + `onlineBusySeconds`，在顶栏那一排渲染 `⏳ 正在连接 PLC（首次会启动常驻在线进程，约 20–40 秒）· 12s` —— 品牌色胶囊、每秒走一格、带 `role="status"` 与 `aria-live`，`prefers-reduced-motion` 下不做动画。此前只有底部一行小字 + 按钮变灰，等于没有提示 |
| `tests/codesys-online-gate-contract.js` | 新增 9e 段断言：**禁止**卸载时 disarm（含正则反向断言）、切工程仍必须 disarm、显式 disarm 仍会停进程、进行中提示必须存在且带秒数与样式 |

### 三、在线值到底长什么样（回答"不是和 CODESYS 一样在代码上出现监视值吗"）

**是逐行标值的，但不是"嵌在代码文本里"，而是每行右侧一个对齐的值列**：

| 区域 | 显示形式 |
|---|---|
| 声明区（Declaration） | 每一行行尾右侧显示该变量的当前值；FB 实例显示成员摘要，如 `Status=TRUE Busy=FALSE Error=FALSE`（等价于 CODESYS 展开实例） |
| 实现区（Implementation） | 该行**引用到的、本对象声明过的**变量，行尾显示 `变量=值`（最多两个） |
| 区标题 | 读到值后出现绿色「在线值」小标；没读到显示「在线中…」（鼠标悬停说明原因） |
| 刷新节奏 | 约 1.5 秒一次；值没变化就不重绘；读得慢自动退避到最多 6 秒；页面不可见时不读 |

**为什么不是直接写在代码行里**：编辑器是 `<textarea>`，浏览器不允许给 textarea 里的**部分文字**上色/插入文本。要做成 CODESYS 那种"代码中间夹着监视值"，必须把 textarea 换成"高亮层 + 可编辑层"的结构（一次较大的编辑器改造）。当前实现是同一行高、随代码一起滚动的**并排值列**，视觉上仍是"这一行的值"。

### T105 验证证据

| 日期 | 检查 | 结果 | 证据 |
|---|---|---|---|
| 2026-09-21 | `node --check` 插件 | 通过 | exit 0 |
| 2026-09-21 | `node tests/codesys-online-gate-contract.js` | 通过 | 9e 段（会话活过切屏 + 待办提示） |
| 2026-09-21 | `node tests/run-contracts.js` | 通过 | **37 项合同 exit 0**（`cache/online-probe/contracts28.log`） |

### T105 待办（需真实界面验收）

1. 重启 TaskHive → 登录 → **切到别的标签/界面再切回来**：应仍然是「在线」，在线值继续刷新（此前必断）。
2. 点「登录」时应立刻看到 `⏳ 正在连接 PLC… · Ns` 在顶栏那一排走动，而不是只有按钮变灰。
3. 选中一个 POU：声明区行尾出现值列；切到实现区也应看到 `变量=值`。
4. 若长时间（>10 分钟）不用再看：会话会被空闲释放 —— 这是刻意的，重新点「登录」即可（约 20–40 秒）。
5. 真实验收前不得把本任务改为"已验证"。

## T106 「新界面 + 旧引擎」：EBUSY 是旧主进程写的 + 引擎新旧自检

### 用户口径

> （截图）底部扫描面板显示：`扫描失败：… EBUSY: resource busy or locked, open
> '…\jobs\direct-1789979963071-2c636f00\online\online-worker.py…'` +「没有发现设备」

### 一、证据链（不是猜想）

| 观察 | 值 |
|---|---|
| 失败作业目录里的脚本名 | **`online-worker.py`**（T098 之前的固定名） |
| 磁盘上当前代码 | `online-worker-${this.runToken}.py`（T098 已改为按运行令牌命名） |
| TaskHive 主进程启动时间 | **11:47:20** |
| `app/main.js` / `online-session.cjs` 修改时间 | **15:26** / 11:57（都在启动之后） |

结论：**界面（插件 JS）刷新一次就是新的，主进程只在启动时加载** —— 所以那一刻是
「新界面 + 旧引擎」，而旧引擎没有 T098 的并发保护，于是照旧写出固定名并撞上 EBUSY。

同一目录的结果文件还证明**扫描本身是成功的**（引擎侧）：`seq2` 找到 3 台
（`0301.3035` / `0301.303C` / **`0301.603A`**）、`seq4` 找到 2 台（`0301.3032` / `0301.603A`）。
截图是「缓存轮失败」的**中间态**。

### 二、修改

| 文件 | 改动 |
|---|---|
| `plugins/installed/taskhive-surfaces/dsh/client.js` | 扫描成功的那一轮**清掉上一轮的错误文本**（`error: ''`）——此前"缓存轮失败 + 实时轮成功"会一直挂着"扫描失败"，正是截图那个中间态 |
| `app/main.js` | 启动时记录 `CODESYS_ENGINE_FILES`（`app/main.js`、`app/preload.js`、`scriptengine.cjs`、`online-session.cjs`）的 mtime；新增 `codesysEngineFreshness()` 与 **新通道** `codesys:engine-freshness`；`codesys:online-status` 一并返回 `runtime` |
| `app/preload.js` | 暴露 `codesysEngineFreshness()` |
| `client.js` | 挂载时自检：**通道调用失败 ⇒ 主进程比界面旧**；成功但 `stale ⇒ 引擎文件在启动后被改过**。两种情况都在顶栏那一排显示黄色告警「⚠️ 请重启 TaskHive：在线引擎是旧版本」（`data-codesys-engine-stale="channel-missing"｜"files-changed"`，悬停写明哪些文件变了、为什么刷新页面不够） |
| `app/main.js`（探针） | `probeCodesysWorkbenchRender` 增加断言：**刚启动的实例不得出现该告警**（`engineStale === false`）——这同时证明自检通道真的存在 |
| `tests/codesys-online-gate-contract.js` | 新增 9f 段：引擎文件清单、mtime 比较、新通道、status 携带 runtime、preload 桥、通道缺失按陈旧处理、告警文案与样式、成功扫描必须清错误 |

### 三、自证机制为什么必须用"新通道"

旧主进程**不可能**报告自己旧（那段代码它还没有）。所以判据不是"它说自己旧"，而是
**"它有没有这个通道"**：界面调用成功 ⇒ 主进程是新的；调用失败 ⇒ 主进程是旧的。
这是唯一能自证"跑着的引擎是不是磁盘上那一份"的办法。

### T106 验证证据

| 日期 | 检查 | 结果 | 证据 |
|---|---|---|---|
| 2026-09-21 | `node tests/codesys-online-gate-contract.js` | 通过 | 9f 段全部断言 |
| 2026-09-21 | `node tests/run-contracts.js` | 通过 | **37 项合同 exit 0**（`cache/online-probe/contracts29.log`） |
| 2026-09-21 | **隔离 UI smoke 实跑**（`--smoke --smoke-ui --smoke-isolated`） | **exit 0 / stage=complete** | `logs/codesys-workbench-render-probe.json` = `{ok:true, root:true, controls:2, crash:false, engineStale:false, tabTitles:["CODESYS 工作台"]}` —— 新实例不出现重启告警，证明自检通道存在且判定为"新" |

### T106 待办（需真实界面验收）

1. **完全退出并重新启动 TaskHive**（刷新页面不够）：之后扫描不应再出现旧写法的 EBUSY。
2. 重启后顶栏**不应**再出现黄色「请重启 TaskHive」告警；若出现，说明主进程仍旧 —— 把悬停里的文件名发我。
3. 真实验收前不得把本任务改为"已验证"。

## T107 绑定必须是登录/下载的前置条件

### 用户口径

> 「我都没有绑定设备 为什么可以登录？明显不合理对不对」

同意，而且此前确实不合理：**没绑定就沿用工程文件里配置的目标去连**。工程里配的目标只是
"这个工程上次连过谁"的记录，不该被当成"操作者这次选过设备"。T103 已经把绑定做成按钮上的
状态（「扫描设备」→「已绑定」），这一轮把**门槛**补上。

### 修改

| 文件 | 改动 |
|---|---|
| `plugins/installed/taskhive-surfaces/dsh/client.js` | 「登录」「下载」在 `!onlineBound` 时**直接禁用**，标题写明原因（"尚未绑定设备：登录/下载在你**选中一台 PLC**之前不可用……工程文件里配的目标只是记录，不作为登录依据"）；`aria-label` 同步区分"需先绑定设备" |
| 同上 | 底部「目标」chip 从 `<span>` 改成 `<button>`：未绑定时是**黄色硬门槛**样式 `目标 未绑定 · 先扫描设备（工程里配的是 X）`，**点它直接打开扫描面板**（未绑定状态下唯一的绑定入口，不能藏起来）；已绑定时点它打开目标面板改目标 |
| `plugins/installed/codesys-monitor/scriptengine.cjs` | **引擎侧第二道锁**：`REQUIRES_BOUND_TARGET = ['online-login','online-download','online-change']`，作业里没有 `onlineTargetOverride` 时一律拒绝，抛 `CODESYS_ONLINE_TARGET_NOT_BOUND`，并明确"工程文件里配置的目标不作为登录依据"。绕过界面直接发 IPC 也一样拒绝 |
| `client.js` | `codesysOnlineErrorMessage` 增加该错误码的中文说明 |
| `tests/codesys-online-session-concurrency-contract.js` | 行为断言：未绑定时三个动作都必须 `rejects`，且**连在线进程都不能被启动**（`pending.length === 0`） |
| `tests/codesys-online-gate-contract.js`、`codesys-workbench-compact-layout-contract.js` | 9g 段断言（界面禁用 + 引擎拒绝 + 黄色门槛样式 + 点击去扫描）；布局契约把"登录"的 `aria-label` 按有状态入口计数（和「扫描设备」同样的处理） |

### T107 验证证据

| 日期 | 检查 | 结果 | 证据 |
|---|---|---|---|
| 2026-09-21 | `node tests/codesys-online-session-concurrency-contract.js` | 通过 | 未绑定 → 三个动作全部拒绝、不启动 worker |
| 2026-09-21 | `node tests/run-contracts.js` | 通过 | **37 项合同 exit 0**（`cache/online-probe/contracts31.log`） |
| 2026-09-21 | **隔离 UI smoke 实跑**（本轮改动之后） | **exit 0 / stage=complete** | `logs/codesys-workbench-render-probe.json` = `{ok:true, root:true, controls:2, crash:false, engineStale:false, tabTitles:["CODESYS 工作台"]}` |

### T107 待办（需真实界面验收）

1. 重启 TaskHive 后：**登录/下载应处于禁用**，底栏是黄色「目标 未绑定 · 先扫描设备（工程里配的是 …）」。
2. 点那颗黄色 chip（或顶栏「扫描设备」）→ 扫描面板 → 选中设备 → 顶栏按钮变「已绑定」、底栏变「目标 … · 已绑定（本次扫描选择）」→ 此时「登录」才可用。
3. 真实验收前不得把本任务改为"已验证"。

## T108 IP 直连的入口 + 进行中提示挪到最下面的状态栏

### 用户口径

> 「怎么通过 ip 直连？提示登录字样应该在最下面的状态提示栏」

### 一、IP 直连本来就在，但被 T107 的门槛挡在门外（我自己引入的）

IP 直连的字段一直在「在线目标」面板里（寻址方式 `节点地址 / IP 直连` + IP + 端口），
但这个面板此前只能从**已连接**时的在线徽标打开；T107 把未绑定状态的底栏 chip 改成"直接跳扫描"
之后，**未绑定 = 走不到 IP 直连**。这是门槛引入的新断路。

### 二、修改

| 文件 | 改动 |
|---|---|
| `plugins/installed/taskhive-surfaces/dsh/client.js` | 底栏「目标」chip **任何状态都打开同一个目标面板**（面板里同时有「扫描设备…」和「IP 直连」两条路），不再在未绑定时跳扫描 |
| 同上 | 目标面板新增**未绑定引导行**：`尚未绑定：可选「扫描设备…」从网络里挑，或把寻址方式切到「IP 直连」填地址后点「应用」。绑定成功后「登录」才可用。` |
| 同上 | 打开面板时若还没枚举到网关（网关列表来自在线 worker 的 ready），**先拉一次**：`正在读取可用网关（会启动一次在线进程，约 20–40 秒；只读工程副本，不连接 PLC）…`。否则「应用」会因为"请选择网关"失败，IP 直连就是一条走不通的路（worker 侧两种寻址都要求网关，这是 CODESYS 的模型：IP 直连也是经网关的直连路由） |
| 同上 | **进行中提示挪到最下面的状态栏**（`taskhive-codesys-status` 那一行，和状态文字同一处），不再占顶栏宽度（用户口径："提示登录字样应该在最下面的状态提示栏"） |
| `tests/codesys-online-gate-contract.js` | 9g 段改为：目标 chip 在任何状态都打开同一个面板、面板必须有未绑定引导、IP/端口字段必须保留、打开面板必须能补拉网关、**进行中提示必须位于底部状态行**（正则限定在 `taskhive-codesys-status` 之后） |

### 三、IP 直连怎么用（给操作者的答案）

1. 底栏点 🟡「目标 未绑定 …」（或顶栏「扫描设备」先把网关读出来）；
2. 面板里把**寻址方式**切到「**IP 直连**」；
3. 填 PLC 的 IPv4（可带端口，端口留空即默认）；
4. 点「**应用**」→ 这一步就是"绑定"（来源显示为"本次手动填写"）；
5. 顶栏「**登录**」此时才可用。

> 注意：**IP 模式没有读回接口**（CODESYS 本版本只提供 setter），所以设完无法在界面上回显确认，
> 只能靠随后点「登录」验证 —— 面板的 title 里已经写明这一点。

### T108 验证证据

| 日期 | 检查 | 结果 | 证据 |
|---|---|---|---|
| 2026-09-21 | `node tests/codesys-online-gate-contract.js` | 通过 | IP 字段保留、未绑定引导、补拉网关、进行中提示在底部状态行 |
| 2026-09-21 | `node tests/run-contracts.js` | 通过 | **37 项合同 exit 0**（`cache/online-probe/contracts32.log`） |

### T108 待办（需真实界面验收）

1. 重启 TaskHive → 底栏点「目标 未绑定」→ 面板里应看到寻址方式下拉（含「IP 直连」）与引导行；若还没网关，应先显示"正在读取可用网关…"再填出网关。
2. 切「IP 直连」→ 填 IP → 「应用」→ 顶栏变「已绑定」且来源是"本次手动填写"→「登录」可用。
3. 点「登录」后，提示应出现在**最下面的状态栏**（不是顶栏）。
4. 真实验收前不得把本任务改为"已验证"。

## T109 未绑定不常驻告警：点在线功能时在状态栏说一句

### 用户口径

> 「提示目标未绑定... 不应该为常驻提示信息，应该是点击在线功能状态栏提示一下就可以，
> 绑定之后提示一下」

### 一、问题

T107 把"未绑定"做成了**常驻黄色告警** + 按钮**禁用**。两处都不对：

1. 常驻告警等于一直挂着一句"你做错了"，占着底栏、也占了顶栏的 width 预算；
2. **禁用按钮根本点不动** —— 用户要的"点一下给个提示"在这个形态下不可能发生（点了没反应，
   只有悬浮提示里才有原因）。

### 二、修改

| 文件 | 改动 |
|---|---|
| `plugins/installed/taskhive-surfaces/dsh/client.js` | 「登录」「下载」**去掉绑定门槛的禁用**（保留 `!onlineReady` / `!onlineConnected` 等真正不满足才禁用的条件），改成**点击时拦截**：`if (!onlineBound) { setStatus('尚未绑定设备：请先点「扫描设备」选中一台 PLC…'); return }` —— 提示落在**最下面的状态栏** |
| 同上 | 底栏目标 chip：未绑定时从黄色告警改为**中性状态** `目标 未选择 · 点这里选择`（仍然是可点入口，打开目标面板）；删掉 `.is-unbound` 样式规则 |
| 同上 | 绑定成功的提示保留且更明确：扫描选中 → `已绑定 <设备> <地址>（本次扫描选择…）请点「登录」`；手动应用 → `已绑定在线目标 <地址>…`；进程未运行 → `已绑定 …（在线进程未运行，点「登录」时自动应用…）` |
| `tests/codesys-online-gate-contract.js` | 9g 段改写：**禁止**再把绑定写进 `disabled`（含反向断言）、点击路径必须走 `setStatus`、chip 文案必须是中性的"未选择"、`.is-unbound` 不得回归、绑定成功两条路都必须有确认文案 |

> 引擎侧的硬拒绝（`CODESYS_ONLINE_TARGET_NOT_BOUND`）保持不变：界面把话说在前面，
> 引擎兜底保证"绕过界面也连不上没选过的设备"。

### T109 验证证据

| 日期 | 检查 | 结果 | 证据 |
|---|---|---|---|
| 2026-09-21 | `node tests/codesys-online-gate-contract.js` | 通过 | 9g 段（可点 + 状态栏提示 + 中性 chip + 反向断言） |
| 2026-09-21 | `node tests/run-contracts.js` | 通过 | **37 项合同 exit 0**（`cache/online-probe/contracts33.log`） |

### T109 待办（需真实界面验收）

1. 重启后未绑定状态：顶栏「登录」应**可以点**（不置灰）；点它 → **最下面状态栏**出现
   「尚未绑定设备：请先点「扫描设备」选中一台 PLC…」。
2. 底栏应是中性的「目标 未选择 · 点这里选择」，**不再有黄色常驻告警**。
3. 绑定之后：底栏变成「目标 <设备> · 已绑定（…）」，状态栏再提示一句可以登录。

## T110 IP 直连并入「扫描设备」面板（不必先扫描）

### 用户口径

> 「ip 直连不应该是独立窗口，应该融合到扫描设备的窗口，我理解的 ip 直连不需要是不要扫描
> 设备，直接输入 ip 进行连接 plc」

### 一、问题

IP 直连此前长在「在线目标」弹层里（寻址方式开关 + IP + 端口）：**它是一个独立弹层**，
和"扫描设备"是两个入口，语义上也像是"必须先扫描才谈得上目标"。用户要的是：**同一个面板**，
而且**填 IP 就能连，不需要扫描**。

### 二、修改

| 文件 | 改动 |
|---|---|
| `plugins/installed/taskhive-surfaces/dsh/client.js` | 「扫描设备」底部面板新增 **IP 直连行**：`IP 直连：[192.168.31.58] [端口(可选)] [用作目标]`，placeholder 明写「直接填 PLC 的 IP…（不必先扫描）」；该行在扫描进行中也可见可用 |
| 同上 | 新增 `applyDirectIp()`：校验 IPv4 → 取网关（优先扫描结果里的第一台，其次在线进程已读到的）→ **一个网关都还没有时自动补跑一次「上次记录」**（秒回、只读网关列表、不广播、不连接设备）→ 绑定为在线目标（`source: 'ip'`）。**全程不需要先扫描** |
| 同上 | 「在线目标」弹层里**删掉**寻址方式开关与 IP/端口字段，改成一个指路按钮「扫描设备 / 填 IP…」（打开底部面板）—— 两处入口会互相打架，只留一处；节点地址仍可在这里手填 |
| 同上 | 目标来源新增 `'ip'`：底栏显示「已绑定（IP 直连）」；`onlineBound` 判定同步包含它 |
| 同上 | 绑定成功/延迟提示里都保留那句限制说明：**IP 模式没有读回接口，能不能连上只能靠「登录」验证** |
| `tests/codesys-online-gate-contract.js` | 断言改写：IP 行必须在扫描面板里（`data-codesys-scan-ip*`）、必须存在唯一的 `applyDirectIp`、`source: 'ip'`、**弹层里不得再有 IP 字段/寻址方式开关**（反向断言）、必须写明"不必先扫描"、必须有样式 |

### T110 验证证据

| 日期 | 检查 | 结果 | 证据 |
|---|---|---|---|
| 2026-09-21 | `node tests/codesys-online-gate-contract.js` | 通过 | 上述断言（含两条反向断言：弹层里不得再有 IP 字段/模式开关） |
| 2026-09-21 | `node tests/run-contracts.js` | 通过 | **37 项合同 exit 0**（`cache/online-probe/contracts34.log`） |
| 2026-09-21 | **隔离 UI smoke 实跑** | **exit 0 / stage=complete** | `logs/codesys-workbench-render-probe.json` = `{ok:true, root:true, controls:2, crash:false, engineStale:false, tabTitles:["CODESYS 工作台"]}` |

### T110 待办（需真实界面验收）

1. 点「扫描设备」→ 底部面板最下面应有 **IP 直连**一行；**不必等扫描跑完**就能填 IP 点「用作目标」。
2. 绑定后底栏显示「目标 … · 已绑定（IP 直连）」；顶栏「登录」随后可用。
3. 「在线目标」弹层里应只剩「网关 + 节点地址」，IP 相关字段与寻址方式开关都不在（改为「扫描设备 / 填 IP…」按钮）。
4. 真实验收前不得把本任务改为"已验证"。

## T111 IP 行套用皮肤控件 + 目标状态不再常驻

### 用户口径

> （截图）「方框区域太丑不是皮肤 ui 风格，箭头指示的状态应该只是一行提示字在最后面，
> 类似滚动信息，不应该常驻」

### 一、问题

1. **IP 行是一排自造外观的控件**：我给它单独写了 `.taskhive-codesys-scan-ip-input/-apply` 的
   内联式外观（11px 等宽、7px 圆角、自定义焦点环），和皮肤里既有控件（`.taskhive-codesys-online-target-address/-apply`：
   10.5px、6px 圆角、`--th-line` 描边、`--th-brand-line` 高亮）不是一套 —— 放在扫描面板
   那种浅色日志底上就很突兀。
2. **目标状态是常驻 chip**：底栏左侧一直挂着一颗「目标 未选择 · 点这里选择」/「目标 X · 已绑定」，
   用户要的是**一行会变的提示字**（像状态信息那样出现一次就够），不要常驻元素。

### 二、修改

| 文件 | 改动 |
|---|---|
| `plugins/installed/taskhive-surfaces/dsh/client.js` | IP 行的两个输入框与按钮**改用既有类名**（`taskhive-codesys-online-target-address` / `-address.is-port` / `-apply`）—— 皮肤一致是"用同一套类"保证的，不是再抄一遍颜色；删掉自定义的 `.taskhive-codesys-scan-ip-input/-apply` 规则，只留这一行的排布 |
| 同上 | **删除常驻目标 chip**（含未绑定那颗"未选择"）。改为：绑定/更换目标时由**状态行播报一行**（`在线目标：<设备> · 已绑定（…）（登录/下载都会作用到它；要更换请点「扫描设备」）`），同一个目标只播报一次（`targetAnnouncedRef`），目标清空后下次绑定会再播一次 |
| 同上 | **只有已连接时**才在底栏保留一个可点的目标入口（那时它表达的是"当前连着谁"），未连接状态底栏不再有目标元素 |
| `tests/codesys-online-gate-contract.js` | 断言改写：目标信息必须走状态行播报且只播一次、常驻 chip 文案不得回归（反向断言）、未绑定时不得渲染常驻元素 |

### T111 验证证据

| 日期 | 检查 | 结果 | 证据 |
|---|---|---|---|
| 2026-09-21 | `node tests/codesys-online-gate-contract.js` | 通过 | 皮肤一致性（复用类名）+ 目标播报一次 + 常驻 chip 反向断言 |
| 2026-09-21 | `node tests/run-contracts.js` | 通过 | **37 项合同 exit 0**（`cache/online-probe/contracts35.log`） |

### T111 待办（需真实界面验收）

1. 扫描面板里的 IP 行：输入框与「用作目标」按钮应与「在线目标」面板里的控件**长得一模一样**（高度、圆角、描边、焦点环）。
2. 底栏不再常驻显示目标；绑定/更换目标时**只在状态行出现一行**信息，随后被别的状态覆盖。
3. 只有连上之后，底栏才会出现「目标 <设备>」这个可点入口。
4. 真实验收前不得把本任务改为"已验证"。

## T112 「在线目标」弹层整体删除：目标操作只剩底部面板一处

### 用户口径

> （截图）「为什么这个依然存在，这个不是已经转移到底下了吗」

### 一、问题

T110/T111 只把 **IP 字段**搬进了底部面板，却把「在线目标」弹层本身留着（网关下拉、节点地址、
应用、取消、扫描设备…、释放在线会话、仿真/设备备注）。于是同一件事仍然有**两处入口**，
用户看到的还是那个弹层。

### 二、修改：弹层删除，内容全部搬到扫描面板

| 弹层里的东西 | 新家 |
|---|---|
| 网关下拉 | 面板里新增「手动指定」一行：`[网关 ▾] [节点地址] [用作目标]` |
| 节点地址输入 + 「应用」 | 同上（`data-codesys-scan-gateway` / `-address` / `-address-apply`） |
| 「扫描设备…」/「取消」按钮 | 不需要了：面板本身就是入口与出口 |
| 「释放在线会话」 | 面板头部右侧（`data-codesys-scan-release`，沿用「无会话/释放会话」文案） |
| 仿真 / 设备 IP 备注 | 面板状态行末尾（仿真时才追加 `· 仿真：…`） |
| IP 直连字段 | 上一轮已在面板里（`data-codesys-scan-ip*`） |

删除的代码：`onlineTargetPanelNode` 整个节点、`onlineTargetOpen` 状态、`openOnlineTargetPicker`
（改为 `openOnlineTargetPanel`，内部直接打开扫描面板并在缺网关时补拉），以及弹层专用的 CSS
（`-panel` / `-title` / `-mode` / `-sim` / `-note` / `-hint`）。在线徽标与"已连接时的目标 chip"
现在都改为打开这个面板。

### T112 验证证据

| 日期 | 检查 | 结果 | 证据 |
|---|---|---|---|
| 2026-09-21 | `node --check plugins/installed/taskhive-surfaces/dsh/client.js` | 通过 | 删除弹层时还顺手修掉了一处括号失衡（`onlineTargetPanelNode),` 原本兼作 `h('header')` 的收尾） |
| 2026-09-21 | `node tests/codesys-online-gate-contract.js`、`codesys-workbench-compact-layout-contract.js` | 通过 | 弹层标记不得回归（反向断言）、网关/地址/应用/释放必须已搬入面板、第一行切片终点改用命令条（原终点 `onlineTargetPanelNode)` 已不存在） |
| 2026-09-21 | `node tests/run-contracts.js` | 通过 | **37 项合同 exit 0**（`cache/online-probe/contracts37.log`） |

### T112 待办（需真实界面验收）

1. 工作台里**不应**再出现「在线目标」那个横条面板（无论是否已绑定）。
2. 目标相关操作只在一处：顶栏「扫描设备 / 已绑定」→ 底部面板（设备列表 + 手动指定一行 + IP 直连一行 + 头部释放会话）。
3. 已连接时点底栏「目标 <设备>」或在线徽标，应打开同一个底部面板。
4. 真实验收前不得把本任务改为"已验证"。


