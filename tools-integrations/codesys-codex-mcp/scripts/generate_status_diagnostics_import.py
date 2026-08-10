from __future__ import annotations

from datetime import datetime
from pathlib import Path
import xml.etree.ElementTree as ET


# 这个脚本只生成 CODESYS PLCopenXML 导入文件，不直接修改 PLC 工程。
# 后续通过 CODESYS ScriptEngine 把导入文件写入工程副本，再重新编译验证。

PLC_NS = "http://www.plcopen.org/xml/tc6_0200"
XHTML_NS = "http://www.w3.org/1999/xhtml"
NS = {"plc": PLC_NS, "xhtml": XHTML_NS}

SOURCE_EXPORT = Path(r"C:\path\export_enable_control\Machine.xml")
IMPORT_PATH = Path(
    r"C:\Users\29925\codesys-codex-mcp\imports\FiveDofPlatform.status_diag.fulltask.import.xml"
)
REPORT_PATH = Path(
    r"C:\Users\29925\codesys-codex-mcp\imports\FiveDofPlatform.status_diag.report.md"
)


ET.register_namespace("", PLC_NS)
ET.register_namespace("xhtml", XHTML_NS)


def plc(tag: str) -> str:
    """返回带 PLCopenXML 命名空间的标签名。"""
    return f"{{{PLC_NS}}}{tag}"


def xhtml(tag: str) -> str:
    """返回带 XHTML 命名空间的标签名。"""
    return f"{{{XHTML_NS}}}{tag}"


def find_pou(root: ET.Element, name: str) -> ET.Element:
    """按 POU 名称查找程序对象。"""
    for pou in root.findall(".//plc:pou", NS):
        if pou.get("name") == name:
            return pou
    raise RuntimeError(f"POU not found: {name}")


def find_st_body(pou: ET.Element) -> ET.Element:
    """找到一个 ST 程序体的 XHTML 节点。"""
    body = pou.find("plc:body/plc:ST/xhtml:xhtml", NS)
    if body is None:
        raise RuntimeError(f"ST body not found for POU {pou.get('name')}")
    return body


def variable(name: str, type_tag: str | None = None, derived_type: str | None = None) -> ET.Element:
    """创建一个 CODESYS 变量声明节点。"""
    item = ET.Element(plc("variable"), {"name": name})
    typ = ET.SubElement(item, plc("type"))
    if derived_type is not None:
        ET.SubElement(typ, plc("derived"), {"name": derived_type})
    elif type_tag is not None:
        ET.SubElement(typ, plc(type_tag))
    else:
        raise ValueError("type_tag or derived_type is required")
    return item


def append_local_variable(pou: ET.Element, item: ET.Element) -> None:
    """向 POU 的 localVars 增加局部变量，已存在时不重复增加。"""
    local_vars = pou.find("plc:interface/plc:localVars", NS)
    if local_vars is None:
        raise RuntimeError(f"localVars not found for POU {pou.get('name')}")
    name = item.get("name")
    for old in local_vars.findall("plc:variable", NS):
        if old.get("name") == name:
            return
    local_vars.append(item)


def update_axis_status_pou(root: ET.Element) -> None:
    """补充 MC_ReadStatus.ErrorID 输出寄存器和使能请求不一致诊断。"""
    pou = find_pou(root, "AxisStatusFeedback_PRG")

    for axis_name in ("X", "Y", "Z", "B", "C"):
        append_local_variable(
            pou,
            variable(f"eStatusError{axis_name}", derived_type="SM3_Error.SMC_ERROR"),
        )
    append_local_variable(pou, variable("wEnableMismatchFeedback", type_tag="WORD"))

    find_st_body(pou).text = "\n" + axis_status_body() + "\n"


