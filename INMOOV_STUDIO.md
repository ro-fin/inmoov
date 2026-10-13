# RoboAttis InMoov Studio

Open `LAUNCH_ARM_DESKTOP.bat` (the existing Desktop shortcut also uses this launcher). It now opens the local full-body digital twin. `LAUNCH_LEGACY_ARM_DESKTOP.bat` opens the previous Tk interface.

Start in Preview: select an arm joint, move the angle slider, or choose Preview motion. Drag to orbit and scroll to zoom. Preview never sends servo commands.

To use hardware, choose Connect robot, select the Nano, then enable one joint at its saved home. The readout shows your requested pulse; the acknowledgement line and model update from Nano replies. Use Calibration & limits while the joint is released. Save session retains limits, homes and recordings. Import/export remains compatible with the existing eight-joint format.

The left-arm safety settings now come from the tested standalone motion profile:

| Joint | Pin | Pulse limits µs | Home µs | Original home / command range | Home-relative slider |
|---|---|---|---|---|---|
| Omoplate | D2 | 1389–1604 | 1600 | 149 / 120–149 | 0–29 |
| Rotation | D3 | 1204–1685 | 1500 | 135 / 95–160 | −25–40 |
| Shoulder | D4 | 1093–1856 | 1626 | 152 / 80–183 | −31–72 |
| Bicep | D5 | 1004–1604 | 1604 | 149 / 68–149 | 0–68 lift units |

Home is displayed as zero. Positive offsets lift/open the arm or turn rotation outward. These are command units, not measured joint degrees; bicep lift units intentionally span 0–68 and are not the subtraction of the original command values. The original command and pulse bounds are shown beside each slider. D2 preserves its earlier exact 1600 µs home anchor, whose old display rounded to 149. The controller rejects wider limits, changed left-arm homes and reversed left-arm hardware directions, including imported recordings. Narrower limits may be saved; gestures reject any pose that falls outside them. Right-arm profiles and their existing reversals remain unchanged.

In **Motion → Robot hand signs**, choose Hi, Stop sign, Go left or Hi → Stop → Go left. Confirm physical home before enabling released joints for a gesture. Each sign returns home and releases the left outputs after a single run. Turn on **Repeat until stopped** to loop; turn it off during a run to finish the current cycle at home. **Stop loop / Escape** cancels movement and requests outputs off. **Return home / Alt+H** ends the gesture with a bounded stepped home return. Alt+1, Alt+2, Alt+3 and Alt+4 select the four buttons when not typing in a field. Stop sign is a three-second held pose; Stop loop cancels execution.

The gesture coordinator uses the same serial owner as manual controls, advances only after all four command replies, and never resumes a gesture after a browser-heartbeat, timing or connection fault. Manual controls, recording and edits are locked during gestures. The right arm must be released before a left-arm gesture starts. Wrist/fingers are not driven; arrange the open hand and palm before testing.

Left-arm visual mapping anchors the neutral model pose to each saved home, and decreasing pulses lift the visual arm to match the tested hardware direction. Visual travel remains an estimate until measured. **Twin calibration → Invert twin direction only** reverses the rendered joint without changing any hardware command or servo reversal; it is saved per joint in this browser. Keep visual direction and hardware direction separate.

The full-body model contains authentic InMoov geometry. The current controller maps only eight arm joints. Its visual angles are estimates until the pulse-to-angle mapping is calibrated against the physical robot. Other body parts are references, not connected controls.

The viewport opens at eye level inside a Finstein executive cabin. Choose Inside, Robot, or the other camera angles; drag to orbit and scroll to zoom. Full view expands only the 3D environment. Back to Studio or Escape returns to the normal layout without resetting the pose or selected joint. Full view retains connection status and an Emergency off button. Its Room, Robot, Inside and Desk buttons change the camera only.

Touch the robot in Full view to open the glass controls, or choose Robot controls. The Move tab includes Preview/Robot mode, joint selection, movement and enable/release controls. Hi, Bye, Go left, Stop and Vanakkam are visual gestures available only in Preview mode. They never send hardware commands. Inspect provides close focus on body sections or the touched mesh, pointer-directed zoom and transparent printed shells. Identified servo cases stay black and opaque.

