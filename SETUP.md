# RoboAttis InMoov Studio: Full Setup & Reference

This is the complete guide for moving the InMoov arm controller and digital twin to a new Windows PC.
`LAUNCH_ARM_DESKTOP.bat` is the entry point. Every other file in this repository supports it.

> Setting up with Claude Code? Clone the repo, open a terminal in it, run `claude`, and say
> *"set this project up following SETUP.md and CLAUDE.md"*.

---

## 1. What this is

| Part | File(s) | Role |
|---|---|---|
| Launcher | `LAUNCH_ARM_DESKTOP.bat` → `launch_studio.ps1` | Finds Python, starts the service, waits for it, then opens Edge |
| Studio service | `twin_server.py` (+ `arm_desktop.py`, `calibrator_motion.py`, `serial_protocol.py`, `session_pairing.py`) | Local HTTP API at `http://127.0.0.1:8765`; owns the serial port and enforces safety |
| Digital twin (browser UI) | `digital_twin/` (`index.html`, `app.js`, `twin.js`, `stage.js`, `motion.js`, `safety-controls.js`, `link-heartbeat.js`, `control-access.js`, …) | Three.js 3D InMoov model, calibration panel, gestures, Full view |
| Firmware | `nano_arm_controller/nano_arm_controller.ino` | Arduino Nano **Arms V8**: 8 servo outputs on D2–D9, 115200 baud |
| Safety profile | `standalone_motion/left_arm_safety.json` | Tested left-arm limits, homes and gesture poses (the **source of truth**) |
| Saved calibration | `arm_desktop_session.json` | Current pulse limits / homes / reversal for all 8 joints (+ timestamped backups) |
| Standalone scripts | `standalone_motion/hi_loop.py`, `home_joint.py` | Gesture loop and single-joint home return without the UI |
| Pairing | `PAIR_ARM_CALIBRATOR.bat` → `pair_studio.py` | 8-digit code to authorise a browser tab opened manually |
| Legacy | `LAUNCH_LEGACY_ARM_DESKTOP.bat` (`arm_ui.py`), `nano_calibrator.*`, `arm_calibrator.*`, `roboattis_inmoov_calibration.html`, `mega_pca9685_servo_controller/` | Older UIs and firmware variants, kept for reference |

Launch flow:
```
LAUNCH_ARM_DESKTOP.bat
  └─ powershell launch_studio.ps1
       ├─ choose a Python that can `import tkinter, serial` (PYTHONPATH=.runtime-packages supplies pyserial)
       ├─ if Studio is not already running: start  python -u twin_server.py --no-browser  (hidden window)
       │     logs → studio-output.log / studio-error.log, token → studio_runtime.json
       ├─ poll GET /api/state with X-Studio-Token until 8 profiles are reported (25 s timeout)
       └─ open_studio.py → Edge --new-window http://127.0.0.1:8765/#token=…&tab=control&view=calibrator
```
Running the launcher again reuses the existing service.

---

## 2. Requirements on the new PC

| Need | Version | Notes |
|---|---|---|
| Windows 10/11 | | The launcher uses PowerShell and Edge |
| **Python** | 3.12+ (3.14 tested) | Must include **tkinter**. The python.org installer includes it by default. Do **not** rely on the Microsoft Store stub. |
| pyserial | 3.5 | Already in `.runtime-packages/`. Alternatively run `python -m pip install pyserial==3.5`. |
| Microsoft Edge (or any WebGL browser) | | `open_studio.py` prefers Edge, else the default browser |
| **Node.js** | 18+ | Only for restoring `digital_twin/node_modules` (three.js) and running UI tests |
| Arduino CLI or Arduino IDE | | Only to flash the Nano. Core: `arduino:avr`; library: `Servo` (built in) |
| CH340 USB driver | | Only if the Nano clone isn't recognised as a COM port |

The launcher tries Python in this order: `%LOCALAPPDATA%\Programs\Python\Python312`, the Codex runtime,
`D:\Python314\python.exe`, `python`/`python3` on PATH, and finally `py -3`. It takes the first one where
`import tkinter, serial` succeeds.

---

## 3. Setup steps (new device)

```powershell
# 1. Clone
git clone <REPO_URL> C:\Users\<you>\ServoController
cd C:\Users\<you>\ServoController

# 2. Python (if missing): install Python 3.12+ from python.org, ticking "Add to PATH" + "tcl/tk"
python -c "import tkinter, sys; print(sys.version)"
#    pyserial is vendored; to install globally instead:
python -m pip install pyserial==3.5

# 3. Restore the 3D libraries (three.js 0.180.0, urdf-loader 0.12.6) — required, the page imports ./node_modules/three
cd digital_twin
npm.cmd ci --ignore-scripts --no-audit --no-fund
cd ..

# 4. Run the tests (no hardware needed, nothing moves)
python -m unittest test_calibrator_motion test_arm_desktop test_twin_server test_session_pairing

# 5. Launch
.\LAUNCH_ARM_DESKTOP.bat
```

