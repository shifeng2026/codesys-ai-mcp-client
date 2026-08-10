from __future__ import annotations

import copy
from datetime import datetime
from pathlib import Path
import xml.etree.ElementTree as ET


# 本脚本生成 CODESYS PLCopenXML 导入文件，用于工程副本诊断版。
# 它不会下载 PLC，也不会直接启动/停止 PLC。

PLC_NS = "http://www.plcopen.org/xml/tc6_0200"
XHTML_NS = "http://www.w3.org/1999/xhtml"
NS = {"plc": PLC_NS, "xhtml": XHTML_NS}

SOURCE_EXPORT = Path(r"C:\path\export_enable_control\Machine.xml")
IMPORT_PATH = Path(
    r"C:\Users\29925\codesys-codex-mcp\imports\FiveDofPlatform_v26082.fulltask.import.xml"
)
REPORT_PATH = Path(
    r"C:\Users\29925\codesys-codex-mcp\imports\FiveDofPlatform_v26082.report.md"
)

DIAG_VERSION = 26082

AXES = (
    # name, index, status reg, AxisErrorID low/high, ReadStatus.ErrorID low/high,
    # ReadAxisError.ErrorID low/high, MC_Power.ErrorID low/high, MC_Power diag word
    ("X", 1, 33, 38, 39, 49, 50, 59, 60, 69, 70, 79),
    ("Y", 2, 34, 40, 41, 51, 52, 61, 62, 71, 72, 80),
    ("Z", 3, 35, 42, 43, 53, 54, 63, 64, 73, 74, 81),
    ("B", 4, 36, 44, 45, 55, 56, 65, 66, 75, 76, 82),
    ("C", 5, 37, 46, 47, 57, 58, 67, 68, 77, 78, 83),
)


ET.register_namespace("", PLC_NS)
ET.register_namespace("xhtml", XHTML_NS)


def plc(tag: str) -> str:
    """返回 PLCopenXML 命名空间下的标签名。"""
    return f"{{{PLC_NS}}}{tag}"


def xhtml(tag: str) -> str:
    """返回 XHTML 命名空间下的标签名。"""
    return f"{{{XHTML_NS}}}{tag}"


def child(parent: ET.Element, tag: str, **attrs: str) -> ET.Element:
    """创建 PLCopenXML 子节点。"""
    return ET.SubElement(parent, plc(tag), attrs)


def find_pou(root: ET.Element, name: str) -> ET.Element:
    """按 POU 名称查找程序。"""
    for pou in root.findall(".//plc:pou", NS):
        if pou.get("name") == name:
            return pou
    raise RuntimeError(f"POU not found: {name}")


def find_st_body(pou: ET.Element) -> ET.Element:
    """找到 POU 的 ST 代码节点。"""
    body = pou.find("plc:body/plc:ST/xhtml:xhtml", NS)
    if body is None:
        raise RuntimeError(f"ST body not found for {pou.get('name')}")
    return body


def make_variable(name: str, type_tag: str | None = None, derived_type: str | None = None) -> ET.Element:
    """创建一个局部变量声明。"""
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
    """向 POU 增加局部变量，变量已存在时不重复增加。"""
    local_vars = pou.find("plc:interface/plc:localVars", NS)
    if local_vars is None:
        raise RuntimeError(f"localVars not found for {pou.get('name')}")
    name = item.get("name")
    if not any(old.get("name") == name for old in local_vars.findall("plc:variable", NS)):
        local_vars.append(item)


def dword_to_regs_st(source: str, low_reg: int, high_reg: int) -> str:
    """生成把一个枚举/整数错误号拆成低高 16 位寄存器的 ST 代码。"""
    return (
        f"arReg_data[{low_reg}] := WORD_TO_INT(DWORD_TO_WORD(TO_DWORD({source})));\n"
        f"arReg_data[{high_reg}] := WORD_TO_INT(DWORD_TO_WORD(SHR(TO_DWORD({source}), 16)));"
    )


