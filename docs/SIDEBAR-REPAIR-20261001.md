# CODESYS 工作台右栏恢复

工作目录：`C:\Users\29925\Documents\TaskHive1.1.0`。用户授权恢复右侧代码工作台。

## 问题与原因

DSH 从 0.1.3-alpha.2 的 Better Sidebar 升级至 0.2.0-rc.1 后，旧迁移将代码工作台注册为左栏入口与中央 `main` 面板。新版右栏仍允许插件，通过 `sidebarRightTabs` 注册类型，通过 `sidebar.right.pane.tab` 注册正文。

首次实测还发现沿用 `sessions.list.current` 的打开条件始终不满足。新版目录仅记录会话和引用计数，原生 workspace UI 通过 `retainedBy.mainView` 识别选中会话；导航由 `uiWorkspace.openSession` 和 `connectWorkspace` 提供。工作台现在等待选中会话的右栏完成挂载后打开。

## 修改文件

源代码在 `.repo-stage`，指定文件同步至 `resources/app`。

| 文件 | 修改用途 |
| --- | --- |
| `plugins/installed/taskhive-surfaces/dsh/src/80-codesys-task-and-apply.js` | 原生右栏注册、等待正确会话挂载、宿主代码按钮导航与订阅清理 |
| `src/50-codesys-workbench.js` | 标签所属会话、可见性、后台检测与镜像保护、快照送达按会话识别 |
| `src/40-session-records-panel.js` | 待发送快照及确认只归属于其会话 |
| `src/00-core-and-surfaces.js` | 中央 CODESYS 描述与历史名称归一化 |
| `plugins/installed/taskhive-surfaces/dsh/client.js` | 从源分片构建生成，未手工修改 |
| `plugins/catalog.json`、`plugins/installed/codesys-monitor/plugin.json`、`app/renderer/renderer.js` | 中央能力统一名为 CODESYS；代码工作台保留独立名称 |
| `tests/surfaces-startup-behaviour.js` | 真实 apply 的原生槽位注册、会话等待、导航、所属会话与清理 |
| `tests/codesys-workbench-session-behaviour.js` | 实际发送函数的会话隔离、拒收重试与迟到确认 |
| `tests/codesys-permission-inject-contract.js`、`tests/plugin-identity-contract.js`、`tests/codesys-workbench-ui-contract.js` | 刷新新版原生服务与分离能力的契约 |

## 验证

- `node resources/app/tests/run-contracts.js`：50/50 通过，0 超时。
- 源与运行时的 `node tools/build-client-bundle.js --check` 通过；生成脚本语法通过。
- 正式包 `TaskHive.exe --no-sandbox --smoke-isolated --smoke`：`ok=true`，DSH ready、皮肤 ready、composer 可见、splash 已退出；证据时间为 `2026-10-01T13:06:49` UTC。
- 隔离 Electron CDP 验证：右栏“＋”菜单的 CODESYS 工作台入口、中央 CODESYS 的“代码任务”按钮均打开右栏；聊天仍在中间，宿主插件覆盖层已释放。
- 在真实 React 组件状态中注入两个离线代码对象，使用 DOM 输入事件编辑；切换对象、切换标签、收起再展开均保留草稿。创建第二个隔离 Harness 会话后，代码没有混入新会话；返回原会话恢复草稿。
- 1600×900 / 900×760 截图与矩形检查通过，聊天与工作台不重叠；未修改原有分隔拖动与编辑器样式。
- 两份 bundle SHA-256：`E07A9500B2D4A6FCE163D7226A833DEC91ABAAA7CA806D8A1B460F52F364DC61`。

证据：`.sidebar-repair/ui-verification.json`、`desktop-draft.png`、`narrow-draft.png`、`contracts-final.log`、`resources/app/logs/electron-smoke.json`。

测试进程已退出，9332/9333 调试端口已关闭，剩余 Node/Harness 进程不属于本次 TaskHive 隔离实例，未操作。自动审批拦截了 `.sidebar-repair/browser` 测试缓存目录的递归清理，该目录保留。

## 边界与后续预防

未修改旧版 TaskHive1.0.3 或 Harness 核心，未启动、关闭或操作现场 CODESYS/PLC。本次编辑检查始终不绑定 ScriptEngine job；写入及在线动作禁用，因此不属于实机写入验收。

既有 Mnemon 前端把 `sessions.list.getSnapshot` 未绑定地传入 React，仍有 `refreshSnapshot` 兼容性错误；它在未打开代码工作台时也出现。本次未修改该第三方插件。全工作树 `git diff --check` 还报告既有 CRLF/文档行尾问题；本次 JS/JSON 的限定检查按 CRLF 规则通过，未批量改动其他文件。

后续升级应分别验证中央面板与会话右栏的真实注册接口，并同时运行当前版本原生会话数据的行为测试和正式 Electron UI。生成 bundle 只能从 `src/*.js` 构建；仅更新字符串断言不能替代真实右栏检查。