**Desktop shortcut:** do not copy `LAUNCH_ARM_DESKTOP.bat` itself onto the Desktop. It `cd`s to its own
folder and needs `launch_studio.ps1` next to it. Create a small Desktop `.bat` that calls the real one instead:
```bat
@echo off
call "C:\Users\<you>\ServoController\LAUNCH_ARM_DESKTOP.bat"
```
(On the old PC this was `Desktop\LAUNCH_ARM_CALIBRATOR.bat`.)

### Flash the firmware (only if the Nano isn't already running V8)
Disconnect **servo power** first, then:
```powershell
arduino-cli core install arduino:avr
arduino-cli compile --fqbn arduino:avr:nano:cpu=atmega328 --build-path build-nano-arms-v8 nano_arm_controller
arduino-cli upload  -p COM3 --fqbn arduino:avr:nano:cpu=atmega328 --input-dir build-nano-arms-v8
```
For a Nano with the **old bootloader** (common on clones), use `cpu=atmega328old`. Check the port in Device Manager.

Verify, using queries and output-off commands only (no motion):
```powershell
python verify_nano_v8.py --port COM3      # writes nano_v8_verification.json
```
Expected identity: `PONG,ROBOATTIS,NANO,ARMS,8,115200,D2-D9,V8`.

---

## 4. Hardware & wiring

**Board:** Arduino Nano (ATmega328P), USB serial 115200 baud. D0/D1 are reserved for serial; D10+ are unused.

| Joint | Left arm pin | Left direction | Right arm pin | Right direction |
|---|---|---|---|---|
| Omoplate | **D2** | normal | **D6** | reversed |
| Rotate | **D3** | normal | **D7** | reversed |
| Shoulder | **D4** | normal | **D8** | reversed |
| Bicep | **D5** | normal | **D9** | reversed |

**Servos:** 270° positional servos. The default mapping is 0° / 135° / 270° → 500 / 1500 / 2500 µs.
Firmware clamps every pulse to 500–2500 µs.

**Power (important):**
- Power the servos from a **separate regulated supply** (normally 5–6 V; check your servo datasheet). Never power them from the Nano 5V pin or USB.
- **Join the grounds:** servo-supply negative, servo GND and Nano GND must be common.
- Size the supply from the sum of servo **stall currents** plus margin. High-torque servos can exceed 1 A each.
- Add bulk capacitance near the servo power rail (about 100 µF per simultaneously moving servo as a starting point; observe polarity and voltage rating).
- Servo lead colours: signal = yellow/orange/white → Dx, red → V+, brown/black → GND.

---

## 5. Servo angles, limits and homes

### 5.1 Left arm (tested, locked profile)

From `standalone_motion/left_arm_safety.json` and `arm_desktop_session.json`:

| Joint | Pin | Min µs | Max µs | **Home µs** | Old command home | Old command range | Studio slider (home = 0) |
|---|---|---|---|---|---|---|---|
| Omoplate | D2 | 1389 | 1604 | **1600** | 149 | 120 (up) – 149 | 0 → +29 |
| Rotate | D3 | 1204 | 1685 | **1500** | 135 | 95 (outer) – 160 (inner) | −25 → +40 |
| Shoulder | D4 | 1093 | 1856 | **1626** | 152 | 80 (forward) – 183 (back) | −31 → +72 |
| Bicep | D5 | 1004 | 1604 | **1604** | 149 | 68 lift units | 0 → 68 (lift) |

- Slider values are **command units, not measured joint degrees** (there is no encoder).
- Positive offsets lift/open the arm or turn rotation outward. A **decreasing pulse lifts** the left arm.
- Bicep: display 0 = 1604 µs (home), display 68 = 1004 µs (max lift), linear in between.
- Old-command → pulse conversion (D2–D4): `pulse = round(500 + value × 2000 / 270)`.
- D2 keeps its exact 1600 µs home anchor; the old display rounded it to 149.
- The software **rejects** wider limits, changed left homes and reversed left directions, including in imports. Narrower limits can be saved.
- `physical_home_confirmed` is still `false` for the bicep. Confirm the physical home before running gestures.

### 5.2 Right arm (not yet calibrated)

| Joint | Pin | Min µs | Max µs | Home µs | Reversed |
|---|---|---|---|---|---|
| Omoplate | D6 | 500 | 2500 | 1500 | yes |
| Rotate | D7 | 500 | 2500 | 1500 | yes |
| Shoulder | D8 | 500 | 2500 | 1500 | yes |
| Bicep | D9 | 500 | 2500 | 1500 | yes |

