# FiveDofPlatform v26084 点动/复位修复记录

生成时间：2026-08-01T13:29:29

## 现场现象

Python 已经写入 `arReg_data[19]` 点动总开关和 `arReg_data[6..15]` 方向命令，但五轴状态均为 `2 / 0x0002`。状态 bit1 表示 `Errorstop`，轴处在错误停止时不会执行 `MC_Jog`。

## 本次修改

- 新增 `arReg_data[89]` 五轴复位命令位图，bit0..bit4 对应 X/Y/Z/B/C。
- `JogX/JogY/JogZ/JogB/JogC` 的 `FB_ServoJog.xReset` 改为读取对应复位位，Python 可以发复位脉冲。
- 每个 Jog 程序在 `EtherCAT_Task` 内直接解析 `arReg_data[19]` 和 `arReg_data[6..15]`，避免 MainTask 与 EtherCAT_Task 时序影响点动命令。
- 修复 `PLC_PRG` 里点动总开关逻辑被后续直接赋值覆盖的问题。
- 新增 `arReg_data[90..99]` 点动/复位诊断反馈，版本号为 `26084`。
- `arReg_data[84]` 轴状态诊断版本同步升级为 `26084`。

## 未做的动作

- 未下载 PLC。
- 未启动或停止 PLC。
- 只生成导入 XML、工程副本、编译和导出文件。
