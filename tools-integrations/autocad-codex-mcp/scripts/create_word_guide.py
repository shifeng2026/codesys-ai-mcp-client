from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile
import html


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "AutoCAD使用Codex操作指南.docx"


def esc(value: str) -> str:
    return html.escape(value, quote=False)


def run_text(text: str, bold: bool = False, size: int | None = None, font: str | None = None) -> str:
    props: list[str] = []
    if bold:
        props.append("<w:b/>")
    if size:
        props.append(f'<w:sz w:val="{size}"/>')
        props.append(f'<w:szCs w:val="{size}"/>')
    if font:
        props.append(
            '<w:rFonts '
            f'w:ascii="{esc(font)}" w:hAnsi="{esc(font)}" '
            f'w:eastAsia="{esc(font)}" w:cs="{esc(font)}"/>'
        )
    rpr = f"<w:rPr>{''.join(props)}</w:rPr>" if props else ""
    return f'<w:r>{rpr}<w:t xml:space="preserve">{esc(text)}</w:t></w:r>'


def paragraph(text: str = "", style: str | None = None, bold: bool = False) -> str:
    ppr = f'<w:pPr><w:pStyle w:val="{style}"/></w:pPr>' if style else ""
    return f"<w:p>{ppr}{run_text(text, bold=bold)}</w:p>"


def heading(text: str, level: int) -> str:
    style = "Heading1" if level == 1 else "Heading2"
    return paragraph(text, style=style)


def code_block(text: str) -> list[str]:
    return [paragraph(line, style="Code") for line in text.splitlines()]


def bullet(text: str) -> str:
    return paragraph(f"- {text}")