def status_error_id_lines(axis_name: str, low_addr: int, high_addr: int) -> str:
    """生成一个轴的 MC_ReadStatus.ErrorID 低位/高位寄存器输出代码。"""
    return f"""
// arReg_data[{low_addr}..{high_addr}] 保存 {axis_name} 轴 MC_ReadStatus.ErrorID。
// 这个 ErrorID 是状态读取功能块自己的错误号，不是驱动轴本体 AxisErrorID。
arReg_data[{low_addr}] := WORD_TO_INT(DWORD_TO_WORD(TO_DWORD(eStatusError{axis_name})));
arReg_data[{high_addr}] := WORD_TO_INT(DWORD_TO_WORD(SHR(TO_DWORD(eStatusError{axis_name}), 16)));""".rstrip()


def axis_status_body() -> str:
    """生成 AxisStatusFeedback_PRG 的完整 ST 代码。"""
    return f"""
// 本程序只做轴状态、轴错误号和状态读取诊断反馈，不直接控制轴运动。
// 连续寄存器块从 arReg_data[32] 开始：
// [32] 五轴总使能命令。
// [33..37] 五轴状态字。
// [38..47] 五轴 AxisErrorID，来自 MC_ReadAxisError。
// [48] 五轴 AxisEnable 请求反馈。
// [49..58] 五轴 MC_ReadStatus.ErrorID，低 16 位在前，高 16 位在后。
// [59] 诊断版本号，26081 表示 2026-08-01 诊断版寄存器已生效。
// [60] 使能请求与实际状态不一致位，bit0..bit4 = X/Y/Z/B/C。

fbStatusX(
    Axis := AXIS_X,
    Enable := TRUE,
    Valid => ,
    Busy => ,
    Error => bStatusErrorX,
    ErrorID => eStatusErrorX,
    Disabled => ,
    Errorstop => ,
    Stopping => ,
    StandStill => ,
    DiscreteMotion => ,
    ContinuousMotion => ,
    SynchronizedMotion => ,
    Homing => ,
    ConstantVelocity => ,
    Accelerating => ,
    Decelerating => ,
    FBErrorOccured => bStatusFBErrorX,
);

// 轴本体错误必须用 MC_ReadAxisError 读取，不能从 MC_ReadStatus 取 AxisError。
fbAxisErrorX(
    Axis := AXIS_X,
    Enable := TRUE,
    Valid => ,
    Busy => ,
    Error => ,
    ErrorID => ,
    AxisError => bAxisErrorX,
    AxisErrorID => dwAxisErrorX,
    SWEndSwitchActive => bSwEndSwitchX
);
IF NOT bAxisErrorX THEN
    // 无轴错误时清零错误 ID，避免寄存器保留上一次故障号。
    dwAxisErrorX := DWORD#0;
END_IF;

// 把 X 轴 BOOL 状态压缩成一个 WORD 状态字输出。
wStatusX := WORD#0;
IF fbStatusX.Disabled THEN wStatusX := wStatusX OR WORD#16#0001; END_IF;
IF fbStatusX.Errorstop THEN wStatusX := wStatusX OR WORD#16#0002; END_IF;
IF fbStatusX.Stopping THEN wStatusX := wStatusX OR WORD#16#0004; END_IF;
IF fbStatusX.StandStill THEN wStatusX := wStatusX OR WORD#16#0008; END_IF;
IF fbStatusX.DiscreteMotion THEN wStatusX := wStatusX OR WORD#16#0010; END_IF;
IF fbStatusX.ContinuousMotion THEN wStatusX := wStatusX OR WORD#16#0020; END_IF;
IF fbStatusX.SynchronizedMotion THEN wStatusX := wStatusX OR WORD#16#0040; END_IF;
IF fbStatusX.Homing THEN wStatusX := wStatusX OR WORD#16#0080; END_IF;
IF fbStatusX.ConstantVelocity THEN wStatusX := wStatusX OR WORD#16#0100; END_IF;
IF fbStatusX.Accelerating THEN wStatusX := wStatusX OR WORD#16#0200; END_IF;
IF fbStatusX.Decelerating THEN wStatusX := wStatusX OR WORD#16#0400; END_IF;
IF bStatusErrorX THEN wStatusX := wStatusX OR WORD#16#0800; END_IF;
IF bStatusFBErrorX THEN wStatusX := wStatusX OR WORD#16#1000; END_IF;
IF bAxisErrorX THEN wStatusX := wStatusX OR WORD#16#4000; END_IF;
IF bSwEndSwitchX THEN wStatusX := wStatusX OR WORD#16#8000; END_IF;
arReg_data[33] := WORD_TO_INT(wStatusX);
arReg_data[38] := WORD_TO_INT(DWORD_TO_WORD(dwAxisErrorX));
arReg_data[39] := WORD_TO_INT(DWORD_TO_WORD(SHR(dwAxisErrorX, 16)));
{status_error_id_lines("X", 49, 50)}

fbStatusY(
    Axis := AXIS_Y,
    Enable := TRUE,
    Valid => ,
    Busy => ,
    Error => bStatusErrorY,
    ErrorID => eStatusErrorY,
    Disabled => ,
    Errorstop => ,
    Stopping => ,
    StandStill => ,
    DiscreteMotion => ,
    ContinuousMotion => ,
    SynchronizedMotion => ,
    Homing => ,
    ConstantVelocity => ,
    Accelerating => ,
    Decelerating => ,
    FBErrorOccured => bStatusFBErrorY,
);

// Y 轴错误号单独从 MC_ReadAxisError 输出到 DWORD，再拆成两个 16 位寄存器。
fbAxisErrorY(
    Axis := AXIS_Y,
    Enable := TRUE,
    Valid => ,
    Busy => ,
    Error => ,
    ErrorID => ,
    AxisError => bAxisErrorY,
    AxisErrorID => dwAxisErrorY,
    SWEndSwitchActive => bSwEndSwitchY
);
IF NOT bAxisErrorY THEN
    dwAxisErrorY := DWORD#0;
END_IF;

wStatusY := WORD#0;
IF fbStatusY.Disabled THEN wStatusY := wStatusY OR WORD#16#0001; END_IF;
IF fbStatusY.Errorstop THEN wStatusY := wStatusY OR WORD#16#0002; END_IF;
IF fbStatusY.Stopping THEN wStatusY := wStatusY OR WORD#16#0004; END_IF;
IF fbStatusY.StandStill THEN wStatusY := wStatusY OR WORD#16#0008; END_IF;
IF fbStatusY.DiscreteMotion THEN wStatusY := wStatusY OR WORD#16#0010; END_IF;
IF fbStatusY.ContinuousMotion THEN wStatusY := wStatusY OR WORD#16#0020; END_IF;
IF fbStatusY.SynchronizedMotion THEN wStatusY := wStatusY OR WORD#16#0040; END_IF;
IF fbStatusY.Homing THEN wStatusY := wStatusY OR WORD#16#0080; END_IF;
IF fbStatusY.ConstantVelocity THEN wStatusY := wStatusY OR WORD#16#0100; END_IF;
IF fbStatusY.Accelerating THEN wStatusY := wStatusY OR WORD#16#0200; END_IF;
IF fbStatusY.Decelerating THEN wStatusY := wStatusY OR WORD#16#0400; END_IF;
IF bStatusErrorY THEN wStatusY := wStatusY OR WORD#16#0800; END_IF;
IF bStatusFBErrorY THEN wStatusY := wStatusY OR WORD#16#1000; END_IF;
IF bAxisErrorY THEN wStatusY := wStatusY OR WORD#16#4000; END_IF;
IF bSwEndSwitchY THEN wStatusY := wStatusY OR WORD#16#8000; END_IF;
arReg_data[34] := WORD_TO_INT(wStatusY);
arReg_data[40] := WORD_TO_INT(DWORD_TO_WORD(dwAxisErrorY));
arReg_data[41] := WORD_TO_INT(DWORD_TO_WORD(SHR(dwAxisErrorY, 16)));
{status_error_id_lines("Y", 51, 52)}

fbStatusZ(
    Axis := AXIS_Z,
    Enable := TRUE,
    Valid => ,
    Busy => ,
    Error => bStatusErrorZ,
    ErrorID => eStatusErrorZ,
    Disabled => ,
    Errorstop => ,
    Stopping => ,
    StandStill => ,
    DiscreteMotion => ,
    ContinuousMotion => ,
    SynchronizedMotion => ,
    Homing => ,
    ConstantVelocity => ,
    Accelerating => ,
    Decelerating => ,
    FBErrorOccured => bStatusFBErrorZ,
);

// Z 轴错误号反馈。
fbAxisErrorZ(
    Axis := AXIS_Z,
    Enable := TRUE,
    Valid => ,
    Busy => ,
    Error => ,
    ErrorID => ,
    AxisError => bAxisErrorZ,
    AxisErrorID => dwAxisErrorZ,
    SWEndSwitchActive => bSwEndSwitchZ
);
IF NOT bAxisErrorZ THEN
    dwAxisErrorZ := DWORD#0;
END_IF;

wStatusZ := WORD#0;
IF fbStatusZ.Disabled THEN wStatusZ := wStatusZ OR WORD#16#0001; END_IF;
IF fbStatusZ.Errorstop THEN wStatusZ := wStatusZ OR WORD#16#0002; END_IF;
IF fbStatusZ.Stopping THEN wStatusZ := wStatusZ OR WORD#16#0004; END_IF;
IF fbStatusZ.StandStill THEN wStatusZ := wStatusZ OR WORD#16#0008; END_IF;
IF fbStatusZ.DiscreteMotion THEN wStatusZ := wStatusZ OR WORD#16#0010; END_IF;
IF fbStatusZ.ContinuousMotion THEN wStatusZ := wStatusZ OR WORD#16#0020; END_IF;
IF fbStatusZ.SynchronizedMotion THEN wStatusZ := wStatusZ OR WORD#16#0040; END_IF;
IF fbStatusZ.Homing THEN wStatusZ := wStatusZ OR WORD#16#0080; END_IF;
IF fbStatusZ.ConstantVelocity THEN wStatusZ := wStatusZ OR WORD#16#0100; END_IF;
IF fbStatusZ.Accelerating THEN wStatusZ := wStatusZ OR WORD#16#0200; END_IF;
IF fbStatusZ.Decelerating THEN wStatusZ := wStatusZ OR WORD#16#0400; END_IF;
IF bStatusErrorZ THEN wStatusZ := wStatusZ OR WORD#16#0800; END_IF;
IF bStatusFBErrorZ THEN wStatusZ := wStatusZ OR WORD#16#1000; END_IF;
IF bAxisErrorZ THEN wStatusZ := wStatusZ OR WORD#16#4000; END_IF;
IF bSwEndSwitchZ THEN wStatusZ := wStatusZ OR WORD#16#8000; END_IF;
arReg_data[35] := WORD_TO_INT(wStatusZ);
arReg_data[42] := WORD_TO_INT(DWORD_TO_WORD(dwAxisErrorZ));
arReg_data[43] := WORD_TO_INT(DWORD_TO_WORD(SHR(dwAxisErrorZ, 16)));
{status_error_id_lines("Z", 53, 54)}

fbStatusB(
    Axis := AXIS_B,
    Enable := TRUE,
    Valid => ,
    Busy => ,
    Error => bStatusErrorB,
    ErrorID => eStatusErrorB,
    Disabled => ,
    Errorstop => ,
    Stopping => ,
    StandStill => ,
    DiscreteMotion => ,
    ContinuousMotion => ,
    SynchronizedMotion => ,
    Homing => ,
    ConstantVelocity => ,
    Accelerating => ,
    Decelerating => ,
    FBErrorOccured => bStatusFBErrorB,
);

// B 轴错误号反馈。
fbAxisErrorB(
    Axis := AXIS_B,
    Enable := TRUE,
    Valid => ,
    Busy => ,
    Error => ,
    ErrorID => ,
    AxisError => bAxisErrorB,
    AxisErrorID => dwAxisErrorB,
    SWEndSwitchActive => bSwEndSwitchB
);
IF NOT bAxisErrorB THEN
    dwAxisErrorB := DWORD#0;
END_IF;

wStatusB := WORD#0;
IF fbStatusB.Disabled THEN wStatusB := wStatusB OR WORD#16#0001; END_IF;
IF fbStatusB.Errorstop THEN wStatusB := wStatusB OR WORD#16#0002; END_IF;
IF fbStatusB.Stopping THEN wStatusB := wStatusB OR WORD#16#0004; END_IF;
IF fbStatusB.StandStill THEN wStatusB := wStatusB OR WORD#16#0008; END_IF;
IF fbStatusB.DiscreteMotion THEN wStatusB := wStatusB OR WORD#16#0010; END_IF;
IF fbStatusB.ContinuousMotion THEN wStatusB := wStatusB OR WORD#16#0020; END_IF;
IF fbStatusB.SynchronizedMotion THEN wStatusB := wStatusB OR WORD#16#0040; END_IF;
IF fbStatusB.Homing THEN wStatusB := wStatusB OR WORD#16#0080; END_IF;
IF fbStatusB.ConstantVelocity THEN wStatusB := wStatusB OR WORD#16#0100; END_IF;
IF fbStatusB.Accelerating THEN wStatusB := wStatusB OR WORD#16#0200; END_IF;
IF fbStatusB.Decelerating THEN wStatusB := wStatusB OR WORD#16#0400; END_IF;
IF bStatusErrorB THEN wStatusB := wStatusB OR WORD#16#0800; END_IF;
IF bStatusFBErrorB THEN wStatusB := wStatusB OR WORD#16#1000; END_IF;
IF bAxisErrorB THEN wStatusB := wStatusB OR WORD#16#4000; END_IF;
IF bSwEndSwitchB THEN wStatusB := wStatusB OR WORD#16#8000; END_IF;
arReg_data[36] := WORD_TO_INT(wStatusB);
arReg_data[44] := WORD_TO_INT(DWORD_TO_WORD(dwAxisErrorB));
arReg_data[45] := WORD_TO_INT(DWORD_TO_WORD(SHR(dwAxisErrorB, 16)));
{status_error_id_lines("B", 55, 56)}

fbStatusC(
    Axis := AXIS_C,
    Enable := TRUE,
    Valid => ,
    Busy => ,
    Error => bStatusErrorC,
    ErrorID => eStatusErrorC,
    Disabled => ,
    Errorstop => ,
    Stopping => ,
    StandStill => ,
    DiscreteMotion => ,
    ContinuousMotion => ,
    SynchronizedMotion => ,
    Homing => ,
    ConstantVelocity => ,
    Accelerating => ,
    Decelerating => ,
    FBErrorOccured => bStatusFBErrorC,
);

// C 轴错误号反馈。
fbAxisErrorC(
    Axis := AXIS_C,
    Enable := TRUE,
    Valid => ,
    Busy => ,
    Error => ,
    ErrorID => ,
    AxisError => bAxisErrorC,
    AxisErrorID => dwAxisErrorC,
    SWEndSwitchActive => bSwEndSwitchC
);
IF NOT bAxisErrorC THEN
    dwAxisErrorC := DWORD#0;
END_IF;

wStatusC := WORD#0;
IF fbStatusC.Disabled THEN wStatusC := wStatusC OR WORD#16#0001; END_IF;
IF fbStatusC.Errorstop THEN wStatusC := wStatusC OR WORD#16#0002; END_IF;
IF fbStatusC.Stopping THEN wStatusC := wStatusC OR WORD#16#0004; END_IF;
IF fbStatusC.StandStill THEN wStatusC := wStatusC OR WORD#16#0008; END_IF;
IF fbStatusC.DiscreteMotion THEN wStatusC := wStatusC OR WORD#16#0010; END_IF;
IF fbStatusC.ContinuousMotion THEN wStatusC := wStatusC OR WORD#16#0020; END_IF;
IF fbStatusC.SynchronizedMotion THEN wStatusC := wStatusC OR WORD#16#0040; END_IF;
IF fbStatusC.Homing THEN wStatusC := wStatusC OR WORD#16#0080; END_IF;
IF fbStatusC.ConstantVelocity THEN wStatusC := wStatusC OR WORD#16#0100; END_IF;
IF fbStatusC.Accelerating THEN wStatusC := wStatusC OR WORD#16#0200; END_IF;
IF fbStatusC.Decelerating THEN wStatusC := wStatusC OR WORD#16#0400; END_IF;
IF bStatusErrorC THEN wStatusC := wStatusC OR WORD#16#0800; END_IF;
IF bStatusFBErrorC THEN wStatusC := wStatusC OR WORD#16#1000; END_IF;
IF bAxisErrorC THEN wStatusC := wStatusC OR WORD#16#4000; END_IF;
IF bSwEndSwitchC THEN wStatusC := wStatusC OR WORD#16#8000; END_IF;
arReg_data[37] := WORD_TO_INT(wStatusC);
arReg_data[46] := WORD_TO_INT(DWORD_TO_WORD(dwAxisErrorC));
arReg_data[47] := WORD_TO_INT(DWORD_TO_WORD(SHR(dwAxisErrorC, 16)));
{status_error_id_lines("C", 57, 58)}

// 诊断版本号。Python 读到 26081 时，才说明 [49..60] 已经由新版 PLC 代码写入。
arReg_data[59] := 26081;

// 使能请求不一致：命令请求 TRUE，但 MC_ReadStatus 仍显示 Disabled。
wEnableMismatchFeedback := WORD#0;
IF GVL.Axes[1].AxisEnable AND fbStatusX.Disabled THEN wEnableMismatchFeedback := wEnableMismatchFeedback OR WORD#16#0001; END_IF;
IF GVL.Axes[2].AxisEnable AND fbStatusY.Disabled THEN wEnableMismatchFeedback := wEnableMismatchFeedback OR WORD#16#0002; END_IF;
IF GVL.Axes[3].AxisEnable AND fbStatusZ.Disabled THEN wEnableMismatchFeedback := wEnableMismatchFeedback OR WORD#16#0004; END_IF;
IF GVL.Axes[4].AxisEnable AND fbStatusB.Disabled THEN wEnableMismatchFeedback := wEnableMismatchFeedback OR WORD#16#0008; END_IF;
IF GVL.Axes[5].AxisEnable AND fbStatusC.Disabled THEN wEnableMismatchFeedback := wEnableMismatchFeedback OR WORD#16#0010; END_IF;
arReg_data[60] := WORD_TO_INT(wEnableMismatchFeedback);
""".strip()


