# CLAUDE.md: RoboAttis InMoov Studio

Physical robot-arm controller (Arduino Nano V8 firmware, 8 servos on D2–D9) with a browser digital twin.
**SETUP.md is the full reference**: wiring, servo limits, safety, protocol and troubleshooting.

## Setting up on a fresh machine
1. Check for Python 3.12+ **with tkinter**: `python -c "import tkinter, sys; print(sys.version)"`. If it's missing,
   ask the user to install it from python.org (tick tcl/tk and Add to PATH). pyserial is vendored in `.runtime-packages/`.
2. Restore the JS deps: `cd digital_twin && npm.cmd ci --ignore-scripts --no-audit --no-fund`. Requires Node 18+.
   The page imports `./node_modules/three`, so the 3D view is blank without this step.
3. Run the tests (no hardware): `python -m unittest test_calibrator_motion test_arm_desktop test_twin_server test_session_pairing`
   with `PYTHONPATH=.runtime-packages` if pyserial isn't installed globally.
4. Offer to create a Desktop shortcut `.bat` that `call`s the repo's `LAUNCH_ARM_DESKTOP.bat` by absolute path.
   Never copy the launcher itself, because it needs `launch_studio.ps1` beside it.
5. Launch with `LAUNCH_ARM_DESKTOP.bat`, which serves http://127.0.0.1:8765. Logs: `studio-error.log`.
6. Firmware (only if needed, with servo power OFF): see SETUP.md §3 (`arduino-cli`, fqbn `arduino:avr:nano:cpu=atmega328`).

## Safety rules for any change
- **Never move servos without the user's explicit go-ahead.** `verify_nano_v8.py` sends only queries and output-off commands.
- `standalone_motion/left_arm_safety.json` holds the tested left-arm limits and homes. Do not widen limits,
  change left homes or reverse left joints. The code rejects these on purpose.
- The right arm (D6–D9) still uses the full 500–2500 µs range and is uncalibrated. Treat it as unsafe until calibrated.
- Before editing `arm_desktop_session.json`, back it up (`arm_desktop_session.before-<reason>-<timestamp>.json`).
- Keep twin visual direction separate from hardware reversal.

## Layout
- `twin_server.py` is the HTTP API plus serial owner. `arm_desktop.py` holds SerialLink, session validation and the 8 joint names.
- `calibrator_motion.py` is the bounded gesture planner (10 units / 250 ms, ack-gated). `serial_protocol.py` does CRC-16 frames.
- `digital_twin/` is the Three.js UI. `nano_arm_controller/` holds the current firmware. Everything else is legacy (see SETUP.md §1).
