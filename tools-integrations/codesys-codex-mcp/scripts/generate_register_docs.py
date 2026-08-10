from __future__ import annotations

import csv
from datetime import datetime
from pathlib import Path
import re


SOURCE_XML = Path(r"C:\path\export_enable_control\Machine.xml")
REPORT_DIR = Path(r"C:\Users\29925\codesys-codex-mcp\reports")
LOG_DIR = Path(r"C:\logs\plc_log")


AXES = ["X", "Y", "Z", "B", "C"]


def find_used_indices(text: str, array_name: str) -> set[int]:
    """Return literal numeric indices referenced as arXxx_data[n] in ST/XML text."""
    pattern = re.compile(rf"{re.escape(array_name)}\[(\d+)\]")
    return {int(match.group(1)) for match in pattern.finditer(text)}


def add_row(rows: list[dict[str, str]], area: str, address: int, direction: str, name: str, meaning: str, source: str) -> None:
    """Append one register/coil row using a stable column layout for CSV and Markdown."""
    rows.append(
        {
            "area": area,
            "address": str(address),
            "direction": direction,
            "name": name,
            "meaning": meaning,
            "source": source,
        }
    )


def build_holding_rows() -> list[dict[str, str]]:
    """Build the holding-register map exposed through arReg_data[0..199]."""
    rows: list[dict[str, str]] = []
    add_row(rows, "Holding/arReg_data", 0, "HMI->PLC", "Move_5Axis_Sign", "五轴平台运动命令；等于 1 时触发上升沿启动一次五轴运动。", "ModbusTcpSlave, FiveDOF_Platform_PRG")

    angle_factors = {
        1: "X 目标角度原始值；PLC 换算 TargetAngle = 寄存器值 * (360.0 / 26.0)。",
        2: "Y 目标角度原始值；PLC 换算 TargetAngle = 寄存器值 * (360.0 / 5.0)。",
        3: "Z 目标角度原始值；PLC 换算 TargetAngle = 寄存器值 * (360.0 / 5.0)。",
        4: "B 目标角度原始值；PLC 换算 TargetAngle = 寄存器值 * 1。",
        5: "C 目标角度原始值；PLC 换算 TargetAngle = 寄存器值 * 1。",
    }
    for address, meaning in angle_factors.items():
        add_row(rows, "Holding/arReg_data", address, "HMI->PLC", f"{AXES[address - 1]}_TargetAngleRaw", meaning, "ModbusTcpSlave")

    jog_names = {
        6: ("X_JogFwd", "X 轴点动正向命令；非 0 为 TRUE。"),
        7: ("X_JogRev", "X 轴点动反向命令；非 0 为 TRUE。"),
        8: ("Y_JogFwd", "Y 轴点动正向命令；非 0 为 TRUE。"),
        9: ("Y_JogRev", "Y 轴点动反向命令；非 0 为 TRUE。"),
        10: ("Z_JogFwd", "Z 轴点动正向命令；非 0 为 TRUE。"),
        11: ("Z_JogRev", "Z 轴点动反向命令；非 0 为 TRUE。"),
        12: ("B_JogFwd", "B 轴点动正向命令；非 0 为 TRUE。"),
        13: ("B_JogRev", "B 轴点动反向命令；非 0 为 TRUE。"),
        14: ("C_JogFwd", "C 轴点动正向命令；非 0 为 TRUE。"),
        15: ("C_JogRev", "C 轴点动反向命令；非 0 为 TRUE。"),
    }
    for address, (name, meaning) in jog_names.items():
        add_row(rows, "Holding/arReg_data", address, "HMI->PLC", name, meaning, "ModbusTcpSlave, JogX/JogY/JogZ/JogB/JogC")

    for address in range(16, 19):
        add_row(rows, "Holding/arReg_data", address, "Reserved", f"Reserved_{address}", "当前最终版本未使用；原状态反馈已迁移到连续块 [32..48]。", "Static scan")

    add_row(rows, "Holding/arReg_data", 19, "HMI->PLC", "JogModeBits", "点动模式位：bit0=X，bit1=Y，bit2=Z，bit3=B，bit4=C。注意：现有 ModbusTcpSlave 后续又无条件写入 xJogFwd/xJogRev，导致此门控在该段逻辑中被覆盖。", "ModbusTcpSlave")

    for address in range(20, 32):
        add_row(rows, "Holding/arReg_data", address, "Reserved", f"Reserved_{address}", "当前最终版本未使用；保留给后续扩展。", "Static scan")

    add_row(rows, "Holding/arReg_data", 32, "HMI->PLC", "AxisEnableAllCmd", "五轴总使能命令；0=五轴同时关闭使能，非 0=五轴同时打开使能。", "AxisEnableControl_PRG")

    for offset, axis in enumerate(AXES):
        add_row(rows, "Holding/arReg_data", 33 + offset, "PLC->HMI", f"{axis}_StatusWord", f"{axis} 轴状态字，位定义见文档下方状态字位表。", "AxisStatusFeedback_PRG")

    error_pairs = [(38, "X"), (40, "Y"), (42, "Z"), (44, "B"), (46, "C")]
    for base, axis in error_pairs:
        add_row(rows, "Holding/arReg_data", base, "PLC->HMI", f"{axis}_AxisErrorID_Low", f"{axis} 轴 AxisErrorID 低 16 位。", "AxisStatusFeedback_PRG")
        add_row(rows, "Holding/arReg_data", base + 1, "PLC->HMI", f"{axis}_AxisErrorID_High", f"{axis} 轴 AxisErrorID 高 16 位。", "AxisStatusFeedback_PRG")

    add_row(rows, "Holding/arReg_data", 48, "PLC->HMI", "AxisEnableRequestFeedback", "五轴 AxisEnable 请求反馈；bit0..bit4=X/Y/Z/B/C，bit15=五轴请求全部为 TRUE。", "AxisEnableControl_PRG")

    for address in range(49, 100):
        add_row(rows, "Holding/arReg_data", address, "Reserved", f"Reserved_{address}", "当前最终版本未使用。", "Static scan")

    add_row(rows, "Holding/arReg_data", 100, "PLC->HMI", "LogLength", "当前未读日志字符串长度；0 表示没有未读日志。", "LogConsumer")
    add_row(rows, "Holding/arReg_data", 101, "PLC->HMI", "LogTimestampLow", "日志时间戳低 16 位。", "LogConsumer")
    add_row(rows, "Holding/arReg_data", 102, "PLC->HMI", "LogTimestampHigh", "日志时间戳高 16 位。", "LogConsumer")
    for address in range(103, 153):
        add_row(rows, "Holding/arReg_data", address, "PLC->HMI", f"LogTextWord_{address - 103}", "日志文本载荷；每个 WORD 存 2 个字符，低字节在前，高字节在后。", "LogConsumer")

    for address in range(153, 200):
        add_row(rows, "Holding/arReg_data", address, "Reserved", f"Reserved_{address}", "当前最终版本未使用。", "Static scan")

    return rows