def axis_status_block(meta: tuple[str, int, int, int, int, int, int, int, int, int, int, int]) -> str:
    """生成一个轴的状态、轴错误、诊断错误号输出代码。"""
    axis, _index, status_reg, axis_err_low, axis_err_high, status_err_low, status_err_high, read_axis_err_low, read_axis_err_high, _power_err_low, _power_err_high, _power_diag = meta
    return f"""
fbStatus{axis}(
    Axis := AXIS_{axis},
    Enable := TRUE,
    Valid => ,
    Busy => ,
    Error => bStatusError{axis},
    ErrorID => eStatusError{axis},
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
    FBErrorOccured => bStatusFBError{axis},
);

// MC_ReadAxisError.AxisErrorID 只表示驱动轴本体错误号。
// 如果网线断开导致 MC_ReadAxisError 自己报 Error，错误号会写到 arReg_data[{read_axis_err_low}..{read_axis_err_high}]。
fbAxisError{axis}(
    Axis := AXIS_{axis},
    Enable := TRUE,
    Valid => ,
    Busy => ,
    Error => bAxisReadError{axis},
    ErrorID => eAxisReadError{axis},
    AxisError => bAxisError{axis},
    AxisErrorID => dwAxisError{axis},
    SWEndSwitchActive => bSwEndSwitch{axis}
);
IF NOT bAxisError{axis} THEN
    // 没有驱动轴本体错误时清零 AxisErrorID，但不清零各功能块自己的 ErrorID。
    dwAxisError{axis} := DWORD#0;
END_IF;

// 把 {axis} 轴 BOOL 状态压缩成一个 WORD 状态字输出到 arReg_data[{status_reg}]。
// 主状态字只放轴状态和轴本体错误，不再混入 MC_ReadStatus 功能块自己的 Error 位。
// MC_ReadStatus.ErrorID 单独放到 arReg_data[{status_err_low}..{status_err_high}]，
// MC_ReadStatus.Error 汇总位单独放到 arReg_data[86]，避免 Python 默认状态一直显示“功能块错误”。
wStatus{axis} := WORD#0;
IF fbStatus{axis}.Disabled THEN wStatus{axis} := wStatus{axis} OR WORD#16#0001; END_IF;
IF fbStatus{axis}.Errorstop THEN wStatus{axis} := wStatus{axis} OR WORD#16#0002; END_IF;
IF fbStatus{axis}.Stopping THEN wStatus{axis} := wStatus{axis} OR WORD#16#0004; END_IF;
IF fbStatus{axis}.StandStill THEN wStatus{axis} := wStatus{axis} OR WORD#16#0008; END_IF;
IF fbStatus{axis}.DiscreteMotion THEN wStatus{axis} := wStatus{axis} OR WORD#16#0010; END_IF;
IF fbStatus{axis}.ContinuousMotion THEN wStatus{axis} := wStatus{axis} OR WORD#16#0020; END_IF;
IF fbStatus{axis}.SynchronizedMotion THEN wStatus{axis} := wStatus{axis} OR WORD#16#0040; END_IF;
IF fbStatus{axis}.Homing THEN wStatus{axis} := wStatus{axis} OR WORD#16#0080; END_IF;
IF fbStatus{axis}.ConstantVelocity THEN wStatus{axis} := wStatus{axis} OR WORD#16#0100; END_IF;
IF fbStatus{axis}.Accelerating THEN wStatus{axis} := wStatus{axis} OR WORD#16#0200; END_IF;
IF fbStatus{axis}.Decelerating THEN wStatus{axis} := wStatus{axis} OR WORD#16#0400; END_IF;
IF bAxisError{axis} THEN wStatus{axis} := wStatus{axis} OR WORD#16#4000; END_IF;
IF bSwEndSwitch{axis} THEN wStatus{axis} := wStatus{axis} OR WORD#16#8000; END_IF;
arReg_data[{status_reg}] := WORD_TO_INT(wStatus{axis});

// arReg_data[{axis_err_low}..{axis_err_high}] 保存 {axis} 轴驱动 AxisErrorID。
arReg_data[{axis_err_low}] := WORD_TO_INT(DWORD_TO_WORD(dwAxisError{axis}));
arReg_data[{axis_err_high}] := WORD_TO_INT(DWORD_TO_WORD(SHR(dwAxisError{axis}, 16)));

// arReg_data[{status_err_low}..{status_err_high}] 保存 {axis} 轴 MC_ReadStatus.ErrorID。
{dword_to_regs_st(f"eStatusError{axis}", status_err_low, status_err_high)}

// arReg_data[{read_axis_err_low}..{read_axis_err_high}] 保存 {axis} 轴 MC_ReadAxisError.ErrorID。
{dword_to_regs_st(f"eAxisReadError{axis}", read_axis_err_low, read_axis_err_high)}
""".strip()