def build_document_xml() -> str:
    generated = datetime.now().strftime("%Y-%m-%d %H:%M")
    body: list[str] = []

    body.append(paragraph("AutoCAD 使用 Codex 操作指南", style="Title"))
    body.append(paragraph("适用于本机 AutoCAD 2027 + Codex MCP 接入", style="Subtitle"))
    body.append(paragraph(f"生成时间：{generated}"))

    body.append(heading("1. 当前接入状态", 1))
    body.append(paragraph("本机已经完成 AutoCAD 与 Codex 的 MCP 接入。Codex 通过本地 MCP server 调用 Windows COM Automation，再由 COM 操作 AutoCAD。"))
    body.append(bullet("MCP server 名称：autocad"))
    body.append(bullet("AutoCAD 版本：AutoCAD 2027"))
    body.append(bullet("COM ProgID：AutoCAD.Application.26"))
    body.append(bullet(r"项目目录：C:\Users\29925\autocad-codex-mcp"))
    body.append(bullet(r"启动文件：C:\Users\29925\autocad-codex-mcp\src\server.js"))
    body.append(bullet("注册状态：已通过 codex.cmd mcp add autocad 注册并启用"))

    body.append(heading("2. 日常使用流程", 1))
    body.append(paragraph("推荐按下面顺序使用。"))
    body.append(bullet("先手动打开 AutoCAD 2027。虽然工具支持 startIfMissing=true 自动启动，但手动打开更稳定。"))
    body.append(bullet("新开一个 Codex 会话。刚注册或修改 MCP server 后，旧会话通常不会自动加载新工具。"))
    body.append(bullet("先让 Codex 调用 autocad_status 检查连接状态。"))
    body.append(bullet("确认连接成功后，用自然语言描述要画什么、坐标、尺寸、图层、保存路径。"))
    body.append(bullet("完成后让 Codex 使用 autocad_save_as 保存 DWG 或 DXF。"))

    body.append(heading("3. 可直接复制的提示词", 1))
    body.append(heading("3.1 检查连接", 2))
    body.extend(code_block("先用 autocad_status 检查 AutoCAD 是否连接成功。"))
    body.append(heading("3.2 新建并绘制简单面板", 2))
    body.extend(code_block("用 AutoCAD 新建一张图，创建 PANEL 图层，画一个 600x300 的矩形，在左上角写 PANEL-001，四角各画一个半径 6 的孔。"))
    body.append(heading("3.3 打开文件并另存", 2))
    body.extend(code_block(r"打开 C:\Users\29925\Downloads\test.dxf，在 PANEL 图层上添加一个 100x50 的矩形，然后另存为 C:\Users\29925\Downloads\test_out.dxf。"))
    body.append(heading("3.4 使用原始 AutoCAD 命令", 2))
    body.extend(code_block("允许本次使用 autocad_run_script，并设置 unsafeAcknowledged=true。请执行 ZOOM Extents。"))

    body.append(heading("3.5 给 Codex 的总工作指令", 2))
    body.append(paragraph("下面这段适合作为每次 AutoCAD 自动化任务的开头。复制给 Codex 后，再补充具体尺寸和图纸要求。"))
    body.extend(code_block("""你现在通过 autocad MCP 工具操作 AutoCAD。请按以下规则工作：
1. 先调用 autocad_status 检查 AutoCAD 是否已连接。
2. 如果 available=false，不要继续绘图；先提示我打开 AutoCAD，除非我明确允许 startIfMissing=true。
3. 默认单位按毫米处理，坐标采用 AutoCAD 模型空间坐标。
4. 绘图前先整理图层、尺寸、坐标、保存路径；如果关键信息缺失，先问我。
5. 优先使用高层工具：autocad_set_layer、autocad_draw_rectangle、autocad_draw_circle、autocad_draw_line、autocad_add_text、autocad_save_as。
6. 不要使用 autocad_run_command 或 autocad_run_script，除非我明确说允许，并要求 unsafeAcknowledged=true。
7. 每完成一个主要步骤，记录调用结果里的 handle、layer、document 信息。
8. 保存前检查目标目录是否存在；如文件已存在，需要我允许 overwrite=true。
9. 完成后给我汇报：创建了哪些图层、画了哪些对象、保存到了哪里、是否有失败项。"""))

    body.append(heading("3.6 新建图纸绘图任务模板", 2))
    body.extend(code_block(r"""请按下面流程操作 AutoCAD：
1. 调用 autocad_status，参数 startIfMissing=false。
2. 如果未连接，提示我打开 AutoCAD；如果已连接，继续。
3. 调用 autocad_new_drawing，新建图纸。
4. 创建图层 OUTLINE、HOLE、TEXT；颜色分别为 3、1、7。
5. 在 OUTLINE 图层画外框矩形：origin=[0,0]，width=600，height=300。
6. 在 HOLE 图层画 4 个安装孔，半径 6，圆心分别为 [20,20]、[580,20]、[580,280]、[20,280]。
7. 在 TEXT 图层添加文字 PANEL-001，point=[20,260]，height=12。
8. 保存为 C:\Users\29925\Downloads\PANEL-001.dxf；如果文件存在，先问我是否覆盖。
9. 最后返回每个对象的 handle 和保存路径。"""))

    body.append(heading("3.7 修改已有图纸任务模板", 2))
    body.extend(code_block(r"""请修改已有 AutoCAD 文件：
1. 先调用 autocad_status 检查连接。
2. 打开 C:\Users\29925\Downloads\input.dxf。
3. 创建或切换到图层 REVISION，颜色设为 2。
4. 在 REVISION 图层添加一个 120x40 的矩形，origin=[30,30]。
5. 在矩形内添加文字 REV-A，point=[40,45]，height=8。
6. 另存为 C:\Users\29925\Downloads\input_rev_a.dxf。
7. 不要覆盖原文件；如果输出文件已存在，先问我。"""))

    body.append(heading("3.8 批量出图任务模板", 2))
    body.extend(code_block(r"""请根据以下规格批量生成 AutoCAD 图纸：
输出目录：C:\Users\29925\Downloads\panels
默认单位：mm
每个面板都要包含 OUTLINE、HOLE、TEXT 三个图层。

规格：
- PANEL-A：宽 600，高 300，孔径 6，文字位置 [20,260]
- PANEL-B：宽 800，高 400，孔径 8，文字位置 [20,360]

执行要求：
1. 每张图都新建独立图纸。
2. 外框使用 autocad_draw_rectangle。
3. 四角孔使用 autocad_draw_circle，孔中心距边 20。
4. 标识文字使用 autocad_add_text。
5. 分别保存为 PANEL-A.dxf、PANEL-B.dxf。
6. 完成后给出每个文件的保存路径和是否成功。"""))

    body.append(heading("3.9 工具调用参数示例", 2))
    body.append(paragraph("当你希望 Codex 严格按参数执行时，可以直接给出工具名和参数。"))
    body.extend(code_block("""请按以下工具调用顺序执行：

autocad_status
{
  "startIfMissing": false
}

autocad_new_drawing
{
  "startIfMissing": true
}

autocad_set_layer
{
  "name": "OUTLINE",
  "color": 3,
  "makeActive": true
}

autocad_draw_rectangle
{
  "origin": [0, 0],
  "width": 600,
  "height": 300,
  "layer": "OUTLINE"
}

autocad_draw_circle
{
  "center": [20, 20],
  "radius": 6,
  "layer": "HOLE"
}

autocad_add_text
{
  "text": "PANEL-001",
  "point": [20, 260],
  "height": 12,
  "layer": "TEXT"
}"""))

    body.append(heading("3.10 验收和汇报指令", 2))
    body.extend(code_block("""完成 AutoCAD 操作后，请按以下格式汇报：
1. 连接状态：是否连接 AutoCAD，使用的 ProgID 是什么。
2. 图纸状态：新建还是打开了哪个文件。
3. 图层清单：创建或修改了哪些图层。
4. 图元清单：每个图元的类型、图层、handle。
5. 保存结果：保存路径、是否覆盖、是否成功。
6. 异常项：如果某一步失败，说明失败原因和建议处理方式。"""))

    body.append(heading("3.11 异常处理指令", 2))
    body.extend(code_block("""如果 AutoCAD 操作失败，请按下面规则处理：
1. 如果 available=false，停止绘图，提示我打开 AutoCAD。
2. 如果提示 MK_E_UNAVAILABLE，说明没有找到运行中的 AutoCAD，建议我手动打开 AutoCAD 后重试。
3. 如果提示 CO_E_CLASSSTRING，说明 ProgID 不匹配，使用 AutoCAD.Application.26 重试。
4. 如果保存失败，先检查输出目录是否存在，再检查是否需要 overwrite=true。
5. 如果视图里看不到对象，不要重复绘制；先执行或建议执行 ZOOM Extents。
6. 如果需要原始 AutoCAD 命令，必须先获得我的明确授权。"""))

    body.append(heading("4. 已开放的工具", 1))
    tools = [
        ("autocad_status", "检查 AutoCAD COM 是否可用。"),
        ("autocad_new_drawing", "新建图纸，可指定模板。"),
        ("autocad_open_drawing", "打开 DWG/DXF 文件。"),
        ("autocad_save_as", "保存当前图纸到指定路径。"),
        ("autocad_set_layer", "创建或更新图层，可设置颜色、设为当前图层。"),
        ("autocad_draw_line", "在模型空间画线。"),
        ("autocad_draw_polyline", "画轻量二维多段线。"),
        ("autocad_draw_rectangle", "按原点、宽度、高度画矩形。"),
        ("autocad_draw_circle", "按圆心和半径画圆。"),
        ("autocad_add_text", "添加单行文字，可设置文字高度和旋转角。"),
        ("autocad_run_command", "发送一条原始 AutoCAD 命令，默认锁定。"),
        ("autocad_run_script", "发送多行原始 AutoCAD 命令脚本，默认锁定。"),
    ]
    for name, desc in tools:
        body.append(bullet(f"{name}：{desc}"))

    body.append(heading("5. 安全边界", 1))
    body.append(paragraph("高层绘图工具默认可用，例如画线、画圆、画矩形、创建图层、保存文件。原始 AutoCAD 命令工具默认锁定，因为它们可以执行更广泛的 AutoCAD 动作。"))
    body.append(paragraph("如果确实要允许原始命令，有两种方式："))
    body.append(bullet("单次授权：在提示词里明确要求传入 unsafeAcknowledged=true。"))
    body.append(bullet("长期启用：给 MCP server 设置环境变量 AUTOCAD_MCP_ALLOW_COMMANDS=1。"))
    body.append(paragraph("建议优先使用高层工具，只有在需要 AutoCAD 内置命令、LISP、脚本流程时才启用原始命令。"))

    body.append(heading("6. 常用维护命令", 1))
    body.append(paragraph("查看 MCP 注册状态："))
    body.extend(code_block("codex.cmd mcp get autocad"))
    body.append(paragraph("列出所有 MCP server："))
    body.extend(code_block("codex.cmd mcp list"))
    body.append(paragraph("重新注册 AutoCAD MCP server："))
    body.extend(code_block(r"codex.cmd mcp add autocad --env AUTOCAD_MCP_PROGID=AutoCAD.Application.26 -- node C:\Users\29925\autocad-codex-mcp\src\server.js"))
    body.append(paragraph("删除注册："))
    body.extend(code_block("codex.cmd mcp remove autocad"))
    body.append(paragraph("烟测 MCP server，不启动 AutoCAD："))
    body.extend(code_block(r"node C:\Users\29925\autocad-codex-mcp\test\smoke-test.mjs"))

    body.append(heading("7. 故障排查", 1))
    body.append(bullet("autocad_status 返回 available=false：通常是 AutoCAD 没打开。先打开 AutoCAD，再新开 Codex 会话重试。"))
    body.append(bullet("提示 CO_E_CLASSSTRING：ProgID 不匹配。当前本机应使用 AutoCAD.Application.26。"))
    body.append(bullet("提示 MK_E_UNAVAILABLE：没有找到正在运行的 AutoCAD COM 对象。手动打开 AutoCAD 或使用 startIfMissing=true。"))
    body.append(bullet("Codex 看不到 autocad 工具：确认 codex.cmd mcp get autocad 显示 enabled:true，然后新开 Codex 会话。"))
    body.append(bullet("保存失败：检查目标目录是否存在；如果文件已存在，需要传 overwrite=true。"))
    body.append(bullet("文字或图元没有出现：让 Codex 调用 ZOOM Extents，或确认绘图坐标是否在当前视图范围内。"))

    body.append(heading("8. 扩展建议", 1))
    body.append(paragraph("如果后续要做批量出图、设备面板、BOM 提取或标准图框，可以在现有 MCP server 上继续增加更高层的业务工具。推荐新增业务级工具，而不是长期依赖原始 AutoCAD 命令。"))
    body.append(bullet("批量生成 DXF/DWG：新增 create_panel_from_spec 工具，输入 JSON 规格表。"))
    body.append(bullet("读取图纸信息：新增 list_layers、list_blocks、read_attributes 工具。"))
    body.append(bullet("企业图框：新增 apply_title_block 工具，统一图号、版本、日期、审核人字段。"))
    body.append(bullet("导出清单：新增 export_bom_csv 工具，从块属性生成 CSV。"))

    body.append(heading("9. 参考资料", 1))
    body.append(bullet("OpenAI Codex MCP 文档：https://developers.openai.com/codex/mcp"))
    body.append(bullet("OpenAI Codex CLI 文档：https://developers.openai.com/codex/cli"))
    body.append(bullet(r"本地项目 README：C:\Users\29925\autocad-codex-mcp\README.md"))

    body.append(
        '<w:sectPr>'
        '<w:pgSz w:w="11906" w:h="16838"/>'
        '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" '
        'w:header="708" w:footer="708" w:gutter="0"/>'
        '</w:sectPr>'
    )

    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas" '
        'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" '
        'xmlns:o="urn:schemas-microsoft-com:office:office" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
        'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" '
        'xmlns:v="urn:schemas-microsoft-com:vml" '
        'xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing" '
        'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" '
        'xmlns:w10="urn:schemas-microsoft-com:office:word" '
        'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
        'xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" '
        'xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" '
        'xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk" '
        'xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml" '
        'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" '
        'mc:Ignorable="w14 wp14">'
        f'<w:body>{"".join(body)}</w:body></w:document>'
    )