def update_jog_pou(root: ET.Element, pou_name: str, axis_index: int, fb_name: str) -> None:
    """让点动程序的使能请求跟随五轴总使能，不再使用本地常量 TRUE。"""
    body = find_st_body(find_pou(root, pou_name))
    text = body.text or ""
    marker = f"  {fb_name}("
    injected = (
        f"  // 点动侧使能跟随 arReg_data[32] 解析后的 GVL.Axes[{axis_index}].AxisEnable。\n"
        f"  // 这样五轴总关闭时，点动功能块不会继续保持本地 TRUE 使能请求。\n"
        f"  xServoEnable := GVL.Axes[{axis_index}].AxisEnable;\n\n"
        f"{marker}"
    )
    if "xServoEnable := GVL.Axes[" not in text:
        if marker not in text:
            raise RuntimeError(f"{marker} not found in {pou_name}")
        text = text.replace(marker, injected, 1)
    body.text = text


def reorder_main_task(root: ET.Element) -> None:
    """调整主任务顺序，让使能先执行、状态反馈后执行。"""
    task = root.find(".//plc:task[@name='MainTask']", NS)
    if task is None:
        raise RuntimeError("MainTask not found")

    pou_instances = [child for child in list(task) if child.tag == plc("pouInstance")]
    other_nodes = [child for child in list(task) if child.tag != plc("pouInstance")]
    instance_by_name = {item.get("name"): item for item in pou_instances}

    ordered_names = [
        "AxisEnableControl_PRG",
        "JogX",
        "JogY",
        "JogZ",
        "JogB",
        "JogC",
        "AXIS_X_PRG",
        "Axis_Y_PRG",
        "AXIS_Z_PRG",
        "AXIS_B_PRG",
        "AXIS_C_PRG",
        "FiveDOF_Platform_PRG",
        "LogConsumer",
        "PLC_PRG",
        "AxisStatusFeedback_PRG",
        "ModbusTcpSlave",
    ]

    for child in list(task):
        task.remove(child)
    for name in ordered_names:
        if name in instance_by_name:
            task.append(instance_by_name[name])
    for item in pou_instances:
        if item not in list(task):
            task.append(item)
    for item in other_nodes:
        task.append(item)


