# TaskHive 1.0.2 唯一权威任务清单

更新时间：2026-08-31（Asia/Shanghai）  
唯一工作目录：`C:\Users\29925\Documents\TaskHive1.0.2`  
只读历史来源：`C:\Users\29925\Documents\TaskHive1.0.1`

## 文档地位与工作规则

本文档是 TaskHive 1.0.2 的唯一权威任务清单、实施记录、验证记录和恢复入口。

1. 后续所有改动只能发生在 `TaskHive1.0.2`，不得回写 `TaskHive1.0.1` 或更早版本。
2. 用户提出的新任务必须先登记为唯一编号，再开始实施；不得只依赖聊天记录。
3. 每完成一项任务，必须在同一轮同步更新本文件的状态、实现摘要、验证证据、风险和修改文件索引。
4. 未运行的测试不得标记为“已验证”；失败结果和未解决风险必须如实记录。
5. 会话中断或上下文压缩后，先读取本文档，再检查“当前进行项”和“修改文件索引”。
6. 除非用户明确要求，不修改或删除历史主文档；历史文档仅作参考。

## 基线事实

- 基线来源：`C:\Users\29925\Documents\TaskHive1.0.1`
- 当前副本：`C:\Users\29925\Documents\TaskHive1.0.2`
- 副本建立时间：2026-08-31
- 初始状态：承接 1.0.1 当前文件状态；后续变更从本目录开始累计。

## 状态定义

- `待开始`：已登记，尚未实施。
- `进行中`：正在实施，必须填写当前动作和阻塞点。
- `已实现待验证`：代码或文件改动已完成，验证尚未完成。
- `已验证`：有可复现的检查、测试或用户验收证据。
- `已阻塞`：同一阻塞条件连续复现且需要外部状态或用户决策。
- `已取消`：用户明确取消；保留原因和相关改动。

## 当前任务清单

