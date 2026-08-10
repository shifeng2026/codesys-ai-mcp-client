# FiveDofPlatform v26085 寄存器地址与功能

## Modbus 集中原则

从 v26085 开始，所有 `arReg_data[...]` 和 `arAi_data[...]` 地址读写都集中在 `ModbusTcpSlave` 程序。其他程序不直接写寄存器，只写全局缓存。

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
| `arReg_data[84]` | PLC -> Python/HMI | 轴状态诊断版本号，v26085 固定为 `26085`。 |
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
| `arReg_data[99]` | PLC -> Python/HMI | 点动/复位诊断版本号，v26085 固定为 `26085`。 |

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
