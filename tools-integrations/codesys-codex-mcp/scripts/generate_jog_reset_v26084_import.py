from __future__ import annotations

import copy
from datetime import datetime
from pathlib import Path
import xml.etree.ElementTree as ET


# 生成 FiveDofPlatform v26084 的 CODESYS 导入 XML。
# 本脚本只生成导入文件和说明，不下载 PLC，不启动/停止 PLC。

PLC_NS = "http://www.plcopen.org/xml/tc6_0200"
XHTML_NS = "http://www.w3.org/1999/xhtml"
NS = {"plc": PLC_NS, "xhtml": XHTML_NS}

ROOT = Path(r"C:\Users\29925\codesys-codex-mcp")
SOURCE_EXPORT = Path(r"C:\path\export_v26082\Machine_v26082.xml")
IMPORT_PATH = ROOT / "imports" / "FiveDofPlatform_v26084.jog_reset.import.xml"
REPORT_PATH = ROOT / "imports" / "FiveDofPlatform_v26084.jog_reset.report.md"
REGISTER_MAP_PATH = ROOT / "imports" / "FiveDofPlatform_v26084.register_map.md"

VERSION = 26084

AXES = (
    # axis, index, jog POU, FB instance, reset/jog bit mask, clear mask, fwd register, rev register
    ("X", 1, "JogX", "fbJogX", "0001", "FFFE", 6, 7),
    ("Y", 2, "JogY", "fbJogY", "0002", "FFFD", 8, 9),
    ("Z", 3, "JogZ", "fbJogZ", "0004", "FFFB", 10, 11),
    ("B", 4, "JogB", "fbJogB", "0008", "FFF7", 12, 13),
    ("C", 5, "JogC", "fbJogC", "0010", "FFEF", 14, 15),
)


ET.register_namespace("", PLC_NS)
ET.register_namespace("xhtml", XHTML_NS)


def plc(tag: str) -> str:
    """返回 PLCopenXML 命名空间标签。"""
    return f"{{{PLC_NS}}}{tag}"


def xhtml(tag: str) -> str:
    """返回 XHTML 命名空间标签。"""
    return f"{{{XHTML_NS}}}{tag}"


def child(parent: ET.Element, tag: str, **attrs: str) -> ET.Element:
    """创建 PLCopenXML 子节点。"""
    return ET.SubElement(parent, plc(tag), attrs)


def find_pou(root: ET.Element, name: str) -> ET.Element:
    """按 POU 名称查找程序或功能块。"""
    for pou in root.findall(".//plc:pou", NS):
        if pou.get("name") == name:
            return pou
    raise RuntimeError(f"POU not found: {name}")


def find_st_body(pou: ET.Element) -> ET.Element:
    """查找 POU 的 ST 代码节点。"""
    body = pou.find("plc:body/plc:ST/xhtml:xhtml", NS)
    if body is None:
        raise RuntimeError(f"ST body not found for {pou.get('name')}")
    return body


def make_variable(name: str, type_tag: str) -> ET.Element:
    """创建一个局部变量声明。"""
    item = ET.Element(plc("variable"), {"name": name})
    typ = ET.SubElement(item, plc("type"))
    ET.SubElement(typ, plc(type_tag))
    return item


def append_local_variable(pou: ET.Element, item: ET.Element) -> None:
    """向 POU 增加局部变量；已存在时不重复增加。"""
    local_vars = pou.find("plc:interface/plc:localVars", NS)
    if local_vars is None:
        raise RuntimeError(f"localVars not found for {pou.get('name')}")
    name = item.get("name")
    if not any(old.get("name") == name for old in local_vars.findall("plc:variable", NS)):
        local_vars.append(item)


def bit_update_st(register: int, expression: str, mask: str, clear_mask: str) -> str:
    """生成对一个 WORD 位图寄存器置位/清位的 ST 代码。"""
    return f"""IF {expression} THEN
    arReg_data[{register}] := WORD_TO_INT(INT_TO_WORD(arReg_data[{register}]) OR WORD#16#{mask});
ELSE
    arReg_data[{register}] := WORD_TO_INT(INT_TO_WORD(arReg_data[{register}]) AND WORD#16#{clear_mask});
END_IF;"""


