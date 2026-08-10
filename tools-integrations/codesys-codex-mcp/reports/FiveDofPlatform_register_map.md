# FiveDofPlatform Modbus 寄存器地址与功能

生成时间：2026-08-01 08:48:41

工程副本：`C:\path\FiveDofPlatform_enable_control.project`

最终导出 XML：`C:\path\export_enable_control\Machine.xml`

## Modbus 数据区

- 线圈：`arDo_data[0..16]`，Modbus 起始地址 `0`，数量 `17`。
- 离散输入：`arDi_data[0..15]`，Modbus 起始地址 `0`，数量 `16`。
- 保持寄存器：`arReg_data[0..199]`，Modbus 起始地址 `0`，数量 `200`。
- 输入寄存器：`arAi_data[0..16]`，Modbus 起始地址 `0`，数量 `16`。注意数组声明到 `[16]`，但 Modbus 数量为 16 时通常只暴露地址 `0..15`，`[16]` 是否可读取要按当前 Modbus 库实现确认。

## 静态扫描到的代码引用

- `arReg_data`: [0, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 19, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 100, 101, 102]
- `arAi_data`: [9]
- `arDo_data`: [16]
- `arDi_data`: []

## 保持寄存器 arReg_data

| 区域 | 地址 | 方向 | 名称 | 功能 | 来源 |
|---|---:|---|---|---|---|
| Holding/arReg_data | 0 | HMI->PLC | Move_5Axis_Sign | 五轴平台运动命令；等于 1 时触发上升沿启动一次五轴运动。 | ModbusTcpSlave, FiveDOF_Platform_PRG |
| Holding/arReg_data | 1 | HMI->PLC | X_TargetAngleRaw | X 目标角度原始值；PLC 换算 TargetAngle = 寄存器值 * (360.0 / 26.0)。 | ModbusTcpSlave |
| Holding/arReg_data | 2 | HMI->PLC | Y_TargetAngleRaw | Y 目标角度原始值；PLC 换算 TargetAngle = 寄存器值 * (360.0 / 5.0)。 | ModbusTcpSlave |
| Holding/arReg_data | 3 | HMI->PLC | Z_TargetAngleRaw | Z 目标角度原始值；PLC 换算 TargetAngle = 寄存器值 * (360.0 / 5.0)。 | ModbusTcpSlave |
| Holding/arReg_data | 4 | HMI->PLC | B_TargetAngleRaw | B 目标角度原始值；PLC 换算 TargetAngle = 寄存器值 * 1。 | ModbusTcpSlave |
| Holding/arReg_data | 5 | HMI->PLC | C_TargetAngleRaw | C 目标角度原始值；PLC 换算 TargetAngle = 寄存器值 * 1。 | ModbusTcpSlave |
| Holding/arReg_data | 6 | HMI->PLC | X_JogFwd | X 轴点动正向命令；非 0 为 TRUE。 | ModbusTcpSlave, JogX/JogY/JogZ/JogB/JogC |
| Holding/arReg_data | 7 | HMI->PLC | X_JogRev | X 轴点动反向命令；非 0 为 TRUE。 | ModbusTcpSlave, JogX/JogY/JogZ/JogB/JogC |
| Holding/arReg_data | 8 | HMI->PLC | Y_JogFwd | Y 轴点动正向命令；非 0 为 TRUE。 | ModbusTcpSlave, JogX/JogY/JogZ/JogB/JogC |
| Holding/arReg_data | 9 | HMI->PLC | Y_JogRev | Y 轴点动反向命令；非 0 为 TRUE。 | ModbusTcpSlave, JogX/JogY/JogZ/JogB/JogC |
| Holding/arReg_data | 10 | HMI->PLC | Z_JogFwd | Z 轴点动正向命令；非 0 为 TRUE。 | ModbusTcpSlave, JogX/JogY/JogZ/JogB/JogC |
| Holding/arReg_data | 11 | HMI->PLC | Z_JogRev | Z 轴点动反向命令；非 0 为 TRUE。 | ModbusTcpSlave, JogX/JogY/JogZ/JogB/JogC |
| Holding/arReg_data | 12 | HMI->PLC | B_JogFwd | B 轴点动正向命令；非 0 为 TRUE。 | ModbusTcpSlave, JogX/JogY/JogZ/JogB/JogC |
| Holding/arReg_data | 13 | HMI->PLC | B_JogRev | B 轴点动反向命令；非 0 为 TRUE。 | ModbusTcpSlave, JogX/JogY/JogZ/JogB/JogC |
| Holding/arReg_data | 14 | HMI->PLC | C_JogFwd | C 轴点动正向命令；非 0 为 TRUE。 | ModbusTcpSlave, JogX/JogY/JogZ/JogB/JogC |
| Holding/arReg_data | 15 | HMI->PLC | C_JogRev | C 轴点动反向命令；非 0 为 TRUE。 | ModbusTcpSlave, JogX/JogY/JogZ/JogB/JogC |
| Holding/arReg_data | 16 | Reserved | Reserved_16 | 当前最终版本未使用；原状态反馈已迁移到连续块 [32..48]。 | Static scan |
| Holding/arReg_data | 17 | Reserved | Reserved_17 | 当前最终版本未使用；原状态反馈已迁移到连续块 [32..48]。 | Static scan |
| Holding/arReg_data | 18 | Reserved | Reserved_18 | 当前最终版本未使用；原状态反馈已迁移到连续块 [32..48]。 | Static scan |
| Holding/arReg_data | 19 | HMI->PLC | JogModeBits | 点动模式位：bit0=X，bit1=Y，bit2=Z，bit3=B，bit4=C。注意：现有 ModbusTcpSlave 后续又无条件写入 xJogFwd/xJogRev，导致此门控在该段逻辑中被覆盖。 | ModbusTcpSlave |
| Holding/arReg_data | 20 | Reserved | Reserved_20 | 当前最终版本未使用；保留给后续扩展。 | Static scan |
| Holding/arReg_data | 21 | Reserved | Reserved_21 | 当前最终版本未使用；保留给后续扩展。 | Static scan |
| Holding/arReg_data | 22 | Reserved | Reserved_22 | 当前最终版本未使用；保留给后续扩展。 | Static scan |
| Holding/arReg_data | 23 | Reserved | Reserved_23 | 当前最终版本未使用；保留给后续扩展。 | Static scan |
| Holding/arReg_data | 24 | Reserved | Reserved_24 | 当前最终版本未使用；保留给后续扩展。 | Static scan |
| Holding/arReg_data | 25 | Reserved | Reserved_25 | 当前最终版本未使用；保留给后续扩展。 | Static scan |
| Holding/arReg_data | 26 | Reserved | Reserved_26 | 当前最终版本未使用；保留给后续扩展。 | Static scan |
| Holding/arReg_data | 27 | Reserved | Reserved_27 | 当前最终版本未使用；保留给后续扩展。 | Static scan |
| Holding/arReg_data | 28 | Reserved | Reserved_28 | 当前最终版本未使用；保留给后续扩展。 | Static scan |
| Holding/arReg_data | 29 | Reserved | Reserved_29 | 当前最终版本未使用；保留给后续扩展。 | Static scan |
| Holding/arReg_data | 30 | Reserved | Reserved_30 | 当前最终版本未使用；保留给后续扩展。 | Static scan |
| Holding/arReg_data | 31 | Reserved | Reserved_31 | 当前最终版本未使用；保留给后续扩展。 | Static scan |
| Holding/arReg_data | 32 | HMI->PLC | AxisEnableAllCmd | 五轴总使能命令；0=五轴同时关闭使能，非 0=五轴同时打开使能。 | AxisEnableControl_PRG |
| Holding/arReg_data | 33 | PLC->HMI | X_StatusWord | X 轴状态字，位定义见文档下方状态字位表。 | AxisStatusFeedback_PRG |
| Holding/arReg_data | 34 | PLC->HMI | Y_StatusWord | Y 轴状态字，位定义见文档下方状态字位表。 | AxisStatusFeedback_PRG |
| Holding/arReg_data | 35 | PLC->HMI | Z_StatusWord | Z 轴状态字，位定义见文档下方状态字位表。 | AxisStatusFeedback_PRG |
| Holding/arReg_data | 36 | PLC->HMI | B_StatusWord | B 轴状态字，位定义见文档下方状态字位表。 | AxisStatusFeedback_PRG |
| Holding/arReg_data | 37 | PLC->HMI | C_StatusWord | C 轴状态字，位定义见文档下方状态字位表。 | AxisStatusFeedback_PRG |
| Holding/arReg_data | 38 | PLC->HMI | X_AxisErrorID_Low | X 轴 AxisErrorID 低 16 位。 | AxisStatusFeedback_PRG |
| Holding/arReg_data | 39 | PLC->HMI | X_AxisErrorID_High | X 轴 AxisErrorID 高 16 位。 | AxisStatusFeedback_PRG |
| Holding/arReg_data | 40 | PLC->HMI | Y_AxisErrorID_Low | Y 轴 AxisErrorID 低 16 位。 | AxisStatusFeedback_PRG |
| Holding/arReg_data | 41 | PLC->HMI | Y_AxisErrorID_High | Y 轴 AxisErrorID 高 16 位。 | AxisStatusFeedback_PRG |
| Holding/arReg_data | 42 | PLC->HMI | Z_AxisErrorID_Low | Z 轴 AxisErrorID 低 16 位。 | AxisStatusFeedback_PRG |
| Holding/arReg_data | 43 | PLC->HMI | Z_AxisErrorID_High | Z 轴 AxisErrorID 高 16 位。 | AxisStatusFeedback_PRG |
| Holding/arReg_data | 44 | PLC->HMI | B_AxisErrorID_Low | B 轴 AxisErrorID 低 16 位。 | AxisStatusFeedback_PRG |
| Holding/arReg_data | 45 | PLC->HMI | B_AxisErrorID_High | B 轴 AxisErrorID 高 16 位。 | AxisStatusFeedback_PRG |
| Holding/arReg_data | 46 | PLC->HMI | C_AxisErrorID_Low | C 轴 AxisErrorID 低 16 位。 | AxisStatusFeedback_PRG |
| Holding/arReg_data | 47 | PLC->HMI | C_AxisErrorID_High | C 轴 AxisErrorID 高 16 位。 | AxisStatusFeedback_PRG |
| Holding/arReg_data | 48 | PLC->HMI | AxisEnableRequestFeedback | 五轴 AxisEnable 请求反馈；bit0..bit4=X/Y/Z/B/C，bit15=五轴请求全部为 TRUE。 | AxisEnableControl_PRG |
| Holding/arReg_data | 49 | Reserved | Reserved_49 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 50 | Reserved | Reserved_50 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 51 | Reserved | Reserved_51 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 52 | Reserved | Reserved_52 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 53 | Reserved | Reserved_53 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 54 | Reserved | Reserved_54 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 55 | Reserved | Reserved_55 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 56 | Reserved | Reserved_56 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 57 | Reserved | Reserved_57 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 58 | Reserved | Reserved_58 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 59 | Reserved | Reserved_59 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 60 | Reserved | Reserved_60 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 61 | Reserved | Reserved_61 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 62 | Reserved | Reserved_62 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 63 | Reserved | Reserved_63 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 64 | Reserved | Reserved_64 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 65 | Reserved | Reserved_65 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 66 | Reserved | Reserved_66 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 67 | Reserved | Reserved_67 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 68 | Reserved | Reserved_68 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 69 | Reserved | Reserved_69 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 70 | Reserved | Reserved_70 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 71 | Reserved | Reserved_71 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 72 | Reserved | Reserved_72 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 73 | Reserved | Reserved_73 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 74 | Reserved | Reserved_74 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 75 | Reserved | Reserved_75 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 76 | Reserved | Reserved_76 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 77 | Reserved | Reserved_77 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 78 | Reserved | Reserved_78 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 79 | Reserved | Reserved_79 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 80 | Reserved | Reserved_80 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 81 | Reserved | Reserved_81 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 82 | Reserved | Reserved_82 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 83 | Reserved | Reserved_83 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 84 | Reserved | Reserved_84 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 85 | Reserved | Reserved_85 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 86 | Reserved | Reserved_86 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 87 | Reserved | Reserved_87 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 88 | Reserved | Reserved_88 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 89 | Reserved | Reserved_89 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 90 | Reserved | Reserved_90 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 91 | Reserved | Reserved_91 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 92 | Reserved | Reserved_92 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 93 | Reserved | Reserved_93 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 94 | Reserved | Reserved_94 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 95 | Reserved | Reserved_95 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 96 | Reserved | Reserved_96 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 97 | Reserved | Reserved_97 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 98 | Reserved | Reserved_98 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 99 | Reserved | Reserved_99 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 100 | PLC->HMI | LogLength | 当前未读日志字符串长度；0 表示没有未读日志。 | LogConsumer |
| Holding/arReg_data | 101 | PLC->HMI | LogTimestampLow | 日志时间戳低 16 位。 | LogConsumer |
| Holding/arReg_data | 102 | PLC->HMI | LogTimestampHigh | 日志时间戳高 16 位。 | LogConsumer |
| Holding/arReg_data | 103 | PLC->HMI | LogTextWord_0 | 日志文本载荷；每个 WORD 存 2 个字符，低字节在前，高字节在后。 | LogConsumer |
| Holding/arReg_data | 104 | PLC->HMI | LogTextWord_1 | 日志文本载荷；每个 WORD 存 2 个字符，低字节在前，高字节在后。 | LogConsumer |
| Holding/arReg_data | 105 | PLC->HMI | LogTextWord_2 | 日志文本载荷；每个 WORD 存 2 个字符，低字节在前，高字节在后。 | LogConsumer |
| Holding/arReg_data | 106 | PLC->HMI | LogTextWord_3 | 日志文本载荷；每个 WORD 存 2 个字符，低字节在前，高字节在后。 | LogConsumer |
| Holding/arReg_data | 107 | PLC->HMI | LogTextWord_4 | 日志文本载荷；每个 WORD 存 2 个字符，低字节在前，高字节在后。 | LogConsumer |
| Holding/arReg_data | 108 | PLC->HMI | LogTextWord_5 | 日志文本载荷；每个 WORD 存 2 个字符，低字节在前，高字节在后。 | LogConsumer |
| Holding/arReg_data | 109 | PLC->HMI | LogTextWord_6 | 日志文本载荷；每个 WORD 存 2 个字符，低字节在前，高字节在后。 | LogConsumer |
| Holding/arReg_data | 110 | PLC->HMI | LogTextWord_7 | 日志文本载荷；每个 WORD 存 2 个字符，低字节在前，高字节在后。 | LogConsumer |
| Holding/arReg_data | 111 | PLC->HMI | LogTextWord_8 | 日志文本载荷；每个 WORD 存 2 个字符，低字节在前，高字节在后。 | LogConsumer |
| Holding/arReg_data | 112 | PLC->HMI | LogTextWord_9 | 日志文本载荷；每个 WORD 存 2 个字符，低字节在前，高字节在后。 | LogConsumer |
| Holding/arReg_data | 113 | PLC->HMI | LogTextWord_10 | 日志文本载荷；每个 WORD 存 2 个字符，低字节在前，高字节在后。 | LogConsumer |
| Holding/arReg_data | 114 | PLC->HMI | LogTextWord_11 | 日志文本载荷；每个 WORD 存 2 个字符，低字节在前，高字节在后。 | LogConsumer |
| Holding/arReg_data | 115 | PLC->HMI | LogTextWord_12 | 日志文本载荷；每个 WORD 存 2 个字符，低字节在前，高字节在后。 | LogConsumer |
| Holding/arReg_data | 116 | PLC->HMI | LogTextWord_13 | 日志文本载荷；每个 WORD 存 2 个字符，低字节在前，高字节在后。 | LogConsumer |
| Holding/arReg_data | 117 | PLC->HMI | LogTextWord_14 | 日志文本载荷；每个 WORD 存 2 个字符，低字节在前，高字节在后。 | LogConsumer |
| Holding/arReg_data | 118 | PLC->HMI | LogTextWord_15 | 日志文本载荷；每个 WORD 存 2 个字符，低字节在前，高字节在后。 | LogConsumer |
| Holding/arReg_data | 119 | PLC->HMI | LogTextWord_16 | 日志文本载荷；每个 WORD 存 2 个字符，低字节在前，高字节在后。 | LogConsumer |
| Holding/arReg_data | 120 | PLC->HMI | LogTextWord_17 | 日志文本载荷；每个 WORD 存 2 个字符，低字节在前，高字节在后。 | LogConsumer |
| Holding/arReg_data | 121 | PLC->HMI | LogTextWord_18 | 日志文本载荷；每个 WORD 存 2 个字符，低字节在前，高字节在后。 | LogConsumer |
| Holding/arReg_data | 122 | PLC->HMI | LogTextWord_19 | 日志文本载荷；每个 WORD 存 2 个字符，低字节在前，高字节在后。 | LogConsumer |
| Holding/arReg_data | 123 | PLC->HMI | LogTextWord_20 | 日志文本载荷；每个 WORD 存 2 个字符，低字节在前，高字节在后。 | LogConsumer |
| Holding/arReg_data | 124 | PLC->HMI | LogTextWord_21 | 日志文本载荷；每个 WORD 存 2 个字符，低字节在前，高字节在后。 | LogConsumer |
| Holding/arReg_data | 125 | PLC->HMI | LogTextWord_22 | 日志文本载荷；每个 WORD 存 2 个字符，低字节在前，高字节在后。 | LogConsumer |
| Holding/arReg_data | 126 | PLC->HMI | LogTextWord_23 | 日志文本载荷；每个 WORD 存 2 个字符，低字节在前，高字节在后。 | LogConsumer |
| Holding/arReg_data | 127 | PLC->HMI | LogTextWord_24 | 日志文本载荷；每个 WORD 存 2 个字符，低字节在前，高字节在后。 | LogConsumer |
| Holding/arReg_data | 128 | PLC->HMI | LogTextWord_25 | 日志文本载荷；每个 WORD 存 2 个字符，低字节在前，高字节在后。 | LogConsumer |
| Holding/arReg_data | 129 | PLC->HMI | LogTextWord_26 | 日志文本载荷；每个 WORD 存 2 个字符，低字节在前，高字节在后。 | LogConsumer |
| Holding/arReg_data | 130 | PLC->HMI | LogTextWord_27 | 日志文本载荷；每个 WORD 存 2 个字符，低字节在前，高字节在后。 | LogConsumer |
| Holding/arReg_data | 131 | PLC->HMI | LogTextWord_28 | 日志文本载荷；每个 WORD 存 2 个字符，低字节在前，高字节在后。 | LogConsumer |
| Holding/arReg_data | 132 | PLC->HMI | LogTextWord_29 | 日志文本载荷；每个 WORD 存 2 个字符，低字节在前，高字节在后。 | LogConsumer |
| Holding/arReg_data | 133 | PLC->HMI | LogTextWord_30 | 日志文本载荷；每个 WORD 存 2 个字符，低字节在前，高字节在后。 | LogConsumer |
| Holding/arReg_data | 134 | PLC->HMI | LogTextWord_31 | 日志文本载荷；每个 WORD 存 2 个字符，低字节在前，高字节在后。 | LogConsumer |
| Holding/arReg_data | 135 | PLC->HMI | LogTextWord_32 | 日志文本载荷；每个 WORD 存 2 个字符，低字节在前，高字节在后。 | LogConsumer |
| Holding/arReg_data | 136 | PLC->HMI | LogTextWord_33 | 日志文本载荷；每个 WORD 存 2 个字符，低字节在前，高字节在后。 | LogConsumer |
| Holding/arReg_data | 137 | PLC->HMI | LogTextWord_34 | 日志文本载荷；每个 WORD 存 2 个字符，低字节在前，高字节在后。 | LogConsumer |
| Holding/arReg_data | 138 | PLC->HMI | LogTextWord_35 | 日志文本载荷；每个 WORD 存 2 个字符，低字节在前，高字节在后。 | LogConsumer |
| Holding/arReg_data | 139 | PLC->HMI | LogTextWord_36 | 日志文本载荷；每个 WORD 存 2 个字符，低字节在前，高字节在后。 | LogConsumer |
| Holding/arReg_data | 140 | PLC->HMI | LogTextWord_37 | 日志文本载荷；每个 WORD 存 2 个字符，低字节在前，高字节在后。 | LogConsumer |
| Holding/arReg_data | 141 | PLC->HMI | LogTextWord_38 | 日志文本载荷；每个 WORD 存 2 个字符，低字节在前，高字节在后。 | LogConsumer |
| Holding/arReg_data | 142 | PLC->HMI | LogTextWord_39 | 日志文本载荷；每个 WORD 存 2 个字符，低字节在前，高字节在后。 | LogConsumer |
| Holding/arReg_data | 143 | PLC->HMI | LogTextWord_40 | 日志文本载荷；每个 WORD 存 2 个字符，低字节在前，高字节在后。 | LogConsumer |
| Holding/arReg_data | 144 | PLC->HMI | LogTextWord_41 | 日志文本载荷；每个 WORD 存 2 个字符，低字节在前，高字节在后。 | LogConsumer |
| Holding/arReg_data | 145 | PLC->HMI | LogTextWord_42 | 日志文本载荷；每个 WORD 存 2 个字符，低字节在前，高字节在后。 | LogConsumer |
| Holding/arReg_data | 146 | PLC->HMI | LogTextWord_43 | 日志文本载荷；每个 WORD 存 2 个字符，低字节在前，高字节在后。 | LogConsumer |
| Holding/arReg_data | 147 | PLC->HMI | LogTextWord_44 | 日志文本载荷；每个 WORD 存 2 个字符，低字节在前，高字节在后。 | LogConsumer |
| Holding/arReg_data | 148 | PLC->HMI | LogTextWord_45 | 日志文本载荷；每个 WORD 存 2 个字符，低字节在前，高字节在后。 | LogConsumer |
| Holding/arReg_data | 149 | PLC->HMI | LogTextWord_46 | 日志文本载荷；每个 WORD 存 2 个字符，低字节在前，高字节在后。 | LogConsumer |
| Holding/arReg_data | 150 | PLC->HMI | LogTextWord_47 | 日志文本载荷；每个 WORD 存 2 个字符，低字节在前，高字节在后。 | LogConsumer |
| Holding/arReg_data | 151 | PLC->HMI | LogTextWord_48 | 日志文本载荷；每个 WORD 存 2 个字符，低字节在前，高字节在后。 | LogConsumer |
| Holding/arReg_data | 152 | PLC->HMI | LogTextWord_49 | 日志文本载荷；每个 WORD 存 2 个字符，低字节在前，高字节在后。 | LogConsumer |
| Holding/arReg_data | 153 | Reserved | Reserved_153 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 154 | Reserved | Reserved_154 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 155 | Reserved | Reserved_155 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 156 | Reserved | Reserved_156 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 157 | Reserved | Reserved_157 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 158 | Reserved | Reserved_158 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 159 | Reserved | Reserved_159 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 160 | Reserved | Reserved_160 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 161 | Reserved | Reserved_161 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 162 | Reserved | Reserved_162 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 163 | Reserved | Reserved_163 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 164 | Reserved | Reserved_164 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 165 | Reserved | Reserved_165 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 166 | Reserved | Reserved_166 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 167 | Reserved | Reserved_167 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 168 | Reserved | Reserved_168 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 169 | Reserved | Reserved_169 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 170 | Reserved | Reserved_170 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 171 | Reserved | Reserved_171 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 172 | Reserved | Reserved_172 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 173 | Reserved | Reserved_173 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 174 | Reserved | Reserved_174 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 175 | Reserved | Reserved_175 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 176 | Reserved | Reserved_176 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 177 | Reserved | Reserved_177 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 178 | Reserved | Reserved_178 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 179 | Reserved | Reserved_179 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 180 | Reserved | Reserved_180 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 181 | Reserved | Reserved_181 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 182 | Reserved | Reserved_182 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 183 | Reserved | Reserved_183 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 184 | Reserved | Reserved_184 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 185 | Reserved | Reserved_185 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 186 | Reserved | Reserved_186 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 187 | Reserved | Reserved_187 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 188 | Reserved | Reserved_188 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 189 | Reserved | Reserved_189 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 190 | Reserved | Reserved_190 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 191 | Reserved | Reserved_191 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 192 | Reserved | Reserved_192 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 193 | Reserved | Reserved_193 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 194 | Reserved | Reserved_194 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 195 | Reserved | Reserved_195 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 196 | Reserved | Reserved_196 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 197 | Reserved | Reserved_197 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 198 | Reserved | Reserved_198 | 当前最终版本未使用。 | Static scan |
| Holding/arReg_data | 199 | Reserved | Reserved_199 | 当前最终版本未使用。 | Static scan |

