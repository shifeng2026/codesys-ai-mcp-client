from __future__ import annotations

import copy
from datetime import datetime
from pathlib import Path
import xml.etree.ElementTree as ET
from xml.sax.saxutils import escape


PLC_NS = "http://www.plcopen.org/xml/tc6_0200"
XHTML_NS = "http://www.w3.org/1999/xhtml"
NS = {"plc": PLC_NS, "xhtml": XHTML_NS}


ET.register_namespace("", PLC_NS)
ET.register_namespace("xhtml", XHTML_NS)


ROOT = Path(r"C:\Users\29925\codesys-codex-mcp")
SOURCE_EXPORT = Path(r"C:\path\export\Machine.xml")
IMPORT_PATH = ROOT / "imports" / "AxisEnableControl.enable_control.import.xml"
POU_ONLY_IMPORT_PATH = ROOT / "imports" / "AxisEnableControl.pou_only.import.xml"
FULLTASK_IMPORT_PATH = ROOT / "imports" / "AxisEnableControl.fulltask.import.xml"
REGISTER_MAP_PATH = ROOT / "imports" / "AxisEnableControl.register_map.md"
CONFLICT_PATH = ROOT / "imports" / "AxisEnableControl.conflicts.md"


def plc(tag: str) -> str:
    return f"{{{PLC_NS}}}{tag}"


def xhtml(tag: str) -> str:
    return f"{{{XHTML_NS}}}{tag}"


def child(parent: ET.Element, tag: str, **attrs: str) -> ET.Element:
    item = ET.SubElement(parent, plc(tag), attrs)
    return item


def add_type(parent: ET.Element, type_name: str) -> None:
    typ = child(parent, "type")
    child(typ, type_name)


def add_derived_type(parent: ET.Element, type_name: str) -> None:
    typ = child(parent, "type")
    child(typ, "derived", name=type_name)


def add_var(parent: ET.Element, name: str, type_name: str) -> None:
    variable = child(parent, "variable", name=name)
    add_type(variable, type_name)


def set_st_body(pou: ET.Element, text: str) -> None:
    body = pou.find("plc:body/plc:ST/xhtml:xhtml", NS)
    if body is None:
        raise RuntimeError(f"ST body not found for POU {pou.get('name')}")
    body.text = "\n" + text.strip() + "\n"


def find_pou(root: ET.Element, name: str) -> ET.Element:
    for pou in root.findall(".//plc:pou", NS):
        if pou.get("name") == name:
            return pou
    raise RuntimeError(f"POU not found: {name}")


def build_axis_enable_control_pou() -> ET.Element:
    pou = ET.Element(plc("pou"), {"name": "AxisEnableControl_PRG", "pouType": "program"})
    interface = child(pou, "interface")
    local_vars = child(interface, "localVars")
    add_var(local_vars, "i", "INT")
    add_var(local_vars, "xEnableAll", "BOOL")
    add_var(local_vars, "wEnableFeedback", "WORD")
    body = child(pou, "body")
    st = child(body, "ST")
    xhtml_body = ET.SubElement(st, xhtml("xhtml"))
    xhtml_body.text = """
// arReg_data[32] 是五轴总使能命令寄存器。
// 0 = 五轴同时关闭使能；非 0 = 五轴同时打开使能。
xEnableAll := arReg_data[32] <> 0;

// 单轴程序中的 MC_Power 已经使用 GVL.Axes[n].AxisEnable。
// 这里统一写五个轴的 AxisEnable，避免每个单轴程序各自解析 Modbus 命令。
FOR i := 1 TO GVL.AXIS_COUNT DO
    GVL.Axes[i].AxisEnable := xEnableAll;
END_FOR

// arReg_data[48] 是五轴使能请求反馈寄存器。
// bit0..bit4 分别反馈 X/Y/Z/B/C 的 AxisEnable 请求，bit15 表示五轴请求全部为 TRUE。
wEnableFeedback := WORD#0;
IF GVL.Axes[1].AxisEnable THEN wEnableFeedback := wEnableFeedback OR WORD#16#0001; END_IF;
IF GVL.Axes[2].AxisEnable THEN wEnableFeedback := wEnableFeedback OR WORD#16#0002; END_IF;
IF GVL.Axes[3].AxisEnable THEN wEnableFeedback := wEnableFeedback OR WORD#16#0004; END_IF;
IF GVL.Axes[4].AxisEnable THEN wEnableFeedback := wEnableFeedback OR WORD#16#0008; END_IF;
IF GVL.Axes[5].AxisEnable THEN wEnableFeedback := wEnableFeedback OR WORD#16#0010; END_IF;

IF GVL.Axes[1].AxisEnable
   AND GVL.Axes[2].AxisEnable
   AND GVL.Axes[3].AxisEnable
   AND GVL.Axes[4].AxisEnable
   AND GVL.Axes[5].AxisEnable THEN
    wEnableFeedback := wEnableFeedback OR WORD#16#8000;
END_IF;

arReg_data[48] := WORD_TO_INT(wEnableFeedback);
""".strip()
    child(pou, "addData")
    return pou