Tap the bright wall portraits to read Finstein leadership profiles. The V2 parts tab opens 51 official head, eye and hand STL files individually, with original shape, source dimensions, front/side views, file downloads and official assembly links. Return to robot restores the prior camera. This workbench is a parts reference; the full body is not yet a verified V2 assembly.

Emergency off releases servo outputs. During a live hand sign, Escape always stops motion, including in Full view. Otherwise Full view uses Escape to return to Studio, and the normal layout uses it for Emergency off. Loss of browser heartbeat requests output shutdown after six seconds while preserving the USB connection. Disconnect before switching back to Preview. Close the legacy controller's serial connection before connecting from Studio.

The planned build is InMoov V2, but the current displayed assembly remains the earlier reference. Official i2 head and hand files have been collected locally. They are print-oriented parts, not an assembled rig. See digital_twin/ROOM_SOURCES.md for provenance and the remaining assembly requirements.

The local service runs at 127.0.0.1:8765. Use the launcher to open an authenticated window; launching again reuses the running service. The service remains available in the background after closing its window, with hardware disconnected on loss of browser polling.

The launcher waits for the local service before opening the Calibration panel in a normal Edge window. A fresh launch resets full view so the controls are visible. The joint selector, position controls, saved pulse limits and Save settings are on this panel. Hand signs appear here and on Motion; blocked buttons show a readiness message and setup action. Physical-home confirmation remains required for released joints, and the right arm must be released before left-arm gestures. Preview animations are hidden in Robot mode to avoid confusing them with live hand signs.

A tab opened directly at the local address can now be paired without reopening the browser. Run `PAIR_ARM_CALIBRATOR.bat` to display an eight-digit code, then enter it in **Restore control session** on that tab. Codes expire after ten minutes, work once, and lock after five failed attempts. Generating a new code replaces the previous one. Only the local authenticated helper can issue codes, and redemption requires the local page's origin. Pairing saves the session credential in that tab and does not enable or move servos. A service restart requires a fresh code or the normal launcher.

Startup diagnostics are saved in studio-error.log and studio-output.log. Updated HTML/JS/CSS bypass stale cache entries; large model files retain normal caching. An individual animation callback error no longer stops rendering permanently, and graphics-context recovery is shown in the viewport. If loading fails, Reload 3D view retries the display; it does not restart a gesture.

Full view fills the browser pane and fits the entire robot to narrow screens. Quick controls start hidden; use Controls or touch a joint to reveal them. Hide controls clears the overlay, and Back to Studio restores the normal page. Full view is remembered across reloads within the same tab. The local HTTP server keeps connections alive and accepts larger connection bursts so simultaneous module/model requests do not overwhelm its small default connection queue.

Runtime: Python 3.12, Tkinter and pyserial, plus a WebGL-capable browser. Rendering dependencies and models are installed locally in digital_twin. No internet is needed to run. For dependency restoration: `npm.cmd ci --ignore-scripts --no-audit --no-fund` inside digital_twin.

Verification: `python -m unittest test_calibrator_motion test_arm_desktop test_twin_server`. With Studio running, `node digital_twin/verify-safe-gestures.mjs` checks the new UI with mocked movement requests; no test motion is sent to hardware.

Research, fidelity boundaries, source attribution and licence information: [digital_twin/RESEARCH.md](digital_twin/RESEARCH.md).

Live calibrator hand signs use coordinated steps of up to 10 displayed command units every 250 ms. Every four-joint target must be acknowledged before the next step; delayed acknowledgements never trigger catch-up jumps. Saved pulse limits, home anchors, holds, and stop protections still apply. Planned cycles including final rest are approximately Hi 7 s, Stop 7.5 s, Go left 6.5 s, and the combined sequence 21 s; acknowledgements and scheduling can extend them. Standalone scripts retain their previous timing.