def build_styles_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="Microsoft YaHei" w:hAnsi="Microsoft YaHei" w:eastAsia="Microsoft YaHei" w:cs="Microsoft YaHei"/>
        <w:sz w:val="21"/>
        <w:szCs w:val="21"/>
      </w:rPr>
    </w:rPrDefault>
    <w:pPrDefault>
      <w:pPr>
        <w:spacing w:after="120" w:line="276" w:lineRule="auto"/>
      </w:pPr>
    </w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:qFormat/>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Title">
    <w:name w:val="Title"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:pPr><w:spacing w:after="240"/></w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="Microsoft YaHei" w:hAnsi="Microsoft YaHei" w:eastAsia="Microsoft YaHei" w:cs="Microsoft YaHei"/>
      <w:b/>
      <w:sz w:val="36"/>
      <w:szCs w:val="36"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Subtitle">
    <w:name w:val="Subtitle"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:pPr><w:spacing w:after="240"/></w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="Microsoft YaHei" w:hAnsi="Microsoft YaHei" w:eastAsia="Microsoft YaHei" w:cs="Microsoft YaHei"/>
      <w:color w:val="666666"/>
      <w:sz w:val="24"/>
      <w:szCs w:val="24"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:qFormat/>
    <w:pPr><w:spacing w:before="360" w:after="160"/><w:keepNext/></w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="Microsoft YaHei" w:hAnsi="Microsoft YaHei" w:eastAsia="Microsoft YaHei" w:cs="Microsoft YaHei"/>
      <w:b/>
      <w:sz w:val="28"/>
      <w:szCs w:val="28"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:qFormat/>
    <w:pPr><w:spacing w:before="180" w:after="120"/><w:keepNext/></w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="Microsoft YaHei" w:hAnsi="Microsoft YaHei" w:eastAsia="Microsoft YaHei" w:cs="Microsoft YaHei"/>
      <w:b/>
      <w:sz w:val="23"/>
      <w:szCs w:val="23"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Code">
    <w:name w:val="Code"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:spacing w:before="40" w:after="40"/>
      <w:shd w:val="clear" w:color="auto" w:fill="F3F4F6"/>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:eastAsia="Microsoft YaHei" w:cs="Consolas"/>
      <w:sz w:val="19"/>
      <w:szCs w:val="19"/>
    </w:rPr>
  </w:style>
</w:styles>
"""


def write_docx() -> None:
    utc_now = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    files = {
        "[Content_Types].xml": """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>
""",
        "_rels/.rels": """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>
""",
        "word/_rels/document.xml.rels": """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>
""",
        "word/document.xml": build_document_xml(),
        "word/styles.xml": build_styles_xml(),
        "docProps/core.xml": f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:dcterms="http://purl.org/dc/terms/"
  xmlns:dcmitype="http://purl.org/dc/dcmitype/"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>AutoCAD 使用 Codex 操作指南</dc:title>
  <dc:creator>Codex</dc:creator>
  <cp:lastModifiedBy>Codex</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">{utc_now}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">{utc_now}</dcterms:modified>
</cp:coreProperties>
""",
        "docProps/app.xml": """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"
  xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Codex</Application>
</Properties>
""",
    }

    with ZipFile(OUTPUT, "w", ZIP_DEFLATED) as archive:
        for name, content in files.items():
            archive.writestr(name, content.encode("utf-8"))


if __name__ == "__main__":
    write_docx()
    print(OUTPUT)