## 输入寄存器 arAi_data

| 区域 | 地址 | 方向 | 名称 | 功能 | 来源 |
|---|---:|---|---|---|---|
| Input/arAi_data | 0 | Reserved | Reserved_0 | 当前最终版本未使用。 | Static scan |
| Input/arAi_data | 1 | PLC->HMI | X_ActualAngleRaw | X 当前角度反馈原始值；PLC 写入 REAL_TO_INT(ActualAngle / (360.0 / 26.0) * 10.0)。 | ModbusTcpSlave |
| Input/arAi_data | 2 | PLC->HMI | Y_ActualAngleRaw | Y 当前角度反馈原始值；PLC 写入 REAL_TO_INT(ActualAngle / (360.0 / 5.0) * 10.0)。 | ModbusTcpSlave |
| Input/arAi_data | 3 | PLC->HMI | Z_ActualAngleRaw | Z 当前角度反馈原始值；PLC 写入 REAL_TO_INT(ActualAngle / (360.0 / 5.0) * 10.0)。 | ModbusTcpSlave |
| Input/arAi_data | 4 | PLC->HMI | B_ActualAngleRaw | B 当前角度反馈原始值；PLC 写入 REAL_TO_INT(ActualAngle / (1) * 10.0)。 | ModbusTcpSlave |
| Input/arAi_data | 5 | PLC->HMI | C_ActualAngleRaw | C 当前角度反馈原始值；PLC 写入 REAL_TO_INT(ActualAngle / (1) * 10.0)。 | ModbusTcpSlave |
| Input/arAi_data | 6 | Reserved | Reserved_6 | 当前最终版本未使用。 | Static scan |
| Input/arAi_data | 7 | Reserved | Reserved_7 | 当前最终版本未使用。 | Static scan |
| Input/arAi_data | 8 | Reserved | Reserved_8 | 当前最终版本未使用。 | Static scan |
| Input/arAi_data | 9 | PLC->HMI | FiveDOF_State | 五轴平台状态：0=空闲，1=开始/运动中，2=运动错误。 | FiveDOF_Platform_PRG |
| Input/arAi_data | 10 | Reserved | Reserved_10 | 当前最终版本未使用。 | Static scan |
| Input/arAi_data | 11 | Reserved | Reserved_11 | 当前最终版本未使用。 | Static scan |
| Input/arAi_data | 12 | Reserved | Reserved_12 | 当前最终版本未使用。 | Static scan |
| Input/arAi_data | 13 | Reserved | Reserved_13 | 当前最终版本未使用。 | Static scan |
| Input/arAi_data | 14 | Reserved | Reserved_14 | 当前最终版本未使用。 | Static scan |
| Input/arAi_data | 15 | Reserved | Reserved_15 | 当前最终版本未使用。 | Static scan |
| Input/arAi_data | 16 | Reserved | Reserved_16 | 当前最终版本未使用。 | Static scan |