def write_report() -> None:
    """生成本次诊断修改说明，便于后续追踪。"""
    REPORT_PATH.write_text(
        f"""# FiveDofPlatform 状态诊断导入说明

生成时间：{datetime.now().isoformat(timespec="seconds")}

源 XML：`{SOURCE_EXPORT}`

导入 XML：`{IMPORT_PATH}`

## 排查结论

- 当前 PLC 读到 `arReg_data[32]=1`，`arReg_data[48]=16#801F`，说明五轴使能请求为 TRUE。
- 当前 PLC 读到 `arReg_data[33..37]=16#0801`，代表 `Disabled + MC_ReadStatus.Error`。
- `AxisErrorID=0` 不等于没有 `MC_ReadStatus` 错误，因为 `AxisErrorID` 来自 `MC_ReadAxisError`，原代码没有导出 `MC_ReadStatus.ErrorID`。

## 本次导入修改

- `AxisStatusFeedback_PRG` 新增 `arReg_data[49..58]`：五轴 `MC_ReadStatus.ErrorID`，每轴低 16 位、高 16 位各一个寄存器。
- `AxisStatusFeedback_PRG` 新增 `arReg_data[59]=26081`：诊断版寄存器生效标记。
- `AxisStatusFeedback_PRG` 新增 `arReg_data[60]`：使能请求 TRUE 但状态仍 Disabled 的位图。
- `JogX..JogC` 增加 `xServoEnable := GVL.Axes[n].AxisEnable`，让点动侧跟随五轴总使能命令。
- `MainTask` 顺序调整为先执行 `AxisEnableControl_PRG`，后执行单轴/点动，再执行 `AxisStatusFeedback_PRG`。

## 注意

本导入文件只用于工程副本编译验证；不会下载到 PLC。
""",
        encoding="utf-8",
    )


def main() -> None:
    """生成完整导入 XML。"""
    tree = ET.parse(SOURCE_EXPORT)
    root = tree.getroot()

    update_axis_status_pou(root)
    update_jog_pou(root, "JogX", 1, "fbJogX")
    update_jog_pou(root, "JogY", 2, "fbJogY")
    update_jog_pou(root, "JogZ", 3, "fbJogZ")
    update_jog_pou(root, "JogB", 4, "fbJogB")
    update_jog_pou(root, "JogC", 5, "fbJogC")
    reorder_main_task(root)

    IMPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    tree.write(IMPORT_PATH, encoding="utf-8", xml_declaration=True)
    write_report()
    print(str(IMPORT_PATH))
    print(str(REPORT_PATH))


if __name__ == "__main__":
    main()
