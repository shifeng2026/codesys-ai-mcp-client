# FiveDofPlatform v26084 寄存器地址与功能

## 关键控制寄存器

| 地址 | 方向 | 功能 |
|---:|---|---|
| `arReg_data[6]` | Python/HMI -> PLC | X 正向点动方向命令，需配合 `[19]` bit0。 |
| `arReg_data[7]` | Python/HMI -> PLC | X 反向点动方向命令，需配合 `[19]` bit0。 |
| `arReg_data[8]` | Python/HMI -> PLC | Y 正向点动方向命令，需配合 `[19]` bit1。 |
| `arReg_data[9]` | Python/HMI -> PLC | Y 反向点动方向命令，需配合 `[19]` bit1。 |
| `arReg_data[10]` | Python/HMI -> PLC | Z 正向点动方向命令，需配合 `[19]` bit2。 |
| `arReg_data[11]` | Python/HMI -> PLC | Z 反向点动方向命令，需配合 `[19]` bit2。 |
| `arReg_data[12]` | Python/HMI -> PLC | B 正向点动方向命令，需配合 `[19]` bit3。 |
| `arReg_data[13]` | Python/HMI -> PLC | B 反向点动方向命令，需配合 `[19]` bit3。 |
| `arReg_data[14]` | Python/HMI -> PLC | C 正向点动方向命令，需配合 `[19]` bit4。 |
| `arReg_data[15]` | Python/HMI -> PLC | C 反向点动方向命令，需配合 `[19]` bit4。 |
| `arReg_data[19]` | Python/HMI -> PLC | 点动总开关位图：bit0=X、bit1=Y、bit2=Z、bit3=B、bit4=C。 |
| `arReg_data[32]` | Python/HMI -> PLC | 五轴总使能命令：0=关闭五轴使能，非0=打开五轴使能。 |
| `arReg_data[89]` | Python/HMI -> PLC | 五轴复位命令位图：bit0=X、bit1=Y、bit2=Z、bit3=B、bit4=C。Python 写短脉冲后清 0。 |

## 反馈和诊断寄存器

| 地址 | 方向 | 功能 |
|---:|---|---|
| `arReg_data[33..37]` | PLC -> Python/HMI | X/Y/Z/B/C 五轴状态字。bit1=`0x0002` 表示 Errorstop。 |
| `arReg_data[38..47]` | PLC -> Python/HMI | X/Y/Z/B/C 五轴 AxisErrorID，DWORD 拆成低 16 位和高 16 位。 |
| `arReg_data[48]` | PLC -> Python/HMI | 五轴使能请求反馈，bit0..bit4=X/Y/Z/B/C，bit15=五轴请求全 TRUE。 |
| `arReg_data[49..88]` | PLC -> Python/HMI | v26082 起保留的 MC_ReadStatus、MC_ReadAxisError、MC_Power 诊断区。 |
| `arReg_data[84]` | PLC -> Python/HMI | 轴状态诊断版本号，v26084 固定为 `26084`。 |
| `arReg_data[90]` | PLC -> Python/HMI | 复位命令读到反馈位图，bit0..bit4=X/Y/Z/B/C。 |
| `arReg_data[91]` | PLC -> Python/HMI | 点动总开关读到反馈位图，bit0..bit4=X/Y/Z/B/C。 |
| `arReg_data[92]` | PLC -> Python/HMI | 正向点动命令进入 FB_ServoJog 前的反馈位图。 |
| `arReg_data[93]` | PLC -> Python/HMI | 反向点动命令进入 FB_ServoJog 前的反馈位图。 |
| `arReg_data[94]` | PLC -> Python/HMI | FB_ServoJog.xReady 位图，TRUE 表示点动功能块内部 MC_Power 就绪。 |
| `arReg_data[95]` | PLC -> Python/HMI | FB_ServoJog.xMoving 位图，TRUE 表示正在点动。 |
| `arReg_data[96]` | PLC -> Python/HMI | FB_ServoJog.xFault 位图，TRUE 表示点动功能块故障。 |
| `arReg_data[97]` | PLC -> Python/HMI | FB_ServoJog.xJogError 位图，TRUE 表示 MC_Jog 报错。 |
| `arReg_data[98]` | PLC -> Python/HMI | FB_ServoJog.xJogAborted 位图，TRUE 表示点动命令被中止。 |
| `arReg_data[99]` | PLC -> Python/HMI | 点动/复位诊断版本号，v26084 固定为 `26084`。 |

## 状态字低位/高位

`arReg_data[33..37]` 是 16 位状态字。低位是 bit0..bit7，高位是 bit8..bit15。

| bit | 十六进制 | 英文 | 中文含义 |
|---:|---:|---|---|
| 0 | `0x0001` | Disabled | 轴未使能。 |
| 1 | `0x0002` | Errorstop | 轴错误停止，必须复位或清除驱动故障后才能运动。 |
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
