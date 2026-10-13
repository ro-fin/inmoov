# Nano Arms V7 wiring

V8 now uses the same wiring and directions with a stronger connection protocol;
see [the current V8 guide](NANO_V8_CONNECTION.md).

| Joint | Left arm signal | Right arm signal |
|---|---|---|
| Omoplate | D2 | D6 |
| Rotate | D3 | D7 |
| Shoulder | D4 | D8 |
| Bicep | D5 | D9 |

V7 restores consecutive channels, including D3. Rewire signal leads with servo
power off. D0/D1 are reserved for serial; D10 is unused by this controller.
Servo power comes from a suitable external supply; connect servo/supply ground
and Nano GND together.

Firmware: `nano_arm_controller/nano_arm_controller.ino`, serial 115200 baud.
All eight default angle ranges remain 0–270°, mapped to 500–2500 µs.
Calibrated pulse limits and homes are preserved. Outputs stay off at boot and
connection. Commands specify an expected angle; there is no encoder feedback.

Launch `LAUNCH_ARM_DESKTOP.bat`. Refresh ports and choose the connected Nano.
The USB COM number can change after reconnecting. The Nano must run Arms V7;
other sketches will not pass the controller handshake.

Each joint has its own **Reverse this servo** switch in **Pulse limits & home**.
Release the joint before changing direction, then save the session. Reversal
swaps commanded pulse direction and acknowledged-pulse conversion together,
so the same intended movement still matches the twin. The mirrored joint axes
in the 3D model remain independent of the physical servo direction. Direction
is selected according to mounting; it is not assumed for an entire side.
The current saved configuration uses normal direction for all four left-arm
servos and reversed direction for all four right-arm servos, as requested.

Version-1 and version-2 sessions migrate by joint to version 3, including recorded
events. `migrate_pinmap.py` backs up the local session before changing it.
The earlier V5/V6 guides describe historical configurations.

Compile/upload for a classic Nano with the new bootloader:

```
arduino-cli compile --fqbn arduino:avr:nano:cpu=atmega328 --build-path build-nano-arms-v7 nano_arm_controller
arduino-cli upload -p COM3 --fqbn arduino:avr:nano:cpu=atmega328 --input-dir build-nano-arms-v7
```

`verify_nano_v7.py --port COM3` checks the handshake, all eight angle mappings and
outputs-off status without enabling servos.
