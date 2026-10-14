# TaskHive 维护记录

## 2026-10-01 启动故障修复

- 根因：默认用户数据目录和系统临时目录实际拒绝 Electron 写入；工作台插件初始化仍引用已移除的 `service`。
- 实现：新增启动路径探测和一次性可持续配置迁移；修复 `taskhive-surfaces` 原生面板注册和清理；强化正式 smoke 对实际 workbench 输入框的检查。
- 验证：正式隔离 smoke 通过；普通界面、输入框、CODESYS 面板、重复启动和关闭重开通过；49 项契约通过；218 个原始会话文件哈希一致。
- 结果：TaskHive 可从 `TaskHive.exe` 正常打开，单实例保护保留。
- 剩余：记忆插件有一个非阻断 HTTP 405 设置接口告警。

2026-10-01：启动脚本去除重复启动后的暂停提示；保留单实例锁，后台启动验证通过。

## 2026-10-01 CODESYS 工作台右栏恢复（T114）

- 原因：升级后的面板迁移把代码工作台注册到了中央 `main`，并且沿用已不存在的 `sessions.list.current` 判断，阻止原生右栏打开。
- 修改：使用原生右栏类型和正文槽位；等待右栏绑定到拥有 `mainView` 引用的选中会话；通过 `uiWorkspace` 导航；“代码任务”先恢复聊天再打开右栏。CODESYS 名称与代码工作台名称分开。
- 状态：保留标签挂载与草稿，标签使用所属会话；后台标签不接管窗口检测和当前镜像；快照送达与确认增加会话归属，避免跨会话合并。
- 验证：真实隔离 Electron 的右栏入口、宿主代码按钮、对象编辑/切换、标签切换、收起重开和会话返回通过；1600×900 / 900×760 截图与边界检查通过；正式启动 smoke 通过；契约 50/50；源/运行时 bundle 一致。
- 边界：编辑检查注入离线对象到真实组件，始终没有绑定 ScriptEngine job，写入/在线动作保持禁用；未验证实体 PLC 操作。已有 Mnemon 前端未绑定 getSnapshot 的兼容性报错仍单独存在，不属于此次右栏改动。
- 记录：docs/SIDEBAR-REPAIR-20261001.md；测试进程清理后重新打开 TaskHive 即使用新版本。

## 2026-10-02 正式包 UI smoke 收尾（T115）

- 根因：交互元数据探针只生成 4 个报告，却按 5 个报告判定，因测试契约错误阻断正式 smoke 的最后阶段。
- 实现：同步修正 `.repo-stage/app/smoke/probes.js` 与 `resources/app/app/smoke/probes.js` 的报告数；契约在源码 checkout 缺少 slot `node_modules` 时回退检查正式包闭包。
- 验证：`node tests/subagent-delegation-contract.js` 通过；完整 `node tests/run-contracts.js` 结果 **50/50**；隔离正式包 smoke 使用独立运行目录完成到 `complete`，`smoke-ui-error.json` 已清理；`interactive-metadata-probe.json`、`repository-ui-probe.json`、`session-delete-probe.json` 均 `ok=true`，`electron-smoke.json` 显示 Harness ready、splash false、windowCount 1。
- React #130：本次正式包 smoke 的 `consoleBefore` / `consoleAfter` 均为空，未产生新的 React #130 证据；历史 EPERM 与 CODESYS detach 记录保留为历史诊断，不改写为本次故障。
- 运行边界：未停止或修改用户当前 TaskHive、DeepSeek、CODESYS 进程；未执行实体 PLC 在线写入。

## 2026-10-02 存储占用、诊断轮转与知识库整理（T116）

- 问题：诊断日志和 Chromium 可丢弃缓存没有明确上界，长期运行会持续增加磁盘占用；历史任务清单分散在版本根目录；TaskHive 相关开源项目没有结构化只读索引。
- 实现：新增 `app/diagnostic-log.js`，活动诊断日志约 2 MiB、保留两个轮转备份；启动、bootstrap 错误和 renderer console 日志统一使用该实现。Chromium `diskCacheSize` 设置为 128 MiB，限制从下一次启动生效。新增 `knowledge/repositories/taskhive-open-source/` 只读索引，保留来源、许可证、用途和审核边界。将旧 `TASKHIVE-1.0.1-MASTER.md`、`TASKHIVE-1.0.2-MASTER.md` 移至 `docs/archive/task-lists/`。
- 验证：`diagnostic-log-contract.js`、`runtime-storage-budget-contract.js` 通过；完整 `node tests/run-contracts.js` **52/52**；源码与正式包 smoke 探针语法通过；正式包隔离 UI smoke 到 `complete`，`electron-smoke.ok=true`，CODESYS/浏览器/知识库原生左栏探针 `ok=true`，CODESYS 工作台右栏渲染探针 `ok=true`，交互元数据和知识库同步 `ok=true`，无 `smoke-ui-error.json`。
- 探针修正：旧 `plugin-right-sidebar-probe` 把三个左栏插件误当成右栏；现在按实际架构验证左栏入口与渲染，工作台继续由专用右栏渲染探针验证。该修正只影响诊断证据，不改变插件运行逻辑。
- 边界：CODESYS 与 CODESYS 工作台仅整理优化方案，等待用户确认后再改；未清理现有 Chromium 缓存，未停止或修改用户当前 TaskHive、DeepSeek Harness、内嵌 DSH 或 CODESYS 进程。