def axis_enable_body() -> str:
    return """
// arReg_data[32] 是五轴总使能命令寄存器。
// 0 = 五轴同时关闭使能；非 0 = 五轴同时打开使能。
xEnableAll := arReg_data[32] <> 0;

// 单轴程序中的 MC_Power 已经使用 GVL.Axes[n].AxisEnable。
// 这里统一写五个轴的 AxisEnable，避免每个单轴程序各自解析 Modbus 命令。
FOR i := 1 TO GVL.AXIS_COUNT DO
    GVL.Axes[i].AxisEnable := xEnableAll;
END_FOR

// arReg_data[48] 是五轴使能请求反馈寄存器。
// bit0..bit4 分别反馈 X/Y/Z/B/C 的 AxisEnable 请求，bit15 表示五轴请求全部为 TRUE。
wEnableFeedback := WORD#0;
IF GVL.Axes[1].AxisEnable THEN wEnableFeedback := wEnableFeedback OR WORD#16#0001; END_IF;
IF GVL.Axes[2].AxisEnable THEN wEnableFeedback := wEnableFeedback OR WORD#16#0002; END_IF;
IF GVL.Axes[3].AxisEnable THEN wEnableFeedback := wEnableFeedback OR WORD#16#0004; END_IF;
IF GVL.Axes[4].AxisEnable THEN wEnableFeedback := wEnableFeedback OR WORD#16#0008; END_IF;
IF GVL.Axes[5].AxisEnable THEN wEnableFeedback := wEnableFeedback OR WORD#16#0010; END_IF;

IF GVL.Axes[1].AxisEnable
   AND GVL.Axes[2].AxisEnable
   AND GVL.Axes[3].AxisEnable
   AND GVL.Axes[4].AxisEnable
   AND GVL.Axes[5].AxisEnable THEN
    wEnableFeedback := wEnableFeedback OR WORD#16#8000;
END_IF;

arReg_data[48] := WORD_TO_INT(wEnableFeedback);
""".strip()


def axis_enable_pou_xml() -> str:
    body = escape(axis_enable_body())
    return f"""      <pou name="AxisEnableControl_PRG" pouType="program">
        <interface>
          <localVars>
            <variable name="i">
              <type>
                <INT />
              </type>
            </variable>
            <variable name="xEnableAll">
              <type>
                <BOOL />
              </type>
            </variable>
            <variable name="wEnableFeedback">
              <type>
                <WORD />
              </type>
            </variable>
          </localVars>
        </interface>
        <body>
          <ST>
            <xhtml xmlns="{XHTML_NS}">{body}</xhtml>
          </ST>
        </body>
        <addData />
      </pou>
"""


def axis_status_body() -> str:
    return """
// 本程序只做轴状态与轴错误号反馈，不直接控制轴运动。
// 连续寄存器块从 arReg_data[32] 开始：
// [32] 五轴总使能命令，[33..37] 五轴状态，[38..47] 五轴错误 ID，[48] 五轴使能请求反馈。

fbStatusX(
    Axis := AXIS_X,
    Enable := TRUE,
    Valid => ,
    Busy => ,
    Error => bStatusErrorX,
    ErrorID => ,
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

fbStatusY(
    Axis := AXIS_Y,
    Enable := TRUE,
    Valid => ,
    Busy => ,
    Error => bStatusErrorY,
    ErrorID => ,
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

fbStatusZ(
    Axis := AXIS_Z,
    Enable := TRUE,
    Valid => ,
    Busy => ,
    Error => bStatusErrorZ,
    ErrorID => ,
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

fbStatusB(
    Axis := AXIS_B,
    Enable := TRUE,
    Valid => ,
    Busy => ,
    Error => bStatusErrorB,
    ErrorID => ,
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

fbStatusC(
    Axis := AXIS_C,
    Enable := TRUE,
    Valid => ,
    Busy => ,
    Error => bStatusErrorC,
    ErrorID => ,
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
""".strip()