⚠️ These are the **full servo range**, not safe mechanical limits. Calibrate each right-arm joint
(Section 7) before relying on it. With the joint released, narrow the limits until the joint cannot hit
its hard stops.

### 5.3 Hand-sign gesture poses (left arm, µs for D2, D3, D4, D5)

| Gesture | Pose(s) | Hold | Notes |
|---|---|---|---|
| Home | 1600, 1500, 1626, 1604 | | Start and end of every gesture |
| **Hi** | A = 1500, 1426, 1352, 1389 · B = 1463, 1574, 1315, 1352 | 1 s | Raise with bent elbow, 2 × A→B→A waves |
| **Stop sign** | 1537, 1500, 1315, 1389 | 3 s | Forward raised arm |
| **Go left** | 1463, 1352, 1463, 1537 | 3 s | Points toward the robot's own left, elbow fairly straight |
| **Hi → Stop → Go left** | all three in order | | About 21 s per cycle |

Live Studio timing uses steps of at most **10 command units every 250 ms**. Each step waits for all four
acknowledgements, and late acks never cause catch-up jumps. Approximate cycle times: Hi 7 s, Stop 7.5 s,
Go left 6.5 s. Wrist and fingers are **not driven**, so arrange the open hand and palm by hand.

---

## 6. Safety guide (read before powering servos)

**Before power-up**
1. Flash or upload firmware with servo power **disconnected**.
2. Check wiring against Section 4 and confirm common ground.
3. Close the Arduino Serial Monitor and the legacy controller. Only one program can own the COM port.
4. Clear the robot's swing area of people, cables and objects.
5. Keep a hand near the servo supply switch. That is the real emergency stop.

**Firmware protections (Nano V8)**
- All outputs are **off at boot** (`BOOT,ARMS,V8`) and on connection. Nothing moves until explicitly enabled.
- Before attaching, the firmware preloads the requested pulse so no default-centre jump occurs.
- **2-second serial watchdog**: with no contact for 2 s, all outputs turn off (`TIMEOUT,ALL_OFF`).
- Pulses outside 500–2500 µs are rejected. Malformed or overlong lines are rejected.
- Verified-frame mode uses CRC-16/CCITT, sequence numbers, duplicate caching and stale-sequence rejection,
  so a corrupted or old command can never move a servo.

**Studio protections**
- **Preview mode never sends servo commands.** Always start there.
- Enable one joint at a time, at its saved home. Confirm physical home before enabling released joints for a gesture.
- **Emergency off** (button, or Escape in the normal layout) releases all outputs.
- **Browser heartbeat**: if the browser stops polling for 6 s, outputs turn off. Motion never resumes automatically.
- After a USB drop the service auto-reconnects (same VID/PID/serial, retry delay 0.5→3 s). It clears queued
  motion and requires an all-off reply. **Joints must then be re-enabled by hand.**
- During gestures, manual controls, recording and edits are locked. The right arm must be released before a
  left-arm gesture. **Stop loop / Escape** cancels; **Return home / Alt+H** does a bounded stepped return.
- Twin visual inversion (*Twin calibration → Invert twin direction only*) never changes hardware pulses.
  Keep visual direction and hardware direction separate.

**Limits of software safety:** software cannot prevent a supply drop, a physical USB pull, a stalled servo
or a board fault. Use the power switch.

---

## 7. Using Studio

1. Run `LAUNCH_ARM_DESKTOP.bat`. Edge opens on the Calibration panel.
2. Start in **Preview**: select a joint, move the slider, drag to orbit and scroll to zoom.
3. **Connect robot**, then choose the Nano's COM port. *Compatibility · direct pulses* (`SET,pin,us`) is the
   default; *Verified frames* uses CRC framing.
4. **Enable** one joint at its home and move it in small steps. The readout shows the requested pulse, and the
   ack line and model update from Nano replies.
5. **Calibration & limits**: edit min/max/home/reverse only while the joint is **released**, then **Save session**
   (writes `arm_desktop_session.json`). Import and export use the same 8-joint format (version 3).
6. **Motion → Robot hand signs**: Hi / Stop sign / Go left / sequence (Alt+1–4). *Repeat until stopped* loops.
7. **Full view**: an immersive Finstein-cabin view with Emergency off still visible. Escape returns to Studio.

Tab opened by hand at `http://127.0.0.1:8765`? Run `PAIR_ARM_CALIBRATOR.bat` and enter the 8-digit code in
*Restore control session*. Codes work once, expire after 10 min and lock after 5 failed attempts.

### Calibrating a new joint (e.g., the right arm)
1. Keep servo power off and the joint released. Set conservative limits, for example 1300–1700 µs.
2. Power on, enable at home and step outwards slowly. Note the pulse where the joint approaches its mechanical stop.
3. Set min/max a safe margin **inside** those stops, set home to the rest pose, and set *Reverse* if the motion is mirrored.
4. Release, Save session, and back up the file. `migrate_pinmap.py` makes timestamped backups automatically.

