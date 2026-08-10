# FiveDofPlatform Error Diagnostic Register Map

Generated: 2026-08-01

Project copy: `C:\path\FiveDofPlatform_error_diag.project`

XML export: `C:\path\export_error_diag\Machine.xml`

Build result: `errors=0`, `warnings=0`

No PLC download was performed.

## Root Cause Found

The old error feedback only exported `MC_ReadAxisError.AxisErrorID` to `arReg_data[38..47]`.

When a servo network cable is unplugged, communication can fail before the drive-side `AxisErrorID` is readable. In that case `MC_ReadAxisError.Error` and `MC_ReadAxisError.ErrorID` can be set while `AxisError` is still FALSE. The old logic cleared `AxisErrorID` when `AxisError=FALSE`, so the monitored error register stayed empty.

When a motor cable is unplugged, the first useful fault can also appear in `MC_Power.ErrorID` or `MC_ReadStatus.ErrorID`, not necessarily in `AxisErrorID`.

## Continuous Holding Registers

| Register | Direction | Meaning |
|---:|---|---|
| `arReg_data[32]` | Python/HMI -> PLC | Five-axis enable command. `0` disables all, nonzero enables all. |
| `arReg_data[33]` | PLC -> Python/HMI | X packed status word. |
| `arReg_data[34]` | PLC -> Python/HMI | Y packed status word. |
| `arReg_data[35]` | PLC -> Python/HMI | Z packed status word. |
| `arReg_data[36]` | PLC -> Python/HMI | B packed status word. |
| `arReg_data[37]` | PLC -> Python/HMI | C packed status word. |
| `arReg_data[38..39]` | PLC -> Python/HMI | X drive `AxisErrorID` from `MC_ReadAxisError.AxisErrorID`. |
| `arReg_data[40..41]` | PLC -> Python/HMI | Y drive `AxisErrorID`. |
| `arReg_data[42..43]` | PLC -> Python/HMI | Z drive `AxisErrorID`. |
| `arReg_data[44..45]` | PLC -> Python/HMI | B drive `AxisErrorID`. |
| `arReg_data[46..47]` | PLC -> Python/HMI | C drive `AxisErrorID`. |
| `arReg_data[48]` | PLC -> Python/HMI | AxisEnable request feedback. bit0..bit4 = X/Y/Z/B/C, bit15 = all TRUE. |
| `arReg_data[49..50]` | PLC -> Python/HMI | X `MC_ReadStatus.ErrorID`. |
| `arReg_data[51..52]` | PLC -> Python/HMI | Y `MC_ReadStatus.ErrorID`. |
| `arReg_data[53..54]` | PLC -> Python/HMI | Z `MC_ReadStatus.ErrorID`. |
| `arReg_data[55..56]` | PLC -> Python/HMI | B `MC_ReadStatus.ErrorID`. |
| `arReg_data[57..58]` | PLC -> Python/HMI | C `MC_ReadStatus.ErrorID`. |
| `arReg_data[59..60]` | PLC -> Python/HMI | X `MC_ReadAxisError.ErrorID`. |
| `arReg_data[61..62]` | PLC -> Python/HMI | Y `MC_ReadAxisError.ErrorID`. |
| `arReg_data[63..64]` | PLC -> Python/HMI | Z `MC_ReadAxisError.ErrorID`. |
| `arReg_data[65..66]` | PLC -> Python/HMI | B `MC_ReadAxisError.ErrorID`. |
| `arReg_data[67..68]` | PLC -> Python/HMI | C `MC_ReadAxisError.ErrorID`. |
| `arReg_data[69..70]` | PLC -> Python/HMI | X `MC_Power.ErrorID`. |
| `arReg_data[71..72]` | PLC -> Python/HMI | Y `MC_Power.ErrorID`. |
| `arReg_data[73..74]` | PLC -> Python/HMI | Z `MC_Power.ErrorID`. |
| `arReg_data[75..76]` | PLC -> Python/HMI | B `MC_Power.ErrorID`. |
| `arReg_data[77..78]` | PLC -> Python/HMI | C `MC_Power.ErrorID`. |
| `arReg_data[79]` | PLC -> Python/HMI | X `MC_Power` diagnostic word. bit0=Status, bit1=Error. |
| `arReg_data[80]` | PLC -> Python/HMI | Y `MC_Power` diagnostic word. |
| `arReg_data[81]` | PLC -> Python/HMI | Z `MC_Power` diagnostic word. |
| `arReg_data[82]` | PLC -> Python/HMI | B `MC_Power` diagnostic word. |
| `arReg_data[83]` | PLC -> Python/HMI | C `MC_Power` diagnostic word. |
| `arReg_data[84]` | PLC -> Python/HMI | Diagnostic version. `26081` means this diagnostic code is running. |
| `arReg_data[85]` | PLC -> Python/HMI | Enable mismatch bitmap. bit0..bit4 = X/Y/Z/B/C request TRUE but still Disabled. |
| `arReg_data[86]` | PLC -> Python/HMI | `MC_ReadStatus.Error` bitmap. |
| `arReg_data[87]` | PLC -> Python/HMI | `MC_ReadAxisError.Error` bitmap. |
| `arReg_data[88]` | PLC -> Python/HMI | `MC_ReadStatus.FBErrorOccured` bitmap. |

## Python Commands

Read once:

```powershell
python test_fivedofplat.py --read-axis-feedback
```

Watch continuously:

```powershell
python test_fivedofplat.py --watch-axis-feedback --watch-interval 0.5
```

Jog and print feedback continuously until manual stop:

```powershell
python test_fivedofplat.py --jog --axis 1 --direction fwd
```

Use `Ctrl+C` to stop jog and exit.
