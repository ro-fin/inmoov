> **New device / full documentation:** see [SETUP.md](SETUP.md): install, wiring, servo limits, safety guide, protocol and troubleshooting.

# RoboAttis Lab InMoov servo calibrator

## Current digital-twin controller: Nano Arms V8

Launch `LAUNCH_ARM_DESKTOP.bat`. The connected Nano uses
`nano_arm_controller/nano_arm_controller.ino`, 115200 baud, eight arm outputs
D2–D9 and calibrated serial angle commands.
Left arm uses D2–D5; right arm uses D6–D9. All eight sliders support 0–270 degrees. See
[Nano V8 connection, wiring and calibration](NANO_V8_CONNECTION.md).
The older standalone Nano and Mega variants below use different firmware.

## Nano + expansion shield (current launcher)

Run `ROBOATTIS_LAB_INMOOV_CALIBRATION.bat` to open `nano_calibrator.html` in Edge/Chrome. Keep `nano_calibrator.js` and `nano_motion.js` beside the HTML file. The Nano firmware is `nano_servo_controller/nano_servo_controller.ino`, using 115200 baud and direct outputs D2–D13 (D0/D1 are reserved for serial).

- **Home 90°** on each card enables that servo at exactly 1500 µs. Align its horn mechanically in that position. The degree display uses a nominal 500–2500 µs / 0–180° mapping; it does not measure the servo or joint angle. Home is blocked if 1500 µs is outside that servo's configured limits.
- **Control:** pulse slider, angle input, ±1° adjustments, custom Rest, and individual Off. Edit pulse limits and Rest with the servo off. Defaults are 1000–2000 µs with Rest at 1500 µs. Commands remain within the configured limits.
- **Record:** set up a starting pose, click Start recording, move servos and pause as needed, then Finish recording. The recording includes the initial enabled pose, timed movement/off commands and final pause. Starting another recording replaces the previous one when finished. Maximum 10 minutes or 15,000 commands.
- **Replay in loop:** repeats the recording until stopped, returning to the recorded starting pose on every loop. Plan the end and starting poses accordingly. Manual movement controls are locked during replay. Individual Off stops replay and disables that servo; others hold position.
- **Stop replay:** holds the last commanded pose. **Emergency off:** cancels pending movements, ends recording/replay, and stops all pulses. Disconnect, serial error, contact timeout, or hiding the tab during recording/replay also stops the motion. Keep the page visible and connected during replay. Replay runs on the computer, not autonomously on the Nano.
- **Save session / Export JSON / Import JSON:** include all profiles plus the recording. Existing version-1 Nano profile exports are supported. Saved outputs are never enabled automatically. A recording outside newly edited pulse limits cannot replay; restore the relevant limits or record again.

Firmware v3 automatically enables all D2–D13 outputs at 1500 µs (nominal 90°) on every power-up/reset, including the reset that may happen when USB serial opens. This standalone starting pose holds until control begins. The 2-second contact watchdog arms on the first `HEARTBEAT`, `SET`, `HOME`, `OFF`, or `ALL_OFF`; a later timeout turns outputs off without automatically homing again. `PING` and `STATUS` are read-only and do not arm the watchdog. Emergency Off remains effective until the next explicit movement command or hardware reset.

The identity is `PONG,ROBOATTIS,NANO,DIRECT,12,115200,D2-D13,V3,AUTOHOME90`. `STATUS` reports twelve `STATE,pin,pulse_us` lines (zero means off), so the browser reflects the startup pose without releasing it on connection. Firmware boot homing uses fixed 1500 µs and cannot read browser-saved limits; confirm this position is mechanically suitable. The browser retains compatibility with v1/v2 Nano firmware.

Use an appropriate external servo supply with a common ground. Firmware preparation and upload should be done with servo power disconnected; connect servo power when ready to position a servo.

Build: `arduino-cli compile --fqbn arduino:avr:nano:cpu=atmega328 --build-path build-nano-v2 nano_servo_controller`

Checks: `node --test test_nano_calibrator.cjs`. The build verifies compilation; physical travel, horn alignment, USB port and bootloader must be checked with the connected Nano.

## Mega + PCA9685 variant