def jog_feedback_block(axis: str, index: int, fb_name: str, mask: str, clear_mask: str) -> str:
    """生成单轴点动/复位诊断反馈寄存器写入代码。"""
    return f"""
  // arReg_data[90] 反馈复位命令当前是否被 PLC 读到，bit0..bit4=X/Y/Z/B/C。
  {bit_update_st(90, "xResetCmdReg", mask, clear_mask)}

  // arReg_data[91] 反馈点动总开关 xJogMode，bit0..bit4=X/Y/Z/B/C。
  {bit_update_st(91, f"xJogMode[{index}]", mask, clear_mask)}

  // arReg_data[92] 反馈进入 FB_ServoJog 前的正向点动命令。
  {bit_update_st(92, f"xJogFwd[{index}]", mask, clear_mask)}

  // arReg_data[93] 反馈进入 FB_ServoJog 前的反向点动命令。
  {bit_update_st(93, f"xJogRev[{index}]", mask, clear_mask)}

  // arReg_data[94] 反馈 FB_ServoJog.xReady，TRUE 表示点动功能块内部 MC_Power 已就绪。
  {bit_update_st(94, f"{fb_name}.xReady", mask, clear_mask)}

  // arReg_data[95] 反馈 FB_ServoJog.xMoving，TRUE 表示当前轴正在点动。
  {bit_update_st(95, f"{fb_name}.xMoving", mask, clear_mask)}

  // arReg_data[96] 反馈 FB_ServoJog.xFault，TRUE 表示点动功能块检测到故障。
  {bit_update_st(96, f"{fb_name}.xFault", mask, clear_mask)}

  // arReg_data[97] 反馈 FB_ServoJog.xJogError，TRUE 表示 MC_Jog 功能块报错。
  {bit_update_st(97, f"{fb_name}.xJogError", mask, clear_mask)}

  // arReg_data[98] 反馈 FB_ServoJog.xJogAborted，TRUE 表示点动命令被中止。
  {bit_update_st(98, f"{fb_name}.xJogAborted", mask, clear_mask)}

  // arReg_data[99] 是点动/复位诊断版本号，Python 用它判断 [89..99] 是否已生效。
  arReg_data[99] := {VERSION};
""".rstrip()


def jog_parse_block(index: int, mask: str, fwd_reg: int, rev_reg: int) -> str:
    """生成在 EtherCAT_Task 内解析点动寄存器的 ST 代码。"""
    return f"""
  // arReg_data[89] 是五轴复位命令位图，bit0..bit4=X/Y/Z/B/C。
  // Python 复位时写一个短脉冲；FB_ServoJog 内部用 R_TRIG 转成 MC_Reset 上升沿。
  xResetCmdReg := (arReg_data[89] AND WORD#16#{mask}) <> WORD#0;

  // 在 EtherCAT_Task 内直接解析点动总开关和方向命令。
  // 这样 Jog 程序调用 FB_ServoJog 前，拿到的是本任务内最新的寄存器状态。
  xJogMode[{index}] := (arReg_data[19] AND WORD#16#{mask}) <> WORD#0;
  xJogFwd[{index}] := xJogMode[{index}] AND (arReg_data[{fwd_reg}] <> WORD#0);
  xJogRev[{index}] := xJogMode[{index}] AND (arReg_data[{rev_reg}] <> WORD#0);
""".rstrip()


def update_jog_pou(root: ET.Element, axis: str, index: int, pou_name: str, fb_name: str, mask: str, clear_mask: str, fwd_reg: int, rev_reg: int) -> None:
    """修改单轴 Jog 程序：接入复位命令、任务内点动解析和反馈寄存器。"""
    pou = find_pou(root, pou_name)
    append_local_variable(pou, make_variable("xResetCmdReg", "BOOL"))
    body_node = find_st_body(pou)
    text = body_node.text or ""

    if "xReset := FALSE," not in text:
        raise RuntimeError(f"xReset input pattern not found in {pou_name}")
    text = text.replace("xReset := FALSE,", "xReset := xResetCmdReg,", 1)

    parse_marker = "  // 点动侧使能跟随"
    if parse_marker not in text:
        raise RuntimeError(f"jog enable marker not found in {pou_name}")
    text = text.replace(parse_marker, jog_parse_block(index, mask, fwd_reg, rev_reg) + "\n\n" + parse_marker, 1)

    call_start = text.find(f"  {fb_name}(")
    if call_start < 0:
        raise RuntimeError(f"{fb_name} call not found in {pou_name}")
    call_end = text.find("  );", call_start)
    if call_end < 0:
        raise RuntimeError(f"{fb_name} call end not found in {pou_name}")
    call_end += len("  );")
    text = text[:call_end] + "\n\n" + jog_feedback_block(axis, index, fb_name, mask, clear_mask) + text[call_end:]
    body_node.text = text