---

## 8. Serial protocol (Nano V8, 115200 baud, newline-terminated ASCII)

| Command | Reply | Effect |
|---|---|---|
| `PING` | `PONG,ROBOATTIS,NANO,ARMS,8,115200,D2-D9,V8` | Identity (read-only) |
| `VERSION` | `VERSION,ARMS,V8,270DEG,CRC16` | Read-only |
| `STATUS` | 8 × `STATE,pin,us` (0 = off) | Read-only |
| `HEARTBEAT` | `ALIVE` | Feeds the watchdog |
| `SET,pin,us` | `OK,pin,us` | Drive pin at 500–2500 µs |
| `ANGLE,pin,mdeg,angAtMin,angAtMax,minUs,maxUs` | `OK,pin,us` | Angle (millidegrees) → pulse, linear |
| `CHECK_ANGLE,…` | `CALC,pin,us` | Same calculation, no motion |
| `OFF,pin` | `OFF,pin` | Release one output |
| `ALL_OFF` | `ALL_OFF` | Release all |

Framed form: `@sequence,payload*CRC16HEX`. Sequence 0 is reserved for HEARTBEAT. Errors: `ERR,EMPTY_FIELD`,
`ERR,COMMAND_OR_PIN`, `ERR,COMMAND_OR_PULSE`, `ERR,ANGLE_OR_CALIBRATION`, `ERR,TOO_LONG`, `ERR,RESERVED_SEQUENCE`,
`ERR,SEQUENCE_REUSE`, `ERR,STALE_SEQUENCE`.

---

## 9. Troubleshooting

| Symptom | Fix |
|---|---|
| "Python 3.12+ with Tkinter and pyserial is required" | Install python.org Python with tcl/tk, then reopen the terminal |
| "Studio could not start" or "did not become ready" | Read `studio-error.log`. Port 8765 may be in use: close the old `python` process or reboot |
| Blank or grey 3D view | `digital_twin/node_modules` is missing, so run `npm.cmd ci` in `digital_twin`. Then use *Reload 3D view* |
| Handshake fails or "wrong firmware" | Flash `nano_arm_controller.ino` (V8) and close Serial Monitor or other apps using the port |
| COM number changed | Normal after replugging. Choose the new port; auto-reconnect matches by USB serial |
| Servos twitch or the Nano resets when moving | The supply is too weak or grounds aren't shared. Use a separate supply, common GND and capacitors |
| Windows `ClearCommError` after movement | USB/driver interruption (often power-related), not an angle-mapping bug. See `usb_drop_diagnostic.json` |
| `ConnectionResetError 10054` in studio-error.log | Harmless. The browser closed a connection |
| Legacy launcher fails (`py -3.12`) | Use `python arm_ui.py` instead, with any Python 3.12+ |

---

## 10. Tests & verification

```powershell
python -m unittest test_calibrator_motion test_arm_desktop test_twin_server test_session_pairing
python -m unittest discover standalone_motion -p "test_*.py"
node digital_twin/verify-safe-gestures.mjs     # with Studio running; mocked movement, no hardware motion
python verify_nano_v8.py --port COM3           # hardware link check, queries + output-off only
```

---

## 11. Repository notes

- **Not in git (regenerate):** `digital_twin/node_modules/` (`npm ci`) and `build-*/` firmware builds (`arduino-cli compile`).
- **Per-run files (ignored):** `studio_runtime.json` (new auth token each launch) and `studio-*.log`.
- **3D assets:** `digital_twin/assets/` holds the VinMoov body (`original/`), official i2 head/hand STLs (`inmoov-v2/`),
  reference sources (`reference/`), the Finstein cabin (`finstein/`, `interior/`) and source archives. See
  `digital_twin/ASSEMBLY.md`, `ROOM_SOURCES.md` and `RESEARCH.md`.
- **Other docs:** `INMOOV_STUDIO.md` (Studio behaviour detail), `NANO_V8_CONNECTION.md`, `NANO_V7_PINOUT.md`, `README.md`
  (older Nano/Mega variants), `BOTH_ARMS_SETUP.md`, `PYTHON_SERIAL_CONTROLLER.md`, `NANO_V5_CALIBRATION.md` (historical).

## 12. Licences

- InMoov is by Gaël Langevin (inmoov.fr). InMoov-derived meshes are **CC BY-NC 4.0**: attribution required,
  **non-commercial use only**.
- `assets/reference/inmoov_ros_sim-master` project files are GPL-3.0 (see its README, LICENSE and ATTRIBUTION.md).
- Three.js 0.180.0 (MIT), urdf-loader 0.12.6 (Apache-2.0) and Playwright (Apache-2.0, dev only).