def build_input_rows() -> list[dict[str, str]]:
    """Build the input-register map exposed through arAi_data[0..16]."""
    rows: list[dict[str, str]] = []
    add_row(rows, "Input/arAi_data", 0, "Reserved", "Reserved_0", "当前最终版本未使用。", "Static scan")
    factors = ["360.0 / 26.0", "360.0 / 5.0", "360.0 / 5.0", "1", "1"]
    for index, axis in enumerate(AXES, start=1):
        add_row(rows, "Input/arAi_data", index, "PLC->HMI", f"{axis}_ActualAngleRaw", f"{axis} 当前角度反馈原始值；PLC 写入 REAL_TO_INT(ActualAngle / ({factors[index - 1]}) * 10.0)。", "ModbusTcpSlave")
    for address in range(6, 9):
        add_row(rows, "Input/arAi_data", address, "Reserved", f"Reserved_{address}", "当前最终版本未使用。", "Static scan")
    add_row(rows, "Input/arAi_data", 9, "PLC->HMI", "FiveDOF_State", "五轴平台状态：0=空闲，1=开始/运动中，2=运动错误。", "FiveDOF_Platform_PRG")
    for address in range(10, 17):
        add_row(rows, "Input/arAi_data", address, "Reserved", f"Reserved_{address}", "当前最终版本未使用。", "Static scan")
    return rows


def build_coil_rows() -> list[dict[str, str]]:
    """Build the coil map exposed through arDo_data[0..16]."""
    rows: list[dict[str, str]] = []
    for address in range(0, 16):
        add_row(rows, "Coil/arDo_data", address, "Reserved", f"Reserved_{address}", "当前最终版本未使用。", "Static scan")
    add_row(rows, "Coil/arDo_data", 16, "HMI->PLC", "LogAcknowledgeNext", "日志确认/读取下一条；主站置 TRUE 后，PLC 弹出一条日志并自动复位为 FALSE。", "LogConsumer")
    return rows


def build_discrete_rows() -> list[dict[str, str]]:
    """Build the discrete-input map exposed through arDi_data[0..15]."""
    rows: list[dict[str, str]] = []
    for address in range(0, 16):
        add_row(rows, "Discrete/arDi_data", address, "Reserved", f"Reserved_{address}", "当前最终版本未在 PLC 代码中赋值。", "Static scan")
    return rows


def to_markdown_table(rows: list[dict[str, str]]) -> str:
    """Convert rows to a Markdown table."""
    lines = ["| 区域 | 地址 | 方向 | 名称 | 功能 | 来源 |", "|---|---:|---|---|---|---|"]
    for row in rows:
        lines.append(f"| {row['area']} | {row['address']} | {row['direction']} | {row['name']} | {row['meaning']} | {row['source']} |")
    return "\n".join(lines)


