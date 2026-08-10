from __future__ import annotations

from pathlib import Path
import shutil
from xml.sax.saxutils import escape
import zipfile


DAQ_DIR = Path(r"C:\Users\29925\Documents\工作资料\daqctrl")
LOG_DIR = Path(r"C:\logs\plc_log")
DOCX_NAME = "FiveDofPlatform_Python_Register_Guide.docx"


def text_run(text: str) -> str:
    """Create a Word text run with XML escaping."""
    return f"<w:r><w:t xml:space=\"preserve\">{escape(text)}</w:t></w:r>"


def paragraph(text: str = "", style: str | None = None) -> str:
    """Create a Word paragraph, optionally using a named paragraph style."""
    style_xml = ""
    if style:
        style_xml = f"<w:pPr><w:pStyle w:val=\"{style}\"/></w:pPr>"
    return f"<w:p>{style_xml}{text_run(text)}</w:p>"


def bullet(text: str) -> str:
    """Create a simple bullet-like paragraph using text, avoiding complex numbering XML."""
    return paragraph(f"- {text}")


def code_block(lines: list[str]) -> str:
    """Create a block of monospace-like command text using plain paragraphs."""
    return "".join(paragraph(line, "Code") for line in lines)


def table(headers: list[str], rows: list[list[str]]) -> str:
    """Create a basic Word table with visible borders."""
    border = (
        "<w:tblPr><w:tblBorders>"
        "<w:top w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"auto\"/>"
        "<w:left w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"auto\"/>"
        "<w:bottom w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"auto\"/>"
        "<w:right w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"auto\"/>"
        "<w:insideH w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"auto\"/>"
        "<w:insideV w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"auto\"/>"
        "</w:tblBorders></w:tblPr>"
    )

    def cell(value: str) -> str:
        return f"<w:tc><w:tcPr><w:tcW w:w=\"2400\" w:type=\"dxa\"/></w:tcPr>{paragraph(value)}</w:tc>"

    header_xml = "<w:tr>" + "".join(cell(item) for item in headers) + "</w:tr>"
    row_xml = ""
    for row in rows:
        row_xml += "<w:tr>" + "".join(cell(item) for item in row) + "</w:tr>"
    return f"<w:tbl>{border}{header_xml}{row_xml}</w:tbl>"


