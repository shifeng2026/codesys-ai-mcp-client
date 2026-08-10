# Axis enable control conflict review

## Conflicts found

1. `FiveDOF_Platform_PRG` forced every axis enable request to TRUE every scan:
   `FOR i := 1 TO AXIS_COUNT BY 1 DO Axes[i].AxisEnable := TRUE; END_FOR`

   This conflicts with a Modbus disable command because the next scan turns all axes back on.
   In the modified copy, this forced-write block is removed and ownership is moved to
   `AxisEnableControl_PRG`.

2. Existing `arReg_data[19]` is already used for jog mode bits X/Y/Z/B/C.
   The previous status map used `[16]`, `[17]`, `[18]`, `[20]`, `[21]`, leaving a gap at `[19]`.
   In the modified copy, the new contiguous block starts at `[32]` to avoid the existing jog area.

## No direct conflict found

- Single-axis programs already use `GVL.Axes[n].AxisEnable` as `MC_Power.bRegulatorOn`
  and `MC_Power.bDriveStart`, so no second `MC_Power` block was added.
- `arReg_data[100]` and above are used by log output and are not touched.
- CODESYS MCP tools used here only import/export/build. No PLC download, run, or stop action is used.

## Behavior change to confirm

- `arReg_data[32] = 0` now means all five axis enable requests are FALSE.
- `arReg_data[32] <> 0` now means all five axis enable requests are TRUE.
- Because the old forced TRUE block is removed, the PLC no longer enables axes by default unless
  the Modbus/HMI side writes a non-zero value to `arReg_data[32]`.
