# TaskHive 1.0.1 唯一权威任务清单

更新时间：2026-08-31（Asia/Shanghai）  
唯一工作目录：`C:\Users\29925\Documents\TaskHive1.0.1`  
只读历史来源：`C:\Users\29925\Documents\TaskHive1.0.0`

## 文档地位与工作规则

本文档是 TaskHive 1.0.1 的唯一权威任务清单、实施记录、验证记录和恢复入口。

1. 后续所有改动只能发生在 `TaskHive1.0.1`，不得回写 `TaskHive1.0.0`。
2. 用户提出的新任务必须先登记为唯一编号，再开始实施；不得只依赖聊天记录。
3. 每完成一项任务，必须在同一轮同步更新本文件的状态、实现摘要、验证证据、风险和修改文件索引。
4. 未运行的测试不得标记为“已验证”；失败结果和未解决风险必须如实记录。
5. 会话中断或上下文压缩后，先读取本文档，再检查“当前进行项”和“修改文件索引”。
6. 除非用户明确要求，不修改或删除历史主文档；历史文档仅作参考。

## 基线事实

- 基线来源：`C:\Users\29925\Documents\TaskHive1.0.0`
- 当前副本：`C:\Users\29925\Documents\TaskHive1.0.1`
- 副本建立时间：2026-08-31
- 初始状态：从 1.0.0 完整复制，后续变更从本目录开始累计。

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

## 当前进行项

无。T007 已完成实现，等待真实长会话界面验收。

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

## 更新模板

新增任务时至少填写：

- 编号（从上一个编号连续递增）
- 用户原始要求与验收口径
- 状态、当前动作、阻塞点
- 实现摘要与修改文件索引
- 验证命令/结果/证据
- 剩余风险和下一步