def build_document_xml() -> str:
    """Build the Word document body for the Python register guide."""
    register_rows = [
        ["arAi 1", "PLC->HMI", "X_ActualPosition", "X 轴位置反馈"],
        ["arAi 2", "PLC->HMI", "Y_ActualPosition", "Y 轴位置反馈"],
        ["arAi 3", "PLC->HMI", "Z_ActualPosition", "Z 轴位置反馈"],
        ["arAi 4", "PLC->HMI", "B_ActualPosition", "B 轴位置反馈"],
        ["arAi 5", "PLC->HMI", "C_ActualPosition", "C 轴位置反馈"],
        ["32", "HMI->PLC", "AxisEnableAllCmd", "0=关闭五轴使能；非0=打开五轴使能"],
        ["33", "PLC->HMI", "X_StatusWord", "X 轴状态字"],
        ["34", "PLC->HMI", "Y_StatusWord", "Y 轴状态字"],
        ["35", "PLC->HMI", "Z_StatusWord", "Z 轴状态字"],
        ["36", "PLC->HMI", "B_StatusWord", "B 轴状态字"],
        ["37", "PLC->HMI", "C_StatusWord", "C 轴状态字"],
        ["38/39", "PLC->HMI", "X_AxisErrorID Low/High", "X 轴错误 ID 低 16 位/高 16 位"],
        ["40/41", "PLC->HMI", "Y_AxisErrorID Low/High", "Y 轴错误 ID 低 16 位/高 16 位"],
        ["42/43", "PLC->HMI", "Z_AxisErrorID Low/High", "Z 轴错误 ID 低 16 位/高 16 位"],
        ["44/45", "PLC->HMI", "B_AxisErrorID Low/High", "B 轴错误 ID 低 16 位/高 16 位"],
        ["46/47", "PLC->HMI", "C_AxisErrorID Low/High", "C 轴错误 ID 低 16 位/高 16 位"],
        ["48", "PLC->HMI", "AxisEnableRequestFeedback", "bit0..bit4=X/Y/Z/B/C，bit15=五轴全部为 TRUE"],
        ["49..58", "PLC->HMI", "MC_ReadStatus.ErrorID", "五轴状态读取功能块错误号，每轴低/高 16 位"],
        ["59..68", "PLC->HMI", "MC_ReadAxisError.ErrorID", "五轴读取轴错误功能块错误号，每轴低/高 16 位"],
        ["69..78", "PLC->HMI", "MC_Power.ErrorID", "五轴上使能功能块错误号，每轴低/高 16 位"],
        ["79..83", "PLC->HMI", "MC_PowerDiagWord", "五轴上使能诊断字，bit0=Status，bit1=Error"],
        ["84", "PLC->HMI", "DiagnosticVersion", "26081 表示诊断版 PLC 代码已运行"],
        ["85", "PLC->HMI", "EnableMismatchBits", "bit0..bit4=X/Y/Z/B/C，使能请求 TRUE 但状态仍 Disabled"],
        ["86", "PLC->HMI", "ReadStatusErrorBits", "bit0..bit4=X/Y/Z/B/C，MC_ReadStatus.Error 汇总"],
        ["87", "PLC->HMI", "ReadAxisErrorBits", "bit0..bit4=X/Y/Z/B/C，MC_ReadAxisError.Error 汇总"],
        ["88", "PLC->HMI", "ReadStatusFBErrorBits", "bit0..bit4=X/Y/Z/B/C，MC_ReadStatus.FBErrorOccured 汇总"],
    ]

    status_rows = [
        ["bit0", "0x0001", "Disabled", "轴未使能"],
        ["bit1", "0x0002", "Errorstop", "轴错误停止"],
        ["bit2", "0x0004", "Stopping", "轴正在停止"],
        ["bit3", "0x0008", "StandStill", "轴静止"],
        ["bit4", "0x0010", "DiscreteMotion", "离散/定位运动中"],
        ["bit5", "0x0020", "ContinuousMotion", "连续运动中"],
        ["bit6", "0x0040", "SynchronizedMotion", "同步运动中"],
        ["bit7", "0x0080", "Homing", "回零中"],
        ["bit8", "0x0100", "ConstantVelocity", "恒速中"],
        ["bit9", "0x0200", "Accelerating", "加速中"],
        ["bit10", "0x0400", "Decelerating", "减速中"],
        ["bit11", "0x0800", "ReadStatusError", "MC_ReadStatus 功能块错误"],
        ["bit12", "0x1000", "ReadStatusFBError", "MC_ReadStatus 内部 FB 错误"],
        ["bit13", "0x2000", "Reserved", "预留位"],
        ["bit14", "0x4000", "AxisError", "轴本体错误"],
        ["bit15", "0x8000", "SWEndSwitchActive", "软件限位触发"],
    ]

    abbreviation_rows = [
        ["FiveDOF", "Five Degrees Of Freedom", "五自由度/五轴平台"],
        ["HMI", "Human Machine Interface", "人机界面"],
        ["PLC", "Programmable Logic Controller", "可编程逻辑控制器"],
        ["Cmd", "Command", "命令"],
        ["Fwd", "Forward", "正向"],
        ["Rev", "Reverse", "反向"],
        ["Reg", "Register", "寄存器"],
        ["Low", "Low word", "低 16 位"],
        ["High", "High word", "高 16 位"],
        ["ID", "Identifier", "编号/标识"],
        ["FB", "Function Block", "功能块"],
        ["SW", "Software", "软件"],
    ]

    function_rows = [
        ["write_all_axes_enable(controller, enable=True)", "写 arReg_data[32]。enable=True 写 1，enable=False 写 0。"],
        ["read_axis_position_feedback(controller)", "读取 arAi_data[1..5]，返回五轴位置反馈。"],
        ["read_axis_status_feedback(controller)", "一次读取 arReg_data[33..88]，解析五轴状态、错误 ID、使能反馈和诊断错误号。"],
        ["read_five_axis_feedback(controller)", "统一读取五轴位置、状态、错误和使能反馈。"],
        ["print_five_axis_feedback(feedback)", "统一打印五轴位置反馈、状态反馈、错误反馈和使能反馈。"],
        ["decode_status_word(status_word)", "把 16 位状态字拆成多个 TRUE 状态。"],
        ["combine_low_high_words(low_word, high_word)", "把低 16 位和高 16 位合成完整 32 位错误 ID。"],
        ["decode_enable_feedback(feedback_word)", "解析 arReg_data[48] 的 bit0..bit4 和 bit15。"],
        ["decode_axis_bit_map(bit_word)", "解析 bit0..bit4 的五轴位图。"],
        ["decode_power_diag_word(power_diag_word)", "解析 MC_Power 诊断字 bit0=Status，bit1=Error。"],
        ["print_axis_status_feedback(feedback)", "把解析结果打印给人工查看。"],
        ["run_axis_register_commands(...)", "命令行入口，支持使能、关闭、读取、循环读取。"],
    ]

    body = ""
    body += paragraph("FiveDofPlatform Python 新增寄存器使用说明", "Title")
    body += paragraph("文件：C:\\Users\\29925\\Documents\\工作资料\\daqctrl\\test_fivedofplat.py")
    body += paragraph("本说明对应 PLC 诊断版副本中的连续寄存器块 arReg_data[32..88]。")

    body += paragraph("一、Python 怎么控制", "Heading1")
    body += bullet("五轴同时使能：写保持寄存器 arReg_data[32] = 1。")
    body += bullet("五轴同时关闭使能：写保持寄存器 arReg_data[32] = 0。")
    body += bullet("读取位置：读输入寄存器 arAi_data[1..5]，得到 X/Y/Z/B/C 五轴位置反馈。")
    body += bullet("读取状态和错误：读保持寄存器 arReg_data[33..88]，再解析状态字、错误 ID、使能反馈和诊断错误号。")
    body += bullet("统一打印：--read-axis-feedback 会同时打印五轴位置反馈、五轴状态反馈、五轴错误反馈。")
    body += bullet("Modbus 起始地址是 0，所以 Python 地址和 PLC arReg_data 下标一致，不需要加 1。")

    body += paragraph("二、命令行用法", "Heading1")
    body += code_block(
        [
            "python test_fivedofplat.py --enable-all",
            "python test_fivedofplat.py --disable-all",
            "python test_fivedofplat.py --read-axis-feedback",
            "python test_fivedofplat.py --enable-all --read-axis-feedback",
            "python test_fivedofplat.py --watch-axis-feedback --watch-interval 0.5",
            "python test_fivedofplat.py --jog --axis 1 --direction fwd",
            "python test_fivedofplat.py --jog --axis 1 --direction rev",
            "python test_fivedofplat.py --jog --axis 3 --direction fwd --watch-interval 0.2",
            "python test_fivedofplat.py --glossary",
        ]
    )
    body += bullet("--jog 会持续点动指定轴并持续打印位置、状态、错误和使能反馈。")
    body += bullet("手动按 Ctrl+C 后，程序会先发送当前轴停止点动命令，再关闭连接。")

    body += paragraph("三、新增寄存器表", "Heading1")
    body += table(["地址", "方向", "名称", "功能"], register_rows)

    body += paragraph("四、状态字怎么读", "Heading1")
    body += paragraph("状态字是 16 位数。某一位为 1，表示对应状态成立。比如 0x4208 = bit3 + bit9 + bit14，表示 StandStill、Accelerating、AxisError 同时为 TRUE。")
    body += table(["位", "十六进制", "英文名", "中文含义"], status_rows)

    body += paragraph("五、错误 ID 高低位怎么合成", "Heading1")
    body += paragraph("每个轴的 AxisErrorID 是 32 位 DWORD，PLC 拆成两个 16 位寄存器。")
    body += paragraph("完整错误 ID = 高 16 位 * 65536 + 低 16 位。")
    body += paragraph("Python 代码：error_id = (high_word << 16) | low_word。")
    body += paragraph("注意：arReg_data[38..47] 是驱动 AxisErrorID；拔网线或电机线时，还要同时看 arReg_data[49..78]，因为错误可能先出现在 MC_ReadStatus、MC_ReadAxisError 或 MC_Power 功能块自己的 ErrorID。")

    body += paragraph("六、Python 每段新增代码的意思", "Heading1")
    body += table(["代码段/函数", "具体意思"], function_rows)

    body += paragraph("七、英文缩写解释", "Heading1")
    body += table(["缩写", "英文全称", "中文解释"], abbreviation_rows)

    body += paragraph("八、注意事项", "Heading1")
    body += bullet("read_axis_status_feedback() 使用 ControlFiveDOF._read_holding_registers()，这是项目里已有的底层读保持寄存器方法。")
    body += bullet("read_axis_position_feedback() 使用 ControlFiveDOF.read_all_actual_positions()，这是项目里已有的输入寄存器位置读取方法。")
    body += bullet("如果状态字大于 32767，某些环境可能显示为负数；代码里的 _u16() 会把它还原成 0..65535 的 16 位无符号值。")
    body += bullet("AxisEnableRequestFeedback 是请求反馈，不等同于驱动器真实上电完成状态；真实轴状态请看 arReg_data[33..37] 的 Disabled/Errorstop/StandStill 等位，以及 arReg_data[79..83] 的 MC_Power 诊断字。")
    body += bullet("点动寄存器 [6..15] 和点动模式 [19] 是旧逻辑，本次没有改。")

    section = "<w:sectPr><w:pgSz w:w=\"11906\" w:h=\"16838\"/><w:pgMar w:top=\"1440\" w:right=\"1440\" w:bottom=\"1440\" w:left=\"1440\"/></w:sectPr>"
    return (
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
        "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">"
        f"<w:body>{body}{section}</w:body>"
        "</w:document>"
    )


