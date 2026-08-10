# -*- coding: utf-8 -*-
import os
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from xml.sax.saxutils import escape


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "dist" / "CODESYS-Codex-MCP-完整使用文档.docx"


def x(text):
    return escape(text, {'"': "&quot;"})


def run(text):
    return '<w:r><w:t xml:space="preserve">{}</w:t></w:r>'.format(x(text))


def paragraph(text, style="Normal"):
    style_xml = ""
    if style and style != "Normal":
        style_xml = '<w:pPr><w:pStyle w:val="{}"/></w:pPr>'.format(x(style))
    return "<w:p>{}{}</w:p>".format(style_xml, run(text))


def bullet(text):
    return paragraph("- " + text, "ListParagraph")


def code(text):
    return paragraph(text, "Code")


DOC_ITEMS = [
    ("CODESYS 接入 Codex MCP 完整使用文档", "Title"),
    ("1. 文档目标", "Heading1"),
    ("本文档说明 codesys-codex-mcp 部署完成后，日常如何使用 Codex 操作 CODESYS 工程：检查连接、读取工程、导出、导入、编译，以及如何用 Python 修改或扩展功能。", "Normal"),
    ("2. 工具能做什么", "Heading1"),
    ("让 Codex 调用本机 CODESYS ScriptEngine，打开 .project 工程。", "Bullet"),
    ("把工程对象导出为 XML 或 native export，方便进入 Git 管理。", "Bullet"),
    ("把修改后的 XML 或 native export 导入到工程副本。", "Bullet"),
    ("对工程执行 build、rebuild、clean、generate_code，并返回错误和警告。", "Bullet"),
    ("通过 Python 脚本扩展新的工程自动化动作。", "Bullet"),
    ("3. 安全边界", "Heading1"),
    ("默认不下载到 PLC。", "Bullet"),
    ("默认不执行 Online Change、启动、停止、复位、强制变量。", "Bullet"),
    ("建议所有导入动作先作用于工程副本，例如 Machine_copy.project。", "Bullet"),
    ("上线、下载、现场调试必须由工程师在 CODESYS 中人工确认。", "Bullet"),
    ("4. 关键文件位置", "Heading1"),
    ("源工具包：C:\\Users\\29925\\codesys-codex-mcp", "Bullet"),
    ("本机安装目录：C:\\Users\\29925\\AppData\\Local\\codesys-codex-mcp", "Bullet"),
    ("Codex 配置文件：C:\\Users\\29925\\.codex\\config.toml", "Bullet"),
    ("部署包：C:\\Users\\29925\\codesys-codex-mcp\\dist\\codesys-codex-mcp.zip", "Bullet"),
    ("CODESYS 脚本入口：scripts\\codesys\\codesys_job.py", "Bullet"),
    ("MCP 服务入口：server\\index.js", "Bullet"),
    ("5. 首次使用流程", "Heading1"),
    ("部署完成后，重启 Codex 或新开一个 Codex 会话。", "Bullet"),
    ("在 Codex 中输入：检查 CODESYS MCP 是否可用。", "Bullet"),
    ("如果返回 ok=true，并能看到 CODESYS.exe 路径，说明接入成功。", "Bullet"),
    ("如果看不到工具，检查 C:\\Users\\29925\\.codex\\config.toml 里是否存在 [mcp_servers.codesys] 配置块。", "Bullet"),
    ("6. 推荐项目目录", "Heading1"),
    ("repo\\", "Code"),
    ("  AGENTS.md", "Code"),
    ("  plc\\", "Code"),
    ("    Machine.project", "Code"),
    ("    Machine_copy.project", "Code"),
    ("    export\\", "Code"),
    ("      Machine.xml", "Code"),
    ("  tools\\", "Code"),
    ("    codesys\\", "Code"),
    ("      modify_export.py", "Code"),
    ("建议把 C:\\Users\\29925\\codesys-codex-mcp\\templates\\AGENTS.md 复制到 PLC 项目仓库根目录。", "Normal"),
    ("7. 标准总流程", "Heading1"),
    ("第一步：检查 MCP 和 CODESYS 是否可用。", "Bullet"),
    ("第二步：读取工程信息，确认工程能被 CODESYS 打开。", "Bullet"),
    ("第三步：导出工程对象到 export 目录。", "Bullet"),
    ("第四步：编译原工程或工程副本，确认导出前工程本身无严重错误。", "Bullet"),
    ("第五步：让 Codex 或 Python 修改导出文件。", "Bullet"),
    ("第六步：导入到工程副本。", "Bullet"),
    ("第七步：重新编译工程副本，查看错误和警告。", "Bullet"),
    ("第八步：人工在 CODESYS 中审查，再决定是否用于现场。", "Bullet"),
    ("8. 检查连接", "Heading1"),
    ("在 Codex 中输入：", "Normal"),
    ("检查 CODESYS MCP 是否可用", "Code"),
    ("成功时通常能看到：ok=true、server.root、codesys.exe、jobScriptExists=true。", "Normal"),
    ("9. 读取工程信息", "Heading1"),
    ("在 Codex 中输入：", "Normal"),
    ("读取这个 CODESYS 工程信息：C:\\path\\Machine.project", "Code"),
    ("用途：确认 CODESYS 能打开工程，并查看 activeApplication、工程对象和主要层级。", "Normal"),
    ("10. 导出并编译", "Heading1"),
    ("场景：你想把当前 CODESYS 工程导出成文本文件，并确认工程能正常编译。", "Normal"),
    ("在 Codex 中输入：", "Normal"),
    ("把 C:\\path\\Machine.project 导出成 XML 到 C:\\path\\export\\Machine.xml，然后重新编译这个工程，不要下载到 PLC。", "Code"),
    ("等价工具参数：", "Normal"),
    ("codesys_export_project projectPath=C:\\path\\Machine.project exportPath=C:\\path\\export\\Machine.xml format=xml recursive=true", "Code"),
    ("codesys_build_project projectPath=C:\\path\\Machine.project mode=rebuild", "Code"),
    ("导出成功后，exportPath 会生成 XML 文件。编译成功后，errors 应该为 0；warnings 可以由工程师决定是否处理。", "Normal"),
    ("11. 导入并编译", "Heading1"),
    ("场景：你已经修改了 XML 或 native export，需要导回 CODESYS 工程并检查是否能编译。", "Normal"),
    ("强烈建议导入到工程副本，不要直接覆盖现场工程。", "Bullet"),
    ("在 Codex 中输入：", "Normal"),
    ("把 C:\\path\\export\\Machine.xml 导入到 C:\\path\\Machine_copy.project，然后重新编译 Machine_copy.project，不要下载到 PLC。", "Code"),
    ("等价工具参数：", "Normal"),
    ("codesys_import_project projectPath=C:\\path\\Machine_copy.project importPath=C:\\path\\export\\Machine.xml format=xml save=true", "Code"),
    ("codesys_build_project projectPath=C:\\path\\Machine_copy.project mode=rebuild", "Code"),
    ("如果编译失败，把返回的 messages 发给 Codex，让 Codex 根据错误位置继续修改导出的 XML 或相关脚本。", "Normal"),
    ("12. 让 Codex 修改 PLC 功能的推荐流程", "Heading1"),
    ("先导出工程对象。", "Bullet"),
    ("明确告诉 Codex 要改哪个功能、输入输出变量、保持哪些安全逻辑不变。", "Bullet"),
    ("让 Codex 修改导出的 XML 或 ST 相关文本。", "Bullet"),
    ("导入到工程副本。", "Bullet"),
    ("重新编译工程副本。", "Bullet"),
    ("编译错误返回后，让 Codex 继续修正。", "Bullet"),
    ("示例话术：", "Normal"),
    ("在导出的 Machine.xml 里新增一个运行小时计数功能，要求保留原有急停和互锁逻辑。修改后导入到 Machine_copy.project 并重新编译。", "Code"),
    ("13. 用普通 Python 修改导出文件", "Heading1"),
    ("这是最容易理解、最适合批量处理的方式。普通 Python 不直接操作 CODESYS，而是修改导出的 XML 或文本文件，然后再导入和编译。", "Normal"),
    ("示例：批量替换变量名。", "Normal"),
    ("from pathlib import Path", "Code"),
    ("p = Path(r\"C:\\path\\export\\Machine.xml\")", "Code"),
    ("text = p.read_text(encoding=\"utf-8\")", "Code"),
    ("text = text.replace(\"OldVar\", \"NewVar\")", "Code"),
    ("p.write_text(text, encoding=\"utf-8\")", "Code"),
    ("执行后再让 Codex 导入并编译：", "Normal"),
    ("把 C:\\path\\export\\Machine.xml 导入到 C:\\path\\Machine_copy.project，然后重新编译。", "Code"),
    ("14. 用 Python 添加功能的推荐做法", "Heading1"),
    ("不要让 Python 直接猜 CODESYS 二进制工程结构。推荐先导出 XML，再让 Python 按规则修改 XML。", "Bullet"),
    ("新增功能前，先让 Codex 读取工程信息，确认对象名称和应用名称。", "Bullet"),
    ("让 Python 只做可审计的文本或 XML 修改，修改完成后必须导入工程副本并编译。", "Bullet"),
    ("可以让 Codex 帮你生成 Python 修改脚本，例如：", "Normal"),
    ("帮我写 tools\\codesys\\modify_export.py：读取 Machine.xml，新增运行小时计数变量和对应 ST 逻辑，保留原有互锁逻辑。写完后导入 Machine_copy.project 并重新编译。", "Code"),
    ("15. 用 CODESYS ScriptEngine Python 扩展功能", "Heading1"),
    ("这是高级方式。脚本运行在 CODESYS 的 ScriptEngine 里，不是普通 Python 环境。脚本里可以使用 projects、system、active_application 等 CODESYS 提供的对象。", "Normal"),
    ("现有入口文件：", "Normal"),
    ("C:\\Users\\29925\\codesys-codex-mcp\\scripts\\codesys\\codesys_job.py", "Code"),
    ("添加一个新动作的基本步骤：", "Normal"),
    ("第一步：在 codesys_job.py 中新增函数，例如 _run_my_action(args)。", "Bullet"),
    ("第二步：在 main() 里增加 action 分支。", "Bullet"),
    ("第三步：在 server\\index.js 里增加 MCP tool 定义。", "Bullet"),
    ("第四步：在 callTool() 里把工具映射到 runCodesysJob(\"my_action\", args)。", "Bullet"),
    ("第五步：运行 smoke-test，再用真实工程测试。", "Bullet"),
    ("CODESYS Python 动作模板：", "Normal"),
    ("def _run_my_action(args):", "Code"),
    ("    project = _open_project(args.get(\"projectPath\"))", "Code"),
    ("    try:", "Code"),
    ("        # 在这里调用 CODESYS ScriptEngine API", "Code"),
    ("        return {\"ok\": True, \"action\": \"my_action\"}", "Code"),
    ("    finally:", "Code"),
    ("        _close_project(project)", "Code"),
    ("main() 中增加：", "Normal"),
    ("elif action == \"my_action\":", "Code"),
    ("    result = _run_my_action(args)", "Code"),
    ("server\\index.js 中增加工具后，就可以在 Codex 里用自然语言调用这个新能力。", "Normal"),
    ("16. 任意 CODESYS 脚本执行", "Heading1"),
    ("工具 codesys_run_script 默认禁用。只有在可信工程和可信脚本里才建议打开。", "Normal"),
    ("打开方式：修改 C:\\Users\\29925\\.codex\\config.toml 中的 MCP 环境变量：", "Normal"),
    ("CODESYS_MCP_ALLOW_ARBITRARY_SCRIPT = \"1\"", "Code"),
    ("改完后重启 Codex。", "Bullet"),
    ("不建议在陌生仓库、生产工程、现场电脑上开启这个能力。", "Bullet"),
    ("17. 常见错误处理", "Heading1"),
    ("Codex 看不到 CODESYS 工具：重启 Codex，检查 config.toml 中的 [mcp_servers.codesys]。", "Bullet"),
    ("找不到 CODESYS.exe：重新运行 install-local.ps1，并用 -CodesysExe 指定路径。", "Bullet"),
    ("Profile 不匹配：重新运行 install-local.ps1，并用 -CodesysProfile 指定 CODESYS 版本。", "Bullet"),
    ("编译失败：把 codesys_build_project 返回的 messages 发给 Codex，让它按错误继续修。", "Bullet"),
    ("导入失败：确认 importPath 是 XML 文件或 native export 文件夹，并优先导入到工程副本。", "Bullet"),
    ("18. Python 执行命令记忆", "Heading1"),
    ("当你让 Codex 生成某个 Python 文件的执行命令时，系统会按“文件路径 + 版本号/文件哈希”保存历史记录。", "Normal"),
    ("不同 Python 文件会有不同记忆，不会共用同一条执行命令。", "Bullet"),
    ("文件名里有 v26082、v26085、v26086 这类版本号时，会识别为版本信息。", "Bullet"),
    ("代码里有 __version__、VERSION、SCRIPT_VERSION 等变量时，也会识别为版本信息。", "Bullet"),
    ("即使版本号没变，只要文件内容变化，sha256 文件哈希也会变化，因此会重新阅读代码生成新命令。", "Bullet"),
    ("没有生成过命令的新文件，会重新读取 Python 代码，分析 argparse、click、typer、sys.argv、main 入口，然后生成建议命令。", "Bullet"),
    ("常用话术：", "Normal"),
    ("帮我生成这个 Python 文件的执行命令，并记住它：C:\\path\\tools\\modify_export.py", "Code"),
    ("查看这个 Python 文件以前保存过的执行命令：C:\\path\\tools\\modify_export.py", "Code"),
    ("这个 Python 文件版本变了，重新阅读代码并生成命令：C:\\path\\tools\\modify_export.py", "Code"),
    ("MCP 工具名：python_command_suggest、python_command_history、python_command_forget。", "Normal"),
    ("记忆文件默认位置：C:\\Users\\29925\\AppData\\Local\\codesys-codex-mcp\\python-command-memory.json", "Code"),
    ("19. 一句话操作模板", "Heading1"),
    ("检查连接：检查 CODESYS MCP 是否可用。", "Bullet"),
    ("读取工程：读取 C:\\path\\Machine.project 的工程信息。", "Bullet"),
    ("导出编译：导出 C:\\path\\Machine.project 到 C:\\path\\export\\Machine.xml，然后重新编译。", "Bullet"),
    ("导入编译：把 C:\\path\\export\\Machine.xml 导入 C:\\path\\Machine_copy.project，然后重新编译。", "Bullet"),
    ("Python 修改：帮我生成 Python 脚本修改导出的 Machine.xml，修改后导入工程副本并编译。", "Bullet"),
]


