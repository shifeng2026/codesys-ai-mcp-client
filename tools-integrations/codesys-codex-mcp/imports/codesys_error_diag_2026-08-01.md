# CODESYS Error Diagnostic Work Log

Date: 2026-08-01

## User-Reported Fault

During field testing, unplugging the servo network cable or motor cable caused the servo to report an error ID, but the CODESYS monitored error register was empty.

## Investigation

The existing PLC feedback wrote only `MC_ReadAxisError.AxisErrorID` to `arReg_data[38..47]`.

This is not enough for cable-disconnect diagnosis:

- Network cable unplug: communication can break first. `MC_ReadAxisError.ErrorID` can contain the useful function-block error, while `AxisErrorID` can remain zero.
- Motor cable unplug: the first useful error can appear in `MC_Power.ErrorID` or `MC_ReadStatus.ErrorID`.
- Old code cleared `dwAxisErrorX/Y/Z/B/C` when `AxisError=FALSE`, which erased the visible value in `[38..47]`.

## CODESYS Changes

Modified project copy:

`C:\path\FiveDofPlatform_error_diag.project`

Backup before modification:

`C:\logs\FiveDofPlatform_enable_control_before_error_diag_20260801_112411.project`

Final XML export:

`C:\path\export_error_diag\Machine.xml`

Generated import XML:

`C:\Users\29925\codesys-codex-mcp\imports\FiveDofPlatform.error_diag.fulltask.import.xml`

### Added Diagnostics

- `arReg_data[49..58]`: `MC_ReadStatus.ErrorID`.
- `arReg_data[59..68]`: `MC_ReadAxisError.ErrorID`.
- `arReg_data[69..78]`: `MC_Power.ErrorID`.
- `arReg_data[79..83]`: `MC_Power` status/error diagnostic word.
- `arReg_data[84]`: diagnostic version marker `26081`.
- `arReg_data[85]`: enable-request mismatch bitmap.
- `arReg_data[86]`: `MC_ReadStatus.Error` bitmap.
- `arReg_data[87]`: `MC_ReadAxisError.Error` bitmap.
- `arReg_data[88]`: `MC_ReadStatus.FBErrorOccured` bitmap.

### Logic Conflict Fixed In Copy

`JogX..JogC` previously had local `xServoEnable := TRUE`, so jog-side `MC_Power` could keep requesting enable even when five-axis total enable was turned off. The diagnostic copy now writes:

```iecst
xServoEnable := GVL.Axes[n].AxisEnable;
```

This makes jog power follow `arReg_data[32]`.

## Verification

CODESYS rebuild:

- `ok=true`
- `errors=0`
- `warnings=0`

Python mock test:

- `python test_fivedofplat.py`
- Result: `five-axis jog register tests ok`

Python read-only PLC check:

- `python test_fivedofplat.py --read-axis-feedback`
- The currently running PLC still reports diagnostic version `0`, so `[49..88]` are not active on the running controller yet.

No PLC download, run, or stop command was executed.
