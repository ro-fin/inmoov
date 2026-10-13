# Finstein executive cabin and InMoov V2

Updated 16 September 2026.

## Cabin

The scene is an original executive-office concept, not a reconstruction of Finstein's actual premises. Walnut furniture, stone floor, navy feature wall, brass details, visitor seating, planting and daylight establish a restrained business interior. The city outside is an illustrative skyline, not a claimed office location. All assets load locally at runtime.

The improved materials use photographic colour, normal and roughness maps: [Wood Table 001](https://polyhaven.com/a/wood_table_001) and [Floor Tiles 06](https://polyhaven.com/a/floor_tiles_06). Reflections use [Studio Small 03](https://polyhaven.com/a/studio_small_03), by Greg Zaal. These Poly Haven assets are CC0; original download metadata is retained under assets/interior.

The blue, coral and teal wall displays use unmodified official portraits from Finstein's leadership page: images/aboutus/praveen.png, images/aboutus/Dinesh.png and images/aboutus/Vaidyanathan.png. Tapping a portrait opens readable profile details and the official source link.

The logo was obtained from [Finstein's official asset](https://finstein.ai/images/finstein-logo-white.svg) and retained unchanged in assets/finstein/logo-white.svg. The feature-wall tagline, “Driving change, Securing the future.”, comes from the [official homepage](https://finstein.ai/).

The framed panels cite published education and professional credentials from the [official leadership page](https://finstein.ai/aboutus.html):

- Praveen Kumar: CA, CISA, CEH, CDPSE, CFE; risk, cyber and analytics.
- Dinesh Kumar: MS from the University of Illinois, Chicago, specializing in intelligent robotics; AI, technology and digital solutions.
- Vaidyanathan N A: CA, DISA, DIM; financial reporting and tax.

These are leadership credentials, not invented corporate awards. No award, client logo, revenue, project count or ranking is implied. Verified achievement details can replace these panels when supplied.

## V2 build status

The visible head, eyes, hands, fingers and revised three-piston neck now use official STL geometry fitted to the articulated reference rig. The earlier visuals for these assemblies are hidden. Torso, arms and legs retain the community reference described in RESEARCH.md. This is a visual assembly, not a verified full-body V2 CAD model.

Primary references: [i2 head overview](https://inmoov.fr/i2head-for-inmoov/), [i2 head assembly](https://inmoov.fr/headi2/), [official i2 head parts](https://www.inmoov.fr/inmoov-stl-parts-viewer/?bodyparts=i2Head), and [i2 hand documentation](https://inmoov.fr/inmoov-hand/).

Downloaded to assets/inmoov-v2:

- [Official hand kit](https://www.inmoov.fr/inmoov-hand/Inmoov-hand-i2.zip), extracted under hands/.
- Head, eye and revised neck STL parts from the official i2Head, i2Eyes and Neck galleries. The workbench catalogue contains 69 distinct part names. v2-parts.json records each local path, source-axis bounding dimensions, triangle count and SHA-256 hash. Original geometry is not decimated or reshaped.

The V2 parts workbench displays these actual meshes independently, with front/side views, close zoom, source dimensions, STL download and official assembly-guide links. Dimensions follow the source's millimetre convention, in its original print axes; they are not measured clearances or printer tolerances. Molds, every hand variant and non-printed hardware are not included.

These files are individual printable parts with inconsistent local origins and print orientations; hand finger packs also contain several pieces in one mesh. They contain neither assembly transforms nor servo pivots. Their download alone does not produce an accurate animated V2 twin. Keep the creator's [licence and conditions](https://inmoov.fr/license-and-conditions/) with derived work; the model remains attributed to Gael Langevin / InMoov. The hand download specifically states CC BY-NC 3.0.

The fitting transforms are in v2-assembly.js. Source packs are separated into connected components by prepare_v2_components.py, retaining their original vertex geometry; v2-components.json maps each derived piece to its source. The skull panels, eye mechanisms, palm shells, finger links and neck fittings are positioned manually. The finger parts follow the existing articulation; neck piston orientation follows the head's tilt. Black finger hinge pins are illustrative hardware. These transforms, pivots, clearances and piston travel need verification against an assembled CAD model or measured physical build before construction use. The existing eight-arm-joint controller is unchanged; additional V2 servos need their own explicit hardware mapping.

## Gestures, inspection and servo appearance

Hi, Bye, Go left, Stop and Vanakkam are authored visual previews on the reference rig. They stay within its joint limits and never send hardware commands. Vanakkam palm alignment was fitted numerically to the reference model; it is not a calibrated physical movement or a collision-tested trajectory.

Full view supports touching the robot to open glass-style controls, focusing body sections (including the revised neck) or individual meshes, zooming toward the pointer and seeing through printed shells. Finger parts are orange. Servo cases, shoulder mechanisms and joint fittings are black and remain opaque when shells are transparent. The servo case/end-cap groups were identified in the imported mesh atlas: bicep full.008–010, shoulder full.003–005, omoplate full/001/002, and torso topStom full/001/002/009/010/011. This appearance change does not validate physical servo placement. The Neck catalogue links to the creator's neck-and-jaw assembly guide.
