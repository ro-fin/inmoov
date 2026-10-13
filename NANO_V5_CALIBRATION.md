# Nano V5: digital twin calibration

Historical V5 guide. Current firmware is V6 with D3 excluded; use
[the V6 wiring guide](NANO_V6_PINOUT.md) for the current calibrator.

Latest configuration (21 September 2026): all eight arm servos on D2-D9
are 270-degree servos. Every profile now uses 500-2500 us with a 0-270 degree
slider; 135 degrees maps to 1500 us. Existing home pulses are preserved.
Old browser slider ranges are migrated once, with a browser-storage backup;
later customizations remain editable. Saved calibration was backed up to
arm_desktop_session.before-all-270-*.json. The installed V5.1 firmware already
accepts this range on every channel, so this conversion needs no new firmware.
The following omoplate-only update is retained as history.

Updated 21 September 2026: firmware build V5.1 keeps the V5 protocol identity.
Both omoplates (D2/D6) now use 500-2500 us for their 0-270 degree scale:
0 degrees = 500 us, 135 degrees = 1500 us, 270 degrees = 2500 us.
The left channel previously retained 1400-1600 us, restricting physical travel
despite its 270-degree slider. Its saved limits are corrected; saved home pulses
are retained (left 1600 us, right 1500 us). This adopts the full pulse range
already configured on the right servo; physical endpoints still depend on the
servo and installed mechanism. Other joints retain their individual limits.
The previous session is backed up as arm_desktop_session.before-270-*.json.
VERSION reports the installed build; CHECK_ANGLE verifies conversion with
outputs off. No automatic physical sweep is performed during verification.

Uploaded and verified on COM11, 17 September 2026. Classic ATmega328P Nano,
115200 baud, 8 data bits, no parity, one stop bit. Firmware:
`nano_arm_controller/nano_arm_controller.ino`. Launch `py -3.12 twin_server.py`.

## Signal pins

Left and right mean the robot's own sides.

| Joint | Left arm | Right arm |
|---|---|---|
| Omoplate / shoulder outward lift | D2 | D6 |
| Upper-arm rotation | D3 | D7 |
| Shoulder forward lift | D4 | D8 |
| Bicep / elbow bend | D5 | D9 |

These are the eight arm joints mapped in the digital twin. Finger, wrist and
head servos are visual only and have no assigned outputs in this firmware.
D0/RX and D1/TX are reserved for USB serial. D10-D13 are not controlled.
Connect each servo's signal wire to its assigned D pin. Power servos from a
separate regulated supply rated for their voltage and combined current, not
the Nano's USB or 5V output. Join supply negative, servo grounds and Nano GND.

## Calibrate one joint

The main and full-view sliders now display servo degrees. All eight arm
sliders default to 0-270 degrees. Expand Customize angle slider to edit
the angle at each pulse endpoint and the step (0.1-10 degrees). Release
the joint before saving changes. Settings persist per joint in this browser;
reversed angle endpoints are supported. This does not expand pulse limits
or prove the servo can physically travel through that angle. The separate
Visual angle mapping still controls the estimated robot joint rotation.

1. Open Studio, connect COM11 and choose Robot mode. Outputs start off.
2. Select one joint and review its saved minimum, maximum and home pulse.
   All eight servo profiles now default to 500-2500 us.
   The default home is 1500 us; existing saved homes are retained.
   These are starting settings, not measured safe limits for your mechanism.
3. Support the arm, enable that joint at home, and adjust in small pulse steps.
   Release it before editing pulse limits. Establish the actual safe range.
4. In Visual angle mapping, enter the measured joint angle at the minimum
   pulse and the measured angle at the maximum pulse. Reversed endpoints
   are supported. These are robot joint angles, not an assumed servo 0-180°.
5. Save the mapping. Enter a value in Joint angle and press Go to angle.
   The Nano converts that angle using the supplied calibrated endpoints.
6. Save the session to retain pulse limits and home. Angle mappings are stored
   separately in this browser. Repeat for the other joints.

The digital twin displays acknowledged pulse commands mapped into joint
angles. It is not encoder feedback; match it against measurements on the
physical robot. The V2 assembly placements are also unverified visual fits.

## Protocol

Newline-terminated ASCII; input is parsed without delay() or blocking reads.

`ANGLE,pin,millidegrees,angleAtMinPulse,angleAtMaxPulse,minPulseUs,maxPulseUs`

Example: `ANGLE,2,27500,0,55000,1400,1600` requests 27.5 degrees, mapping to
1500 us. Reply: `OK,2,1500`. Each request carries both calibration endpoints,
so the Nano needs no separate synchronization or persistent angle settings.
Angles may run in either direction; out-of-range values and invalid fields
are rejected. Pulses must remain within 500-2500 us and the supplied range.
The desktop validates those supplied pulse endpoints against the joint's
saved calibration before constructing a command.

`CHECK_ANGLE` has the same fields and returns `CALC,pin,pulse` without enabling
any output. `SET,pin,pulseUs`, `OFF,pin`, `ALL_OFF`, `STATUS`, `PING` and
`HEARTBEAT` remain available. Identity ends in `V5`; older firmware is rejected.
The firmware detaches outputs after two seconds without valid contact.

The browser sends the first slider value immediately, keeps only the newest
unsent value and allows one movement HTTP request at a time. The serial worker
requires the matching acknowledgement before the next movement. Emergency
off clears pending updates. Serial reads use a 3 ms timeout; desktop processing
runs every 10 ms. These are software settings, not a guaranteed end-to-end delay.

Read-only Nano verification measured 30 PING exchanges: median 5.24 ms,
maximum 5.77 ms on this system. Servo refresh and mechanical travel add latency;
zero-latency motion is not possible. See `nano_v5_verification.json`.

Build/upload board: `arduino:avr:nano:cpu=atmega328` (new bootloader).
See [Arduino's Nano processor guide](https://support.arduino.cc/hc/en-us/articles/4401874304274-Select-the-right-processor-for-Arduino-Nano).