def build_task_with_axis_enable_call() -> ET.Element:
    instances = ET.Element(plc("instances"))
    configurations = child(instances, "configurations")
    configuration = child(configurations, "configuration", name="Device")
    resource = child(configuration, "resource", name="Application")
    task = child(resource, "task", name="MainTask", interval="PT0.005S", priority="1")
    for name in (
        "FiveDOF_Platform_PRG",
        "LogConsumer",
        "PLC_PRG",
        "AxisStatusFeedback_PRG",
        "AxisEnableControl_PRG",
        "ModbusTcpSlave",
    ):
        instance = child(task, "pouInstance", name=name, typeName="")
        documentation = child(instance, "documentation")
        ET.SubElement(documentation, xhtml("xhtml"))
    add_data = child(task, "addData")
    data = child(add_data, "data", name="http://www.3s-software.com/plcopenxml/tasksettings", handleUnknown="implementation")
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
    return instances


def build_empty_instances() -> ET.Element:
    instances = ET.Element(plc("instances"))
    child(instances, "configurations")
    return instances


def build_pou_instance(name: str) -> ET.Element:
    instance = ET.Element(plc("pouInstance"), {"name": name, "typeName": ""})
    documentation = child(instance, "documentation")
    ET.SubElement(documentation, xhtml("xhtml"))
    return instance


def add_axis_enable_call_to_fulltask(root: ET.Element) -> None:
    tasks = [task for task in root.findall(".//plc:task", NS) if task.get("name") == "MainTask"]
    if not tasks:
        raise RuntimeError("MainTask not found in full export")
    task = tasks[0]
    for instance in task.findall("plc:pouInstance", NS):
        if instance.get("name") == "AxisEnableControl_PRG":
            return

    children = list(task)
    insert_at = len(children)
    for index, item in enumerate(children):
        if item.tag == plc("pouInstance") and item.get("name") == "ModbusTcpSlave":
            insert_at = index
            break
    task.insert(insert_at, build_pou_instance("AxisEnableControl_PRG"))


def write_fulltask_import(status_text: str) -> None:
    text = SOURCE_EXPORT.read_text(encoding="utf-8")

    if 'pou name="AxisEnableControl_PRG"' not in text:
        text = text.replace("    <pous>\n", "    <pous>\n" + axis_enable_pou_xml(), 1)

    status_start = text.find('<pou name="AxisStatusFeedback_PRG"')
    if status_start < 0:
        raise RuntimeError("AxisStatusFeedback_PRG not found in full export text")
    xhtml_open = f'<xhtml xmlns="{XHTML_NS}">'
    body_start = text.find(xhtml_open, status_start)
    if body_start < 0:
        raise RuntimeError("AxisStatusFeedback_PRG XHTML body not found in full export text")
    content_start = body_start + len(xhtml_open)
    body_end = text.find("</xhtml>", content_start)
    if body_end < 0:
        raise RuntimeError("AxisStatusFeedback_PRG XHTML body end not found")
    text = text[:content_start] + "\n" + escape(status_text) + "\n" + text[body_end:]

    old_block = """FOR i := 1 TO AXIS_COUNT BY 1 DO
    Axes[i].AxisEnable := TRUE; 
END_FOR
arAi_data[9]:=bfiveDOF_state;"""
    new_block = """// 五轴使能由 AxisEnableControl_PRG 根据 arReg_data[32] 统一控制。
// 这里不再每周期强制 TRUE，避免覆盖寄存器关闭使能命令。
arAi_data[9]:=bfiveDOF_state;"""
    if old_block not in text:
        raise RuntimeError("Expected forced AxisEnable block was not found in full export text")
    text = text.replace(old_block, new_block, 1)

    task_call = """            <pouInstance name="AxisEnableControl_PRG" typeName="">
              <documentation>
                <xhtml xmlns="http://www.w3.org/1999/xhtml" />
              </documentation>
            </pouInstance>
"""
    modbus_call = '            <pouInstance name="ModbusTcpSlave" typeName="">'
    if 'pouInstance name="AxisEnableControl_PRG"' not in text:
        text = text.replace(modbus_call, task_call + modbus_call, 1)

    FULLTASK_IMPORT_PATH.write_text(text, encoding="utf-8")