def content_types_xml():
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>
"""


def package_rels_xml():
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>
"""


def document_rels_xml():
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>
"""


def styles_xml():
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:rPr><w:rFonts w:ascii="Microsoft YaHei" w:hAnsi="Microsoft YaHei" w:eastAsia="Microsoft YaHei"/><w:sz w:val="22"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:qFormat/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:rFonts w:ascii="Microsoft YaHei" w:hAnsi="Microsoft YaHei" w:eastAsia="Microsoft YaHei"/><w:b/><w:sz w:val="36"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="320" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="30"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="180" w:after="80"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="360"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="80" w:after="80"/><w:ind w:left="240"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:eastAsia="Microsoft YaHei"/><w:sz w:val="19"/></w:rPr></w:style>
</w:styles>
"""


def document_xml():
    paragraphs = []
    for text, style in DOC_ITEMS:
        if style == "Bullet":
            paragraphs.append(bullet(text))
        elif style == "Code":
            paragraphs.append(code(text))
        else:
            paragraphs.append(paragraph(text, style))
    body = "\n".join(paragraphs)
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    {body}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>
""".format(body=body)


def core_xml():
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>CODESYS Codex MCP 简易使用说明</dc:title>
  <dc:creator>Codex</dc:creator>
  <cp:lastModifiedBy>Codex</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">{now}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">{now}</dcterms:modified>
</cp:coreProperties>
""".format(now=now)


def app_xml():
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Codex</Application>
</Properties>
"""


def write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    target = OUT
    with tempfile.TemporaryDirectory(prefix="codesys-codex-docx-") as tmp:
        stage = Path(tmp)
        write(stage / "[Content_Types].xml", content_types_xml())
        write(stage / "_rels" / ".rels", package_rels_xml())
        write(stage / "word" / "_rels" / "document.xml.rels", document_rels_xml())
        write(stage / "word" / "document.xml", document_xml())
        write(stage / "word" / "styles.xml", styles_xml())
        write(stage / "docProps" / "core.xml", core_xml())
        write(stage / "docProps" / "app.xml", app_xml())

        if target.exists():
            try:
                target.unlink()
            except PermissionError:
                stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
                target = OUT.with_name(f"{OUT.stem}-{stamp}{OUT.suffix}")

        with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as docx:
            for file_path in sorted(stage.rglob("*")):
                if file_path.is_file():
                    docx.write(file_path, file_path.relative_to(stage).as_posix())

    print(str(target))


if __name__ == "__main__":
    main()