def axis_status_body() -> str:
    """生成 AxisStatusFeedback_PRG 的完整 ST 代码。"""
    blocks = "\n\n".join(axis_status_block(meta) for meta in AXES)
    return f"""
// 本程序只做反馈和诊断，不直接控制轴运动。
// [32] 五轴总使能命令。
// [33..37] 五轴状态字。
// [38..47] 五轴驱动 AxisErrorID，来自 MC_ReadAxisError.AxisErrorID。
// [48] 五轴 AxisEnable 请求反馈。
// [49..58] 五轴 MC_ReadStatus.ErrorID。
// [59..68] 五轴 MC_ReadAxisError.ErrorID。
// [69..78] 五轴 MC_Power.ErrorID，由各单轴程序写入。
// [79..83] 五轴 MC_Power 诊断字，bit0=Status，bit1=Error。
// [84] 诊断版本号，26082 表示 v26082 诊断版已生效。
// [85] 使能请求 TRUE 但 MC_ReadStatus 仍 Disabled 的位图。
// [86] MC_ReadStatus.Error 位图。
// [87] MC_ReadAxisError.Error 位图。
// [88] MC_ReadStatus.FBErrorOccured 位图。

{blocks}

// 诊断版本号，Python 可用它判断 [49..88] 是否已由新版 PLC 代码写入。
arReg_data[84] := {DIAG_VERSION};

// 使能请求不一致：AxisEnable 请求为 TRUE，但 MC_ReadStatus 仍显示 Disabled。
wEnableMismatchFeedback := WORD#0;
IF GVL.Axes[1].AxisEnable AND fbStatusX.Disabled THEN wEnableMismatchFeedback := wEnableMismatchFeedback OR WORD#16#0001; END_IF;
IF GVL.Axes[2].AxisEnable AND fbStatusY.Disabled THEN wEnableMismatchFeedback := wEnableMismatchFeedback OR WORD#16#0002; END_IF;
IF GVL.Axes[3].AxisEnable AND fbStatusZ.Disabled THEN wEnableMismatchFeedback := wEnableMismatchFeedback OR WORD#16#0004; END_IF;
IF GVL.Axes[4].AxisEnable AND fbStatusB.Disabled THEN wEnableMismatchFeedback := wEnableMismatchFeedback OR WORD#16#0008; END_IF;
IF GVL.Axes[5].AxisEnable AND fbStatusC.Disabled THEN wEnableMismatchFeedback := wEnableMismatchFeedback OR WORD#16#0010; END_IF;
arReg_data[85] := WORD_TO_INT(wEnableMismatchFeedback);

// 汇总 MC_ReadStatus 功能块错误位，便于 Python 在详细诊断模式判断是哪一个轴读状态失败。
wStatusErrorFeedback := WORD#0;
IF bStatusErrorX THEN wStatusErrorFeedback := wStatusErrorFeedback OR WORD#16#0001; END_IF;
IF bStatusErrorY THEN wStatusErrorFeedback := wStatusErrorFeedback OR WORD#16#0002; END_IF;
IF bStatusErrorZ THEN wStatusErrorFeedback := wStatusErrorFeedback OR WORD#16#0004; END_IF;
IF bStatusErrorB THEN wStatusErrorFeedback := wStatusErrorFeedback OR WORD#16#0008; END_IF;
IF bStatusErrorC THEN wStatusErrorFeedback := wStatusErrorFeedback OR WORD#16#0010; END_IF;
arReg_data[86] := WORD_TO_INT(wStatusErrorFeedback);

wAxisReadErrorFeedback := WORD#0;
IF bAxisReadErrorX THEN wAxisReadErrorFeedback := wAxisReadErrorFeedback OR WORD#16#0001; END_IF;
IF bAxisReadErrorY THEN wAxisReadErrorFeedback := wAxisReadErrorFeedback OR WORD#16#0002; END_IF;
IF bAxisReadErrorZ THEN wAxisReadErrorFeedback := wAxisReadErrorFeedback OR WORD#16#0004; END_IF;
IF bAxisReadErrorB THEN wAxisReadErrorFeedback := wAxisReadErrorFeedback OR WORD#16#0008; END_IF;
IF bAxisReadErrorC THEN wAxisReadErrorFeedback := wAxisReadErrorFeedback OR WORD#16#0010; END_IF;
arReg_data[87] := WORD_TO_INT(wAxisReadErrorFeedback);

wStatusFBErrorFeedback := WORD#0;
IF bStatusFBErrorX THEN wStatusFBErrorFeedback := wStatusFBErrorFeedback OR WORD#16#0001; END_IF;
IF bStatusFBErrorY THEN wStatusFBErrorFeedback := wStatusFBErrorFeedback OR WORD#16#0002; END_IF;
IF bStatusFBErrorZ THEN wStatusFBErrorFeedback := wStatusFBErrorFeedback OR WORD#16#0004; END_IF;
IF bStatusFBErrorB THEN wStatusFBErrorFeedback := wStatusFBErrorFeedback OR WORD#16#0008; END_IF;
IF bStatusFBErrorC THEN wStatusFBErrorFeedback := wStatusFBErrorFeedback OR WORD#16#0010; END_IF;
arReg_data[88] := WORD_TO_INT(wStatusFBErrorFeedback);
""".strip()