def write_codesys_xml(tree: ET.ElementTree, path: Path) -> None:
    # CODESYS exports ST bodies as local XHTML namespace elements instead of prefixed
    # xhtml:xhtml nodes. Keeping that style avoids ScriptEngine import rejections.
    raw_path = path.with_suffix(path.suffix + ".tmp")
    tree.write(raw_path, encoding="utf-8", xml_declaration=True)
    text = raw_path.read_text(encoding="utf-8")
    text = text.replace(f' xmlns:xhtml="{XHTML_NS}"', "")
    text = text.replace("<xhtml:xhtml />", f'<xhtml xmlns="{XHTML_NS}" />')
    text = text.replace("<xhtml:xhtml>", f'<xhtml xmlns="{XHTML_NS}">')
    text = text.replace("</xhtml:xhtml>", "</xhtml>")
    path.write_text(text, encoding="utf-8")
    raw_path.unlink()


def write_register_map() -> None:
    REGISTER_MAP_PATH.write_text(
        """# Axis enable and feedback register map

Contiguous holding-register block: `arReg_data[32]` through `arReg_data[48]`.

| Register | Direction | Meaning |
|---:|---|---|
| `arReg_data[32]` | Modbus command input | Five-axis enable command. `0` = disable all axes, non-zero = enable all axes. |
| `arReg_data[33]` | PLC feedback output | X axis packed status word. |
| `arReg_data[34]` | PLC feedback output | Y axis packed status word. |
| `arReg_data[35]` | PLC feedback output | Z axis packed status word. |
| `arReg_data[36]` | PLC feedback output | B axis packed status word. |
| `arReg_data[37]` | PLC feedback output | C axis packed status word. |
| `arReg_data[38]` | PLC feedback output | X axis error ID low word. |
| `arReg_data[39]` | PLC feedback output | X axis error ID high word. |
| `arReg_data[40]` | PLC feedback output | Y axis error ID low word. |
| `arReg_data[41]` | PLC feedback output | Y axis error ID high word. |
| `arReg_data[42]` | PLC feedback output | Z axis error ID low word. |
| `arReg_data[43]` | PLC feedback output | Z axis error ID high word. |
| `arReg_data[44]` | PLC feedback output | B axis error ID low word. |
| `arReg_data[45]` | PLC feedback output | B axis error ID high word. |
| `arReg_data[46]` | PLC feedback output | C axis error ID low word. |
| `arReg_data[47]` | PLC feedback output | C axis error ID high word. |
| `arReg_data[48]` | PLC feedback output | AxisEnable request feedback. bit0..bit4 = X/Y/Z/B/C request, bit15 = all five requests TRUE. |

Status word bits for registers `[33]` through `[37]`:

| Bit | Hex | Meaning |
|---:|---:|---|
| 0 | `16#0001` | Disabled |
| 1 | `16#0002` | Errorstop |
| 2 | `16#0004` | Stopping |
| 3 | `16#0008` | StandStill |
| 4 | `16#0010` | DiscreteMotion |
| 5 | `16#0020` | ContinuousMotion |
| 6 | `16#0040` | SynchronizedMotion |
| 7 | `16#0080` | Homing |
| 8 | `16#0100` | ConstantVelocity |
| 9 | `16#0200` | Accelerating |
| 10 | `16#0400` | Decelerating |
| 11 | `16#0800` | MC_ReadStatus.Error |
| 12 | `16#1000` | MC_ReadStatus.FBErrorOccured |
| 13 | `16#2000` | Reserved |
| 14 | `16#4000` | MC_ReadAxisError.AxisError |
| 15 | `16#8000` | MC_ReadAxisError.SWEndSwitchActive |
""",
        encoding="utf-8",
    )


