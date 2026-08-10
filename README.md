# Codex 本地客户端

一个本地 Web 客户端，用中文界面包装本机 Codex CLI。服务只监听 `127.0.0.1`，后端通过 `codex exec --json` 启动任务并把输出实时推送到页面。

## 启动

```powershell
cd C:\Users\29925\codex-local-client
npm start
```

然后打开：

```text
http://127.0.0.1:5177
```

也可以直接双击 `start-codex-client.cmd`。

如果你想用 Windows 程序入口，直接双击 `CodexLocalClient.exe`。它会隐藏启动本地服务并打开浏览器。

## 配置

- `PORT`: 修改监听端口，默认 `5177`
- `HOST`: 修改监听地址，默认 `127.0.0.1`
- `CODEX_BIN`: 指定 Codex 可执行文件
- `CODEX_CLIENT_WORKSPACE`: 指定默认工作目录

Windows 上默认会优先用 npm 安装目录里的 `@openai/codex/bin/codex.js`，避免 PowerShell 执行策略拦截 `codex.ps1`。

## 重新生成 exe

```cmd
build-exe.cmd
```
