# CODESYS safety baseline

Read-only monitoring only. CODESYS integration may capture a complete visible window and stream frames, but must never download to a PLC, write variables, start or stop a controller, debug, set breakpoints, single-step, or Force.

Complete-frame capture is required before a frame enters the live stream. Minimized or off-screen windows are reported as unavailable rather than moved or restored by TaskHive.