def write_conflicts() -> None:
    CONFLICT_PATH.write_text(
        """# Axis enable control conflict review

## Conflicts found

1. `FiveDOF_Platform_PRG` forced every axis enable request to TRUE every scan:
   `FOR i := 1 TO AXIS_COUNT BY 1 DO Axes[i].AxisEnable := TRUE; END_FOR`

   This conflicts with a Modbus disable command because the next scan turns all axes back on.
   In the modified copy, this forced-write block is removed and ownership is moved to
   `AxisEnableControl_PRG`.

2. Existing `arReg_data[19]` is already used for jog mode bits X/Y/Z/B/C.
   The previous status map used `[16]`, `[17]`, `[18]`, `[20]`, `[21]`, leaving a gap at `[19]`.
   In the modified copy, the new contiguous block starts at `[32]` to avoid the existing jog area.

## No direct conflict found

- Single-axis programs already use `GVL.Axes[n].AxisEnable` as `MC_Power.bRegulatorOn`
  and `MC_Power.bDriveStart`, so no second `MC_Power` block was added.
- `arReg_data[100]` and above are used by log output and are not touched.
- CODESYS MCP tools used here only import/export/build. No PLC download, run, or stop action is used.

## Behavior change to confirm

- `arReg_data[32] = 0` now means all five axis enable requests are FALSE.
- `arReg_data[32] <> 0` now means all five axis enable requests are TRUE.
- Because the old forced TRUE block is removed, the PLC no longer enables axes by default unless
  the Modbus/HMI side writes a non-zero value to `arReg_data[32]`.
""",
        encoding="utf-8",
    )


def main() -> None:
    source_tree = ET.parse(SOURCE_EXPORT)
    source_root = source_tree.getroot()

    status_pou = copy.deepcopy(find_pou(source_root, "AxisStatusFeedback_PRG"))
    status_text = axis_status_body()
    set_st_body(status_pou, status_text)

    platform_pou = copy.deepcopy(find_pou(source_root, "FiveDOF_Platform_PRG"))
    platform_body = platform_pou.find("plc:body/plc:ST/xhtml:xhtml", NS)
    if platform_body is None or platform_body.text is None:
        raise RuntimeError("FiveDOF_Platform_PRG ST body not found")
    old_block = """FOR i := 1 TO AXIS_COUNT BY 1 DO
    Axes[i].AxisEnable := TRUE; 
END_FOR
arAi_data[9]:=bfiveDOF_state;"""
    new_block = """// 五轴使能由 AxisEnableControl_PRG 根据 arReg_data[32] 统一控制。
// 这里不再每周期强制 TRUE，避免覆盖寄存器关闭使能命令。
arAi_data[9]:=bfiveDOF_state;"""
    if old_block not in platform_body.text:
        raise RuntimeError("Expected forced AxisEnable block was not found")
    platform_body.text = platform_body.text.replace(old_block, new_block)

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
        name="AxisEnableControl.enable_control.import.xml",
        modificationDateTime=datetime.now().isoformat(timespec="seconds"),
    )
    coordinate_info = child(content_header, "coordinateInfo")
    for name in ("fbd", "ld", "sfc"):
        item = child(coordinate_info, name)
        child(item, "scaling", x="1", y="1")

    types = child(project, "types")
    child(types, "dataTypes")
    pous = child(types, "pous")
    pous.append(build_axis_enable_control_pou())
    pous.append(status_pou)
    pous.append(platform_pou)
    project.append(build_task_with_axis_enable_call())

    IMPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    write_codesys_xml(ET.ElementTree(project), IMPORT_PATH)

    pou_only_project = copy.deepcopy(project)
    instances = pou_only_project.find("plc:instances", NS)
    if instances is not None:
        pou_only_project.remove(instances)
    pou_only_project.append(build_empty_instances())
    write_codesys_xml(ET.ElementTree(pou_only_project), POU_ONLY_IMPORT_PATH)

    write_fulltask_import(status_text)
    write_register_map()
    write_conflicts()
    print(str(IMPORT_PATH))
    print(str(POU_ONLY_IMPORT_PATH))
    print(str(FULLTASK_IMPORT_PATH))
    print(str(REGISTER_MAP_PATH))
    print(str(CONFLICT_PATH))


if __name__ == "__main__":
    main()
