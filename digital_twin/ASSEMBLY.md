# InMoov Studio — digital twin assembly notes

## What the twin is built from

The body is **Gael Langevin's original VinMoov assembly** (`assets/original/VinMoov4_Blender/i01.*.dae`), the virtual InMoov that MyRobotLab uses. All nine sections — legs, mid/top stomach, torso, head, shoulders, rotate, bicep, hand — are authored in one shared world frame, so every part sits exactly where the designer placed it.

- **Scale:** the files are in decimetres (Z up, robot faces −Y). The twin converts them to metres: 1 : 1, **1698 mm** tall.
- **Joining:** each file's root pivot (for example `i01.leftArm.rotate`) replaces the placeholder node of the same name in its parent file. The mid-stomach hangs off `i01.torso.lowStom`, and both omoplates hang off `i01.torso.topStom`. See `twin.js` → `load()`.
- **Joints:** the designer's pivots are used as-is — 49 twin joints: neck, head rotate, neck roll, jaw, eyes, waist, torso lean; per arm: omoplate, shoulder, rotate, bicep, wrist; per hand: five tendon-curled fingers. Axes are given in the body frame and checked visually (arms, neck, fingers, gestures).
- **Colours:** the source materials — white printed shells, black servos and hardware, bronze bearings, grey metal, green irises — with orange fingers to match the physical build.

## Key dimensions (from the model, rest pose)

| Measurement | mm |
|---|---|
| Overall height | 1698 |
| Shoulder width (outer) | 574 |
| Shoulder → elbow pivot | 279 |
| Elbow → wrist pivot | 273 |
| Hand length | 196 |
| Head width / height | 155 / 207 |
| Torso depth | 316 |
| Shoulder pivot spacing | 293 |
| Waist pivot height | 1011 |

The Inspect tab computes these live, and also measures any two surface points and gives each part's bounding size.

## i2 head, i2 hands, V2 neck

No assembled i2 model has been published. Checked on 2026-09-30:
- inmoov.fr downloads, including the complete Blender robot (2019, classic parts);
- MyRobotLab `VinMoov5.j3o` (classic node set);
- community i2 guides on GitHub (text only).

The official i2 STLs are exported in **print orientation** (each part flat on the bed at Z = 0), so they carry no assembly positions. Rather than guess, the twin keeps the genuine classic head and hands. The **Spares** tab shows each official i2 / neck file individually, at true size, with its measured bounding box, STL download and the official assembly guide link.

If you can supply an assembled i2 file (Blender, STEP or glTF) or measured photos of your head and hands, the spares can be mounted on the twin's existing `i01.head.*` and `i01.*Hand.*` pivots.

## Hardware mapping (Nano, Arms V6)

| Joint | Left | Right |
|---|---|---|
| Omoplate | D2 | D7 |
| Rotate | D4 | D8 |
| Shoulder | D5 | D9 |
| Bicep | D6 | D10 |

D3 is unused. Robot mode drives these eight twin joints from the Nano's acknowledged pulses through **Twin calibration**, which sets the joint angle at the minimum and maximum pulse. Calibration is stored in the browser as `inmoov-twin-mapping-v1`, and the servo angle scale as `inmoov-servo-sliders`.

## Files

| File | Role |
|---|---|
| `index.html`, `app.css`, `app.js` | Interface and controller link (same `/api` protocol as before) |
| `twin.js` | Loads, joins and articulates the VinMoov assembly; materials, highlight, X-ray, exploded view, measurements |
| `stage.js` | Renderer, studio stage, Finstein cabin toggle, cameras, picking, dimension lines |
| `spares.js` | Spares bay for the official i2 STL files |
| `motion.js` | Preview gestures: Hi, Bye, Go left, Stop, Vanakkam, Think |
| `executive-room.js` | Finstein cabin (unchanged) |
| `legacy-v1/` | Previous interface, kept for reference |
| `dev/` | Screenshot and joint-test pages used during development |
