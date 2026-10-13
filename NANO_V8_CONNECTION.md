# Nano Arms V8 connection

Launch `LAUNCH_ARM_DESKTOP.bat`. Firmware is
`nano_arm_controller/nano_arm_controller.ino`, 115200 baud. V8 firmware and
controller must be used together.

The digital-twin calibrator now defaults to **Compatibility · direct pulses**,
matching the earlier controller's `SET,pin,pulse_us` messages. The computer still
converts each joint's slider and direction to a bounded pulse. The left arm uses
home-relative command units and the tested limits listed in INMOOV_STUDIO.md.
**Verified frames** remains available in the connection dialog for comparison.
Both modes keep the port open between commands. DTR/RTS are configured inactive
before opening, and are never changed for a movement command. OS/driver behavior
can still cause a transition when a port is opened.

| Joint | Left signal / direction | Right signal / direction |
|---|---|---|
| Omoplate | D2 / normal | D6 / reversed |
| Rotate | D3 / normal | D7 / reversed |
| Shoulder | D4 / normal | D8 / reversed |
| Bicep | D5 / normal | D9 / reversed |

The left-arm homes are 1600, 1500, 1626 and 1604 µs on D2–D5. Their respective
limits are 1389–1604, 1204–1685, 1093–1856 and 1004–1604 µs. The left homes
and hardware directions are fixed to this tested profile; settings and imports
cannot widen those limits. Existing right-arm profiles retain their previous
controls and reversals. Robot-mode hand signs now run through the existing
serial link, with Loop, Stop loop and Return home controls in the Motion tab.
Twin visual reversal is separate from hardware reversal and never changes pulses.
Servo power comes from an external supply with a shared ground to the Nano.

In Verified frames mode, the serial worker uses CRC-16/CCITT frames to identify each
command by sequence: `@sequence,payload*CRC`. It accepts only matching, intact
replies. A lost reply triggers at most three retries after 350 ms each; a duplicate
command returns its cached reply. Stale control sequences are rejected so an old
movement cannot override a newer stop. Heartbeat requests and replies use sequence
0 every 400 ms. Normal commands are sent immediately, without waiting for a heartbeat.

USB/serial failures reconnect automatically to the same USB VID/PID/serial number,
even if the COM number changes. Retry waits grow from 0.5 to 3 seconds. Queued motion
and playback are cleared; the controller verifies firmware and an all-off reply
before marking the connection ready. Servos require explicit enabling afterwards.
Disconnect ends automatic reconnection. Wrong firmware is reported rather than
repeatedly connecting to an incompatible sketch.

Temporary driver read/write errors retry the existing serial handle for up to
300 ms, without closing the port or toggling the Nano reset line. If Windows
removes the USB device, that handle cannot stay usable; the controller waits
for the same device and opens a fresh connection. The UI distinguishes a missing
USB device from a command retry. Enabling a joint remains required after recovery.

A browser worker sends a heartbeat independently of 3D rendering. Brief polling
gaps keep the serial port open. Six seconds without browser contact turns outputs
off while keeping USB connected; restoring browser contact does not resume motion.
The Nano's separate 2-second serial watchdog remains active.

`verify_nano_v8.py --port COM3` tests checksums, duplicates, stale sequences, normal
and reversed angle conversions, and 600 heartbeat/query pairs. It issues only
queries and output-disable commands. Results are in `nano_v8_verification.json`.

Software can reconnect after a USB interruption; it cannot prevent a supply drop,
physical USB disconnect, or board fault. The observed Windows ClearCommError after
a movement indicates a USB/driver interruption, rather than a bad angle mapping.