def update_axis_status_pou(root: ET.Element) -> None:
    """给 AxisStatusFeedback_PRG 增加读取状态和读取轴错误的 ErrorID 输出。"""
    pou = find_pou(root, "AxisStatusFeedback_PRG")
    for axis, *_rest in AXES:
        append_local_variable(pou, make_variable(f"eStatusError{axis}", derived_type="SMC_ERROR"))
        append_local_variable(pou, make_variable(f"eAxisReadError{axis}", derived_type="SMC_ERROR"))
        append_local_variable(pou, make_variable(f"bAxisReadError{axis}", type_tag="BOOL"))
    for name in (
        "wEnableMismatchFeedback",
        "wStatusErrorFeedback",
        "wAxisReadErrorFeedback",
        "wStatusFBErrorFeedback",
    ):
        append_local_variable(pou, make_variable(name, type_tag="WORD"))
    find_st_body(pou).text = "\n" + axis_status_body() + "\n"


def update_axis_power_pou(root: ET.Element, pou_name: str, axis_index: int, err_low: int, err_high: int, diag_reg: int) -> None:
    """让单轴 MC_Power 输出 ErrorID，并写入连续诊断寄存器。"""
    pou = find_pou(root, pou_name)
    append_local_variable(pou, make_variable("bPowerErrorDiag", type_tag="BOOL"))
    append_local_variable(pou, make_variable("ePowerErrorDiag", derived_type="SMC_ERROR"))
    append_local_variable(pou, make_variable("wPowerDiag", type_tag="WORD"))

    body_node = find_st_body(pou)
    text = body_node.text or ""
    old = """    Error              => ,
    ErrorID            =>
);"""
    new = """    Error              => bPowerErrorDiag,
    ErrorID            => ePowerErrorDiag
);"""
    if old not in text:
        raise RuntimeError(f"MC_Power output pattern not found in {pou_name}")
    text = text.replace(old, new, 1)

    marker = "// 目标位置、速度赋值（来自全局变量）"
    diagnostic = f"""
// arReg_data[{err_low}..{err_high}] 保存本轴 MC_Power.ErrorID。
// 拔网线、驱动掉线、电机线导致的上使能故障，常先从这里体现。
{dword_to_regs_st("ePowerErrorDiag", err_low, err_high)}

// arReg_data[{diag_reg}] 保存本轴 MC_Power 诊断字：bit0=Status，bit1=Error。
wPowerDiag := WORD#0;
IF 轴使能状态 THEN wPowerDiag := wPowerDiag OR WORD#16#0001; END_IF;
IF bPowerErrorDiag THEN wPowerDiag := wPowerDiag OR WORD#16#0002; END_IF;
arReg_data[{diag_reg}] := WORD_TO_INT(wPowerDiag);

{marker}"""
    if marker not in text:
        raise RuntimeError(f"target-position marker not found in {pou_name}")
    text = text.replace(marker, diagnostic, 1)
    body_node.text = text


