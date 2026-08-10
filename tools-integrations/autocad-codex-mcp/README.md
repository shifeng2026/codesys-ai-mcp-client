# AutoCAD Codex MCP

这个目录实现了一个本地 MCP server，让 Codex 通过 Windows COM Automation 调用 AutoCAD。

## 已实现工具

- `autocad_status`: 检查 AutoCAD COM 是否可用。
- `autocad_new_drawing`: 新建图纸，可指定模板。
- `autocad_open_drawing`: 打开 DWG/DXF。
- `autocad_save_as`: 保存当前图纸。
- `autocad_set_layer`: 创建/更新图层。
- `autocad_draw_line`: 画线。
- `autocad_draw_polyline`: 画轻量二维多段线。
- `autocad_draw_rectangle`: 画矩形。
- `autocad_draw_circle`: 画圆。
- `autocad_add_text`: 添加单行文字。
- `autocad_run_command`: 发送原始 AutoCAD 命令。
- `autocad_run_script`: 发送多行原始 AutoCAD 命令脚本。

原始命令工具默认被拦截。要启用，给 MCP server 设置：

```powershell
AUTOCAD_MCP_ALLOW_COMMANDS=1
```

或者单次调用时传入：

```json
{ "unsafeAcknowledged": true }
```

## 本机默认配置

本机检测到 AutoCAD 2027 的 COM ProgID:

```text
AutoCAD.Application.26
```

可以通过环境变量覆盖：

```powershell
$env:AUTOCAD_MCP_PROGID = "AutoCAD.Application.26"
node C:\Users\29925\autocad-codex-mcp\src\server.js
```

## Codex 注册命令

```powershell
codex.cmd mcp add autocad --env AUTOCAD_MCP_PROGID=AutoCAD.Application.26 -- node C:\Users\29925\autocad-codex-mcp\src\server.js
```

查看：

```powershell
codex.cmd mcp get autocad
```

注册后需要新开 Codex 会话，MCP 工具才会出现在可调用工具列表里。

## 烟测

这个测试不会启动 AutoCAD，只检查 MCP 协议、工具列表和 `autocad_status`。

```powershell
node C:\Users\29925\autocad-codex-mcp\test\smoke-test.mjs
```

如果 AutoCAD 没有打开，`autocad_status` 会返回 `available=false`，这属于正常结果。

## 示例

`examples/panel-tools.json` 是一个简单面板图调用序列：新建图纸、创建图层、画矩形、画孔、添加文字。

可以在 Codex 里直接说：

```text
用 autocad 工具新建图纸，按 examples/panel-tools.json 的参数画一个面板。
```
