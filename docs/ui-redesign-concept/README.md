# KeyShot Director redesign concept

These approved comps guided the coordinated Studio and Materials redesign in `server/public/index.html` and `server/public/director.css`. The standalone artifact remains a visual reference and does not touch the open KeyShot scene.

## Direction

The concept keeps the existing calm, scene-first identity and makes it feel more deliberate: a deep graphite product rail, warm silver workspace, restrained blue actions, precise type, and a real KeyShot preview as the largest visual element. The Studio inspector gives the user four quick anchors: shot goal, environment, native lights, and undo. Reference upload and free-form direction share one persistent Ask Director composer.

Materials uses the same header, spacing, control shapes, and surfaces. The app now places its real live preview beside Material Director and the actual scene-material inspector. The concept's node graph is illustrative: the current plugin reports real node inputs and exposed values but does not render an editable graph of its own. The implementation keeps those limits explicit instead of presenting a simulated graph as live data.

## Evidence and illustrative values

- `assets/keyshot-render-phone.jpg` is a crop from `.impeccable/review/desktop.jpg`, which shows a real KeyShot product preview. Its source is embedded in the JPEG metadata.
- The `0.01 mm` displacement value follows the user's requested subtle range. Other material and lighting values are illustrative interface content, not verified values for the open scene.
- The material graph uses node roles and labels visible in the user's KeyShot material screenshot. It is a designed diagram, not a live graph export.

Open `index.html` in a browser and use **Studio / Materials** in the top bar to compare both comps. They remain useful as a visual benchmark; the live app uses the KeyShot preview stream and bridge-backed controls.
