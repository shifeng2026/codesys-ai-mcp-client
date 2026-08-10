# Axis enable and feedback register map

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
