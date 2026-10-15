// Typed, evidence-recorded operations for learning the installed KeyShot lighting surface.
// Only operations explicitly marked runnable are dispatched to the in-process lux bridge.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { decode } = require('./png');
const { analyzeCapture, compareCaptures, normalizeTarget } = require('./lighting-evidence');

const CATEGORIES = ['area', 'point', 'ies', 'spotlight'];
const OPERATION_VERSION = '1.15.0';
const OPERATIONS = [
  {
    id: 'lighting.inspect_control_surface',
    label: 'Inspect lighting control API',
    state: 'verified_live',
    runnable: true,
    replayable: true,
    effect: 'read_only',
    description: 'Read lighting-related lux functions, environment and graph classes, and shader constants without loading resource libraries.',
    inputs: {},
    preconditions: ['KeyShot Director bridge is connected.'],
    validation: ['KeyShot and Python versions are captured.', 'The environment class surface and lighting-related runtime names are returned.'],
    evidence: 'Runtime API names and type metadata; no scene reads, resource-library loads, renders, or edits.',
    limits: ['An exposed name does not prove its behavior or supported call signature.', 'The public 2026.1 lux reference has no HDRI pin API; an empty runtime name search is evidence of no matching exposed name, not proof that no private implementation exists.']
  },
  {
    id: 'lighting.inspect_scene_state',
    label: 'Snapshot scene state',
    state: 'ready_to_probe',
    runnable: true,
    replayable: true,
    effect: 'read_only',
    description: 'Record scene units, object and material identities, camera, environment, and render settings before a controlled lighting experiment.',
    inputs: {},
    preconditions: ['KeyShot Director bridge is connected.'],
    validation: ['Scene, camera, environment, object IDs, and tree signature are returned.'],
    evidence: 'Read-only lux scene inventory and SHA-256 signature; safe to repeat before and after a probe.',
    limits: ['The snapshot detects state changes; it does not restore them. No render or scene edit is performed.']
  },
  {
    id: 'lighting.restore_research_checkpoint',
    label: 'Restore saved five-form research scene',
    state: 'ready_to_probe',
    runnable: true,
    replayable: false,
    effect: 'scene_mutation',
    description: 'Discard research edits by reopening the exact current PluginTest.bip checkpoint, verifying its inventory, then restoring millimeter units while preserving geometry and camera pose.',
    inputs: { expected_path: { type: 'string', description: 'Exact file path returned by the immediately preceding scene snapshot.' } },
    preconditions: ['The open scene is the disposable five-form PluginTest.bip file.', 'Only expected product forms and research-owned test lights are present.', 'This intentionally discards unsaved changes.'],
    validation: ['The same saved file reopens.', 'The five forms and baseline materials return.', 'Millimeter units and camera pose are verified after reopening.', 'No extra scene-tree items remain.'],
    evidence: 'KeyShot documents lux.openFile(path, dontAsk=True); after exact scene verification, the operation reapplies millimeter display units with the geometry scale and camera pose preserved.',
    limits: ['Use only on the disposable PluginTest.bip scene with no unowned edits. Direct per-object deletion remains unverified.']
  },
  {
    id: 'lighting.configure_research_scene_mm',
    label: 'Configure five-form research scene units',
    state: 'ready_to_probe',
    runnable: true,
    replayable: true,
    effect: 'scene_mutation',
    description: 'Set the known five-form disposable research scene to millimeters while preserving its physical scale.',
    inputs: {},
    preconditions: ['The clean Sphere, Torus, Cube, Rounded Cube, and Cylinder research scene is open.', 'The bridge is connected.'],
    validation: ['KeyShot reports millimeters at scale 1000.', 'The five forms, scene tree, materials, camera, environment, and render options retain their identities and settings.'],
    evidence: 'A typed, idempotent scene-unit operation records before/after state and a result digest.',
    limits: ['This changes the open disposable scene and marks it modified; do not save it unless the user asks.']
  },
  {
    id: 'lighting.inspect_subject_bounds',
    label: 'Measure product bounds for light placement',
    state: 'ready_to_probe',
    runnable: true,
    replayable: true,
    effect: 'read_only',
    description: 'Read the visible product models’ world-space bounds so light position and panel size can be expressed relative to the product.',
    inputs: {},
    preconditions: ['The disposable five-form scene is open.', 'The bridge is connected.'],
    validation: ['At least one model returns finite bounds, center, and span.'],
    evidence: 'Uses the same bounded subject measurement consumed by the Director lighting planner; excludes Director-owned light nodes.',
    limits: ['A combined bounding box does not identify semantic parts or surface normals.']
  },
  {
    id: 'lighting.inspect_light_graphs',
    label: 'Inspect light material graphs',
    state: 'ready_to_probe',
    runnable: true,
    replayable: true,
    effect: 'read_only',
    description: 'Read the installed light-library material graphs and exposed shader parameters.',
    inputs: {
      types: { type: 'array', items: CATEGORIES, default: CATEGORIES, minItems: 1, maxItems: 4 },
      max_assets: { type: 'integer', default: 12, minimum: 1, maximum: 40, description: 'Maximum library assets inspected per type.' }
    },
    preconditions: ['KeyShot Director bridge is connected.'],
    validation: ['KeyShot version is captured.', 'Area, Point, and Spotlight return live typed graphs; installed IES material/profile files are reported separately from loaded graphs.'],
    evidence: 'Live KeyShot lux material-graph reads plus a bounded read-only scan of the installed IES Light and IES Profiles folders; each run stores exact inputs and output.',
    limits: ['A visible parameter does not prove its visual effect; causal changes require a controlled render experiment.', 'An IES file on disk is not yet a verified live KeyShot source.']
  },
  {
    id: 'lighting.probe_native_point_spot',
    label: 'Probe native Point or Spotlight material',
    state: 'ready_to_probe',
    runnable: true,
    replayable: false,
    effect: 'scene_mutation',
    description: 'Apply a KeyShot Point or Spotlight material to a tracked carrier in the disposable scene and record its live graph values.',
    inputs: {
      id: { type: 'string', pattern: '^research_[A-Za-z0-9_-]{1,39}$' },
      type: { type: 'enum', items: ['point', 'spotlight'] },
      pos: { type: 'vector3', unit: 'mm' },
      target: { type: 'vector3', unit: 'mm' },
      power: { type: 'number', unit: 'lm', minimum: 0.1, maximum: 10000000, default: 60000 },
      radius: { type: 'number', unit: 'mm', minimum: 0, maximum: 10000, default: 0 },
      angle: { type: 'number', unit: 'degrees', minimum: 1, maximum: 120, default: 45 },
      falloff: { type: 'number', minimum: 0, maximum: 1, default: 0.5 },
      constant_output: { type: 'boolean', default: true }
    },
    preconditions: ['The five-form disposable PluginTest.bip scene is set to millimeters.', 'The saved checkpoint path is known for a full-scene reset after the probe.', 'The bridge is connected.'],
    validation: ['KeyShot applies the expected shader family to the test carrier.', 'Power, color, radius, and spotlight beam controls read back from the assigned scene material.'],
    evidence: 'KeyShot documents physical lights as light-source materials on geometry. The local -Y Spotlight beam axis was confirmed by a controlled KeyShot 2026.2 render; Point and Spotlight graph parameters were read from the installed library.',
    limits: ['This is a probe, not the reusable typed edit/remove lifecycle.', 'Use only in PluginTest.bip and restore that checkpoint after each probe; do not save.']
  },
  {
    id: 'lighting.probe_native_ies',
    label: 'Probe an installed IES profile',
    state: 'ready_to_probe',
    runnable: true,
    replayable: false,
    effect: 'scene_mutation',
    description: 'Load one existing IES MTL into the disposable project, assign it to a tracked carrier, and read the live lux_ies_light graph and referenced profile.',
    inputs: {
      id: { type: 'string', pattern: '^research_[A-Za-z0-9_-]{1,39}$' },
      asset_id: { type: 'string', description: 'Exact asset_id returned by lighting.inspect_light_graphs for an installed IES material.' },
      pos: { type: 'vector3', unit: 'mm' },
      target: { type: 'vector3', unit: 'mm' },
      multiplier: { type: 'number', minimum: 0.001, maximum: 1000000, default: 1 },
      radius: { type: 'number', unit: 'mm', minimum: 0, maximum: 10000, default: 0 },
      axis: { type: 'integer', minimum: 0, maximum: 5 },
      rgb: { type: 'vector3', minimum: 0, maximum: 1 }
    },
    preconditions: ['The clean five-form disposable PluginTest.bip scene is set to millimeters.', 'The selected IES material and its referenced profile exist in the installed KeyShot user library.', 'The saved checkpoint path is known for full-scene restore.'],
    validation: ['KeyShot loads the MTL into the project scene without changing the library.', 'The assigned graph reads back the expected lux_ies_light type and profile filename.', 'The tracked source can be removed by restoring the exact saved checkpoint.'],
    evidence: 'Uses the documented lux.loadMaterials MTL import path and records a matching installed .ies profile; visible contribution still requires a controlled render.',
    limits: ['The MTL axis enum and local emission direction are recorded but not assumed from file labels.', 'Use only in PluginTest.bip; restore the checkpoint after the probe and never save.']
  },
  {
    id: 'lighting.capture_diagnostic_passes',
    label: 'Capture diagnostic render passes',
    state: 'ready_to_probe',
    runnable: true,
    replayable: true,
    effect: 'bounded_render_and_local_files',
    description: 'Render beauty plus selected lighting, reflection, shadow, clown, depth, and normal evidence. A temporary render engine can be selected and is restored before the operation returns.',
    inputs: {
      passes: { type: 'array', items: ['direct', 'indirect', 'reflection', 'shadow', 'raw', 'clown', 'depth', 'normals'], default: ['clown', 'reflection', 'shadow'], minItems: 1, maxItems: 8 },
      width: { type: 'integer', default: 640, minimum: 32, maximum: 1280 },
      height: { type: 'integer', default: 400, minimum: 32, maximum: 960 },
      secs: { type: 'number', default: 2, minimum: 0.5, maximum: 8 },
      render_engine: { type: 'enum', items: ['current', 'product_cpu', 'interior_cpu', 'product_gpu', 'interior_gpu'], default: 'current', description: 'Temporarily select a render engine for this capture; KeyShot restores the active engine before returning.' },
      measurement_target: { type: 'object', optional: true, description: 'Stable target id and identity plus normalized projected-bounds region {x0,y0,x1,y1}. This ROI is approximate and may include occluders; it does not establish pixel identity.' }
    },
    preconditions: ['KeyShot Director bridge is connected.', 'Exact pass setter mapping is present in this KeyShot version.'],
    validation: ['Every requested output is present and PNG output decodes at the requested dimensions.', 'Clown yields aligned product-region metrics for Beauty and supported linear EXR passes.', 'The original render engine and active RenderOptions are restored; the scene signature is unchanged.'],
    evidence: 'Pass setters and output suffixes were live-proven on the five-form scene; all rendering uses a detached RenderOptions clone. Temporary engine selection uses the documented setRenderEngine API and is restored in a finally block. Evidence analysis aligns Beauty and linear Direct, Indirect, Reflection, Shadow, and Raw EXR passes to the Clown object mask when their formats are supported; the bounded parser currently supports single-level tiled ZIP EXRs. Replaying a capture also compares matching pass pixels against its saved source run.',
    limits: ['This operation performs one bounded preview render and writes diagnostic images under the local research folder. A temporary render-engine change may briefly update KeyShot while the capture runs, but is restored before return; the scene is not saved.']
  },
  {
    id: 'lighting.apply_area_light_recipe',
    label: 'Apply a native Area Light recipe',
    state: 'ready_to_probe',
    runnable: true,
    replayable: true,
    effect: 'scene_mutation',
    description: 'Create or update one tracked rectangular Area Light from a complete, typed recipe in millimeter coordinates.',
    inputs: {
      id: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,48}$' },
      type: { type: 'enum', items: ['area'], default: 'area' },
      pos: { type: 'vector3', unit: 'mm' },
      target: { type: 'vector3', unit: 'mm' },
      size: { type: 'vector2', unit: 'mm' },
      power: { type: 'number', unit: 'lm', minimum: 0.1, maximum: 10000000 },
      kelvin: { type: 'integer', minimum: 2500, maximum: 9500 },
      rgb: { type: 'vector3', minimum: 0, maximum: 1 },
      visible_eye: { type: 'boolean', default: false },
      visible_refl: { type: 'boolean', default: true },
      visible_shadows: { type: 'boolean', default: true }
    },
    preconditions: ['The five-form disposable PluginTest.bip scene is set to millimeters.', 'The exact saved checkpoint path is known so the scene can be restored after the probe.', 'The bridge is connected.'],
    validation: ['The light identity and material graph are returned.', 'Panel placement error is reported when the transform changes.', 'Replaying with the same ID updates that light and records the exact new inputs/output.'],
    evidence: 'Create and parameter replay succeeded on KeyShot 2026.2. Direct node deletion can leave imported geometry behind; reopening the exact saved five-form checkpoint has now restored and verified the clean scene.',
    limits: ['This currently creates a rectangular mesh Area Light; it does not create KeyShot Spot, Point, or IES lights.', 'Do not use direct light removal; after an experiment, restore the exact disposable PluginTest.bip checkpoint and verify its inventory. Never save the probe scene.']
  },
  {
    id: 'lighting.remove_native_light',
    label: 'Remove a tracked research light',
    state: 'gated',
    runnable: false,
    replayable: false,
    effect: 'scene_mutation',
    description: 'Remove only the light node and material recorded under the supplied Director light identity.',
    inputs: { id: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,48}$' } },
    preconditions: ['The target ID was created by lighting.apply_area_light_recipe.'],
    validation: ['The bridge reports removal and no remaining owned geometry.'],
    evidence: 'Cleanup targets the recorded node/geometry IDs and never calls the scene-wide clearGeometry operation.',
    limits: ['A second removal is a no-op and is not treated as a successful first cleanup.']
  },
  {
    id: 'lighting.create_native_light',
    label: 'Create or update a native light source',
    state: 'verified_live',
    runnable: true,
    replayable: true,
    effect: 'scene_mutation',
    description: 'Create or update an Area, Point, IES, or Spotlight light on one tracked Director carrier and record its live material graph values. IES preserves the fixture profile color unless kelvin or rgb is explicitly provided.',
    inputs: {
      id: { type: 'string', pattern: '^research_[A-Za-z0-9_-]{1,39}$' },
      type: { type: 'enum', items: CATEGORIES },
      pos: { type: 'vector3', unit: 'mm' }, target: { type: 'vector3', unit: 'mm' },
      size: { type: 'vector2', unit: 'mm', description: 'Area emitter width and height.' },
      power: { type: 'number', unit: 'lm', minimum: 0.1, maximum: 10000000 },
      multiplier: { type: 'number', minimum: 0.001, maximum: 1000000, description: 'IES dimmer multiplier.' },
      radius: { type: 'number', unit: 'mm', minimum: 0, maximum: 10000 },
      angle: { type: 'number', unit: 'degrees', minimum: 1, maximum: 120 },
      falloff: { type: 'number', minimum: 0, maximum: 1 },
      constant_output: { type: 'boolean' },
      ies_asset_id: { type: 'string', description: 'Exact installed asset_id from lighting.list_installed_ies_profiles.' },
      axis: { type: 'integer', minimum: 0, maximum: 5 },
      kelvin: { type: 'integer', minimum: 1500, maximum: 12000, description: 'Optional color override. Omit for IES to preserve its native profile color.' }, rgb: { type: 'vector3', minimum: 0, maximum: 1, description: 'Optional color override. Omit for IES to preserve its native profile color.' },
      visible_eye: { type: 'boolean' }, visible_refl: { type: 'boolean' }, visible_shadows: { type: 'boolean' }
    },
    preconditions: ['The clean five-form PluginTest.bip scene is set to millimeters.', 'The exact saved checkpoint path is known for full-scene restore.', 'The bridge is connected.'],
    validation: ['The expected native shader family is assigned and parameters read back.', 'Spotlight aims along the controlled local -Y axis; Point placement is position-driven.', 'The exact saved checkpoint can restore the five-form baseline after the operation.'],
    evidence: 'Area, Point, Spotlight, and IES typed create/update/readback operations were tested on KeyShot 2026.2. Area placement reported 0 mm error; Point and Spotlight changed render pixels; IES loaded a matching installed MTL/profile and a six-value axis sweep changed local product pixels. Exact cleanup uses the saved PluginTest checkpoint.',
    limits: ['This operation creates/updates only and accepts research_ IDs on the disposable five-form scene. Type changes require a new light ID. Removal is a separate guarded operation; use checkpoint restore for research rollback.']
  },
  {
    id: 'lighting.list_installed_ies_profiles',
    label: 'List installed IES profiles',
    state: 'ready_to_probe', runnable: true, replayable: true, effect: 'read_only',
    description: 'Inventory installed IES MTL/profile pairs and parse bounded LM-63 photometric summaries without loading materials or changing the scene.',
    inputs: { limit: { type: 'integer', minimum: 1, maximum: 100, default: 40 } },
    preconditions: ['The KeyShot Director bridge is connected.'],
    validation: ['Every returned entry declares lux_ies_light, reports profile-file existence, and includes a parsed or explicitly unsupported photometry state.'],
    evidence: 'Bounded read-only scan of installed KeyShot IES material/profile pairs; TILT=NONE LM-63 fields summarize lumen reference, candela distribution and sampled vertical intensity widths.',
    limits: ['TILT=INCLUDE and malformed files are marked unavailable rather than guessed. Dominant-lobe widths are not the vendor beam-angle label and do not describe secondary lobes. Metadata does not prove visual usefulness or orientation on a product; preserve the profile axis unless a controlled render supports changing it.']
  }
];

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function makeId() { return crypto.randomUUID(); }

