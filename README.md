# CODESYS AI MCP Client (TaskHive 1.0.3)

TaskHive 桌面客户端的**应用层源码 + 全部配置文件夹**。

TaskHive 是一个 Electron 桌面客户端，通过 Harness 运行时把大模型接到本机 **CODESYS** 工程站：
内置 `codesys-monitor` 插件调用 CODESYS ScriptEngine 完成工程打开、导出、导入、编译、
在线会话与项目树读取；同时提供 Codex / MCP、终端、专家库、知识库、插件管理等能力。

---

## 一、仓库内容

本仓库对应正式发布包里的 `resources/app` 目录（即应用层），已剔除依赖与本机运行痕迹：

| 目录 | 说明 |
|---|---|
| `app/` | Electron 主进程与渲染层源码（`main.js`、`renderer.js`、`preload.js`、全部 `codesys-*.js`） |
| `plugins/` | 插件目录：`catalog.json`、`manager.js`、`codesys/`、`installed/`（含 `codesys-monitor`） |
| `profiles/` | **配置文件夹（见第二节）** |
| `experts/` | 专家库：`experts.json`、`catalog.json`、`config-store.js`、已安装专家 |
| `knowledge/` | 知识库：`cards.json`、CODESYS 安全规则等 |
| `repositories/` | 仓库管理：`manager.js`、`distill/` 源码 |
| `harness/` | Harness 运行时描述：`core.js`、`runtime/slot/`（闭包清单、SBOM、锁文件） |
| `tests/` | 契约测试（含 CODESYS 启动、窗口归属、在线门禁等） |
| `tools/` | 维护脚本：`clean-release.ps1`、各 `inspect-*.mjs` |
| `docs/` | `TASKHIVE-1.0.x-MASTER.md`、`KNOWN-ISSUES.md`、`release-manifest.json` |
| `package.json` | 应用清单（`npm start` 启动 Electron） |

### 未包含的内容及原因

| 未包含 | 原因 |
|---|---|
| `TaskHive.exe`（215 MB） | 超过 GitHub 单文件 100 MB 硬限制，无法入库 → 见 Releases |
| `*.dll` / `*.pak` / `locales/` | Electron 运行时二进制，随 Releases 完整包提供 |
| `node_modules/`（781 个目录、2509 个 junction） | 依赖可由锁文件重建；junction 入库后克隆会损坏 |
| `workspaces/`（约 497 MB） | CODESYS 作业运行快照，属本机运行数据 |
| `cache/`、`logs/` | 本机缓存与日志 |

---

## 二、配置文件夹（齐全）

配置文件夹已全部入库，克隆后即可直接对应使用：

```text
profiles/
├─ api-credentials.json      # 模型 API 凭据占位（当前为空 {}，请自行填写）
├─ directories.json          # 工作目录配置
├─ model-catalog.json        # 模型目录
└─ dsh/
   ├─ plugin-links.json      # 插件链接配置
   ├─ taskhive.patch.yml     # 主配置：模型路由、插件启用与参数
   └─ profiles/web/          # Web 侧配置（cordis.yml、pnpm 锁文件等）

experts/
├─ experts.json              # 专家清单
├─ catalog.json
├─ config-store.js
└─ installed/taskhive-plc-experts/

plugins/
├─ catalog.json              # 插件目录
└─ codesys/offline-jobs.json # CODESYS 离线作业配置

knowledge/
├─ cards.json
└─ repositories/taskhive-core/codesys-safety.md
```

> ⚠️ **`profiles/api-credentials.json` 已入库且当前为空（`{}`）。**
> 请勿把真实 API Key 提交进本仓库；填写密钥后请把该文件加入 `.gitignore`。

---

## 三、如何运行

本仓库是**应用层源码**，不含 Electron 运行时与依赖。两种使用方式：

### 方式 1：下载完整可运行包（推荐给普通用户）

到 **[Releases](https://github.com/shifeng2026/codesys-ai-mcp-client/releases)** 页面下载：

| 文件 | 大小 | 说明 |
|---|---|---|
| `TaskHive-1.0.3-win-x64.zip` | 762 MB | 解压后双击 `TaskHive.exe` 即可使用，无需安装 Node.js |

直链：

```text
https://github.com/shifeng2026/codesys-ai-mcp-client/releases/download/v1.0.3/TaskHive-1.0.3-win-x64.zip
```

解压后目录结构：

```text
TaskHive-1.0.3\
  TaskHive.exe        程序入口，双击启动
  使用说明.txt
  resources\app\      程序本体与全部配置文件夹
  *.dll *.pak *.dat   Electron 运行库
```

> 压缩包内含 27 万个文件，Windows 资源管理器解压较慢，建议用
> 7-Zip 或 `tar -xf TaskHive-1.0.3-win-x64.zip`。

### 方式 2：从源码构建（开发者）

1. 准备 Electron 运行时（Electron 43.x）。
2. 把本仓库内容放到运行时的 `resources/app` 目录下。
3. 安装依赖：

   ```powershell
   cd resources\app
   pnpm install
   ```

4. 启动：

   ```powershell
   npm start
   ```

配置 CODESYS 路径与配置文件名后即可连接本机 CODESYS 工程站。
可用 `.\tools\clean-release.ps1`（默认 dry-run）检查发布目录是否残留 QA 状态与密钥。

---

## 四、安全说明

- 本仓库**不含** DSH 会话密钥（`.credentials.yaml`）、Chromium Cookie、IndexedDB 等敏感数据。
- `docs/qa-evidence-*.zip` 为 QA 证据归档，不含凭据。
- 请勿向公开仓库提交真实 API Key 与本机路径凭据。

## License

应用代码版权归仓库所有者。`docs/ELECTRON-LICENSE.txt` 为 Electron 运行时许可证（MIT）。