| 编号 | 任务 | 状态 | 实现/验证摘要 | 风险/后续 |
|---|---|---|---|---|
| T001 | 建立 1.0.1 独立工作基线与权威任务清单 | 已验证 | 已完成 1.0.0→1.0.1 完整复制；Robocopy：72,418 文件、8,041 目录、约 1.02 GB，失败 0；本文件已建立。 | 后续任务从 T002 起连续编号。 |
| T002 | 诊断并优化 CODESYS 代码任务上下文过长、写入工程过慢 | 已验证（静态与历史证据） | 已从 1.0.0 运行状态和作业证据定位：一次历史任务达到 91,199 输入 token/92,374 总 token；工程上下文约 93.9k 字符；确认写入按对象逐个启动 CODESYS ScriptEngine。1.0.1 已改为提示词相关对象紧凑上下文（保留完整工程索引）和 `apply-changes` 单进程批量写入、单次保存。JS 语法、工作台/当前工程/活动工程合同及生成 Python 语法均通过。 | 尚未在用户当前真实工程上做端到端写入计时；需用户明确安排离线副本复测。 |
| T003 | 诊断真实 CODESYS 程序写入耗时是否为必需等待 | 已实现待真实验证 | 已确认当前链路仍包含：写前复制工程→创建恢复快照→启动独立 CODESYS `--noUI`→打开工程→写入→`project.save()`→关闭进程→提交源文件→再启动一次 Build→再完整 inspect。1.0.1 已加入 `jobRead/stageCopy/requestNormalize/recoverySnapshot/scriptEngineProcess/sourceCommit/metadataWrite/total` 分阶段计时，并在工作台状态栏显示批量写入与 ScriptEngine 耗时。 | 只有 `project.save()`、CODESYS 工程解析/锁和必要的外部文件提交属于基本成本；Build、再次完整 inspect、恢复快照和安全审计是可区分的流程成本。需用户用真实工程复测后决定哪些步骤可改为手动或按需。 |
| T004 | 修复默认工作区 ENOENT 与终端空白 | 已验证（隔离启动） | 启动时修复 DSH 持久化 `workspace.json`/`session_projcache.json` 中旧发布目录路径，创建时间戳备份并确保新目录存在；终端后端校验 cwd 存在性，失效路径回退到有效 cwd，避免 `node-pty` 因 ENOENT 失败导致空白。 | 真实用户会话需重启 1.0.1 触发迁移；不会删除历史数据。node-pty 原生依赖损坏时仍显示依赖修复提示。 |
| T005 | 修复 CODESYS 插件切换后窗口残留，以及运行一段时间后误报“尚未打开程序” | 已实现待真实界面验证 | 切换离开 CODESYS 时，原生窗口隐藏操作采用 350ms 交接预算，不再阻塞会话切换；窗口所有权在隐藏期间不被误退休，并允许同一插件 PID 的后续 HWND 重建重新认领；当前工程探测增加同 PID 的最后成功结果缓存，避免短暂枚举失联清空绑定；工作台每 15 秒后台复核且不重复昂贵 ScriptEngine inspect。 | 需要用户在真实 CODESYS 上验证切换响应和长时间运行后的识别；只跟踪当前 TaskHive 启动并登记的 PID，不接管手动打开的 CODESYS。 |
| T006 | 允许 CODESYS 代码任务写入用户绑定的完整工程路径，不受 TaskHive 工作区限制 | 已实现待真实验证 | CODESYS 任务提交时将当前 Harness 会话切换到 `danger-full-access`，并写入 `pathAuthorization`：仅授权用户绑定的 `.project`、工程目录及当前 ScriptEngine 隔离作业/快照路径；任务指令明确携带授权清单，禁止清单外路径和全部 PLC 在线动作。新增路径授权单元合同测试。 | 尚未在用户当前真实 CODESYS 工程上做端到端写入；需用户用真实工程确认模型读取和确认写入均不再被工作区沙箱拦截。 |
| T007 | 修复长对话下界面卡顿，尤其是输入框打字延迟 | 已实现待真实界面验证 | 根因为长会话消息行全部参与输入按键引发的布局/绘制。TaskHive 自有皮肤为视口外 `[data-chat-flow-key]` 启用 `content-visibility:auto`、布局/绘制隔离和可记忆 intrinsic size；会话数据与历史消息不删除。新增渲染合同测试。 | 需在长历史真实会话中用 DevTools/用户体验确认输入延迟改善；低版本 Chromium 不支持 `content-visibility` 时仅退化为原布局。 |
| T008 | 将后续 TaskHive 改动切换到 1.0.2 独立工作目录 | 已验证 | 已确认 `C:\Users\29925\Documents\TaskHive1.0.2` 存在并承接当前 1.0.1 文件状态；已建立本文件作为 1.0.2 唯一权威任务清单。 | 1.0.1 及更早版本只读保留；后续新增任务从 T009 连续编号并只修改 1.0.2。 |
| T009 | 修复 CODESYS 代码任务 `permissionPresets` 未注入导致提交失败 | 已验证 | 已将 `permissionPresets` 加入 `taskhive-surfaces` 的 Cordis 模块注入声明，使 CODESYS 工作台可安全切换当前会话到 `danger-full-access`；新增注入回归合同测试。 | 仍只对当前绑定工程及隔离作业路径授权；未改变 PLC 在线操作禁令。 |
| T010 | 修复 Harness 启动时 `taskhive-surfaces` 因等待 `permissionPresets` 无法激活 | 已验证 | 将 `permissionPresets` 从插件和客户端模块的硬注入移除，改为 `ctx.inject(['permissionPresets'], ...)` 可选注入；服务存在时仍启用完整路径权限，不存在时插件照常启动并在提交时明确拒绝越权任务。 | 需在当前发布包重启 Harness 确认插件状态为 active；权限服务未挂载的配置仍不能提交需要真实工程访问的 CODESYS 任务。 |
| T011 | 修复代码任务因缺少完整路径权限预设而提交失败；所有会话允许操作任意本地路径 | 已实现待真实 Harness 验证 | 1.0.2 启动环境固定 `DSH_PERMISSION_MODE=danger-full-access`；生成的 Harness patch 显式覆盖 `sandbox-policy.mode=danger-full-access`、`approval.policy=never`、`permission.defaultPreset=danger-full-access`。CODESYS 提交在服务可用时同步当前会话，但不再因客户端服务暂时不可见而拒绝；路径授权审计标记为全路径（`*`），PLC 在线动作仍禁止。 | 必须重启 1.0.2 后确认实际运行日志不再出现 `pending (waiting for service: permissionPresets)`，并在真实工程离线副本提交一次代码任务。全路径权限扩大了文件操作范围，需依赖用户确认和各工具自身安全边界。 |
| T012 | 修复输入代码任务时工具闪烁/重绘 | 已验证（隔离 UI） | 代码任务输入拆为 `React.memo` 独立组件；移除浏览器端错误权限依赖和每次提交的权限切换，避免插件重挂载；修复表面切换后的异步 DOM 写入竞态。两轮隔离 UI smoke 中最终插件稳定注册、无新权限 pending 或空节点写入异常。 | 真实超长历史下的主观输入流畅度仍建议由用户日常使用确认；若仍闪烁需记录具体操作和时间点。 |
| T013 | 所有 Harness 会话均允许操作任意本地路径，并修复权限服务加载链路 | 已验证（隔离 Harness/UI） | 确认 DSH patch 的 `config` 为整段替换语义，撤除对 `sandbox-policy`/`approval`/`permission` 的不完整覆盖，保留基础 bundle 的完整服务配置；启动环境固定 `DSH_PERMISSION_MODE=danger-full-access`，并在后端插件激活时将已有会话及后续新会话统一切换到 `danger-full-access`。定位到浏览器客户端错误硬注入仅存在于主进程的 `permissionPresets`，已移除该客户端依赖及提交时冗余切换。隔离 UI 中插件 active，新建会话权限投影为 `danger-full-access`。 | 全路径权限意味着会话工具可读写任意本地路径；仍受工具自身协议和 Windows 账户权限约束。 |
| T014 | 精简 `FiveDOF_Platform_PRG` 现场保护逻辑，仅按功能命令触发执行 | 已取消 | 用户随后明确取消上一条命令；未修改 CODESYS 工程、未下载 PLC、未执行现场动作。 | 如以后重新提出，必须重新读取目标工程并确认要保留的急停、限位和驱动故障边界。 |
| T015 | 修复切换 CODESYS/会话时异步窗口刷新写入已卸载 DOM 导致的控制台错误和短暂闪烁 | 已验证（隔离 UI） | `refreshWindows()` 在入口及窗口枚举异步返回后检查目标节点存在且仍连接；表面已切走时立即结束，不再对 `null` 写 `innerHTML`。最终隔离 UI smoke 未再出现该异常。 | 真实 CODESYS 长时间切换仍建议用户使用验收。 |

