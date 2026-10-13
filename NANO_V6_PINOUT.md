# Nano Arms V6 — D3 unused

Historical V6 configuration. The current [V7 guide](NANO_V7_PINOUT.md) restores
consecutive channels D2–D9, including D3.

Current digital-twin firmware: `nano_arm_controller/nano_arm_controller.ino`.
Launch the calibrator with `py -3.12 twin_server.py`.

Rewire the servo signal leads with servo power off:

| Joint | Left arm signal | Right arm signal |
|---|---|---|
| Omoplate | D2 | D7 |
| Rotate | D4 | D8 |
| Shoulder | D5 | D9 |
| Bicep | D6 | D10 |

D3 is faulty and excluded from all commands. D0/D1 remain reserved for serial.
Use an external supply suitable for the servos; connect its ground, servo grounds
and Nano GND together. Do not power the servos from the Nano 5V pin.

All eight default angle ranges are 0–270°, mapped to 500–2500 µs
(135° = 1500 µs). These are commanded angles; this system has no angle feedback.
Individual calibrated limits and home pulses are preserved when migrating.
The firmware and calibrator start with outputs off. Enable one joint when ready.

V6 requires the new pin mapping in both firmware and calibrator. Legacy version-1
sessions and recorded events migrate by joint to version 2, including D9 → D10.
`migrate_pinmap.py` backs up the local session before rewriting it.
Older standalone Nano/Mega controllers and the V5 guide use different pinouts.

Compile/upload for a classic Nano with the new bootloader:

```
arduino-cli compile --fqbn arduino:avr:nano:cpu=atmega328 --build-path build-nano-arms-v6 nano_arm_controller
arduino-cli upload -p COM11 --fqbn arduino:avr:nano:cpu=atmega328 --input-dir build-nano-arms-v6
```

`py -3.12 verify_nano_v6.py` checks identity, all eight angle mappings, rejection
of D3 and outputs-off status without commanding any valid servo movement.
