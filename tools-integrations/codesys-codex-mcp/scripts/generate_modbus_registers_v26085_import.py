from __future__ import annotations

import copy
from datetime import datetime
from pathlib import Path
import xml.etree.ElementTree as ET


# 生成 FiveDofPlatform v26086 的 CODESYS 导入 XML。
# 目标：所有 arReg_data/arAi_data 寄存器地址读写集中在 ModbusTcpSlave 程序内。
# 注意：本脚本只生成导入文件，不下载 PLC，不启动/停止 PLC。

PLC_NS = "http://www.plcopen.org/xml/tc6_0200"
XHTML_NS = "http://www.w3.org/1999/xhtml"
NS = {"plc": PLC_NS, "xhtml": XHTML_NS}

ROOT = Path(r"C:\Users\29925\codesys-codex-mcp")
SOURCE_EXPORT = Path(r"C:\path\export_v26082\Machine_v26082.xml")
IMPORT_PATH = ROOT / "imports" / "FiveDofPlatform_v26086.modbus_registers.import.xml"
REPORT_PATH = ROOT / "imports" / "FiveDofPlatform_v26086.modbus_registers.report.md"
REGISTER_MAP_PATH = ROOT / "imports" / "FiveDofPlatform_v26086.register_map.md"

VERSION = 26086