The separate Mega variant uses an Arduino Mega 2560 and one or two PCA9685 boards for 16 or 32 servo outputs. Open `roboattis_inmoov_calibration.html`; its firmware is in `mega_pca9685_servo_controller`. The following wiring and protocol instructions apply to this Mega variant.

## Choose the number of PCA boards

At the top of the Arduino sketch, set `PCA_COUNT` to `1` or `2`. Board addresses can also be customized there with `PCA0_ADDRESS` and `PCA1_ADDRESS`. The channel count and serial identity are generated automatically from this setting.

## Signal wiring

Both PCA9685 boards share the Mega's I2C bus:

| Arduino Mega 2560 | PCA9685 board 1 | PCA9685 board 2 | Function |
|---|---|---|---|
| 5V | VCC | VCC | 5 V logic power only |
| GND | GND | GND | Common logic/power reference |
| Pin 20 / SDA | SDA | SDA | I2C data |
| Pin 21 / SCL | SCL | SCL | I2C clock |
| Optional digital safety output | OE | OE | HIGH disables every PWM output; LOW enables |

The Mega's dedicated SDA/SCL header carries the same signals as pins 20/21. Keep I2C wiring short. Common Adafruit-style modules already contain pull-ups to VCC, so do not add more unless testing shows they are needed.

### I2C addresses

- Board 1: leave every address jumper open = `0x40`.
- Board 2: solder only the `A0` address jumper = `0x41`.
- Never leave both boards at `0x40`; the address collision prevents reliable control.

Board 1 is global channels 0-15. Board 2 is global channels 16-31: global 16 maps to board 2 output 0, global 17 maps to output 1, and so on.

## Servo power wiring

VCC and V+ are separate:

- `VCC`: PCA9685 logic power from the Mega 5 V pin. It does not power servos.
- `V+`: external regulated servo power, normally 5-6 V. Verify the exact servo datasheet.
- Join external supply negative, both PCA9685 GND terminals, and Mega GND.
- Servo signal (yellow/orange/white) goes to PWM/S, red to V+, and brown/black to GND.
- Never feed servo current through the Mega 5 V pin or USB cable.

Size the supply and wiring from the sum of servo **stall currents**, with margin. A high-torque servo may draw more than 1 A under load. Split high-current installations into fused power banks. Do not carry the current for many servos through thin breadboard jumpers or one small terminal.

Put bulk electrolytic capacitance near each board's V+ terminal. About 100 uF per simultaneously moving servo is a starting guideline, not a guaranteed value. Observe capacitor polarity and use a voltage rating above the servo supply.

## Communication and identification

- USB serial: 500,000 baud, newline-terminated ASCII.
- I2C: 400 kHz.
- `PING` returns `PONG,ROBOATTIS,MEGA2560,PCA9685X2,32,500000,0x40,0x41`.
- `SET,channel,pulse_us` controls global channel 0-31.
- `OFF,channel` disables one output.
- `ALL_OFF` disables all outputs.

The UI coalesces rapid slider events every 8 ms, preventing stale positions from accumulating. On first use, Edge/Chrome asks you to select the Mega. After authorization, the app can reuse the authorized device, displays its USB vendor/product IDs, sends `PING`, and validates the firmware identity. Web Serial does not expose the Windows COM number to page JavaScript; the browser's first-use port picker displays it.

## Setup

1. Disconnect servo power.
2. Leave board 1 at `0x40`; solder A0 on board 2 for `0x41`.
3. Wire VCC, GND, SDA, and SCL as above.
4. Install the Arduino `Adafruit PWM Servo Driver Library` and dependencies.
5. Upload `mega_pca9685_servo_controller.ino` to the Mega 2560.
6. Close Arduino Serial Monitor; only one program can own the USB port.
7. Double-click the desktop `servo calibrator.bat`.
8. Click **Find controller**, select the Mega once, and wait for the `PONG` identity.
9. Apply external servo power. Begin with one unloaded servo, limits around 1000-2000 us, and one enabled channel.

The tool stores 32 profiles and supports JSON plus MyRobotLab/InMoov ServoConfig YAML. Determine safe mechanical limits separately for every servo.