## 线圈 arDo_data

| 区域 | 地址 | 方向 | 名称 | 功能 | 来源 |
|---|---:|---|---|---|---|
| Coil/arDo_data | 0 | Reserved | Reserved_0 | 当前最终版本未使用。 | Static scan |
| Coil/arDo_data | 1 | Reserved | Reserved_1 | 当前最终版本未使用。 | Static scan |
| Coil/arDo_data | 2 | Reserved | Reserved_2 | 当前最终版本未使用。 | Static scan |
| Coil/arDo_data | 3 | Reserved | Reserved_3 | 当前最终版本未使用。 | Static scan |
| Coil/arDo_data | 4 | Reserved | Reserved_4 | 当前最终版本未使用。 | Static scan |
| Coil/arDo_data | 5 | Reserved | Reserved_5 | 当前最终版本未使用。 | Static scan |
| Coil/arDo_data | 6 | Reserved | Reserved_6 | 当前最终版本未使用。 | Static scan |
| Coil/arDo_data | 7 | Reserved | Reserved_7 | 当前最终版本未使用。 | Static scan |
| Coil/arDo_data | 8 | Reserved | Reserved_8 | 当前最终版本未使用。 | Static scan |
| Coil/arDo_data | 9 | Reserved | Reserved_9 | 当前最终版本未使用。 | Static scan |
| Coil/arDo_data | 10 | Reserved | Reserved_10 | 当前最终版本未使用。 | Static scan |
| Coil/arDo_data | 11 | Reserved | Reserved_11 | 当前最终版本未使用。 | Static scan |
| Coil/arDo_data | 12 | Reserved | Reserved_12 | 当前最终版本未使用。 | Static scan |
| Coil/arDo_data | 13 | Reserved | Reserved_13 | 当前最终版本未使用。 | Static scan |
| Coil/arDo_data | 14 | Reserved | Reserved_14 | 当前最终版本未使用。 | Static scan |
| Coil/arDo_data | 15 | Reserved | Reserved_15 | 当前最终版本未使用。 | Static scan |
| Coil/arDo_data | 16 | HMI->PLC | LogAcknowledgeNext | 日志确认/读取下一条；主站置 TRUE 后，PLC 弹出一条日志并自动复位为 FALSE。 | LogConsumer |