AXES = (
    # 轴名, 轴序号, Jog 程序名, Jog 功能块实例名, 位掩码, 清位掩码, 正向点动寄存器, 反向点动寄存器
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
    """按 POU 名称查找程序、功能块或函数。"""
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


def make_scalar_variable(name: str, type_tag: str) -> ET.Element:
    """创建标量变量声明。"""
    item = ET.Element(plc("variable"), {"name": name})
    typ = ET.SubElement(item, plc("type"))
    ET.SubElement(typ, plc(type_tag))
    return item


def make_array_variable(name: str, type_tag: str, lower: int = 1, upper: int = 5) -> ET.Element:
    """创建数组变量声明。"""
    item = ET.Element(plc("variable"), {"name": name})
    typ = ET.SubElement(item, plc("type"))
    array = ET.SubElement(typ, plc("array"))
    ET.SubElement(array, plc("dimension"), {"lower": str(lower), "upper": str(upper)})
    base_type = ET.SubElement(array, plc("baseType"))
    ET.SubElement(base_type, plc(type_tag))
    return item


def append_variable_once(container: ET.Element, item: ET.Element) -> None:
    """变量不存在时才追加，避免重复声明。"""
    name = item.get("name")
    if not any(old.get("name") == name for old in container.findall("plc:variable", NS)):
        children = list(container)
        insert_at = len(children)
        for index, child_item in enumerate(children):
            if child_item.tag == plc("addData"):
                insert_at = index
                break
        container.insert(insert_at, item)


def append_local_variable(pou: ET.Element, item: ET.Element) -> None:
    """给 POU 增加局部变量。"""
    local_vars = pou.find("plc:interface/plc:localVars", NS)
    if local_vars is None:
        raise RuntimeError(f"localVars not found for {pou.get('name')}")
    append_variable_once(local_vars, item)


def register_cache_vars() -> list[ET.Element]:
    """创建独立全局变量表使用的寄存器缓存变量。"""
    return [
        make_array_variable("xJogReset", "BOOL"),
        make_array_variable("wAxisStatusReg", "WORD"),
        make_array_variable("dwAxisErrorIDReg", "DWORD"),
        make_array_variable("dwReadStatusErrorIDReg", "DWORD"),
        make_array_variable("dwReadAxisErrorFBIDReg", "DWORD"),
        make_array_variable("dwPowerErrorIDReg", "DWORD"),
        make_array_variable("wPowerDiagReg", "WORD"),
        make_scalar_variable("wEnableFeedbackReg", "WORD"),
        make_scalar_variable("wEnableMismatchReg", "WORD"),
        make_scalar_variable("wReadStatusErrorBitsReg", "WORD"),
        make_scalar_variable("wReadAxisErrorBitsReg", "WORD"),
        make_scalar_variable("wReadStatusFBErrorBitsReg", "WORD"),
        make_scalar_variable("wJogResetCmdReg", "WORD"),
        make_scalar_variable("wJogModeReg", "WORD"),
        make_scalar_variable("wJogFwdReg", "WORD"),
        make_scalar_variable("wJogRevReg", "WORD"),
        make_scalar_variable("wJogReadyReg", "WORD"),
        make_scalar_variable("wJogMovingReg", "WORD"),
        make_scalar_variable("wJogFaultReg", "WORD"),
        make_scalar_variable("wJogErrorReg", "WORD"),
        make_scalar_variable("wJogAbortedReg", "WORD"),
    ]


def bit_update_st(word_name: str, expression: str, mask: str, clear_mask: str) -> str:
    """生成对 WORD 位图变量置位/清位的 ST 代码。"""
    return f"""IF {expression} THEN
    {word_name} := {word_name} OR WORD#16#{mask};
ELSE
    {word_name} := {word_name} AND WORD#16#{clear_mask};
END_IF;"""


def dword_to_regs_st(source: str, low_reg: int, high_reg: int) -> str:
    """生成 DWORD 拆成低/高 16 位寄存器的 ST 代码。"""
    return (
        f"arReg_data[{low_reg}] := WORD_TO_INT(DWORD_TO_WORD({source}));\n"
        f"arReg_data[{high_reg}] := WORD_TO_INT(DWORD_TO_WORD(SHR({source}, 16)));"
    )


def axis_status_block(axis: str, index: int) -> str:
    """生成一个轴的状态读取和全局缓存写入代码。"""
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

// 读取 {axis} 轴本体错误。这里不直接写 arReg_data，寄存器统一由 ModbusTcpSlave 输出。
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
    // 无轴本体错误时清零 AxisErrorID 缓存，避免保留上一次错误号。
    dwAxisError{axis} := DWORD#0;
END_IF;

// 把 {axis} 轴状态压缩成 WORD 缓存。实际 arReg_data[{32 + index}] 由 ModbusTcpSlave 写出。
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
wAxisStatusReg[{index}] := wStatus{axis};

// 错误号先放入全局缓存，ModbusTcpSlave 统一拆成低/高 16 位寄存器。
dwAxisErrorIDReg[{index}] := dwAxisError{axis};
dwReadStatusErrorIDReg[{index}] := TO_DWORD(eStatusError{axis});
dwReadAxisErrorFBIDReg[{index}] := TO_DWORD(eAxisReadError{axis});
""".strip()


def axis_status_body() -> str:
    """生成 AxisStatusFeedback_PRG 的完整 ST 代码。"""
    blocks = "\n\n".join(axis_status_block(axis, index) for axis, index, *_ in AXES)
    return f"""
// v26086：本程序只读取 SoftMotion 状态并写入全局缓存。
// 所有 arReg_data 寄存器地址统一在 ModbusTcpSlave 中写出，方便集中排查。

{blocks}

// 使能请求不一致：AxisEnable 请求 TRUE，但轴状态仍 Disabled。
wEnableMismatchFeedback := WORD#0;
IF GVL.Axes[1].AxisEnable AND fbStatusX.Disabled THEN wEnableMismatchFeedback := wEnableMismatchFeedback OR WORD#16#0001; END_IF;
IF GVL.Axes[2].AxisEnable AND fbStatusY.Disabled THEN wEnableMismatchFeedback := wEnableMismatchFeedback OR WORD#16#0002; END_IF;
IF GVL.Axes[3].AxisEnable AND fbStatusZ.Disabled THEN wEnableMismatchFeedback := wEnableMismatchFeedback OR WORD#16#0004; END_IF;
IF GVL.Axes[4].AxisEnable AND fbStatusB.Disabled THEN wEnableMismatchFeedback := wEnableMismatchFeedback OR WORD#16#0008; END_IF;
IF GVL.Axes[5].AxisEnable AND fbStatusC.Disabled THEN wEnableMismatchFeedback := wEnableMismatchFeedback OR WORD#16#0010; END_IF;
wEnableMismatchReg := wEnableMismatchFeedback;

// MC_ReadStatus.Error 汇总位，bit0..bit4=X/Y/Z/B/C。
wStatusErrorFeedback := WORD#0;
IF bStatusErrorX THEN wStatusErrorFeedback := wStatusErrorFeedback OR WORD#16#0001; END_IF;
IF bStatusErrorY THEN wStatusErrorFeedback := wStatusErrorFeedback OR WORD#16#0002; END_IF;
IF bStatusErrorZ THEN wStatusErrorFeedback := wStatusErrorFeedback OR WORD#16#0004; END_IF;
IF bStatusErrorB THEN wStatusErrorFeedback := wStatusErrorFeedback OR WORD#16#0008; END_IF;
IF bStatusErrorC THEN wStatusErrorFeedback := wStatusErrorFeedback OR WORD#16#0010; END_IF;
wReadStatusErrorBitsReg := wStatusErrorFeedback;

// MC_ReadAxisError.Error 汇总位，bit0..bit4=X/Y/Z/B/C。
wAxisReadErrorFeedback := WORD#0;
IF bAxisReadErrorX THEN wAxisReadErrorFeedback := wAxisReadErrorFeedback OR WORD#16#0001; END_IF;
IF bAxisReadErrorY THEN wAxisReadErrorFeedback := wAxisReadErrorFeedback OR WORD#16#0002; END_IF;
IF bAxisReadErrorZ THEN wAxisReadErrorFeedback := wAxisReadErrorFeedback OR WORD#16#0004; END_IF;
IF bAxisReadErrorB THEN wAxisReadErrorFeedback := wAxisReadErrorFeedback OR WORD#16#0008; END_IF;
IF bAxisReadErrorC THEN wAxisReadErrorFeedback := wAxisReadErrorFeedback OR WORD#16#0010; END_IF;
wReadAxisErrorBitsReg := wAxisReadErrorFeedback;

// MC_ReadStatus.FBErrorOccured 汇总位，bit0..bit4=X/Y/Z/B/C。
wStatusFBErrorFeedback := WORD#0;
IF bStatusFBErrorX THEN wStatusFBErrorFeedback := wStatusFBErrorFeedback OR WORD#16#0001; END_IF;
IF bStatusFBErrorY THEN wStatusFBErrorFeedback := wStatusFBErrorFeedback OR WORD#16#0002; END_IF;
IF bStatusFBErrorZ THEN wStatusFBErrorFeedback := wStatusFBErrorFeedback OR WORD#16#0004; END_IF;
IF bStatusFBErrorB THEN wStatusFBErrorFeedback := wStatusFBErrorFeedback OR WORD#16#0008; END_IF;
IF bStatusFBErrorC THEN wStatusFBErrorFeedback := wStatusFBErrorFeedback OR WORD#16#0010; END_IF;
wReadStatusFBErrorBitsReg := wStatusFBErrorFeedback;
""".strip()


def update_axis_status_pou(root: ET.Element) -> None:
    """把 AxisStatusFeedback_PRG 改为只写全局缓存。"""
    pou = find_pou(root, "AxisStatusFeedback_PRG")
    find_st_body(pou).text = "\n" + axis_status_body() + "\n"


def update_axis_enable_control_pou(root: ET.Element) -> None:
    """保留 AxisEnableControl_PRG 空程序，寄存器逻辑移到 ModbusTcpSlave。"""
    pou = find_pou(root, "AxisEnableControl_PRG")
    find_st_body(pou).text = """
// v26086：五轴使能寄存器 arReg_data[32] 已集中到 ModbusTcpSlave 解析。
// 本程序只保留任务调用占位，不再读写 arReg_data，避免同一个寄存器被多处写入。
""".rstrip()


def update_platform_pou(root: ET.Element) -> None:
    """把 FiveDOF_Platform_PRG 中的输入寄存器写入移到 ModbusTcpSlave。"""
    pou = find_pou(root, "FiveDOF_Platform_PRG")
    body_node = find_st_body(pou)
    text = body_node.text or ""
    old = "arAi_data[9]:=bfiveDOF_state;"
    new = (
        "// v26086：arAi_data[9] 五轴运行状态输入寄存器改由 ModbusTcpSlave 统一写出。\n"
        "// 本程序只维护内部状态变量 bfiveDOF_state。"
    )
    if old not in text:
        raise RuntimeError("FiveDOF_Platform_PRG arAi_data[9] assignment not found")
    body_node.text = text.replace(old, new, 1)


def update_axis_power_pou(root: ET.Element, pou_name: str, index: int) -> None:
    """把单轴 MC_Power 诊断从直接写寄存器改为写全局缓存。"""
    pou = find_pou(root, pou_name)
    body_node = find_st_body(pou)
    text = body_node.text or ""
    start = text.find("// arReg_data[")
    marker = "// 目标位置、速度赋值（来自全局变量）"
    end = text.find(marker, start)
    if start < 0 or end < 0:
        raise RuntimeError(f"power diagnostic register block not found in {pou_name}")
    replacement = f"""
// v26086：本轴 MC_Power 诊断先写入全局缓存，实际寄存器输出统一由 ModbusTcpSlave 完成。
dwPowerErrorIDReg[{index}] := TO_DWORD(ePowerErrorDiag);

// wPowerDiagReg[{index}] bit0=MC_Power.Status，bit1=MC_Power.Error。
wPowerDiag := WORD#0;
IF 轴使能状态 THEN wPowerDiag := wPowerDiag OR WORD#16#0001; END_IF;
IF bPowerErrorDiag THEN wPowerDiag := wPowerDiag OR WORD#16#0002; END_IF;
wPowerDiagReg[{index}] := wPowerDiag;

"""
    body_node.text = text[:start] + replacement + text[end:]


def jog_feedback_block(index: int, fb_name: str, mask: str, clear_mask: str) -> str:
    """生成 Jog 程序写全局反馈位图的 ST 代码。"""
    return f"""
  // v26086：Jog 程序只写全局反馈位图，寄存器 arReg_data[90..99] 统一由 ModbusTcpSlave 写出。
  {bit_update_st("wJogResetCmdReg", "xResetCmdReg", mask, clear_mask)}
  {bit_update_st("wJogModeReg", f"xJogMode[{index}]", mask, clear_mask)}
  {bit_update_st("wJogFwdReg", f"xJogFwd[{index}]", mask, clear_mask)}
  {bit_update_st("wJogRevReg", f"xJogRev[{index}]", mask, clear_mask)}
  {bit_update_st("wJogReadyReg", f"{fb_name}.xReady", mask, clear_mask)}
  {bit_update_st("wJogMovingReg", f"{fb_name}.xMoving", mask, clear_mask)}
  {bit_update_st("wJogFaultReg", f"{fb_name}.xFault", mask, clear_mask)}
  {bit_update_st("wJogErrorReg", f"{fb_name}.xJogError", mask, clear_mask)}
  {bit_update_st("wJogAbortedReg", f"{fb_name}.xJogAborted", mask, clear_mask)}
""".rstrip()


def update_jog_pou(root: ET.Element, axis: str, index: int, pou_name: str, fb_name: str, mask: str, clear_mask: str, _fwd_reg: int, _rev_reg: int) -> None:
    """修改 Jog 程序：复位命令来自 Modbus 缓存，反馈写全局缓存。"""
    pou = find_pou(root, pou_name)
    append_local_variable(pou, make_scalar_variable("xResetCmdReg", "BOOL"))
    body_node = find_st_body(pou)
    lines = (body_node.text or "").splitlines()
    # Jog 程序不直接读 arReg_data；点动寄存器由 ModbusTcpSlave 解析到全局 xJogMode/xJogFwd/xJogRev。
    lines = [line for line in lines if "arReg_data[" not in line]
    text = "\n".join(lines)
    if "xReset := FALSE," not in text:
        raise RuntimeError(f"xReset input pattern not found in {pou_name}")
    text = text.replace("xReset := FALSE,", "xReset := xResetCmdReg,", 1)

    marker = f"  xServoEnable := GVL.Axes[{index}].AxisEnable;"
    if marker not in text:
        raise RuntimeError(f"jog enable marker not found in {pou_name}")
    insert = f"""
  // v26086：复位命令由 ModbusTcpSlave 从 arReg_data[89] 解析到 xJogReset[{index}]。
  // FB_ServoJog 内部用 R_TRIG 把这个 BOOL 转成 MC_Reset 上升沿。
  xResetCmdReg := xJogReset[{index}];

{marker}"""
    text = text.replace(marker, insert, 1)

    call_start = text.find(f"  {fb_name}(")
    if call_start < 0:
        raise RuntimeError(f"{fb_name} call not found in {pou_name}")
    call_end = text.find("  );", call_start)
    if call_end < 0:
        raise RuntimeError(f"{fb_name} call end not found in {pou_name}")
    call_end += len("  );")
    text = text[:call_end] + "\n\n" + jog_feedback_block(index, fb_name, mask, clear_mask) + text[call_end:]
    body_node.text = "\n" + text.strip() + "\n"


def modbus_register_block() -> str:
    """生成 ModbusTcpSlave 中集中寄存器解析和反馈输出代码。"""
    return f"""
	// ============================================================
	// v26086 Modbus 寄存器集中处理区
	// 规则：所有 arReg_data/arAi_data 的地址读写都放在本程序，其他程序只写全局缓存变量。
	// ============================================================

	// arAi_data[1..5]：五轴当前位置反馈输入寄存器，X/Y/Z/B/C。
	// Python 按 0.1 单位读取；PLC 内部角度除以 aAngleFactor 后再乘 10。
	FOR i := 1 TO GVL.AXIS_COUNT DO
		arAi_data[i] := INT_TO_WORD(REAL_TO_INT(Axes[i].ActualAngle/aAngleFactor[i]*10.0));
	END_FOR

	// arAi_data[9]：五轴平台运行状态反馈，来自 FiveDOF_Platform_PRG 维护的 bfiveDOF_state。
	arAi_data[9]:=bfiveDOF_state;

	// arReg_data[0]：五轴绝对定位启动命令，非 0 时由 FiveDOF_Platform_PRG 触发运动。
	Move_5Axis_Sign:=arReg_data[0];

	// arReg_data[1..5]：五轴目标位置原始值，只有平台空闲时才更新目标，避免运动中目标被改写。
	IF 	bfiveDOF_state =0 THEN
		FOR i := 1 TO GVL.AXIS_COUNT DO
			dwAngle := WORD_TO_INT(arReg_data[i]);      // 有符号原始值
			PlatformTargetAngle[i] := dwAngle * aAngleFactor[i];
		END_FOR
	END_IF

	// arReg_data[32]：五轴总使能命令。0=关闭使能，非 0=打开使能。
	xEnableAllReg := arReg_data[32] <> 0;
	FOR i := 1 TO GVL.AXIS_COUNT DO
		GVL.Axes[i].AxisEnable := xEnableAllReg;
	END_FOR

	// arReg_data[48]：五轴使能请求反馈，bit0..bit4=X/Y/Z/B/C，bit15=五轴全部请求 TRUE。
	wEnableFeedbackReg := WORD#0;
	IF GVL.Axes[1].AxisEnable THEN wEnableFeedbackReg := wEnableFeedbackReg OR WORD#16#0001; END_IF;
	IF GVL.Axes[2].AxisEnable THEN wEnableFeedbackReg := wEnableFeedbackReg OR WORD#16#0002; END_IF;
	IF GVL.Axes[3].AxisEnable THEN wEnableFeedbackReg := wEnableFeedbackReg OR WORD#16#0004; END_IF;
	IF GVL.Axes[4].AxisEnable THEN wEnableFeedbackReg := wEnableFeedbackReg OR WORD#16#0008; END_IF;
	IF GVL.Axes[5].AxisEnable THEN wEnableFeedbackReg := wEnableFeedbackReg OR WORD#16#0010; END_IF;
	IF GVL.Axes[1].AxisEnable
	   AND GVL.Axes[2].AxisEnable
	   AND GVL.Axes[3].AxisEnable
	   AND GVL.Axes[4].AxisEnable
	   AND GVL.Axes[5].AxisEnable THEN
		wEnableFeedbackReg := wEnableFeedbackReg OR WORD#16#8000;
	END_IF;
	arReg_data[48] := WORD_TO_INT(wEnableFeedbackReg);

	// arReg_data[19]：点动总开关位图，bit0=X，bit1=Y，bit2=Z，bit3=B，bit4=C。
	xJogMode[1] := (arReg_data[19] AND WORD#16#0001) <> WORD#0; // X
	xJogMode[2] := (arReg_data[19] AND WORD#16#0002) <> WORD#0; // Y
	xJogMode[3] := (arReg_data[19] AND WORD#16#0004) <> WORD#0; // Z
	xJogMode[4] := (arReg_data[19] AND WORD#16#0008) <> WORD#0; // B
	xJogMode[5] := (arReg_data[19] AND WORD#16#0010) <> WORD#0; // C

	// arReg_data[6..15]：点动方向命令。方向必须同时满足 arReg_data[19] 对应轴点动总开关。
	xJogFwd[1] := xJogMode[1] AND (arReg_data[6] <> WORD#0);   // X 正向
	xJogRev[1] := xJogMode[1] AND (arReg_data[7] <> WORD#0);   // X 反向
	xJogFwd[2] := xJogMode[2] AND (arReg_data[8] <> WORD#0);   // Y 正向
	xJogRev[2] := xJogMode[2] AND (arReg_data[9] <> WORD#0);   // Y 反向
	xJogFwd[3] := xJogMode[3] AND (arReg_data[10] <> WORD#0);  // Z 正向
	xJogRev[3] := xJogMode[3] AND (arReg_data[11] <> WORD#0);  // Z 反向
	xJogFwd[4] := xJogMode[4] AND (arReg_data[12] <> WORD#0);  // B 正向
	xJogRev[4] := xJogMode[4] AND (arReg_data[13] <> WORD#0);  // B 反向
	xJogFwd[5] := xJogMode[5] AND (arReg_data[14] <> WORD#0);  // C 正向
	xJogRev[5] := xJogMode[5] AND (arReg_data[15] <> WORD#0);  // C 反向

	// arReg_data[89]：五轴复位命令位图，Python 写短脉冲，bit0..bit4=X/Y/Z/B/C。
	xJogReset[1] := (arReg_data[89] AND WORD#16#0001) <> WORD#0; // X 复位
	xJogReset[2] := (arReg_data[89] AND WORD#16#0002) <> WORD#0; // Y 复位
	xJogReset[3] := (arReg_data[89] AND WORD#16#0004) <> WORD#0; // Z 复位
	xJogReset[4] := (arReg_data[89] AND WORD#16#0008) <> WORD#0; // B 复位
	xJogReset[5] := (arReg_data[89] AND WORD#16#0010) <> WORD#0; // C 复位

	// arReg_data[33..37]：五轴状态字，来自 AxisStatusFeedback_PRG 写入的 wAxisStatusReg[1..5]。
	arReg_data[33] := WORD_TO_INT(wAxisStatusReg[1]); // X 状态字
	arReg_data[34] := WORD_TO_INT(wAxisStatusReg[2]); // Y 状态字
	arReg_data[35] := WORD_TO_INT(wAxisStatusReg[3]); // Z 状态字
	arReg_data[36] := WORD_TO_INT(wAxisStatusReg[4]); // B 状态字
	arReg_data[37] := WORD_TO_INT(wAxisStatusReg[5]); // C 状态字

	// arReg_data[38..47]：五轴 AxisErrorID，DWORD 拆成低 16 位和高 16 位。
	{dword_to_regs_st("dwAxisErrorIDReg[1]", 38, 39)}
	{dword_to_regs_st("dwAxisErrorIDReg[2]", 40, 41)}
	{dword_to_regs_st("dwAxisErrorIDReg[3]", 42, 43)}
	{dword_to_regs_st("dwAxisErrorIDReg[4]", 44, 45)}
	{dword_to_regs_st("dwAxisErrorIDReg[5]", 46, 47)}

	// arReg_data[49..58]：五轴 MC_ReadStatus.ErrorID，DWORD 拆成低 16 位和高 16 位。
	{dword_to_regs_st("dwReadStatusErrorIDReg[1]", 49, 50)}
	{dword_to_regs_st("dwReadStatusErrorIDReg[2]", 51, 52)}
	{dword_to_regs_st("dwReadStatusErrorIDReg[3]", 53, 54)}
	{dword_to_regs_st("dwReadStatusErrorIDReg[4]", 55, 56)}
	{dword_to_regs_st("dwReadStatusErrorIDReg[5]", 57, 58)}

	// arReg_data[59..68]：五轴 MC_ReadAxisError.ErrorID，DWORD 拆成低 16 位和高 16 位。
	{dword_to_regs_st("dwReadAxisErrorFBIDReg[1]", 59, 60)}
	{dword_to_regs_st("dwReadAxisErrorFBIDReg[2]", 61, 62)}
	{dword_to_regs_st("dwReadAxisErrorFBIDReg[3]", 63, 64)}
	{dword_to_regs_st("dwReadAxisErrorFBIDReg[4]", 65, 66)}
	{dword_to_regs_st("dwReadAxisErrorFBIDReg[5]", 67, 68)}

	// arReg_data[69..78]：五轴 MC_Power.ErrorID，DWORD 拆成低 16 位和高 16 位。
	{dword_to_regs_st("dwPowerErrorIDReg[1]", 69, 70)}
	{dword_to_regs_st("dwPowerErrorIDReg[2]", 71, 72)}
	{dword_to_regs_st("dwPowerErrorIDReg[3]", 73, 74)}
	{dword_to_regs_st("dwPowerErrorIDReg[4]", 75, 76)}
	{dword_to_regs_st("dwPowerErrorIDReg[5]", 77, 78)}

	// arReg_data[79..83]：五轴 MC_Power 诊断字，bit0=Status，bit1=Error。
	arReg_data[79] := WORD_TO_INT(wPowerDiagReg[1]); // X MC_Power 诊断
	arReg_data[80] := WORD_TO_INT(wPowerDiagReg[2]); // Y MC_Power 诊断
	arReg_data[81] := WORD_TO_INT(wPowerDiagReg[3]); // Z MC_Power 诊断
	arReg_data[82] := WORD_TO_INT(wPowerDiagReg[4]); // B MC_Power 诊断
	arReg_data[83] := WORD_TO_INT(wPowerDiagReg[5]); // C MC_Power 诊断

	// arReg_data[84..88]：轴状态诊断版本和汇总位图。
	arReg_data[84] := {VERSION};                              // 诊断版本号
	arReg_data[85] := WORD_TO_INT(wEnableMismatchReg);        // 使能请求不一致位图
	arReg_data[86] := WORD_TO_INT(wReadStatusErrorBitsReg);   // MC_ReadStatus.Error 位图
	arReg_data[87] := WORD_TO_INT(wReadAxisErrorBitsReg);     // MC_ReadAxisError.Error 位图
	arReg_data[88] := WORD_TO_INT(wReadStatusFBErrorBitsReg); // MC_ReadStatus.FBErrorOccured 位图

	// arReg_data[90..99]：点动/复位诊断反馈，全部由 Jog 程序写全局缓存，本程序统一输出到 Modbus。
	arReg_data[90] := WORD_TO_INT(wJogResetCmdReg); // 复位命令读到反馈
	arReg_data[91] := WORD_TO_INT(wJogModeReg);     // 点动总开关反馈
	arReg_data[92] := WORD_TO_INT(wJogFwdReg);      // 正向点动命令反馈
	arReg_data[93] := WORD_TO_INT(wJogRevReg);      // 反向点动命令反馈
	arReg_data[94] := WORD_TO_INT(wJogReadyReg);    // FB_ServoJog.xReady
	arReg_data[95] := WORD_TO_INT(wJogMovingReg);   // FB_ServoJog.xMoving
	arReg_data[96] := WORD_TO_INT(wJogFaultReg);    // FB_ServoJog.xFault
	arReg_data[97] := WORD_TO_INT(wJogErrorReg);    // FB_ServoJog.xJogError
	arReg_data[98] := WORD_TO_INT(wJogAbortedReg);  // FB_ServoJog.xJogAborted
	arReg_data[99] := {VERSION};                    // 点动/复位诊断版本号
""".rstrip()


def update_modbus_tcp_slave(root: ET.Element) -> None:
    """把全部寄存器解析和反馈输出集中到 ModbusTcpSlave。"""
    pou = find_pou(root, "ModbusTcpSlave")
    append_local_variable(pou, make_scalar_variable("xEnableAllReg", "BOOL"))
    body_node = find_st_body(pou)
    text = body_node.text or ""
    start_marker = "	// 循环读取电机位置"
    start = text.find(start_marker)
    if start < 0:
        start = text.find("// 循环读取电机位置")
        if start >= 0:
            start = text.rfind("\n", 0, start) + 1
    end_marker = text.find("modtcpslavectrl", start)
    end = text.rfind("\n", 0, end_marker) if end_marker >= 0 else -1
    if start < 0 or end < 0:
        raise RuntimeError("ModbusTcpSlave register block not found")
    body_node.text = text[:start] + modbus_register_block() + text[end:]


def build_minimal_project(source_root: ET.Element) -> ET.Element:
    """打包 GVL 和本次修改的 POU。"""
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
        name="FiveDofPlatform_v26086.modbus_registers.import.xml",
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
        "AxisEnableControl_PRG",
        "FiveDOF_Platform_PRG",
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
        "ModbusTcpSlave",
    ):
        pous.append(copy.deepcopy(find_pou(source_root, pou_name)))

    instances = child(project, "instances")
    configurations = child(instances, "configurations")
    configuration = child(configurations, "configuration", name="Device")
    resource = child(configuration, "resource", name="Application")
    cache_gvl = child(resource, "globalVars", name="FiveDOF_ModbusCache_GVL")
    for variable in register_cache_vars():
        cache_gvl.append(variable)
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
    """写出本次修改说明。"""
    REPORT_PATH.write_text(
        f"""# FiveDofPlatform v26086 Modbus 寄存器集中版

生成时间：{datetime.now().isoformat(timespec="seconds")}

## 修改原则

所有 `arReg_data[...]` 和 `arAi_data[...]` 地址读写集中在 `ModbusTcpSlave` 程序中。其他程序只做运动控制或状态采集，并把结果写入 `FiveDOF_ModbusCache_GVL` 中的全局缓存变量。

## 解决的问题

- 点动总开关 `[19]` 和方向 `[6..15]` 的解析集中到 `ModbusTcpSlave`，并保留中文注释。
- 复位命令 `[89]` 集中到 `ModbusTcpSlave`，Jog 程序只读取全局 `xJogReset[1..5]`。
- 轴状态、错误 ID、MC_Power 诊断、点动反馈都先写全局缓存，再由 `ModbusTcpSlave` 统一输出到 `[33..99]`。
- `AxisEnableControl_PRG` 改成占位程序，不再写寄存器，避免寄存器被多处写入。
- 新增独立全局变量表 `FiveDOF_ModbusCache_GVL`，避免导入时覆盖原 `GVL` 失败。

## 未做动作

- 未下载 PLC。
- 未启动/停止 PLC。
- 需要你后续确认安全后，在 CODESYS 里下载 v26086 工程到控制器才会现场生效。
""",
        encoding="utf-8",
    )


def write_register_map() -> None:
    """写出 v26086 完整寄存器说明。"""
    REGISTER_MAP_PATH.write_text(
        f"""# FiveDofPlatform v26086 寄存器地址与功能

## Modbus 集中原则

从 v26086 开始，所有 `arReg_data[...]` 和 `arAi_data[...]` 地址读写都集中在 `ModbusTcpSlave` 程序。其他程序不直接写寄存器，只写 `FiveDOF_ModbusCache_GVL` 中的全局缓存。

## 控制寄存器

| 地址 | 方向 | 功能 |
|---:|---|---|
| `arReg_data[0]` | Python/HMI -> PLC | 五轴绝对定位启动命令。 |
| `arReg_data[1..5]` | Python/HMI -> PLC | X/Y/Z/B/C 五轴目标位置原始值。 |
| `arReg_data[6]` | Python/HMI -> PLC | X 正向点动方向命令，需 `[19]` bit0=1。 |
| `arReg_data[7]` | Python/HMI -> PLC | X 反向点动方向命令，需 `[19]` bit0=1。 |
| `arReg_data[8]` | Python/HMI -> PLC | Y 正向点动方向命令，需 `[19]` bit1=1。 |
| `arReg_data[9]` | Python/HMI -> PLC | Y 反向点动方向命令，需 `[19]` bit1=1。 |
| `arReg_data[10]` | Python/HMI -> PLC | Z 正向点动方向命令，需 `[19]` bit2=1。 |
| `arReg_data[11]` | Python/HMI -> PLC | Z 反向点动方向命令，需 `[19]` bit2=1。 |
| `arReg_data[12]` | Python/HMI -> PLC | B 正向点动方向命令，需 `[19]` bit3=1。 |
| `arReg_data[13]` | Python/HMI -> PLC | B 反向点动方向命令，需 `[19]` bit3=1。 |
| `arReg_data[14]` | Python/HMI -> PLC | C 正向点动方向命令，需 `[19]` bit4=1。 |
| `arReg_data[15]` | Python/HMI -> PLC | C 反向点动方向命令，需 `[19]` bit4=1。 |
| `arReg_data[19]` | Python/HMI -> PLC | 点动总开关位图：bit0=X、bit1=Y、bit2=Z、bit3=B、bit4=C。 |
| `arReg_data[32]` | Python/HMI -> PLC | 五轴总使能命令：0=全部关闭使能，非0=全部打开使能。 |
| `arReg_data[89]` | Python/HMI -> PLC | 五轴复位命令位图：bit0=X、bit1=Y、bit2=Z、bit3=B、bit4=C。Python 写短脉冲后清0。 |

## 反馈寄存器

| 地址 | 方向 | 功能 |
|---:|---|---|
| `arAi_data[1..5]` | PLC -> Python/HMI | X/Y/Z/B/C 五轴当前位置反馈，Python 按 0.1 单位换算。 |
| `arReg_data[33..37]` | PLC -> Python/HMI | X/Y/Z/B/C 五轴状态字。 |
| `arReg_data[38..47]` | PLC -> Python/HMI | X/Y/Z/B/C 五轴 AxisErrorID，低/高 16 位。 |
| `arReg_data[48]` | PLC -> Python/HMI | 五轴使能请求反馈，bit0..bit4=X/Y/Z/B/C，bit15=五轴全 TRUE。 |
| `arReg_data[49..58]` | PLC -> Python/HMI | X/Y/Z/B/C 的 MC_ReadStatus.ErrorID，低/高 16 位。 |
| `arReg_data[59..68]` | PLC -> Python/HMI | X/Y/Z/B/C 的 MC_ReadAxisError.ErrorID，低/高 16 位。 |
| `arReg_data[69..78]` | PLC -> Python/HMI | X/Y/Z/B/C 的 MC_Power.ErrorID，低/高 16 位。 |
| `arReg_data[79..83]` | PLC -> Python/HMI | X/Y/Z/B/C 的 MC_Power 诊断字，bit0=Status，bit1=Error。 |
| `arReg_data[84]` | PLC -> Python/HMI | 轴状态诊断版本号，v26086 固定为 `{VERSION}`。 |
| `arReg_data[85]` | PLC -> Python/HMI | 使能请求不一致位图。 |
| `arReg_data[86]` | PLC -> Python/HMI | MC_ReadStatus.Error 位图。 |
| `arReg_data[87]` | PLC -> Python/HMI | MC_ReadAxisError.Error 位图。 |
| `arReg_data[88]` | PLC -> Python/HMI | MC_ReadStatus.FBErrorOccured 位图。 |
| `arReg_data[90]` | PLC -> Python/HMI | 复位命令读到反馈位图。 |
| `arReg_data[91]` | PLC -> Python/HMI | 点动总开关读到反馈位图。 |
| `arReg_data[92]` | PLC -> Python/HMI | 正向点动命令进入 FB_ServoJog 前的反馈位图。 |
| `arReg_data[93]` | PLC -> Python/HMI | 反向点动命令进入 FB_ServoJog 前的反馈位图。 |
| `arReg_data[94]` | PLC -> Python/HMI | FB_ServoJog.xReady 位图。 |
| `arReg_data[95]` | PLC -> Python/HMI | FB_ServoJog.xMoving 位图。 |
| `arReg_data[96]` | PLC -> Python/HMI | FB_ServoJog.xFault 位图。 |
| `arReg_data[97]` | PLC -> Python/HMI | FB_ServoJog.xJogError 位图。 |
| `arReg_data[98]` | PLC -> Python/HMI | FB_ServoJog.xJogAborted 位图。 |
| `arReg_data[99]` | PLC -> Python/HMI | 点动/复位诊断版本号，v26086 固定为 `{VERSION}`。 |

## 状态字 bit 含义

| bit | 十六进制 | 英文 | 中文 |
|---:|---:|---|---|
| 0 | `0x0001` | Disabled | 轴未使能。 |
| 1 | `0x0002` | Errorstop | 轴错误停止，需要复位或清除驱动故障后才能运动。 |
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
    """生成 v26086 导入 XML 和说明文件。"""
    tree = ET.parse(SOURCE_EXPORT)
    root = tree.getroot()

    update_axis_enable_control_pou(root)
    update_platform_pou(root)
    update_axis_status_pou(root)
    for _axis, index, pou_name, _fb_name, *_rest in AXES:
        update_axis_power_pou(root, pou_name.replace("Jog", "AXIS_") if False else {
            1: "AXIS_X_PRG",
            2: "Axis_Y_PRG",
            3: "AXIS_Z_PRG",
            4: "AXIS_B_PRG",
            5: "AXIS_C_PRG",
        }[index], index)
    for meta in AXES:
        update_jog_pou(root, *meta)
    update_modbus_tcp_slave(root)

    IMPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    write_codesys_xml(ET.ElementTree(build_minimal_project(root)), IMPORT_PATH)
    write_report()
    write_register_map()
    print(str(IMPORT_PATH))
    print(str(REPORT_PATH))
    print(str(REGISTER_MAP_PATH))


if __name__ == "__main__":
    main()
