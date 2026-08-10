# Codex 本地客户端便携包说明

## 启动

1. 解压 `codex-local-client-portable-*.zip` 到新电脑任意目录。
2. 双击 `run-portable.cmd`，或运行：

```powershell
.\launch-portable.ps1
```

3. 浏览器会打开 `http://127.0.0.1:5177/`。

## 必须手动补充的认证

压缩包不会包含真实 `auth.json`、API Key、令牌或沙箱密钥。首次在新电脑使用模型服务前，请把新电脑可用的认证写入：

```text
user-config\.codex\auth.json
```

可参考同目录的 `auth.example.json`。`config.toml` 已放入不含密钥的模型 provider 模板。

## 已包含内容

- 客户端前端、后端、启动脚本、维护记录、历史记录和 launcher 日志。
- 包内 Node 运行时和当前 `@openai/codex` CLI 包。
- CODESYS MCP 与 AutoCAD MCP 工具目录。
- `C:\logs` 的日志/备份快照。
- 当前 Python 工作区、CODESYS Git 工作区和 `C:\path` 工程缓存快照，位于 `engineering-snapshots\`。
- 用户级 `.codex\skills` 和 `.codex\rules`，不含认证和会话数据库。

## 未包含内容

- `auth.json`、API Key、token、`.sandbox-secrets`。
- Codex 会话 SQLite 数据库、沙箱临时目录、`.git` 元数据、`node_modules` 缓存、Python `__pycache__` 和测试缓存。
- CODESYS、AutoCAD、Python、Git LFS 等外部软件安装程序。相关功能需要新电脑已安装对应软件；基础客户端页面和模型推理可使用包内 Node/Codex 启动。

## 目录约定

- `user-config\.codex`: 便携 Codex 配置目录。
- `portable-runtime`: 包内 Node、Codex CLI 和本地 AppData/LocalAppData。
- `tools-integrations`: 包内 MCP 工具目录。
- `logs`: 新电脑运行后的客户端日志和镜像日志。
- `logs-snapshot`: 原电脑 `C:\logs` 快照。
- `engineering-snapshots`: 原电脑工程快照，不会自动覆盖新电脑目录。