def update_jog_pou(root: ET.Element, pou_name: str, axis_index: int, fb_name: str) -> None:
    """让点动程序的 MC_Power 请求跟随五轴总使能。"""
    body_node = find_st_body(find_pou(root, pou_name))
    text = body_node.text or ""
    marker = f"  {fb_name}("
    if "xServoEnable := GVL.Axes[" not in text:
        insert = (
            f"  // 点动侧使能跟随 arReg_data[32] 解析后的 GVL.Axes[{axis_index}].AxisEnable。\n"
            f"  // 五轴总关闭时，点动功能块不会继续用本地 TRUE 保持上使能。\n"
            f"  xServoEnable := GVL.Axes[{axis_index}].AxisEnable;\n\n"
            f"{marker}"
        )
        if marker not in text:
            raise RuntimeError(f"{marker} not found in {pou_name}")
        text = text.replace(marker, insert, 1)
    body_node.text = text


def reorder_main_task(root: ET.Element) -> None:
    """调整任务顺序，使能先执行，状态反馈最后读取本扫描周期结果。"""
    task = root.find(".//plc:task[@name='MainTask']", NS)
    if task is None:
        raise RuntimeError("MainTask not found")

    pou_instances = [item for item in list(task) if item.tag == plc("pouInstance")]
    other_nodes = [item for item in list(task) if item.tag != plc("pouInstance")]
    by_name = {item.get("name"): item for item in pou_instances}
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

    for item in list(task):
        task.remove(item)
    for name in ordered_names:
        if name in by_name:
            task.append(by_name[name])
    for item in pou_instances:
        if item not in list(task):
            task.append(item)
    for item in other_nodes:
        task.append(item)


def write_report() -> None:
    """写出本次诊断版寄存器说明。"""
    REPORT_PATH.write_text(
        f"""# FiveDofPlatform v26082 错误诊断版导入说明

生成时间：{datetime.now().isoformat(timespec="seconds")}

## 为什么原错误寄存器会为空

原 `arReg_data[38..47]` 只保存 `MC_ReadAxisError.AxisErrorID`。拔伺服网线时，通信先断，`MC_ReadAxisError` 功能块自己会报 `Error/ErrorID`，但 `AxisError` 可能是 FALSE；原逻辑在 `AxisError=FALSE` 时把 `AxisErrorID` 清零，所以监控窗口看到空值。

拔电机线时，错误也可能先出现在 `MC_Power.ErrorID` 或 `MC_ReadStatus.ErrorID`，不一定会进入 `AxisErrorID`。

## 新增连续寄存器

- `arReg_data[33..37]`：五轴主状态字。v26082 起只保存轴状态和轴本体错误，不再把 `MC_ReadStatus.Error` / `FBErrorOccured` 混入 bit11/bit12。
- `arReg_data[49..58]`：五轴 `MC_ReadStatus.ErrorID`。
- `arReg_data[59..68]`：五轴 `MC_ReadAxisError.ErrorID`。
- `arReg_data[69..78]`：五轴 `MC_Power.ErrorID`。
- `arReg_data[79..83]`：五轴 `MC_Power` 诊断字，bit0=Status，bit1=Error。
- `arReg_data[84]`：诊断版本号，固定写 `{DIAG_VERSION}`。
- `arReg_data[85]`：使能请求 TRUE 但状态仍 Disabled 的轴位图。
- `arReg_data[86]`：`MC_ReadStatus.Error` 轴位图。
- `arReg_data[87]`：`MC_ReadAxisError.Error` 轴位图。
- `arReg_data[88]`：`MC_ReadStatus.FBErrorOccured` 轴位图。

## 工程处理

本文件用于导入工程副本并重新编译，不执行 PLC 下载。
""",
        encoding="utf-8",
    )