function createLightingLab({ send, heartbeat, SHOTS }) {
  const root = path.join(SHOTS, 'lighting-lab');
  const records = path.join(root, 'records');
  const indexFile = path.join(root, 'runs.jsonl');
  let busy = false;

  function operation(id) { return OPERATIONS.find(item => item.id === id) || null; }
  function normalizeInputs(id, value) {
    const op = operation(id);
    if (!op || !op.runnable) throw Object.assign(new Error(op ? `Operation is ${op.state} and is not runnable yet.` : 'Unknown lighting operation.'), { status: op ? 409 : 404 });
    if (value == null) value = {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Object.assign(new Error('inputs must be an object.'), { status: 400 });
    if (id === 'lighting.inspect_scene_state') {
      if (Object.keys(value).length) throw Object.assign(new Error('This operation takes no inputs.'), { status: 400 });
      return {};
    }
    if (id === 'lighting.restore_research_checkpoint') {
      const unknown = Object.keys(value).filter(key => key !== 'expected_path');
      if (unknown.length) throw Object.assign(new Error(`Unsupported input: ${unknown[0]}`), { status: 400 });
      const expectedPath = value.expected_path;
      if (typeof expectedPath !== 'string' || expectedPath.length > 1024 || !path.win32.isAbsolute(expectedPath) || path.win32.basename(expectedPath).toLowerCase() !== 'plugintest.bip')
        throw Object.assign(new Error('expected_path must be the absolute path to the current PluginTest.bip research scene.'), { status: 400 });
      return { expected_path: expectedPath };
    }
    if (id === 'lighting.inspect_control_surface') {
      if (Object.keys(value).length) throw Object.assign(new Error('This operation takes no inputs.'), { status: 400 });
      return {};
    }
    if (id === 'lighting.configure_research_scene_mm') {
      if (Object.keys(value).length) throw Object.assign(new Error('This operation takes no inputs.'), { status: 400 });
      return {};
    }
    if (id === 'lighting.inspect_subject_bounds') {
      if (Object.keys(value).length) throw Object.assign(new Error('This operation takes no inputs.'), { status: 400 });
      return {};
    }
    if (id === 'lighting.inspect_light_graphs') {
      const unknown = Object.keys(value).filter(key => !['types', 'max_assets'].includes(key));
      if (unknown.length) throw Object.assign(new Error(`Unsupported input: ${unknown[0]}`), { status: 400 });
      const types = value.types == null ? CATEGORIES.slice() : value.types;
      if (!Array.isArray(types) || !types.length || types.length > CATEGORIES.length || types.some(type => !CATEGORIES.includes(type)) || new Set(types).size !== types.length)
        throw Object.assign(new Error('types must be a unique list chosen from area, point, ies, and spotlight.'), { status: 400 });
      const maxAssets = value.max_assets == null ? 12 : value.max_assets;
      if (!Number.isInteger(maxAssets) || maxAssets < 1 || maxAssets > 40)
        throw Object.assign(new Error('max_assets must be an integer from 1 to 40.'), { status: 400 });
      return { types: types.slice(), max_assets: maxAssets };
    }
    if (id === 'lighting.probe_native_point_spot') {
      const allowed = ['id', 'type', 'pos', 'target', 'power', 'radius', 'angle', 'falloff', 'constant_output'];
      const unknown = Object.keys(value).filter(key => !allowed.includes(key));
      if (unknown.length) throw Object.assign(new Error(`Unsupported input: ${unknown[0]}`), { status: 400 });
      if (typeof value.id !== 'string' || !/^research_[A-Za-z0-9_-]{1,39}$/.test(value.id)) throw Object.assign(new Error('id must start with research_ and contain at most 48 characters.'), { status: 400 });
      if (!['point', 'spotlight'].includes(value.type)) throw Object.assign(new Error('type must be point or spotlight.'), { status: 400 });
      const vector = key => {
        const v = value[key];
        if (!Array.isArray(v) || v.length !== 3 || v.some(n => typeof n !== 'number' || !Number.isFinite(n))) throw Object.assign(new Error(`${key} must be a three-number vector.`), { status: 400 });
        return v.slice();
      };
      const pos = vector('pos'), target = vector('target');
      if (Math.hypot(...pos.map((n, i) => n - target[i])) < 1e-4) throw Object.assign(new Error('pos and target must be distinct.'), { status: 400 });
      const power = value.power == null ? 60000 : value.power;
      const radius = value.radius == null ? 0 : value.radius;
      const angle = value.angle == null ? 45 : value.angle;
      const falloff = value.falloff == null ? 0.5 : value.falloff;
      const constant_output = value.constant_output == null ? true : value.constant_output;
      if (typeof power !== 'number' || !Number.isFinite(power) || power < 0.1 || power > 10000000) throw Object.assign(new Error('power must be between 0.1 and 10000000 lumens.'), { status: 400 });
      if (typeof radius !== 'number' || !Number.isFinite(radius) || radius < 0 || radius > 10000) throw Object.assign(new Error('radius must be between 0 and 10000 mm.'), { status: 400 });
      if (typeof angle !== 'number' || !Number.isFinite(angle) || angle < 1 || angle > 120) throw Object.assign(new Error('angle must be between 1 and 120 degrees.'), { status: 400 });
      if (typeof falloff !== 'number' || !Number.isFinite(falloff) || falloff < 0 || falloff > 1) throw Object.assign(new Error('falloff must be between 0 and 1.'), { status: 400 });
      if (typeof constant_output !== 'boolean') throw Object.assign(new Error('constant_output must be true or false.'), { status: 400 });
      return { id: value.id, type: value.type, pos, target, power, radius, angle, falloff, constant_output };
    }
    if (id === 'lighting.probe_native_ies') {
      const allowed = ['id', 'asset_id', 'pos', 'target', 'multiplier', 'radius', 'axis', 'rgb'];
      const unknown = Object.keys(value).filter(key => !allowed.includes(key));
      if (unknown.length) throw Object.assign(new Error(`Unsupported input: ${unknown[0]}`), { status: 400 });
      if (typeof value.id !== 'string' || !/^research_[A-Za-z0-9_-]{1,39}$/.test(value.id)) throw Object.assign(new Error('id must start with research_ and contain at most 48 characters.'), { status: 400 });
      if (typeof value.asset_id !== 'string' || value.asset_id.length > 480 || !value.asset_id.replace(/\\/g, '/').startsWith('Light/IES Light/') || value.asset_id.replace(/\\/g, '/').split('/').includes('..') || !value.asset_id.toLowerCase().endsWith('.mtl'))
        throw Object.assign(new Error('asset_id must be an exact .mtl path from the installed KeyShot IES Light folder.'), { status: 400 });
      const vector = key => {
        const v = value[key];
        if (!Array.isArray(v) || v.length !== 3 || v.some(n => typeof n !== 'number' || !Number.isFinite(n))) throw Object.assign(new Error(`${key} must be a three-number vector.`), { status: 400 });
        return v.slice();
      };
      const pos = vector('pos'), target = vector('target');
      if (Math.hypot(...pos.map((n, i) => n - target[i])) < 1e-4) throw Object.assign(new Error('pos and target must be distinct.'), { status: 400 });
      const multiplier = value.multiplier == null ? 1 : value.multiplier;
      const radius = value.radius == null ? 0 : value.radius;
      if (typeof multiplier !== 'number' || !Number.isFinite(multiplier) || multiplier < 0.001 || multiplier > 1000000) throw Object.assign(new Error('multiplier must be between 0.001 and 1000000.'), { status: 400 });
      if (typeof radius !== 'number' || !Number.isFinite(radius) || radius < 0 || radius > 10000) throw Object.assign(new Error('radius must be between 0 and 10000 mm.'), { status: 400 });
      if (value.axis != null && (!Number.isInteger(value.axis) || value.axis < 0 || value.axis > 5)) throw Object.assign(new Error('axis must be an integer from 0 through 5.'), { status: 400 });
      const out = { id: value.id, asset_id: value.asset_id.replace(/\\/g, '/'), pos, target, multiplier, radius };
      if (value.axis != null) out.axis = value.axis;
      if (value.rgb != null) {
        const rgb = vector('rgb');
        if (rgb.some(n => n < 0 || n > 1)) throw Object.assign(new Error('rgb values must be between 0 and 1.'), { status: 400 });
        out.rgb = rgb;
      }
      return out;
    }
    if (id === 'lighting.apply_area_light_recipe') {
      const allowed = ['id', 'type', 'pos', 'target', 'size', 'power', 'kelvin', 'rgb', 'visible_eye', 'visible_refl', 'visible_shadows'];
      const unknown = Object.keys(value).filter(key => !allowed.includes(key));
      if (unknown.length) throw Object.assign(new Error(`Unsupported input: ${unknown[0]}`), { status: 400 });
      const idValue = value.id;
      if (typeof idValue !== 'string' || !/^[A-Za-z0-9_-]{1,48}$/.test(idValue)) throw Object.assign(new Error('id must contain 1 to 48 letters, digits, underscores, or hyphens.'), { status: 400 });
      if (value.type != null && value.type !== 'area') throw Object.assign(new Error('Only rectangular Area Light recipes are runnable in this probe.'), { status: 400 });
      const vector = (key, length) => {
        const v = value[key];
        if (!Array.isArray(v) || v.length !== length || v.some(n => typeof n !== 'number' || !Number.isFinite(n))) throw Object.assign(new Error(`${key} must be a ${length}-number vector.`), { status: 400 });
        return v.slice();
      };
      const pos = vector('pos', 3), target = vector('target', 3), size = vector('size', 2);
      if (size.some(n => n <= 0 || n > 10000)) throw Object.assign(new Error('size values must be greater than 0 and no more than 10000 mm.'), { status: 400 });
      if (typeof value.power !== 'number' || !Number.isFinite(value.power) || value.power < 0.1 || value.power > 10000000) throw Object.assign(new Error('power must be between 0.1 and 10000000 lumens.'), { status: 400 });
      if (value.rgb != null && value.kelvin != null) throw Object.assign(new Error('Provide either kelvin or rgb, not both.'), { status: 400 });
      const output = { id: idValue, type: 'area', pos, target, size, power: value.power,
        visible_eye: value.visible_eye == null ? false : value.visible_eye,
        visible_refl: value.visible_refl == null ? true : value.visible_refl,
        visible_shadows: value.visible_shadows == null ? true : value.visible_shadows };
      for (const key of ['visible_eye', 'visible_refl', 'visible_shadows']) if (typeof output[key] !== 'boolean') throw Object.assign(new Error(`${key} must be true or false.`), { status: 400 });
      if (value.rgb != null) {
        const rgb = vector('rgb', 3);
        if (rgb.some(n => n < 0 || n > 1)) throw Object.assign(new Error('rgb values must be between 0 and 1.'), { status: 400 });
        output.rgb = rgb;
      } else {
        const kelvin = value.kelvin == null ? 5600 : value.kelvin;
        if (!Number.isInteger(kelvin) || kelvin < 2500 || kelvin > 9500) throw Object.assign(new Error('kelvin must be an integer from 2500 to 9500.'), { status: 400 });
        output.kelvin = kelvin;
      }
      return output;
    }
    if (id === 'lighting.create_native_light') {
      const allowed = ['id', 'type', 'pos', 'target', 'size', 'power', 'multiplier', 'radius', 'angle', 'falloff', 'constant_output', 'ies_asset_id', 'axis', 'kelvin', 'rgb', 'visible_eye', 'visible_refl', 'visible_shadows'];
      const unknown = Object.keys(value).filter(key => !allowed.includes(key));
      if (unknown.length) throw Object.assign(new Error(`Unsupported input: ${unknown[0]}`), { status: 400 });
      if (typeof value.id !== 'string' || !/^research_[A-Za-z0-9_-]{1,39}$/.test(value.id)) throw Object.assign(new Error('id must start with research_ and contain at most 48 characters.'), { status: 400 });
      if (!CATEGORIES.includes(value.type)) throw Object.assign(new Error('type must be area, point, ies, or spotlight.'), { status: 400 });
      const vector = (key, length) => {
        const v = value[key];
        if (!Array.isArray(v) || v.length !== length || v.some(n => typeof n !== 'number' || !Number.isFinite(n))) throw Object.assign(new Error(`${key} must be a ${length}-number vector.`), { status: 400 });
        return v.slice();
      };
      const pos = vector('pos', 3), target = vector('target', 3);
      if (Math.hypot(...pos.map((n, i) => n - target[i])) < 1e-4) throw Object.assign(new Error('pos and target must be distinct.'), { status: 400 });
      const size = value.type === 'area' ? vector('size', 2) : [10, 10];
      if (size.some(n => n <= 0 || n > 10000)) throw Object.assign(new Error('size values must be greater than 0 and no more than 10000 mm.'), { status: 400 });
      const output = { id: value.id, type: value.type, pos, target, size,
        radius: value.radius == null ? 0 : value.radius,
        angle: value.angle == null ? 45 : value.angle,
        falloff: value.falloff == null ? 0.5 : value.falloff,
        constant_output: value.constant_output == null ? true : value.constant_output };
      if (typeof output.radius !== 'number' || !Number.isFinite(output.radius) || output.radius < 0 || output.radius > 10000) throw Object.assign(new Error('radius must be from 0 to 10000 mm.'), { status: 400 });
      if (typeof output.angle !== 'number' || !Number.isFinite(output.angle) || output.angle < 1 || output.angle > 120) throw Object.assign(new Error('angle must be from 1 to 120 degrees.'), { status: 400 });
      if (typeof output.falloff !== 'number' || !Number.isFinite(output.falloff) || output.falloff < 0 || output.falloff > 1) throw Object.assign(new Error('falloff must be from 0 to 1.'), { status: 400 });
      if (typeof output.constant_output !== 'boolean') throw Object.assign(new Error('constant_output must be true or false.'), { status: 400 });
      if (value.type === 'ies') {
        const asset = String(value.ies_asset_id || '').replace(/\\/g, '/');
        if (!asset.startsWith('Light/IES Light/') || asset.split('/').includes('..') || !asset.toLowerCase().endsWith('.mtl')) throw Object.assign(new Error('ies_asset_id must be an exact installed .mtl path under Light/IES Light.'), { status: 400 });
        output.ies_asset_id = asset;
        output.multiplier = value.multiplier == null ? 1 : value.multiplier;
        if (typeof output.multiplier !== 'number' || !Number.isFinite(output.multiplier) || output.multiplier < 0.001 || output.multiplier > 1000000) throw Object.assign(new Error('multiplier must be from 0.001 to 1000000.'), { status: 400 });
        if (value.axis != null) {
          if (!Number.isInteger(value.axis) || value.axis < 0 || value.axis > 5) throw Object.assign(new Error('axis must be an integer from 0 through 5.'), { status: 400 });
          output.axis = value.axis;
        }
      } else {
        output.power = value.power == null ? 60000 : value.power;
        if (typeof output.power !== 'number' || !Number.isFinite(output.power) || output.power < 0.1 || output.power > 10000000) throw Object.assign(new Error('power must be from 0.1 to 10000000 lumens.'), { status: 400 });
      }
      if (value.rgb != null && value.kelvin != null) throw Object.assign(new Error('Provide either kelvin or rgb, not both.'), { status: 400 });
      if (value.rgb != null) {
        const rgb = vector('rgb', 3);
        if (rgb.some(n => n < 0 || n > 1)) throw Object.assign(new Error('rgb values must be from 0 to 1.'), { status: 400 });
        output.rgb = rgb;
      } else if (value.type !== 'ies' || value.kelvin != null) {
        const kelvin = value.kelvin == null ? 5600 : value.kelvin;
        if (!Number.isInteger(kelvin) || kelvin < 1500 || kelvin > 12000) throw Object.assign(new Error('kelvin must be an integer from 1500 to 12000.'), { status: 400 });
        output.kelvin = kelvin;
      }
      if (value.type === 'area') {
        output.visible_eye = value.visible_eye == null ? false : value.visible_eye;
        output.visible_refl = value.visible_refl !== false;
        output.visible_shadows = value.visible_shadows !== false;
        for (const key of ['visible_eye', 'visible_refl', 'visible_shadows']) if (typeof output[key] !== 'boolean') throw Object.assign(new Error(`${key} must be true or false.`), { status: 400 });
      } else if (['visible_eye', 'visible_refl', 'visible_shadows'].some(key => value[key] != null)) {
        throw Object.assign(new Error('Camera, reflection, and shadow visibility controls are only available for Area lights.'), { status: 400 });
      }
      return output;
    }
    if (id === 'lighting.list_installed_ies_profiles') {
      const unknown = Object.keys(value).filter(key => key !== 'limit');
      if (unknown.length) throw Object.assign(new Error(`Unsupported input: ${unknown[0]}`), { status: 400 });
      const limit = value.limit == null ? 40 : value.limit;
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw Object.assign(new Error('limit must be an integer from 1 to 100.'), { status: 400 });
      return { limit };
    }
    if (id === 'lighting.remove_native_light') {
      if (Object.keys(value).some(key => key !== 'id') || typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{1,48}$/.test(value.id)) throw Object.assign(new Error('id must contain 1 to 48 letters, digits, underscores, or hyphens.'), { status: 400 });
      return { id: value.id };
    }
    if (id === 'lighting.capture_diagnostic_passes') {
      const allowed = ['direct', 'indirect', 'reflection', 'shadow', 'raw', 'clown', 'depth', 'normals'];
      const unknown = Object.keys(value).filter(key => !['passes', 'width', 'height', 'secs', 'render_engine', 'measurement_target'].includes(key));
      if (unknown.length) throw Object.assign(new Error(`Unsupported input: ${unknown[0]}`), { status: 400 });
      const passes = value.passes == null ? ['clown', 'reflection', 'shadow'] : value.passes;
      if (!Array.isArray(passes) || !passes.length || passes.length > allowed.length || passes.some(pass => !allowed.includes(pass)) || new Set(passes).size !== passes.length)
        throw Object.assign(new Error('passes must be a unique list of supported diagnostic passes.'), { status: 400 });
      const width = value.width == null ? 640 : value.width;
      const height = value.height == null ? 400 : value.height;
      const secs = value.secs == null ? 2 : value.secs;
      const engines = ['current', 'product_cpu', 'interior_cpu', 'product_gpu', 'interior_gpu'];
      const render_engine = value.render_engine == null ? 'current' : String(value.render_engine).toLowerCase();
      if (!engines.includes(render_engine)) throw Object.assign(new Error(`render_engine must be one of: ${engines.join(', ')}.`), { status: 400 });
      if (!Number.isInteger(width) || width < 32 || width > 1280 || width % 2 || !Number.isInteger(height) || height < 32 || height > 960 || height % 2 || width * height > 4000000)
        throw Object.assign(new Error('width/height must be even integers within 32x32 to 1280x960, at most 4 million pixels.'), { status: 400 });
      if (typeof secs !== 'number' || !Number.isFinite(secs) || secs < 0.5 || secs > 8)
        throw Object.assign(new Error('secs must be a number from 0.5 to 8.'), { status: 400 });
      let measurement_target;
      try { measurement_target = normalizeTarget(value.measurement_target); }
      catch (error) { throw Object.assign(error, { status: 400 }); }
      return { passes: passes.slice(), width, height, secs, render_engine, ...(measurement_target ? { measurement_target } : {}) };
    }
    throw Object.assign(new Error('No input schema is available for this operation.'), { status: 400 });
  }

  function writeRecord(record) {
    fs.mkdirSync(records, { recursive: true });
    const file = path.join(records, record.id + '.json');
    const temp = file + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(record, null, 2), 'utf8');
    fs.renameSync(temp, file);
    fs.appendFileSync(indexFile, JSON.stringify({ id: record.id, operation_id: record.operation_id,
      status: record.status, created_at: record.created_at, replay_of: record.replay_of || null }) + '\n', 'utf8');
  }

  function readRun(id) {
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) throw Object.assign(new Error('Invalid run id.'), { status: 400 });
    try { return JSON.parse(fs.readFileSync(path.join(records, id + '.json'), 'utf8')); }
    catch { throw Object.assign(new Error('Lighting research run not found.'), { status: 404 }); }
  }

  function listRuns(limit = 30) {
    let lines = [];
    try { lines = fs.readFileSync(indexFile, 'utf8').trim().split(/\r?\n/).filter(Boolean); } catch { /* no runs yet */ }
    return lines.slice(-Math.max(1, Math.min(100, limit))).reverse().map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
  }

  function outputFile(runId, name) {
    const record = readRun(runId);
    const entry = record.output && Array.isArray(record.output.files) && record.output.files.find(file => file.name === name);
    if (!entry || typeof entry.path !== 'string') throw Object.assign(new Error('Diagnostic output file not found.'), { status: 404 });
    const runRoot = path.resolve(SHOTS, 'lighting-lab', runId);
    const resolved = path.resolve(entry.path);
    if (!resolved.startsWith(runRoot + path.sep) || path.basename(resolved) !== name) throw Object.assign(new Error('Invalid diagnostic output path.'), { status: 403 });
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) throw Object.assign(new Error('Diagnostic output is not ready.'), { status: 404 });
    return { path: resolved, extension: path.extname(resolved).toLowerCase(), bytes: fs.statSync(resolved).size };
  }

  function validateOutput(output, inputs, runId, operationId) {
    const checks = [];
    if (operationId === 'lighting.inspect_scene_state') {
      checks.push({ id: 'keyshot_version_captured', pass: !!(output && output.keyshot && (output.keyshot.display_version || output.keyshot.version)) });
      checks.push({ id: 'read_only_operation_confirmed', pass: !!(output && output.read_only === true) });
      checks.push({ id: 'scene_inventory_captured', pass: !!(output && output.scene && typeof output.scene.unit === 'string' && Number.isFinite(output.scene.unitScale) && Array.isArray(output.geometry_ids) && Array.isArray(output.scene_materials) && Array.isArray(output.tree)) });
      checks.push({ id: 'scene_tree_entries_read', pass: !!(output && Array.isArray(output.tree) && output.tree.every(node => node && node.id != null && typeof node.name === 'string' && !node.read_error)) });
      checks.push({ id: 'scene_signature_captured', pass: !!(output && typeof output.scene_signature === 'string' && output.scene_signature.length === 64) });
      return checks;
    }
    if (operationId === 'lighting.restore_research_checkpoint') {
      checks.push({ id: 'checkpoint_reopened', pass: !!(output && output.reopened === true) });
      checks.push({ id: 'same_checkpoint_path_verified', pass: !!(output && output.path_verified === true && output.scene_path === inputs.expected_path) });
      checks.push({ id: 'five_forms_restored', pass: !!(output && output.forms_verified === true) });
      checks.push({ id: 'scene_tree_restored', pass: !!(output && output.tree_verified === true) });
      checks.push({ id: 'baseline_materials_restored', pass: !!(output && output.materials_verified === true) });
      checks.push({ id: 'millimeter_units_restored', pass: !!(output && output.units_verified === true && output.after_scene && output.after_scene.unit === 'mm' && output.after_scene.unitScale === 1000) });
      checks.push({ id: 'camera_and_geometry_preserved_during_unit_setup', pass: !!(output && output.unit_setup && output.unit_setup.non_camera_identity_preserved && output.unit_setup.camera_pose_preserved) });
      return checks;
    }
    if (operationId === 'lighting.inspect_control_surface') {
      checks.push({ id: 'keyshot_version_captured', pass: !!(output && output.keyshot && (output.keyshot.display_version || output.keyshot.version)) });
      checks.push({ id: 'read_only_operation_confirmed', pass: !!(output && output.read_only === true) });
      checks.push({ id: 'runtime_surface_returned', pass: !!(output && output.api_surface && Array.isArray(output.api_surface.lighting_related_lux_names) && output.api_surface.type_surfaces && output.api_surface.type_surfaces.Env) });
      checks.push({ id: 'render_engine_api_captured', pass: !!(output && Number.isFinite(output.keyshot?.render_engine) && output.api_surface?.constants && Object.keys(output.api_surface.constants).some(name => name.startsWith('RENDER_ENGINE_')) && output.api_surface?.function_docs?.setRenderEngine) });
      checks.push({ id: 'inspection_did_not_load_libraries', pass: !!(output && typeof output.inspection_scope === 'string' && output.inspection_scope.includes('no scene reads')) });
      return checks;
    }
    if (operationId === 'lighting.inspect_subject_bounds') {
      const finite3 = value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
      checks.push({ id: 'product_models_returned', pass: !!(output && Array.isArray(output.models) && output.models.length > 0) });
      checks.push({ id: 'world_bounds_are_finite', pass: !!(output && finite3(output.min) && finite3(output.max) && finite3(output.center) && Number.isFinite(output.span) && output.span > 0) });
      checks.push({ id: 'bounds_order_is_valid', pass: !!(output && finite3(output.min) && finite3(output.max) && output.min.every((n, i) => n <= output.max[i])) });
      return checks;
    }
    if (operationId === 'lighting.probe_native_point_spot') {
      const expectedShader = inputs.type === 'point' ? 'lux_point_light' : 'lux_spotlight';
      const readback = output && output.readback;
      checks.push({ id: 'tracked_light_created', pass: !!(output && output.created === true && output.id === inputs.id) });
      checks.push({ id: 'expected_shader_family_assigned', pass: !!(output && output.shader_type === expectedShader && typeof output.material === 'string' && output.material.length > 0) });
      checks.push({ id: 'power_and_radius_readback_match', pass: !!(readback && Number.isFinite(readback.power) && Math.abs(readback.power - inputs.power) <= Math.max(1e-4, inputs.power * 1e-5) && Number.isFinite(readback.radius) && Math.abs(readback.radius - inputs.radius) <= 1e-4) });
      checks.push({ id: 'color_readback_present', pass: !!(readback && Array.isArray(readback.color) && readback.color.length === 3 && readback.color.every(Number.isFinite)) });
      if (inputs.type === 'spotlight') {
        checks.push({ id: 'beam_controls_readback_match', pass: !!(readback && Math.abs(readback.angle - inputs.angle) <= 1e-4 && Math.abs(readback.falloff - inputs.falloff) <= 1e-4 && readback.focus_power_in_cone === inputs.constant_output) });
        checks.push({ id: 'verified_local_minus_y_axis', pass: !!(output && Array.isArray(output.aim_direction_local_minus_y) && output.aim_direction_local_minus_y.length === 3 && output.orientation && output.orientation.includes('local -Y')) });
      }
      return checks;
    }
    if (operationId === 'lighting.probe_native_ies') {
      const readback = output && output.readback;
      checks.push({ id: 'tracked_ies_source_created', pass: !!(output && output.created === true && output.id === inputs.id && output.type === 'ies') });
      checks.push({ id: 'ies_shader_assigned', pass: !!(output && output.shader_type === 'lux_ies_light' && typeof output.material === 'string') });
      checks.push({ id: 'profile_reference_found', pass: !!(output && output.profile_exists === true && typeof output.profile === 'string' && output.profile.toLowerCase() === String(readback?.file || '').split(/[\\/]/).pop()?.toLowerCase()) });
      checks.push({ id: 'photometric_parameters_read_back', pass: !!(readback && Number.isFinite(readback.multiplier) && Math.abs(readback.multiplier - inputs.multiplier) <= Math.max(1e-4, inputs.multiplier * 1e-5) && Number.isFinite(readback.radius) && Math.abs(readback.radius - inputs.radius) <= 1e-4 && Array.isArray(readback.color) && readback.color.length === 3) });
      if (inputs.axis != null) checks.push({ id: 'light_axis_read_back', pass: !!(readback && Math.abs(readback['light axis'] - inputs.axis) <= 1e-4) });
      return checks;
    }
    if (operationId === 'lighting.create_native_light') {
      const expectedShader = ({ area: 'lux_mesh_light', point: 'lux_point_light', ies: 'lux_ies_light', spotlight: 'lux_spotlight' })[inputs.type];
      const readback = output && output.readback;
      checks.push({ id: 'tracked_light_identity_matches', pass: !!(output && output.id === inputs.id && output.type === inputs.type && typeof output.material === 'string') });
      checks.push({ id: 'expected_native_shader_assigned', pass: !!(output && output.shader_type === expectedShader) });
      checks.push({ id: 'live_graph_values_returned', pass: !!(readback && typeof readback === 'object' && typeof readback.color !== 'undefined') });
      if (inputs.type === 'area') {
        checks.push({ id: 'area_power_and_placement_verified', pass: !!(readback && Number.isFinite(readback.power) && Math.abs(readback.power - inputs.power) <= Math.max(1e-4, inputs.power * 1e-5) && (!output.moved || (Number.isFinite(output.placement_err_mm) && output.placement_err_mm <= 0.5))) });
      } else if (inputs.type === 'ies') {
        const basename = String(readback?.file || '').split(/[\\/]/).pop()?.toLowerCase();
        checks.push({ id: 'profile_and_dimmer_readback_verified', pass: !!(output && output.ies_asset_id === inputs.ies_asset_id && typeof output.ies_profile === 'string' && output.ies_profile.toLowerCase() === basename && Number.isFinite(readback?.multiplier) && Math.abs(readback.multiplier - inputs.multiplier) <= Math.max(1e-4, inputs.multiplier * 1e-5)) });
        checks.push({ id: 'profile_asset_identity_matches', pass: !!(output && output.ies_asset_id === inputs.ies_asset_id) });
        if (output?.created === true && inputs.kelvin == null && inputs.rgb == null) checks.push({ id: 'native_profile_color_preserved', pass: !!(Array.isArray(output?.profile_native_color) && Array.isArray(readback?.color) && output.profile_native_color.length === 3 && output.profile_native_color.every((channel, i) => Math.abs(channel - readback.color[i]) <= 1e-5)) });
      } else {
        checks.push({ id: 'power_and_radius_readback_verified', pass: !!(readback && Number.isFinite(readback.power) && Math.abs(readback.power - inputs.power) <= Math.max(1e-4, inputs.power * 1e-5) && Number.isFinite(readback.radius) && Math.abs(readback.radius - inputs.radius) <= 1e-4) });
        if (inputs.type === 'spotlight') {
        checks.push({ id: 'beam_shape_and_axis_readback_verified', pass: !!(Math.abs(readback.angle - inputs.angle) <= 1e-4 && Math.abs(readback.falloff - inputs.falloff) <= 1e-4 && readback.focus_power_in_cone === inputs.constant_output && output.orientation && output.orientation.includes('local -Y') && Array.isArray(output.spotlight_local_minus_y_world) && output.spotlight_local_minus_y_world.length === 3) });
        }
      }
      return checks;
    }
    if (operationId === 'lighting.list_installed_ies_profiles') {
      const assets = output?.installed_files?.assets;
      checks.push({ id: 'catalog_is_read_only', pass: !!(output && output.read_only === true) });
      checks.push({ id: 'installed_assets_returned', pass: Array.isArray(assets) && assets.every(asset => asset.shader_type === 'lux_ies_light' && typeof asset.asset_id === 'string' && typeof asset.profile_exists === 'boolean') });
      checks.push({ id: 'photometry_state_reported', pass: Array.isArray(assets) && assets.every(asset => asset.photometry && ['parsed', 'unsupported', 'invalid', 'missing_profile'].includes(asset.photometry.status)) });
      return checks;
    }
    if (operationId === 'lighting.configure_research_scene_mm') {
      checks.push({ id: 'keyshot_version_captured', pass: !!(output && output.keyshot && (output.keyshot.display_version || output.keyshot.version)) });
      checks.push({ id: 'millimeter_units_verified', pass: !!(output && output.units_verified && output.after && output.after.unit === 'mm' && output.after.unitScale === 1000) });
      checks.push({ id: 'five_form_scene_verified', pass: !!(output && output.forms_verified && ['Sphere', 'Torus', 'Cube', 'Rounded Cube', 'Cylinder'].every(name => output.forms_after.includes(name)) ) });
      checks.push({ id: 'object_material_and_environment_state_preserved', pass: !!(output && output.non_camera_identity_preserved) });
      checks.push({ id: 'camera_pose_preserved_across_unit_conversion', pass: !!(output && output.camera_pose_preserved && Number.isFinite(output.camera_coordinate_factor)) });
      checks.push({ id: 'before_after_signatures_recorded', pass: !!(output && /^[0-9a-f]{64}$/.test(output.before_signature || '') && /^[0-9a-f]{64}$/.test(output.after_signature || '')) });
      return checks;
    }
    if (operationId === 'lighting.apply_area_light_recipe') {
      checks.push({ id: 'light_identity_matches_input', pass: !!(output && output.id === inputs.id) });
      checks.push({ id: 'area_light_material_assigned', pass: !!(output && typeof output.material === 'string' && output.material.length > 0) });
      checks.push({ id: 'light_write_applied', pass: !!(output && ((output.moved && Number.isFinite(output.placement_err_mm)) || (Array.isArray(output.params_changed) && output.params_changed.length > 0))) });
      checks.push({ id: 'panel_placement_within_tolerance', pass: !!(output && (!output.moved || (Number.isFinite(output.placement_err_mm) && output.placement_err_mm <= 0.5))) });
      checks.push({ id: 'power_readback_matches_input', pass: !!(output && output.readback && Number.isFinite(output.readback.power) && Math.abs(output.readback.power - inputs.power) <= Math.max(1e-4, inputs.power * 1e-5)) });
      return checks;
    }
    if (operationId === 'lighting.remove_native_light') {
      checks.push({ id: 'light_removed', pass: !!(output && output.removed === true) });
      checks.push({ id: 'no_owned_geometry_remaining', pass: !!(output && Array.isArray(output.remaining_owned_geometry) && output.remaining_owned_geometry.length === 0) });
      checks.push({ id: 'millimeter_units_retained', pass: !!(output && output.scene_unit && output.scene_unit.unit === 'mm' && output.scene_unit.unitScale === 1000) });
      return checks;
    }
    if (inputs.passes) {
      const files = output && output.files;
      const found = new Set((files || []).map(file => file.pass));
      checks.push({ id: 'requested_passes_present', pass: !!(output && Array.isArray(files) && Array.isArray(output.missing_passes) && output.missing_passes.length === 0 && found.has('beauty') && inputs.passes.every(name => found.has(name))) });
      checks.push({ id: 'run_and_dimensions_match_inputs', pass: !!(output && output.run_id === runId && output.width === inputs.width && output.height === inputs.height && JSON.stringify(output.requested_passes) === JSON.stringify(inputs.passes)) });
      let fileHashesMatch = Array.isArray(files) && files.length > 0;
      const runRoot = path.resolve(SHOTS, 'lighting-lab', runId) + path.sep;
      try {
        for (const file of files || []) {
          const resolved = path.resolve(file.path || '');
          if (!resolved.startsWith(runRoot) || !fs.existsSync(resolved)) { fileHashesMatch = false; break; }
          const actual = crypto.createHash('sha256').update(fs.readFileSync(resolved)).digest('hex');
          if (actual !== file.sha256) { fileHashesMatch = false; break; }
        }
      } catch { fileHashesMatch = false; }
      checks.push({ id: 'output_file_hashes_match', pass: fileHashesMatch });
      let pngsDecode = Array.isArray(files) && files.some(file => file.pass === 'beauty');
      try {
        for (const file of files || []) {
          if (file.extension !== '.png') continue;
          const image = decode(fs.readFileSync(file.path));
          if (image.w !== output.width || image.h !== output.height) pngsDecode = false;
        }
      } catch { pngsDecode = false; }
      checks.push({ id: 'png_outputs_decode_at_requested_size', pass: pngsDecode });
      if (inputs.passes.includes('clown')) checks.push({ id: 'clown_product_mask_analyzed', pass: !!(output && output.analysis && output.analysis.available && output.analysis.product_mask && output.analysis.product) });
      checks.push({ id: 'scene_unchanged', pass: !!(output && output.scene_unchanged === true) });
      checks.push({ id: 'render_options_unchanged', pass: !!(output && output.render_options_unchanged === true) });
      checks.push({ id: 'render_engine_restored', pass: !!(output && output.render_engine_before === output.render_engine_after && output.render_engine_requested === inputs.render_engine) });
      const requestedEngineValue = inputs.render_engine === 'current' ? output?.render_engine_before : output?.render_engine_values?.[inputs.render_engine];
      checks.push({ id: 'requested_render_engine_used', pass: !!(output && output.render_engine_during === requestedEngineValue) });
      return checks;
    }
    const keyshot = output && output.keyshot;
    checks.push({ id: 'keyshot_version_captured', pass: !!(keyshot && (keyshot.display_version || keyshot.version)) });
    checks.push({ id: 'read_only_operation_confirmed', pass: !!(output && output.read_only === true) });
    const lights = output && output.lights;
    checks.push({ id: 'requested_types_returned', pass: !!lights && inputs.types.every(type => lights[type] && lights[type].shader_type && Array.isArray(lights[type].assets)) });
    const entries = inputs.types.flatMap(type => (lights && lights[type] && lights[type].assets) || []);
    const graphTypes = inputs.types.filter(type => type !== 'ies');
    checks.push({ id: 'matching_shader_graph_found', pass: !!lights && graphTypes.every(type => Array.isArray(lights[type]?.assets) && lights[type].assets.length > 0) });
    checks.push({ id: 'graph_parameters_typed', pass: entries.every(item => typeof item.material === 'string' && typeof item.shader_type === 'string' && Array.isArray(item.parameters) && item.parameters.every(p => typeof p.name === 'string' && Object.prototype.hasOwnProperty.call(p, 'type'))) });
    if (inputs.types.includes('ies')) {
      const installed = lights?.ies?.installed_files?.assets || [];
      checks.push({ id: 'ies_material_files_found', pass: installed.length > 0 });
      checks.push({ id: 'ies_profile_file_verified', pass: installed.some(asset => asset.shader_type === 'lux_ies_light' && asset.profile_exists === true && typeof asset.asset_id === 'string') });
    }
    return checks;
  }

  async function run({ operation_id, inputs, replay_of = null }) {
    if (busy) throw Object.assign(new Error('A lighting research operation is already running.'), { status: 409 });
    const normalized = normalizeInputs(operation_id, inputs);
    const record = {
      id: makeId(), operation_id, operation_version: OPERATION_VERSION,
      created_at: new Date().toISOString(), replay_of,
      effect: operation(operation_id).effect, inputs: normalized,
      preconditions: { bridge_alive: !!heartbeat().alive },
      status: 'running', validation: [], output: null, error: null
    };
    busy = true;
    try {
      if (!record.preconditions.bridge_alive) throw new Error('KeyShot is not connected. Connect the bridge, then retry this read-only inspection.');
      const bridgeOperations = {
        'lighting.inspect_control_surface': 'lighting_control_surface',
        'lighting.inspect_scene_state': 'lighting_scene_snapshot',
        'lighting.restore_research_checkpoint': 'lighting_restore_research_checkpoint',
        'lighting.configure_research_scene_mm': 'lighting_configure_scene_mm',
        'lighting.inspect_subject_bounds': 'subject',
        'lighting.inspect_light_graphs': 'lighting_inspect',
        'lighting.probe_native_point_spot': 'lighting_point_spot_probe',
        'lighting.probe_native_ies': 'lighting_ies_probe',
        'lighting.create_native_light': 'light_set',
        'lighting.list_installed_ies_profiles': 'lighting_ies_assets',
        'lighting.apply_area_light_recipe': 'light_set',
        'lighting.remove_native_light': 'light_remove',
        'lighting.capture_diagnostic_passes': 'lighting_render_passes'
      };
      const bridgeOperation = bridgeOperations[operation_id];
      const payload = operation_id === 'lighting.capture_diagnostic_passes' ? { ...normalized, run_id: record.id } : normalized;
      const output = await send(bridgeOperation, payload, operation_id === 'lighting.capture_diagnostic_passes' ? 60000 : 45000);
      if (operation_id === 'lighting.capture_diagnostic_passes') {
        try { output.analysis = analyzeCapture(output.files, normalized); }
        catch (error) { output.analysis = { available: false, reason: String(error.message || error).slice(0, 240) }; }
        if (record.replay_of) {
          try {
            const previous = readRun(record.replay_of);
            if (previous.operation_id === operation_id && Array.isArray(previous.output?.files)) {
              output.analysis.comparison_to = {
                run_id: previous.id,
                result: compareCaptures(previous.output.files, output.files, 1e-4, {
                  require_metadata: true, reference: previous.output.capture_metadata,
                  candidate: output.capture_metadata
                })
              };
            }
          } catch { /* Keep the current capture analysis if the source run is unavailable. */ }
        }
      }
      record.output = output;
      record.keyshot = output.keyshot || null;
      record.validation = validateOutput(output, normalized, record.id, operation_id);
      record.status = record.validation.every(check => check.pass) ? 'verified_shape' : 'needs_review';
      record.result_hash = crypto.createHash('sha256').update(JSON.stringify(output)).digest('hex');
    } catch (error) {
      record.status = 'failed';
      record.error = String(error && error.message || error).slice(0, 500);
      record.validation = [{ id: 'operation_completed', pass: false }];
    } finally {
      record.finished_at = new Date().toISOString();
      try { writeRecord(record); }
      catch (error) { record.record_error = `Could not persist research record: ${String(error.message).slice(0, 200)}`; }
      busy = false;
    }
    return record;
  }

  async function replay({ run_id, inputs }) {
    const previous = readRun(run_id);
    const op = operation(previous.operation_id);
    if (!op || !op.replayable || !op.runnable) throw Object.assign(new Error('This operation is not approved for replay.'), { status: 409 });
    return run({ operation_id: op.id, inputs: inputs == null ? previous.inputs : inputs, replay_of: previous.id });
  }

  return {
    catalog: () => ({ schema_version: '1.0', pattern: 'discover → validate inputs → execute typed operation → record output → replay with new inputs → check result', operations: clone(OPERATIONS), runs: listRuns() }),
    listRuns,
    getRun: readRun,
    outputFile,
    run,
    replay,
    isBusy: () => busy
  };
}

module.exports = { createLightingLab };
