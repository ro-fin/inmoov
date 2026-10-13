# InMoov digital twin: research and implementation
Research date: 16 September 2026

## Result and fidelity
RoboAttis Studio uses actual InMoov-derived meshes, not a generic humanoid or a generated illustration. The articulated upper body comes from Sentience Robotics' InMoov URDF. The lower body comes from the original VinMoov4 Blender/Collada package shared by InMoov creator Gael Langevin.

The result is a full-body visual twin with eight hardware-mapped arm joints. It is a **command-driven, estimated-pose twin**. It is not an exact metrological copy of this particular physical robot: its servo directions, measured pulse-to-angle relationships, printed part revisions, dimensions and mechanical offsets have not been measured. A Nano acknowledgement confirms protocol processing; it does not measure movement or prove the servo reached its target.

## Research decisions
### Geometry and articulation
The InMoov community has previously used Blender and JMonkeyEngine to assemble virtual body parts and connect model rotations to servo events. That work shows why a model needs both geometry and a hierarchy of joint pivots; rotating a decorative mesh alone does not provide correct articulated motion.

Source: [MyRobotLab: moving the 3D model with JMonkey](https://myrobotlab.org/content/moving-3d-model-jmonkey-mrl).

The selected URDF describes visual meshes, parent/child relationships, local origins, joint axes and angular limits. Studio preserves those relationships through a URDF scene graph. A shoulder motion therefore carries the upper arm, elbow, forearm and fingers with it. The robot's own left side remains its left side when the camera turns.

Source: [Sentience Robotics InMoov ROS simulation](https://github.com/Sentience-Robotics/inmoov_ros_sim).

The URDF's support stand is hidden and the original lower-body Collada model is added at the shared model scale. The Collada importer handles its Z-up coordinate system; the URDF is rotated into the renderer's Y-up frame. Both imports are scaled by 0.1 for the display scene. This shared scale is a rendering alignment, not a measured physical calibration.

Source: [Gael Langevin's original model download discussion](https://inmoov.fr/members/juerg/activity/29461/).

### Digital twin versus animation
Research on robot digital twins distinguishes geometric, physical and functional consistency. That distinction matters here: authentic geometry and correct kinematic hierarchy are useful, but they do not establish dynamic or physical accuracy without calibration and validation.

Source: [Jiang et al., Digital Twin System for Home Service Robot Based on Motion Simulation](https://arxiv.org/abs/2309.05993).

For this controller, a local command/acknowledgement display is the appropriate first implementation. A dynamics simulator would additionally require masses, inertias, actuator models, friction, loads, contact geometry and validation against the robot. Those are outside the available hardware data.

### Renderer choice
The implementation uses Three.js and the URDF loader in a local browser window. These provide GPU rendering, orbit/zoom, mesh picking and hierarchical joint transforms. All runtime scripts and model files are stored locally. The application does not require ROS, Blender, a cloud account, Web Serial permission or an internet connection after setup.

A desktop Tk canvas would require a separate software 3D renderer and would be a poor fit for this detailed geometry. Installing a complete ROS or JMonkey application would also add a second controller stack. Keeping the existing Python serial worker and adding a local presentation layer preserves the project's hardware behavior.

Sources: [Three.js documentation](https://threejs.org/docs/), [URDF loader](https://github.com/gkjohnson/urdf-loaders). The architecture comparison above is the implementation choice for this project.

## Control and feedback model
The existing serial owner continues to verify Arms V4 identity and send commands at 115200 baud. No firmware changes are needed.

| Channel | Physical control | Model joint |
| --- | --- | --- |
| D2 | Left omoplate | left_shoulder_y_link_joint |
| D3 | Left rotate | left_shoulder_z_link_joint |
| D4 | Left shoulder | left_shoulder_x_link_joint |
| D5 | Left bicep | left_elbow_x_link_joint |
| D6 | Right omoplate | right_shoulder_y_link_joint |
| D7 | Right rotate | right_shoulder_z_link_joint |
| D8 | Right shoulder | right_shoulder_x_link_joint |
| D9 | Right bicep | right_elbow_x_link_joint |

The inspector displays the requested pulse independently of the acknowledged pulse. A queued request does not animate the robot as if the Nano had processed it. In Robot mode, matching valid feedback updates the estimated pose and flashes the affected part. The UI distinguishes enabled requests from confirmed output state. Releasing a joint retains the last acknowledged pose as a reference; it cannot predict where an unsupported limb falls.

Pose conversion is linear between the saved visual angles at the minimum and maximum servo pulse. Increasing or decreasing angle mappings support opposite servo directions. Model angular limits still clamp rendering. These mappings live in browser local storage, separately from physical servo limits. They need to be set from actual measurements before the visual angle is treated as physically meaningful.

The animation interpolates toward the acknowledged angle for a smooth display. That interpolation is a visual transition; it is not a measured velocity or an additional command to the servo.

## Preview and hardware separation
Preview sliders and the demonstration animation only change client-side model joints. They do not call the hardware move endpoint. The demonstration adds gentle head and finger motion, but those joints remain unmapped hardware references. Legs are static reference geometry.

Connecting selects Robot mode. Preview mode is blocked while a device connection is active. Hardware actions require verified connection, valid joint indices and calibrated pulse bounds. Calibration editing is blocked for enabled joints and during recording/playback. Imported recordings still use the existing session validation.

The serial worker retains command acknowledgements, heartbeat and emergency-off behavior. Slider values are coalesced when the command queue is busy. The bridge additionally requests emergency off and closes serial if authenticated browser polling is absent for more than two seconds. The local HTTP service binds to 127.0.0.1, checks request origin/host and requires a per-launch token for its API. None of the build or verification work connects to the physical Nano.

## UI
The workspace uses a light neutral surface, restrained green accents and one selected-joint inspector. Users can pick an arm directly on the robot or select a joint in the body explorer. Front, side and three-quarter views, free orbit, fit and zoom help inspect motion.

Calibration and visual-angle mapping are tucked into disclosure panels. Recording, playback, looping and session import/export remain available. Emergency off is always in the header when connected; Escape also requests it. The activity feed names the affected joint and distinguishes queued commands from acknowledged commands. Laptop side panels scroll independently; tablet and narrow layouts stack the controls.

## Validation
- Existing controller tests pass.
- Added tests cover acknowledgement versus request state, invalid/offline commands, bounds, editing guards, browser-loss shutdown, slider backpressure and complete fake-serial round trips.
- Browser tests load the real full-body model, exercise all eight selections and animation, verify preview does not send movement commands, check requested/acknowledged pulse separation with mocked telemetry, and inspect laptop/tablet/mobile layouts.
- Hardware motion, actual angular accuracy, physical limits and collision safety have **not** been validated. No hardware commands were issued during testing.

## Model provenance and licences
**Original creator:** Gael Langevin, InMoov — https://inmoov.fr/
The InMoov-derived models retain their Attribution–NonCommercial terms. This local integration does not grant additional rights to the models.

Original package:
https://www.inmoov.fr/wp-content/uploads/stl/InMoov%20Goodies/VinMoov4_Blender.zip
SHA-256: 6801fd45cdacbe9fb8e1d6f4ca931c27b7944da333ab7b1e25233823e79b44c0

Articulated reference:
https://github.com/Sentience-Robotics/inmoov_ros_sim
Repository revision recorded at download: 460f419048f5adb4cb76da6f946000bd7d2e52ed
Downloaded archive SHA-256: 8b5dbb36937f214060174d464fc66e50fdc063c55c89b4f246671f187b735497
Its README distinguishes GPL-3.0 project files from CC BY-NC 4.0 InMoov-derived meshes. The original README, LICENSE and mesh ATTRIBUTION.md remain in assets/reference/inmoov_ros_sim-master/.

Presentation modifications: common display scale/orientation, hidden support stand, original lower body combined with the articulated upper body, neutral white display materials and selection/acknowledgement highlights. Source archives and model files are retained without mesh edits.

Third-party software: Three.js 0.180.0 (MIT), urdf-loader 0.12.6 (Apache-2.0, see installed package LICENSE), Playwright for development verification (Apache-2.0). The lockfile pins the installed versions.