def update_modbus_tcp_slave(root: ET.Element) -> None:
    """修复 ModbusTcpSlave 中点动总开关被后续直接赋值覆盖的问题。"""
    pou = find_pou(root, "ModbusTcpSlave")
    body_node = find_st_body(pou)
    text = body_node.text or ""

    start = text.find("xJogMode[1] :=")
    if start >= 0:
        # 保留本行前面的原缩进，只替换点动解析代码本身。
        start = text.rfind("\n", 0, start) + 1
    end_marker = text.find("modtcpslavectrl", start)
    end = text.rfind("\n", 0, end_marker) if end_marker >= 0 else -1
    if start < 0 or end < 0:
        raise RuntimeError("ModbusTcpSlave jog parse block was not found")

    replacement = """
  // arReg_data[19] 是点动总开关位图，bit0..bit4=X/Y/Z/B/C。
  xJogMode[1] := (arReg_data[19] AND WORD#16#0001) <> WORD#0; // X
  xJogMode[2] := (arReg_data[19] AND WORD#16#0002) <> WORD#0; // Y
  xJogMode[3] := (arReg_data[19] AND WORD#16#0004) <> WORD#0; // Z
  xJogMode[4] := (arReg_data[19] AND WORD#16#0008) <> WORD#0; // B
  xJogMode[5] := (arReg_data[19] AND WORD#16#0010) <> WORD#0; // C

  // arReg_data[6..15] 是五轴点动方向命令。
  // 方向命令必须同时满足 arReg_data[19] 对应点动总开关位，避免单独残留方向寄存器导致误点动。
  xJogFwd[1] := xJogMode[1] AND (arReg_data[6] <> WORD#0);
  xJogRev[1] := xJogMode[1] AND (arReg_data[7] <> WORD#0);

  xJogFwd[2] := xJogMode[2] AND (arReg_data[8] <> WORD#0);
  xJogRev[2] := xJogMode[2] AND (arReg_data[9] <> WORD#0);

  xJogFwd[3] := xJogMode[3] AND (arReg_data[10] <> WORD#0);
  xJogRev[3] := xJogMode[3] AND (arReg_data[11] <> WORD#0);

  xJogFwd[4] := xJogMode[4] AND (arReg_data[12] <> WORD#0);
  xJogRev[4] := xJogMode[4] AND (arReg_data[13] <> WORD#0);

  xJogFwd[5] := xJogMode[5] AND (arReg_data[14] <> WORD#0);
  xJogRev[5] := xJogMode[5] AND (arReg_data[15] <> WORD#0);
""".rstrip()
    body_node.text = text[:start] + replacement + text[end:]


def update_status_version(root: ET.Element) -> None:
    """把轴状态诊断版本号升级到 v26084。"""
    pou = find_pou(root, "AxisStatusFeedback_PRG")
    body_node = find_st_body(pou)
    text = body_node.text or ""
    text = text.replace("26082 表示 v26082 诊断版已生效", "26084 表示 v26084 诊断版已生效")
    if "arReg_data[84] := 26082;" not in text:
        raise RuntimeError("diagnostic version assignment was not found")
    body_node.text = text.replace("arReg_data[84] := 26082;", f"arReg_data[84] := {VERSION};", 1)


def build_minimal_project(source_root: ET.Element) -> ET.Element:
    """只打包本次修改的 POU，避免重导整个工程造成无关变化。"""
    project = ET.Element(plc("project"))
    ET.SubElement(
        project,
        plc("fileHeader"),
        {
            "companyName": "",
            "productName": "CODESYS",
            "productVersion": "CODESYS V3.5 SP20 Patch 4",
            "creationDateTime": datetime.now().isoformat(timespec="seconds"),
        },
    )
    content_header = child(
        project,
        "contentHeader",
        name="FiveDofPlatform_v26084.jog_reset.import.xml",
        modificationDateTime=datetime.now().isoformat(timespec="seconds"),
    )
    coordinate_info = child(content_header, "coordinateInfo")
    for name in ("fbd", "ld", "sfc"):
        item = child(coordinate_info, name)
        child(item, "scaling", x="1", y="1")

    types = child(project, "types")
    child(types, "dataTypes")
    pous = child(types, "pous")
    for pou_name in (
        "ModbusTcpSlave",
        "AxisStatusFeedback_PRG",
        "JogX",
        "JogY",
        "JogZ",
        "JogB",
        "JogC",
    ):
        pous.append(copy.deepcopy(find_pou(source_root, pou_name)))

    instances = child(project, "instances")
    child(instances, "configurations")
    return project