def build_styles_xml() -> str:
    """Create a small set of Word styles used by the document."""
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:rPr><w:rFonts w:ascii="Microsoft YaHei" w:eastAsia="Microsoft YaHei"/><w:sz w:val="21"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Title">
    <w:name w:val="Title"/>
    <w:rPr><w:b/><w:rFonts w:ascii="Microsoft YaHei" w:eastAsia="Microsoft YaHei"/><w:sz w:val="34"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:rPr><w:b/><w:rFonts w:ascii="Microsoft YaHei" w:eastAsia="Microsoft YaHei"/><w:sz w:val="28"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Code">
    <w:name w:val="Code"/>
    <w:rPr><w:rFonts w:ascii="Consolas" w:eastAsia="Microsoft YaHei"/><w:sz w:val="20"/></w:rPr>
  </w:style>
</w:styles>
"""


def write_docx(path: Path) -> None:
    """Write a minimal .docx file with no external Python dependencies."""
    content_types = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>
"""
    rels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>
"""
    document_rels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>
"""
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as docx:
        docx.writestr("[Content_Types].xml", content_types)
        docx.writestr("_rels/.rels", rels)
        docx.writestr("word/_rels/document.xml.rels", document_rels)
        docx.writestr("word/document.xml", build_document_xml())
        docx.writestr("word/styles.xml", build_styles_xml())


def main() -> None:
    """Generate the Word document in the project directory and the PLC log directory."""
    project_docx = DAQ_DIR / DOCX_NAME
    log_docx = LOG_DIR / DOCX_NAME
    write_docx(project_docx)
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    try:
        shutil.copy2(project_docx, log_docx)
    except PermissionError:
        # If the previous Word document is open, Windows locks it. Keep the
        # current open file untouched and write a new copy with a clear suffix.
        log_docx = LOG_DIR / "FiveDofPlatform_Python_Register_Guide_feedback.docx"
        shutil.copy2(project_docx, log_docx)
    print(project_docx)
    print(log_docx)


if __name__ == "__main__":
    main()