## 当前进行项

T012/T013/T015 已通过隔离 Harness/UI 验证；T014 已取消。无代码任务处于进行中。

## 修改文件索引

| 日期 | 任务编号 | 文件 | 变更摘要 |
|---|---|---|---|
| 2026-08-31 | T001 | `TASKHIVE-1.0.1-MASTER.md` | 建立本版本唯一权威任务清单和恢复规则。 |
| 2026-08-31 | T002 | `resources/app/plugins/installed/taskhive-surfaces/dsh/client.js` | CODESYS 代码任务改用按提示词筛选的紧凑工程上下文，并在界面显示估算 token 和选中对象数；确认写入改为批处理。 |
| 2026-08-31 | T002 | `resources/app/plugins/installed/codesys-monitor/scriptengine.cjs` | 新增 `apply-changes` 白名单动作，一次 ScriptEngine 进程应用多对象变更并只保存一次。 |
| 2026-08-31 | T002 | `resources/app/app/main.js` | 将上下文字符数、估算 token、选中/总对象数写入请求审计记录。 |
| 2026-08-31 | T002 | `resources/app/tests/codesys-workbench-ui-contract.js` | 更新工作台合同，验证紧凑上下文和批量写入入口。 |
| 2026-08-31 | T003 | `TASKHIVE-1.0.1-MASTER.md` | 登记真实程序写入耗时诊断任务。 |
| 2026-08-31 | T003 | `resources/app/plugins/installed/codesys-monitor/scriptengine.cjs` | 为 ScriptEngine 作业加入分阶段耗时证据。 |
| 2026-08-31 | T003 | `resources/app/plugins/installed/taskhive-surfaces/dsh/client.js` | 在工作台写入状态显示批量链路、脚本和恢复快照耗时。 |
| 2026-08-31 | T004 | `TASKHIVE-1.0.1-MASTER.md` | 登记默认工作区 ENOENT 与终端空白修复任务。 |
| 2026-08-31 | T004 | `resources/app/app/main.js` | 启动时迁移 DSH 持久化默认工作区路径；创建备份、修复日志并确保新工作区目录存在。 |
| 2026-08-31 | T004 | `resources/app/plugins/installed/better-sidebar/src/index.ts` | `sessionCwdOf` 校验 cwd 存在性，失效持久化路径回退到有效客户端 cwd/进程 cwd。 |
| 2026-08-31 | T004 | `resources/app/plugins/installed/better-sidebar/lib/index.js` | 同步发布版 host bundle 的 cwd 存在性防护，确保实际运行加载修复。 |
| 2026-08-31 | T005 | `resources/app/app/main.js` | CODESYS 当前工程探测增加同 PID 成功结果缓存；插件切换隐藏采用有限交接预算，避免会话切换被慢速 PowerShell/窗口操作阻塞。 |
| 2026-08-31 | T005 | `resources/app/app/codesys-window-ownership.js` | 隐藏托管窗口不再被误判为已销毁；同一插件 PID 的新 HWND 可在冻结后重新认领。 |
| 2026-08-31 | T005 | `resources/app/plugins/installed/taskhive-surfaces/dsh/client.js` | CODESYS 工作台增加 15 秒后台探测和瞬时探测失败保护，避免显示状态被一次失联清空。 |
| 2026-08-31 | T006 | `resources/app/app/codesys-path-authorization.js` | 新增受限 CODESYS 绝对路径授权构造器；范围仅绑定工程、工程目录和隔离作业路径，明确禁止 PLC 在线动作。 |
| 2026-08-31 | T006 | `resources/app/app/main.js` | CODESYS 代码请求写入路径授权审计记录，并将授权清单传递给 Harness 任务。 |
| 2026-08-31 | T006 | `resources/app/plugins/installed/taskhive-surfaces/dsh/client.js` | CODESYS 代码任务提交前为当前会话启用 `danger-full-access`，提示词携带绝对路径授权和越权禁止边界。 |
| 2026-08-31 | T006 | `resources/app/tests/codesys-path-authorization.js` | 覆盖工作区外真实工程路径授权、工程目录/作业目录包含关系及空输入不授权。 |
| 2026-08-31 | T007 | `TASKHIVE-1.0.1-MASTER.md` | 登记长对话输入卡顿修复任务。 |
| 2026-08-31 | T007 | `resources/app/plugins/installed/taskhive-surfaces/dsh/client.js` | 为视口外聊天消息启用 `content-visibility:auto`、布局/绘制隔离和 intrinsic size，减少输入时全历史重排。 |
| 2026-08-31 | T007 | `resources/app/tests/long-conversation-render-contract.js` | 验证长会话渲染优化 CSS 契约存在。 |
| 2026-08-31 | T008 | `TASKHIVE-1.0.2-MASTER.md` | 从 1.0.1 承接权威清单，切换后续任务唯一工作目录到 1.0.2。 |
| 2026-09-01 | T009 | `TASKHIVE-1.0.2-MASTER.md` | 登记 CODESYS 代码任务权限服务未注入错误。 |
| 2026-09-01 | T009 | `resources/app/plugins/installed/taskhive-surfaces/dsh/client.js` | 将 `permissionPresets` 加入 Cordis `module.exports.inject`，修复代码任务提交时权限服务缺失。 |
| 2026-09-01 | T009 | `resources/app/tests/codesys-permission-inject-contract.js` | 验证权限服务注入声明和会话权限切换调用存在。 |
| 2026-09-01 | T010 | `resources/app/plugins/installed/taskhive-surfaces/dsh/index.js` | 将 `permissionPresets` 从硬注入改为可选 scoped 注入，避免插件启动挂起。 |
| 2026-09-01 | T010 | `resources/app/plugins/installed/taskhive-surfaces/dsh/client.js` | 将客户端权限服务改为可选注入引用，避免模块等待服务导致整个表面不激活。 |
| 2026-09-01 | T010 | `resources/app/tests/codesys-permission-inject-contract.js` | 更新回归合同，覆盖插件/客户端可选注入和权限调用。 |
| 2026-09-01 | T011 | `resources/app/app/harness-runtime.js` | 将 Harness 启动环境默认权限固定为 `danger-full-access`。 |
| 2026-09-01 | T011 | `resources/app/app/main.js` | 生成 DSH patch 时显式覆盖 sandbox、approval、permission 默认配置为全路径访问。 |
| 2026-09-01 | T011 | `resources/app/app/codesys-path-authorization.js` | 将路径审计模式改为全路径标记（`*`），保留工程/作业路径证据，继续标注 PLC 在线动作禁止。 |
| 2026-09-01 | T011 | `resources/app/plugins/installed/taskhive-surfaces/dsh/index.js` | 以模块级依赖同步获取 `permissionPresets`，避免异步服务导致提交竞态。 |
| 2026-09-01 | T011 | `resources/app/plugins/installed/taskhive-surfaces/dsh/client.js` | 读取同步注入的权限服务；不再因客户端服务暂时缺失阻断代码任务提交，提示词声明全路径 Harness 策略。 |
| 2026-09-01 | T011 | `resources/app/tests/codesys-permission-inject-contract.js` | 更新为模块级权限注入和全路径策略契约。 |
| 2026-09-01 | T011 | `resources/app/tests/codesys-path-authorization.js` | 更新全路径授权模式与 `*` 审计标记断言。 |
| 2026-09-01 | T012 | `resources/app/plugins/installed/taskhive-surfaces/dsh/client.js` | 将代码任务输入拆成 `React.memo` 独立组件；输入按键不再触发工程树、代码差异和写入面板重绘。 |
| 2026-09-01 | T013 | `resources/app/plugins/installed/taskhive-surfaces/dsh/index.js` | 对插件激活时的已有会话及后续新会话统一应用 `danger-full-access`，防止旧会话继续沿用工作区限制。 |
| 2026-09-01 | T013 | `resources/app/plugins/installed/taskhive-surfaces/dsh/client.js` | 移除浏览器端不存在的 `permissionPresets` 硬依赖和提交时冗余权限切换，消除插件永久 pending 与输入期间重挂载来源。 |
| 2026-09-01 | T013 | `resources/app/tests/codesys-permission-inject-contract.js` | 增加已有会话、新建会话全路径权限同步合同断言。 |
| 2026-09-01 | T013/T014 | `TASKHIVE-1.0.2-MASTER.md` | 登记全会话全路径权限修复及已取消的 PLC 程序精简请求。 |
| 2026-09-01 | T015 | `resources/app/app/renderer/renderer.js` | CODESYS 窗口异步刷新增加已卸载 DOM 防护，避免切换表面后的空节点写入。 |
| 2026-09-01 | T015 | `resources/app/tests/codesys-renderer-lifecycle-contract.js` | 新增表面生命周期竞态回归合同。 |