def write_codesys_xml(tree: ET.ElementTree, path: Path) -> None:
    """按 CODESYS 可导入的 XHTML 样式写 XML。"""
    raw_path = path.with_suffix(path.suffix + ".tmp")
    tree.write(raw_path, encoding="utf-8", xml_declaration=True)
    text = raw_path.read_text(encoding="utf-8")
    text = text.replace(f' xmlns:xhtml="{XHTML_NS}"', "")
    text = text.replace("<xhtml:xhtml />", f'<xhtml xmlns="{XHTML_NS}" />')
    text = text.replace("<xhtml:xhtml>", f'<xhtml xmlns="{XHTML_NS}">')
    text = text.replace("</xhtml:xhtml>", "</xhtml>")
    path.write_text(text, encoding="utf-8")
    raw_path.unlink()


def write_report() -> None:
    """写出本次 CODESYS 修改说明。"""
    REPORT_PATH.write_text(
        f"""# FiveDofPlatform v26084 点动/复位修复记录

生成时间：{datetime.now().isoformat(timespec="seconds")}

## 现场现象

Python 已经写入 `arReg_data[19]` 点动总开关和 `arReg_data[6..15]` 方向命令，但五轴状态均为 `2 / 0x0002`。状态 bit1 表示 `Errorstop`，轴处在错误停止时不会执行 `MC_Jog`。

## 本次修改

- 新增 `arReg_data[89]` 五轴复位命令位图，bit0..bit4 对应 X/Y/Z/B/C。
- `JogX/JogY/JogZ/JogB/JogC` 的 `FB_ServoJog.xReset` 改为读取对应复位位，Python 可以发复位脉冲。
- 每个 Jog 程序在 `EtherCAT_Task` 内直接解析 `arReg_data[19]` 和 `arReg_data[6..15]`，避免 MainTask 与 EtherCAT_Task 时序影响点动命令。
- 修复 `ModbusTcpSlave` 里点动总开关逻辑被后续直接赋值覆盖的问题。
- 新增 `arReg_data[90..99]` 点动/复位诊断反馈，版本号为 `{VERSION}`。
- `arReg_data[84]` 轴状态诊断版本同步升级为 `{VERSION}`。

## 未做的动作

- 未下载 PLC。
- 未启动或停止 PLC。
- 只生成导入 XML、工程副本、编译和导出文件。
""",
        encoding="utf-8",
    )


