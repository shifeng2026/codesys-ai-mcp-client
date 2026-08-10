# FiveDofPlatform v26086 Modbus 寄存器集中版

生成时间：2026-08-01T15:55:17

## 修改原则

所有 `arReg_data[...]` 和 `arAi_data[...]` 地址读写集中在 `ModbusTcpSlave` 程序中。其他程序只做运动控制或状态采集，并把结果写入 `GVL` 中的全局缓存变量。

## 解决的问题

- 点动总开关 `[19]` 和方向 `[6..15]` 的解析集中到 `ModbusTcpSlave`，并保留中文注释。
- 复位命令 `[89]` 集中到 `ModbusTcpSlave`，Jog 程序只读取全局 `xJogReset[1..5]`。
- 轴状态、错误 ID、MC_Power 诊断、点动反馈都先写全局缓存，再由 `ModbusTcpSlave` 统一输出到 `[33..99]`。
- `AxisEnableControl_PRG` 改成占位程序，不再写寄存器，避免寄存器被多处写入。
- 在原 `GVL` 追加 v26086 缓存变量，避免新建 GVL 的 PLCopenXML schema 兼容问题。

## 未做动作

- 未下载 PLC。
- 未启动/停止 PLC。
- 需要你后续确认安全后，在 CODESYS 里下载 v26086 工程到控制器才会现场生效。
