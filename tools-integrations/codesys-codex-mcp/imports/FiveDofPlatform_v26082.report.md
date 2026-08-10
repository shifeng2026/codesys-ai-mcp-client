# FiveDofPlatform v26082 错误诊断版导入说明

生成时间：2026-08-01T12:13:42

## 为什么原错误寄存器会为空

原 `arReg_data[38..47]` 只保存 `MC_ReadAxisError.AxisErrorID`。拔伺服网线时，通信先断，`MC_ReadAxisError` 功能块自己会报 `Error/ErrorID`，但 `AxisError` 可能是 FALSE；原逻辑在 `AxisError=FALSE` 时把 `AxisErrorID` 清零，所以监控窗口看到空值。

拔电机线时，错误也可能先出现在 `MC_Power.ErrorID` 或 `MC_ReadStatus.ErrorID`，不一定会进入 `AxisErrorID`。

## 新增连续寄存器

- `arReg_data[33..37]`：五轴主状态字。v26082 起只保存轴状态和轴本体错误，不再把 `MC_ReadStatus.Error` / `FBErrorOccured` 混入 bit11/bit12。
- `arReg_data[49..58]`：五轴 `MC_ReadStatus.ErrorID`。
- `arReg_data[59..68]`：五轴 `MC_ReadAxisError.ErrorID`。
- `arReg_data[69..78]`：五轴 `MC_Power.ErrorID`。
- `arReg_data[79..83]`：五轴 `MC_Power` 诊断字，bit0=Status，bit1=Error。
- `arReg_data[84]`：诊断版本号，固定写 `26082`。
- `arReg_data[85]`：使能请求 TRUE 但状态仍 Disabled 的轴位图。
- `arReg_data[86]`：`MC_ReadStatus.Error` 轴位图。
- `arReg_data[87]`：`MC_ReadAxisError.Error` 轴位图。
- `arReg_data[88]`：`MC_ReadStatus.FBErrorOccured` 轴位图。

## 工程处理

本文件用于导入工程副本并重新编译，不执行 PLC 下载。