def main() -> None:
    text = SOURCE_XML.read_text(encoding="utf-8")
    used = {
        "arReg_data": sorted(find_used_indices(text, "arReg_data")),
        "arAi_data": sorted(find_used_indices(text, "arAi_data")),
        "arDo_data": sorted(find_used_indices(text, "arDo_data")),
        "arDi_data": sorted(find_used_indices(text, "arDi_data")),
    }

    holding_rows = build_holding_rows()
    input_rows = build_input_rows()
    coil_rows = build_coil_rows()
    discrete_rows = build_discrete_rows()
    all_rows = holding_rows + input_rows + coil_rows + discrete_rows

    stamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    markdown = f"""# FiveDofPlatform Modbus 寄存器地址与功能

生成时间：{stamp}

工程副本：`C:\\path\\FiveDofPlatform_enable_control.project`

最终导出 XML：`C:\\path\\export_enable_control\\Machine.xml`

## Modbus 数据区

- 线圈：`arDo_data[0..16]`，Modbus 起始地址 `0`，数量 `17`。
- 离散输入：`arDi_data[0..15]`，Modbus 起始地址 `0`，数量 `16`。
- 保持寄存器：`arReg_data[0..199]`，Modbus 起始地址 `0`，数量 `200`。
- 输入寄存器：`arAi_data[0..16]`，Modbus 起始地址 `0`，数量 `16`。注意数组声明到 `[16]`，但 Modbus 数量为 16 时通常只暴露地址 `0..15`，`[16]` 是否可读取要按当前 Modbus 库实现确认。

## 静态扫描到的代码引用

- `arReg_data`: {used["arReg_data"]}
- `arAi_data`: {used["arAi_data"]}
- `arDo_data`: {used["arDo_data"]}
- `arDi_data`: {used["arDi_data"]}

## 保持寄存器 arReg_data

{to_markdown_table(holding_rows)}

## 输入寄存器 arAi_data

{to_markdown_table(input_rows)}

## 线圈 arDo_data

{to_markdown_table(coil_rows)}

## 离散输入 arDi_data

{to_markdown_table(discrete_rows)}

## 状态字位定义

用于 `arReg_data[33]..arReg_data[37]`。

| 位 | 十六进制 | 含义 |
|---:|---:|---|
| 0 | `16#0001` | Disabled，轴未使能 |
| 1 | `16#0002` | Errorstop，轴错误停止 |
| 2 | `16#0004` | Stopping，轴正在停止 |
| 3 | `16#0008` | StandStill，轴静止 |
| 4 | `16#0010` | DiscreteMotion，离散运动中 |
| 5 | `16#0020` | ContinuousMotion，连续运动中 |
| 6 | `16#0040` | SynchronizedMotion，同步运动中 |
| 7 | `16#0080` | Homing，回零中 |
| 8 | `16#0100` | ConstantVelocity，恒速中 |
| 9 | `16#0200` | Accelerating，加速中 |
| 10 | `16#0400` | Decelerating，减速中 |
| 11 | `16#0800` | `MC_ReadStatus.Error` |
| 12 | `16#1000` | `MC_ReadStatus.FBErrorOccured` |
| 13 | `16#2000` | 预留 |
| 14 | `16#4000` | `MC_ReadAxisError.AxisError` |
| 15 | `16#8000` | `MC_ReadAxisError.SWEndSwitchActive` |

## 已标出的逻辑注意事项

1. 原 `FiveDOF_Platform_PRG` 每周期强制 `Axes[i].AxisEnable := TRUE`，会覆盖关闭使能命令；最终副本中已移除，改由 `AxisEnableControl_PRG` 根据 `arReg_data[32]` 控制。
2. 原状态反馈地址 `[16] [17] [18] [20] [21] [22..31]` 已迁移为连续块 `[32..48]`，避免占用 `[19]` 点动模式位。
3. 点动逻辑里 `[19]` 先用于点动模式门控，但随后 `[6..15]` 又无条件覆盖 `xJogFwd/xJogRev`，所以 `[19]` 在该段逻辑中实际不再限制点动方向。本次只记录，不擅自修改。
"""

    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    md_paths = [
        REPORT_DIR / "FiveDofPlatform_register_map.md",
        LOG_DIR / "FiveDofPlatform_register_map.md",
    ]
    csv_paths = [
        REPORT_DIR / "FiveDofPlatform_register_map.csv",
        LOG_DIR / "FiveDofPlatform_register_map.csv",
    ]

    for path in md_paths:
        path.write_text(markdown, encoding="utf-8")

    for path in csv_paths:
        with path.open("w", newline="", encoding="utf-8-sig") as handle:
            writer = csv.DictWriter(handle, fieldnames=["area", "address", "direction", "name", "meaning", "source"])
            writer.writeheader()
            writer.writerows(all_rows)

    for path in md_paths + csv_paths:
        print(path)


if __name__ == "__main__":
    main()
