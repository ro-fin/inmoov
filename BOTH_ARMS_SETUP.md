# Both Arms Studio — Nano expansion shield

Prepared for eight arm joints, four per side. This does not include fingers or wrists.
The separate V4 sketch is `nano_arm_controller/nano_arm_controller.ino`.
Launch `LAUNCH_BOTH_ARMS.bat` after the V4 firmware has been uploaded.
The older controller and firmware have been preserved.

## Identify by the driven mechanism

InMoov distinguishes omoplate, shoulder, rotate and bicep. Physical descriptions such as top/front/underarm are useful hints but depend on the assembly orientation. Trace each cable to its motor and mechanism before labeling it.

| Joint | Mechanism | Robot's left arm | Robot's right arm |
|---|---|---|---|
| Omoplate | Scapula/clavicle mechanism; your top-servo label | D2 | D6 |
| Rotate | Axial upper-arm rotation; not the shoulder pivot | D3 | D7 |
| Shoulder | Shoulder pivot / arm raising mechanism; your underarm label | D4 | D8 |
| Bicep | Elbow bending / forearm lift | D5 | D9 |

Left and right mean the robot's own sides (your left/right while standing behind it).
This is a custom one-Nano mapping, not the original InMoov/NervoBoard pin allocation.
D0/D1 remain USB serial. D10–D13 are unused by this firmware.

Sources: https://inmoov.fr/shoulder-and-torso/ and https://inmoov.fr/bicep/
The diagram identifies mechanisms, not the model, pulse limits, direction or voltage of your installed servos.

## Electrical connection

Disconnect servo power before moving plugs. S is signal (usually white/yellow/orange), G is ground (usually black/brown), V is positive (usually red). Use the printed letters rather than assuming the header orientation.

For eight arm servos, route servo red wires to an external regulated supply/distribution block rated for the servo models and total current. Route servo grounds to supply negative and join that negative to Nano GND. Route each signal to the S header in the table. Do not power eight arm servos through the Nano, USB, or assume the shield's onboard regulator can supply them.

If using the shield's V rail, first verify its power-selection/isolation circuit and current rating. Do not connect an external positive supply to the V rail while it remains tied to USB 5 V. The barrel jack's input voltage is not necessarily the servo V-rail voltage.

## First upload and calibration

1. Support the arms mechanically and leave external servo power disconnected. Earlier firmware found in this workspace automatically centers every servo on reset; opening a serial connection can reset a Nano.
2. Wire signals/ground using the table. Plug the Nano into USB and report that it is connected. The port must be detected again; COM11 was the earlier port, not a permanent assignment.
3. Upload V4 before applying servo power. V4 starts with all outputs off and does not auto-home.
4. Open the launcher in Edge/Chrome, select Connect Nano, and choose the USB port. The application requires the V4 identity and rejects the older firmware.
5. Verify the servo model, feedback arrangement and mechanical position before enabling. InMoov may use relocated potentiometers; a nominal 1500 µs command is not guaranteed to be mechanically safe.
6. Enable one supported joint at a time. Initial software limits are 1400–1600 µs, centered at 1500 µs; these are cautious starting bounds, not validated physical limits. Adjust in small steps. Edit pulse bounds while that joint is off.
7. At your desired rest pose, choose Set here as home. This saves that joint's current commanded pulse. Go to home and Home enabled joints use saved values. Disabled joints remain off when homing enabled joints.
8. Save session or Export JSON. Homes live in browser storage / exported JSON, not Nano EEPROM. There are no home switches or measured position feedback in this controller.

## Record and play

Start recording with the desired joints enabled. Move them and pause, then Finish recording. Playback captures command timing, starting commanded positions and off commands; it cannot record an arm moved by hand.

Play recording runs once by default. Loop repeats until stopped. Playback commands the starting pose first, including on each loop; ensure the return path is clear. It does not implement trajectory planning or collision detection.

Stop replay holds the last pose. Emergency off disables pulses and may let unsupported joints fall. A two-second communication watchdog also disables outputs. Recording/playback stops when the tab is hidden. Keep the controller visible while playing.

## Verification performed

Classic Nano ATmega328P compilation: 5,174 bytes flash / 360 bytes SRAM.
Seven software tests passed: startup off, named mapping, saved homes, emergency queue cancellation, enabled-only homing, recording/import validation, and once/loop playback cancellation.
No upload or physical movement test has been performed for this eight-joint version.
