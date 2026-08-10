# CODESYS MCP Project Read Process

This note records the working process used on 2026-07-31 to read:

`C:\Users\29925\Documents\修改资料\FiveDofPlatform.project`

## What Worked

1. Validate the MCP setup first:

   `codesys_validate_setup`

2. Locate the actual `.project` file. The user-provided path may be a project base name, not a directory.

   For `FiveDofPlatform`, the real file was:

   `C:\Users\29925\Documents\修改资料\FiveDofPlatform.project`

3. Avoid passing Chinese/non-ASCII project paths directly into CODESYS ScriptEngine. In this run, CODESYS reported the Chinese path as missing even though PowerShell could see it.

4. Copy the project file and same-prefix sidecar files to an ASCII-only temp path before using the MCP tool:

   Source:

   `C:\Users\29925\Documents\修改资料\FiveDofPlatform*`

   Temp target:

   `C:\Users\29925\AppData\Local\Temp\codesys_ascii\FiveDofPlatform\`

5. Read project info from the temp copy:

   Tool:

   `codesys_project_info`

   Arguments:

   ```json
   {
     "projectPath": "C:\\Users\\29925\\AppData\\Local\\Temp\\codesys_ascii\\FiveDofPlatform\\FiveDofPlatform.project",
     "profile": "CODESYS V3.5 SP20 Patch 4",
     "noUI": false,
     "timeoutSec": 300
   }
   ```

6. If the MCP tool call times out, check the latest result JSON manually:

   `C:\Users\29925\AppData\Local\Temp\codesys-codex-mcp\jobs\*.result.json`

   In this run the MCP call timed out, but CODESYS still wrote a successful result file.

## Known CODESYS Setup

- CODESYS executable:

  `C:\Program Files\CODESYS 3.5.20.40\CODESYS\Common\CODESYS.exe`

- Installed profile:

  `CODESYS V3.5 SP20 Patch 4`

- Profile file:

  `C:\Program Files\CODESYS 3.5.20.40\CODESYS\Profiles\CODESYS V3.5 SP20 Patch 4.profile.xml`

## Observed Issues

- `noUI: true` failed with a CODESYS message saying `--noUI` requires `--profile`, even when the profile argument was supplied through MCP.
- Direct Chinese path failed inside CODESYS ScriptEngine with `projectPath does not exist`.
- `noUI: false` may exceed the MCP timeout, but the result file can still be written successfully.
- For direct `CODESYS.exe` noUI calls on this machine, the profile value must keep embedded quotes:

  ```powershell
  & 'C:\Program Files\CODESYS 3.5.20.40\CODESYS\Common\CODESYS.exe' `
    '--profile="CODESYS V3.5 SP20 Patch 4"' `
    --noUI `
    '--runscript=C:\Users\29925\AppData\Local\codesys-codex-mcp\scripts\codesys\codesys_job.py' `
    '--scriptargs:C:\Users\29925\AppData\Local\Temp\codesys-codex-mcp\jobs\<job>.json'
  ```

- The MCP import helper needed the CODESYS ScriptEngine import overload with reporter second:

  ```python
  project.import_xml(path, reporter)
  project.import_native(path, reporter)
  ```

  Keep fallback overloads after these for compatibility.

- A CODESYS noUI command can return before the result JSON appears. Check for the expected result file after a short delay before treating it as failed.

## Modification Workflow Confirmed On 2026-07-31

This workflow was used to add `AxisStatusFeedback_PRG` to `C:\path\FiveDofPlatform.project` without downloading to a PLC:

1. Create a PLCopenXML import file under an ASCII path.
2. Import it into a temp copy of the project.
3. Export the temp project and verify the new object/text is present.
4. Rebuild the temp project and require `errors: 0`.
5. Back up the real project to `C:\Users\29925\AppData\Local\Temp\codesys_axis_status\FiveDofPlatform_before_axis_status.project`.
6. Import the same XML into the real project and save.
7. Rebuild the real project and require `errors: 0`.
8. Export the real project to `C:\path\export\Machine.xml` for review.

## Task Call Import Notes

- Importing a small PLCopenXML file with `<instances>` did create the PRG POU, but did not merge the new `<pouInstance>` into the existing `MainTask`.
- Importing a full project XML with the desired task instance can create a donor top-level object such as `Device_1` and can also create duplicate POU names such as `AxisStatusFeedback_PRG_1`.
- The confirmed repair workflow is:

  1. Import the full donor XML.
  2. Move the donor task call object from donor `MainTask` to the original `MainTask`.
  3. Remove the donor branch, for example `Device_1`.
  4. Remove duplicate donor POU objects such as `AxisStatusFeedback_PRG_1`.
  5. Export and confirm `MainTask` contains one call in the desired order.
  6. Rebuild and require `errors: 0`.

- Confirmed final `MainTask` order for the axis feedback change:

  ```text
  FiveDOF_Platform_PRG
  LogConsumer
  PLC_PRG
  AxisStatusFeedback_PRG
  ModbusTcpSlave
  ```

## Result From FiveDofPlatform

- Active application: `Application`
- Top-level objects:
  - `Project Settings`
  - `Device`
  - `GlobalTextList`
  - `Library Manager`
  - `__VisualizationStyle`
- Device children:
  - `Plc Logic/Application`
  - `EtherCAT_Master_SoftMotion`
  - `SoftMotion General Axis Pool`
- EtherCAT slave/device nodes:
  - `LC10E_V1_04_1`
  - `LC10E_V1_04`
  - `LC10E_V1_04_4`
  - `LC10E_V1_04_6`
  - `LC10E_V1_04_7`
