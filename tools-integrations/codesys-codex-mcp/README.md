# CODESYS Codex MCP Bridge

这个工具包把 Codex 接到本机 CODESYS 工程站：

- Codex 通过 MCP 调用本地 Node.js server。
- Node.js server 调用 `CODESYS.exe --runscript ... --scriptargs:... --noUI`。
- CODESYS ScriptEngine 执行项目打开、导出、导入、编译、项目信息读取。

默认不提供 PLC 下载、在线变更、启动、停止、复位、强制等在线控制能力。

## Prerequisites

- Windows 工程站。
- Node.js 18 或更新版本。
- CODESYS Development System。
- Codex CLI / Codex IDE extension / Codex app 中可读取 `~\.codex\config.toml` 的 MCP 配置。

## Local Install

在本机安装并写入当前用户的 Codex 配置：

```powershell
cd C:\Users\29925\codesys-codex-mcp
.\scripts\install-local.ps1 `
  -CodesysExe "C:\Program Files\CODESYS 3.5.21.0\CODESYS\Common\CODESYS.exe" `
  -CodesysProfile "CODESYS V3.5 SP21"
```

如果 CODESYS 路径各电脑不一致，可以省略 `-CodesysExe`，server 会在常见 Program Files 目录中自动查找；也可以在每次工具调用时传 `codesysExe`。

安装后重启 Codex 或新开 Codex 会话。

## Tools Exposed To Codex

- `codesys_validate_setup`: 检查 Node、server、Codex config、CODESYS.exe、CODESYS 脚本。
- `codesys_project_info`: 打开 CODESYS project 并返回项目对象概览。
- `codesys_build_project`: build/rebuild/clean/generate_code，不下载到 PLC。
- `codesys_export_project`: 导出 PLCopenXML 或 CODESYS native export。
- `codesys_import_project`: 导入 PLCopenXML 或 native export 并可保存工程。
- `codesys_run_script`: 任意脚本执行，默认禁用；只有设置 `CODESYS_MCP_ALLOW_ARBITRARY_SCRIPT=1` 才可用。
- `python_command_suggest`: 按 Python 文件路径和版本号/文件哈希返回历史执行命令；没有历史时重新阅读代码生成命令。
- `python_command_history`: 查看一个文件或全部文件的 Python 执行命令记忆。
- `python_command_forget`: 删除某个文件、某个版本或全部 Python 执行命令记忆。

## Python Command Memory

Python 执行命令记忆默认保存在：

```text
%LOCALAPPDATA%\codesys-codex-mcp\python-command-memory.json
```

记忆规则：

- 不同 Python 文件按绝对路径隔离。
- 同一个文件按版本号和内容哈希隔离。
- 会识别 `__version__`、`VERSION`、`SCRIPT_VERSION`、文件名里的 `v26082` 这类版本。
- 没有历史记录或文件内容变化时，会重新读取 Python 代码，分析 `argparse`、`click`、`typer`、`sys.argv` 和 `__main__` 入口后生成建议命令。

示例话术：

```text
帮我生成这个 Python 文件的执行命令，并记住它：C:\path\tools\modify_export.py
```

```text
查看这个 Python 文件以前保存过的执行命令：C:\path\tools\modify_export.py
```

```text
这个 Python 文件版本变了，重新阅读代码并生成命令：C:\path\tools\modify_export.py
```

## Recommended Project Layout

```text
repo\
  AGENTS.md
  plc\
    Machine.project
    export\
      PLC_PRG.xml
      GVL.xml
  tools\
    codesys\
      build.py
```

把 `templates\AGENTS.md` 复制到 PLC 项目仓库根目录，让 Codex 遵守工程站安全边界。

## Package For Other Computers

生成 ZIP 部署包：

```powershell
cd C:\Users\29925\codesys-codex-mcp
.\scripts\New-DeploymentPackage.ps1
```

默认输出：

```text
C:\Users\29925\codesys-codex-mcp\dist\codesys-codex-mcp.zip
```

## Batch Deploy Through PowerShell Remoting

目标电脑需要启用 PowerShell Remoting，且你使用的账号需要能写入目标用户的 `~\.codex\config.toml`。

```powershell
cd C:\Users\29925\codesys-codex-mcp
.\deploy\Install-RemoteComputers.ps1 `
  -ComputerListPath .\deploy\computers.example.txt `
  -PackageZip .\dist\codesys-codex-mcp.zip `
  -CodesysProfile "CODESYS V3.5 SP21"
```

指定统一 CODESYS 路径：

```powershell
.\deploy\Install-RemoteComputers.ps1 `
  -ComputerName ENG-PC-01,ENG-PC-02 `
  -PackageZip .\dist\codesys-codex-mcp.zip `
  -CodesysExe "C:\Program Files\CODESYS 3.5.21.0\CODESYS\Common\CODESYS.exe" `
  -CodesysProfile "CODESYS V3.5 SP21"
```

如果目标机器没有 Node.js，并允许用 winget 安装：

```powershell
.\deploy\Install-RemoteComputers.ps1 `
  -ComputerListPath .\deploy\computers.txt `
  -PackageZip .\dist\codesys-codex-mcp.zip `
  -InstallNodeWithWinget
```

## Install From A Package On One Computer

把 ZIP 拷到目标电脑后运行：

```powershell
.\deploy\Install-FromPackage.ps1 `
  -PackageZip C:\Temp\codesys-codex-mcp.zip `
  -CodesysProfile "CODESYS V3.5 SP21"
```

## Smoke Test

协议级测试，不需要安装 CODESYS：

```powershell
.\scripts\Test-CodesysCodexMcp.ps1
```

真实 CODESYS 编译测试需要在装有 CODESYS 的工程站上让 Codex 调用：

```text
codesys_build_project with projectPath="C:\path\Machine.project"
```
