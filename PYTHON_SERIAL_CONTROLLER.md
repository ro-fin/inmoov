# Python desktop controller

Double-click `LAUNCH_ARM_CALIBRATOR.bat` on the Desktop. It calls `LAUNCH_ARM_DESKTOP.bat` in this directory and runs Python 3.12. The machine's default Python 3.14 registration is broken, so the launcher explicitly selects the working 3.12 runtime.

No web server, browser or internet connection is required. Dependencies: Tkinter and pyserial (already installed).

## Communication flow

Desktop slider / home / playback → validated pulse within joint limits → serial worker → USB COM port at 115200 baud, 8N1 → Nano V4 → Servo library pulses on D2–D9 → servos.

Nano replies travel back through the same serial port. A single worker owns the port, verifies the V4 identity, sends one motion command at a time, and waits for the matching reply. Serial operations do not block the UI.

| Request | Reply / effect |
|---|---|
| `PING` | `PONG,ROBOATTIS,NANO,ARMS,8,115200,D2-D9,V4` |
| `SET,2,1500` | `OK,2,1500`; D2 receives a 1500 µs command |
| `OFF,2` | `OFF,2`; D2 pulses disabled |
| `ALL_OFF` | `ALL_OFF`; all eight outputs disabled |
| `STATUS` | Eight `STATE,pin,pulse` lines; 0 means off |
| `HEARTBEAT` | No reply; refreshes Nano communication watchdog |

Commands are ASCII and newline terminated. The desktop sends a heartbeat every 400 ms. V4 stops pulses after two seconds without communication. Serial errors, missing acknowledgements, or a stalled UI trigger output shutdown. Acknowledgements confirm commands, not physical motion or measured servo position.

Close/disconnect the browser controller or Arduino Serial Monitor before connecting; only one application can own a COM port. Refresh ports, select the Nano and click Connect Nano. Existing V4 firmware is compatible; no new upload is needed.

## Controls

Left and right arm tabs contain four named joints each. Enable at home starts one joint at its saved home pulse. Use the slider or ±5 µs adjustments. Set here as home saves the commanded pulse. Edit limits/home while that joint is off. Homes are local settings, not physical limit-switch homing.

Record captures starting commanded positions, subsequent commands and pauses. Finish recording, then Play; optional Loop repeats. Playback returns to its starting pose on every pass; verify the return path. Stop playback holds the last sent positions. Emergency off releases all outputs; support the arms mechanically.

Save session writes `arm_desktop_session.json` next to the script. Export/Import JSON is compatible with the eight-joint browser controller's exported sessions. Browser local storage is not transferred automatically: export it from the old controller and import the file here if needed.

## Wiring

Left: D2 omoplate, D3 rotate, D4 shoulder, D5 bicep.
Right: D6 omoplate, D7 rotate, D8 shoulder, D9 bicep.
Signals go to S; common ground to G. Supply servos externally at their rated voltage, with supply negative joined to Nano ground. Do not power eight arm servos from USB. D0/D1 remain serial; fingers/wrists are not included.