def write_codesys_xml(tree: ET.ElementTree, path: Path) -> None:
    """按 CODESYS 可导入的 XHTML 命名空间格式写 XML。"""
    raw_path = path.with_suffix(path.suffix + ".tmp")
    tree.write(raw_path, encoding="utf-8", xml_declaration=True)
    text = raw_path.read_text(encoding="utf-8")
    text = text.replace(f' xmlns:xhtml="{XHTML_NS}"', "")
    text = text.replace("<xhtml:xhtml />", f'<xhtml xmlns="{XHTML_NS}" />')
    text = text.replace("<xhtml:xhtml>", f'<xhtml xmlns="{XHTML_NS}">')
    text = text.replace("</xhtml:xhtml>", "</xhtml>")
    path.write_text(text, encoding="utf-8")
    raw_path.unlink()


def build_task_instance(name: str) -> ET.Element:
    """创建 MainTask 中的 POU 调用节点。"""
    instance = ET.Element(plc("pouInstance"), {"name": name, "typeName": ""})
    documentation = child(instance, "documentation")
    ET.SubElement(documentation, xhtml("xhtml"))
    return instance


def build_minimal_project(source_root: ET.Element) -> ET.Element:
    """只打包被修改的对象，避免整工程 XML 重新序列化导致 CODESYS 拒绝导入。"""
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
        name="FiveDofPlatform_v26082.import.xml",
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
        "AxisStatusFeedback_PRG",
        "AXIS_X_PRG",
        "Axis_Y_PRG",
        "AXIS_Z_PRG",
        "AXIS_B_PRG",
        "AXIS_C_PRG",
        "JogX",
        "JogY",
        "JogZ",
        "JogB",
        "JogC",
    ):
        pous.append(copy.deepcopy(find_pou(source_root, pou_name)))

    instances = child(project, "instances")
    configurations = child(instances, "configurations")
    configuration = child(configurations, "configuration", name="Device")
    resource = child(configuration, "resource", name="Application")
    task = child(resource, "task", name="MainTask", interval="PT0.005S", priority="1")
    for name in (
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
    ):
        task.append(build_task_instance(name))
    add_data = child(task, "addData")
    data = child(
        add_data,
        "data",
        name="http://www.3s-software.com/plcopenxml/tasksettings",
        handleUnknown="implementation",
    )
    ET.SubElement(
        data,
        "TaskSettings",
        {
            "KindOfTask": "Cyclic",
            "Interval": "5",
            "IntervalUnit": "ms",
            "WithinSPSTimeSlicing": "true",
        },
    )
    return project


def main() -> None:
    """生成完整 CODESYS 导入 XML 和说明。"""
    tree = ET.parse(SOURCE_EXPORT)
    root = tree.getroot()

    update_axis_status_pou(root)
    update_axis_power_pou(root, "AXIS_X_PRG", 1, 69, 70, 79)
    update_axis_power_pou(root, "Axis_Y_PRG", 2, 71, 72, 80)
    update_axis_power_pou(root, "AXIS_Z_PRG", 3, 73, 74, 81)
    update_axis_power_pou(root, "AXIS_B_PRG", 4, 75, 76, 82)
    update_axis_power_pou(root, "AXIS_C_PRG", 5, 77, 78, 83)
    update_jog_pou(root, "JogX", 1, "fbJogX")
    update_jog_pou(root, "JogY", 2, "fbJogY")
    update_jog_pou(root, "JogZ", 3, "fbJogZ")
    update_jog_pou(root, "JogB", 4, "fbJogB")
    update_jog_pou(root, "JogC", 5, "fbJogC")
    reorder_main_task(root)

    IMPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    minimal_project = build_minimal_project(root)
    write_codesys_xml(ET.ElementTree(minimal_project), IMPORT_PATH)
    write_report()
    print(str(IMPORT_PATH))
    print(str(REPORT_PATH))


if __name__ == "__main__":
    main()