## 离散输入 arDi_data

| 区域 | 地址 | 方向 | 名称 | 功能 | 来源 |
|---|---:|---|---|---|---|
| Discrete/arDi_data | 0 | Reserved | Reserved_0 | 当前最终版本未在 PLC 代码中赋值。 | Static scan |
| Discrete/arDi_data | 1 | Reserved | Reserved_1 | 当前最终版本未在 PLC 代码中赋值。 | Static scan |
| Discrete/arDi_data | 2 | Reserved | Reserved_2 | 当前最终版本未在 PLC 代码中赋值。 | Static scan |
| Discrete/arDi_data | 3 | Reserved | Reserved_3 | 当前最终版本未在 PLC 代码中赋值。 | Static scan |
| Discrete/arDi_data | 4 | Reserved | Reserved_4 | 当前最终版本未在 PLC 代码中赋值。 | Static scan |
| Discrete/arDi_data | 5 | Reserved | Reserved_5 | 当前最终版本未在 PLC 代码中赋值。 | Static scan |
| Discrete/arDi_data | 6 | Reserved | Reserved_6 | 当前最终版本未在 PLC 代码中赋值。 | Static scan |
| Discrete/arDi_data | 7 | Reserved | Reserved_7 | 当前最终版本未在 PLC 代码中赋值。 | Static scan |
| Discrete/arDi_data | 8 | Reserved | Reserved_8 | 当前最终版本未在 PLC 代码中赋值。 | Static scan |
| Discrete/arDi_data | 9 | Reserved | Reserved_9 | 当前最终版本未在 PLC 代码中赋值。 | Static scan |
| Discrete/arDi_data | 10 | Reserved | Reserved_10 | 当前最终版本未在 PLC 代码中赋值。 | Static scan |
| Discrete/arDi_data | 11 | Reserved | Reserved_11 | 当前最终版本未在 PLC 代码中赋值。 | Static scan |
| Discrete/arDi_data | 12 | Reserved | Reserved_12 | 当前最终版本未在 PLC 代码中赋值。 | Static scan |
| Discrete/arDi_data | 13 | Reserved | Reserved_13 | 当前最终版本未在 PLC 代码中赋值。 | Static scan |
| Discrete/arDi_data | 14 | Reserved | Reserved_14 | 当前最终版本未在 PLC 代码中赋值。 | Static scan |
| Discrete/arDi_data | 15 | Reserved | Reserved_15 | 当前最终版本未在 PLC 代码中赋值。 | Static scan |

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