def write_register_map() -> None:
    """写出 v26084 新增寄存器说明。"""
    REGISTER_MAP_PATH.write_text(
        f"""# FiveDofPlatform v26084 寄存器地址与功能

## 关键控制寄存器

| 地址 | 方向 | 功能 |
|---:|---|---|
| `arReg_data[6]` | Python/HMI -> PLC | X 正向点动方向命令，需配合 `[19]` bit0。 |
| `arReg_data[7]` | Python/HMI -> PLC | X 反向点动方向命令，需配合 `[19]` bit0。 |
| `arReg_data[8]` | Python/HMI -> PLC | Y 正向点动方向命令，需配合 `[19]` bit1。 |
| `arReg_data[9]` | Python/HMI -> PLC | Y 反向点动方向命令，需配合 `[19]` bit1。 |
| `arReg_data[10]` | Python/HMI -> PLC | Z 正向点动方向命令，需配合 `[19]` bit2。 |
| `arReg_data[11]` | Python/HMI -> PLC | Z 反向点动方向命令，需配合 `[19]` bit2。 |
| `arReg_data[12]` | Python/HMI -> PLC | B 正向点动方向命令，需配合 `[19]` bit3。 |
| `arReg_data[13]` | Python/HMI -> PLC | B 反向点动方向命令，需配合 `[19]` bit3。 |
| `arReg_data[14]` | Python/HMI -> PLC | C 正向点动方向命令，需配合 `[19]` bit4。 |
| `arReg_data[15]` | Python/HMI -> PLC | C 反向点动方向命令，需配合 `[19]` bit4。 |
| `arReg_data[19]` | Python/HMI -> PLC | 点动总开关位图：bit0=X、bit1=Y、bit2=Z、bit3=B、bit4=C。 |
| `arReg_data[32]` | Python/HMI -> PLC | 五轴总使能命令：0=关闭五轴使能，非0=打开五轴使能。 |
| `arReg_data[89]` | Python/HMI -> PLC | 五轴复位命令位图：bit0=X、bit1=Y、bit2=Z、bit3=B、bit4=C。Python 写短脉冲后清 0。 |

## 反馈和诊断寄存器

| 地址 | 方向 | 功能 |
|---:|---|---|
| `arReg_data[33..37]` | PLC -> Python/HMI | X/Y/Z/B/C 五轴状态字。bit1=`0x0002` 表示 Errorstop。 |
| `arReg_data[38..47]` | PLC -> Python/HMI | X/Y/Z/B/C 五轴 AxisErrorID，DWORD 拆成低 16 位和高 16 位。 |
| `arReg_data[48]` | PLC -> Python/HMI | 五轴使能请求反馈，bit0..bit4=X/Y/Z/B/C，bit15=五轴请求全 TRUE。 |
| `arReg_data[49..88]` | PLC -> Python/HMI | v26082 起保留的 MC_ReadStatus、MC_ReadAxisError、MC_Power 诊断区。 |
| `arReg_data[84]` | PLC -> Python/HMI | 轴状态诊断版本号，v26084 固定为 `{VERSION}`。 |
| `arReg_data[90]` | PLC -> Python/HMI | 复位命令读到反馈位图，bit0..bit4=X/Y/Z/B/C。 |
| `arReg_data[91]` | PLC -> Python/HMI | 点动总开关读到反馈位图，bit0..bit4=X/Y/Z/B/C。 |
| `arReg_data[92]` | PLC -> Python/HMI | 正向点动命令进入 FB_ServoJog 前的反馈位图。 |
| `arReg_data[93]` | PLC -> Python/HMI | 反向点动命令进入 FB_ServoJog 前的反馈位图。 |
| `arReg_data[94]` | PLC -> Python/HMI | FB_ServoJog.xReady 位图，TRUE 表示点动功能块内部 MC_Power 就绪。 |
| `arReg_data[95]` | PLC -> Python/HMI | FB_ServoJog.xMoving 位图，TRUE 表示正在点动。 |
| `arReg_data[96]` | PLC -> Python/HMI | FB_ServoJog.xFault 位图，TRUE 表示点动功能块故障。 |
| `arReg_data[97]` | PLC -> Python/HMI | FB_ServoJog.xJogError 位图，TRUE 表示 MC_Jog 报错。 |
| `arReg_data[98]` | PLC -> Python/HMI | FB_ServoJog.xJogAborted 位图，TRUE 表示点动命令被中止。 |
| `arReg_data[99]` | PLC -> Python/HMI | 点动/复位诊断版本号，v26084 固定为 `{VERSION}`。 |

## 状态字低位/高位

`arReg_data[33..37]` 是 16 位状态字。低位是 bit0..bit7，高位是 bit8..bit15。

| bit | 十六进制 | 英文 | 中文含义 |
|---:|---:|---|---|
| 0 | `0x0001` | Disabled | 轴未使能。 |
| 1 | `0x0002` | Errorstop | 轴错误停止，必须复位或清除驱动故障后才能运动。 |
| 2 | `0x0004` | Stopping | 轴正在停止。 |
| 3 | `0x0008` | StandStill | 轴已使能并静止。 |
| 4 | `0x0010` | DiscreteMotion | 定位运动中。 |
| 5 | `0x0020` | ContinuousMotion | 连续运动中。 |
| 6 | `0x0040` | SynchronizedMotion | 同步运动中。 |
| 7 | `0x0080` | Homing | 回零中。 |
| 8 | `0x0100` | ConstantVelocity | 恒速中。 |
| 9 | `0x0200` | Accelerating | 加速中。 |
| 10 | `0x0400` | Decelerating | 减速中。 |
| 14 | `0x4000` | AxisError | 轴本体错误。 |
| 15 | `0x8000` | SWEndSwitchActive | 软件限位触发。 |
""",
        encoding="utf-8",
    )


def main() -> None:
    """生成 v26084 导入 XML 和说明文件。"""
    tree = ET.parse(SOURCE_EXPORT)
    root = tree.getroot()

    update_status_version(root)
    update_modbus_tcp_slave(root)
    for meta in AXES:
        update_jog_pou(root, *meta)

    IMPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    write_codesys_xml(ET.ElementTree(build_minimal_project(root)), IMPORT_PATH)
    write_report()
    write_register_map()
    print(str(IMPORT_PATH))
    print(str(REPORT_PATH))
    print(str(REGISTER_MAP_PATH))


if __name__ == "__main__":
    main()
