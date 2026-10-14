# TaskHive 1.1.0 启动修复记录

日期：2026-10-01  
工作目录：`C:\Users\29925\Documents\TaskHive1.1.0`

## 复现与根因

直接启动 `TaskHive.exe` 时，Electron 在默认用户数据目录创建单实例锁失败，日志为 `process_singleton_win.cc:318` / `EPERM`。独立 Electron 44 探针同时确认 `%APPDATA%\TaskHive` 和系统临时目录不能创建普通文件；因此 DSH 的 spill-local 临时目录也会失败。该现象确认了写入被拒绝，但没有把原因武断归因到某个 Windows 安全策略。

工作台随后还显示 `Failed to load plugins`。`taskhive-surfaces` 的客户端已经迁移到 DSH 0.2 的 `ctx.layout.selectPanel`，但初始化路径仍访问不存在的 `service`，导致插件同步抛错。

## 修复

- 新增 `app/startup-paths.js`，在 Electron 单实例锁创建前探测用户数据和临时目录；拒绝写入时切换到安装目录下的 `user-data` / `user-data\temp`，保留单实例锁。
- 首次切换只复制可持续的会话、设置和浏览器状态；排除模型权重、缓存、日志、依赖目录、符号链接和运行时锁文件。原 `%APPDATA%\TaskHive` 保留不动。
- 修复 `taskhive-surfaces` 的原生面板注册、CODESYS 面板选择和清理回调，并由源分片重新生成 `dsh/client.js`。
- 加强 `--smoke`：必须确认 DSH boot promise、TaskHive surface、皮肤和可见输入框都已就绪。
- 保留 `Start-TaskHive.cmd` 的 sandbox 环境兼容设置，清除历史 `TASKHIVE_SKIP_SINGLE_INSTANCE` 绕过变量。

## 验证

- 隔离正式 Electron smoke：`ok=true`，runtime `ready`，主窗口存活，splash 已隐藏，workbench `ready=true`，composer 可见。
- 普通启动：工作台、侧栏、历史会话和输入框均已渲染，输入框可聚焦，CODESYS 面板切换可用。
- 重复启动：第二个进程退出码 0，已有窗口继续运行。
- 关闭后重新启动：通过。
- `node resources/app/tests/run-contracts.js`：49/49 通过。
- 两份客户端 bundle `--check`：通过；源与打包运行时的 `main.js`、`startup-paths.js`、`dsh/client.js` 哈希一致。
- 原始会话目录 218 个文件与迁移副本逐一哈希比对：218 个一致，0 个缺失。

记忆插件仍会对一个设置读取接口记录 HTTP 405，但不阻止工作台启动或输入操作。

## 重复启动提示优化（2026-10-01）

`Start-TaskHive.cmd` 保留 Electron 单实例锁，但改为后台启动并立即退出，不再在第二次点击后停留在“TaskHive has exited. Press any key…”提示。当前已有实例仍会被单实例机制唤回。

验证：`cmd /d /c Start-TaskHive.cmd` 返回码 0、耗时约 69 ms；TaskHive 窗口仍为 1 个且标题为 `TaskHive`；调试端口 9331 未监听。