## 验证记录

| 日期 | 任务编号 | 检查 | 结果 | 证据 |
|---|---|---|---|---|
| 2026-08-31 | T001 | 源目录存在性、目标目录初始为空、Robocopy 完整复制 | 通过 | Robocopy exit code 1（表示已复制文件，无失败）；Files 72,418；Dirs 8,041；FAILED 0；Mismatch 0。 |
| 2026-08-31 | T002 | 1.0.0 运行记录与 CODESYS 作业状态诊断 | 通过 | `codex-history-current.json`：历史任务最大 `inputTokens=91199`、`totalTokens=92374`、`durationMs=200847`；1.0.0 作业上下文 `project-context.json` 约 93,923 字符（实际文件 104,725 bytes）。 |
| 2026-08-31 | T002 | 1.0.1 JS 语法、CODESYS 工作台/工程合同、批量 ScriptEngine 生成脚本语法 | 通过 | `node --check`（main.js、scriptengine.cjs、client.js）；`codesys-workbench-ui-contract.js`、`codesys-current-project.js`、`codesys-active-project-contract.js`；Python `py_compile`。 |
| 2026-08-31 | T003 | 1.0.0 历史作业时间戳拆分 | 已读取 | 已存在 `inspect-project → update-text → build → inspect-project` 串行链路；历史记录显示每次动作均独立启动 CODESYS ScriptEngine，当前尚无动作内部阶段耗时字段。 |
| 2026-08-31 | T003 | 1.0.1 分阶段耗时实现 | 已通过静态检查 | 后续 `codesys-scriptengine-offline-workbench.json` 将记录 `timings`，工作台显示关键阶段；尚未对真实工程执行写入。 |
| 2026-08-31 | T004 | 用户运行错误 | 已定位 | `workspace.json` 与 `session_projcache.json` 同时保存旧发布目录；终端 host 会将该失效 cwd 交给 `node-pty`，造成 ENOENT/空白。懒加载 chunk 文件存在且可解析。 |
| 2026-08-31 | T004 | Node/Electron 静态检查 | 通过 | `node --check`：`app/main.js`、`better-sidebar/lib/index.js`、`better-sidebar/lib/client-terminal.js`；`terminal-shell-contract.js` 通过（PowerShell 7.6.5）。 |
| 2026-08-31 | T004 | 隔离 profile 启动迁移验收 | 通过 | 临时 `TASKHIVE_RUNTIME_ROOT` + `--smoke-splash` 启动 1.0.1，退出码 0；两个 DSH storage 文件均改写为 1.0.1 新工作区路径并创建目录，未触碰真实 profile。 |
| 2026-08-31 | T005 | CODESYS 所有权与识别回归测试 | 通过 | `codesys-window-ownership.js`、`codesys-current-project.js`、`codesys-active-project-contract.js` 均通过；覆盖 HWND 替换、冻结后重新认领和活动工程判定。 |
| 2026-08-31 | T005 | 1.0.1 JS 静态检查 | 通过 | `node --check`：`app/main.js`、`app/codesys-window-ownership.js`、`plugins/installed/taskhive-surfaces/dsh/client.js`。 |
| 2026-08-31 | T006 | 路径授权合同与 CODESYS 任务链路静态检查 | 通过 | `codesys-path-authorization.js` 通过；`node --check`：`app/main.js`、`app/codesys-path-authorization.js`、`plugins/installed/taskhive-surfaces/dsh/client.js`；既有 `codesys-current-project.js`、`codesys-active-project-contract.js` 通过。 |
| 2026-08-31 | T007 | 长会话渲染优化静态/合同检查 | 通过 | `node --check plugins/installed/taskhive-surfaces/dsh/client.js`；`long-conversation-render-contract.js` 通过。 |
| 2026-08-31 | T007 | 隔离 Electron UI smoke | 未通过（与本改动无关） | `TaskHive.exe --smoke-ui --smoke` 在历史 CODESYS 生命周期探测阶段失败（`codesys-program-lifecycle-probe-failed`，实际加载路径显示为既有 1.1.4 运行时）；未将该结果计为 T007 成功证据。 |
| 2026-08-31 | T008 | 1.0.2 工作目录与权威清单检查 | 通过 | `Test-Path C:\Users\29925\Documents\TaskHive1.0.2` 返回 True；`TASKHIVE-1.0.2-MASTER.md` 已建立并明确禁止回写 1.0.1/旧版本。 |
| 2026-09-01 | T009 | CODESYS 权限注入语法与合同测试 | 通过 | `node --check plugins/installed/taskhive-surfaces/dsh/client.js`；`codesys-permission-inject-contract.js`；`codesys-path-authorization.js` 均通过。 |
| 2026-09-01 | T010 | Harness 可选权限注入语法与合同测试 | 通过 | `node --check plugins/installed/taskhive-surfaces/dsh/client.js`；`node --check plugins/installed/taskhive-surfaces/dsh/index.js`；`codesys-permission-inject-contract.js` 通过。 |
| 2026-09-01 | T011 | 1.0.2 JS 语法与回归合同 | 通过 | `node --check`（harness-runtime.js、main.js、taskhive-surfaces index/client）及 `codesys-permission-inject-contract.js`、`codesys-path-authorization.js`、`long-conversation-render-contract.js`、`codesys-workbench-ui-contract.js` 通过。 |
| 2026-09-01 | T011 | 1.0.2 packaged smoke | 通过（启动） | `TaskHive1.0.2\\TaskHive.exe --smoke` 退出码 0；尚未证明 Harness 插件树和真实权限服务已 active。 |
| 2026-09-01 | T012 | 输入闪烁静态检查 | 已实现待界面验证 | 稳定 `permissionPresets` 引用、保留长会话渲染隔离；未运行真实浏览器输入帧采样。 |
| 2026-09-01 | T013 | 1.0.2 隔离 Harness/UI smoke | 通过 | `--smoke-ui --smoke` 完成，`electron-smoke.json.ok=true`；`taskhiveSurfacesRegistered=true`，新建会话权限投影 `currentValue=danger-full-access`，本次无新的 `permissionPresets pending`。 |
| 2026-09-01 | T015 | 生命周期合同与最终隔离 UI smoke | 通过 | `node --check app/renderer/renderer.js`、`codesys-renderer-lifecycle-contract.js` 通过；最终 `electron-smoke.json.ok=true`，14:22:35 启动样本至结束无新的 `renderer.js:654` 异常。 |

## 更新模板

新增任务时至少填写：

- 编号（从上一个编号连续递增）
- 用户原始要求与验收口径
- 状态、当前动作、阻塞点
- 实现摘要与修改文件索引
- 验证命令/结果/证据
- 剩余风险和下一步
