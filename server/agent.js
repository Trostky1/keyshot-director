// agent.js - the prompt box. Turns plain language (and attached reference images) into actions on the live KeyShot scene.
//
// Two engines share one tool loop:
//   * Claude (needs the user's own Anthropic API key, saved locally in config.local.json - never shared or uploaded elsewhere)
//   * Offline mode (no key): a small keyword router for the basic commands, so the app is usable and testable without AI.
const fs = require('fs');
const path = require('path');
const cli = require('./cli');

const CONFIG = path.join(__dirname, '..', 'config.local.json');
const readSkill = name => { try { return fs.readFileSync(path.join(__dirname, '..', 'skills', name, 'SKILL.md'), 'utf8'); } catch { return ''; } };
const getConfig = () => { try { return JSON.parse(fs.readFileSync(CONFIG, 'utf8')); } catch { return {}; } };
const setConfig = patch => { const c = { ...getConfig(), ...patch }; fs.writeFileSync(CONFIG, JSON.stringify(c, null, 2)); return c; };
const publicConfig = () => { const c = getConfig(); return { hasKey: !!(c.apiKey || process.env.ANTHROPIC_API_KEY), model: c.model || 'claude-sonnet-5-5', codexModel: c.codexModel || '', engine: c.engine || 'auto', cliPath: c.cliPath || '', codexPath: c.codexPath || '' }; };
// Which engine answers (engine setting: auto | cli (Claude) | codex (ChatGPT) | api | offline). Automatic tries, in order:
// a signed-in Claude CLI, a signed-in Codex (ChatGPT) CLI, an API key, then offline.
async function pickEngine(cfg = getConfig()) {
  const key = !!(cfg.apiKey || process.env.ANTHROPIC_API_KEY), want = cfg.engine || 'auto';
  if (want === 'offline') return { engine: 'offline' };
  if (want === 'api') return key ? { engine: 'api' } : { engine: 'offline', why: 'No API key is set.' };
  if (want === 'auto' || want === 'cli') {
    const st = await cli.status(cfg.cliPath);
    if (st.found && st.loggedIn) return { engine: 'cli', provider: 'claude', bin: st.path };
    if (want === 'cli') return { engine: 'offline', why: st.found ? 'The Claude CLI is not signed in. Run  "' + st.path + '" auth login  once in a terminal.' : 'The Claude CLI was not found on this computer.' };
  }
  if (want === 'auto' || want === 'codex') {
    const cx = await cli.codexStatus(cfg.codexPath);
    if (cx.found && cx.loggedIn) return { engine: 'cli', provider: 'codex', bin: cx.path };
    if (want === 'codex') return { engine: 'offline', why: cx.found ? 'The Codex CLI is not signed in. Run  "' + cx.path + '" login  once in a terminal.' : 'The Codex (ChatGPT) CLI was not found on this computer.' };
  }
  return key ? { engine: 'api' } : { engine: 'offline' };
}
async function engineStatus() {
  const cfg = getConfig(), st = await cli.status(cfg.cliPath), cx = await cli.codexStatus(cfg.codexPath), e = await pickEngine(cfg);
  return { engine: e.engine, provider: e.provider || null, why: e.why || null, hasKey: !!(cfg.apiKey || process.env.ANTHROPIC_API_KEY), want: cfg.engine || 'auto',
    cli: { found: st.found, loggedIn: st.loggedIn, path: st.path, searched: st.searched || [], error: st.error || null },
    codex: { found: cx.found, loggedIn: cx.loggedIn, path: cx.path, method: cx.method || null, searched: cx.searched || [], error: cx.error || null } };
}


const SYSTEM = `You are the director inside "KeyShot Director", a companion app that drives the user's OPEN KeyShot scene live. You light and move the camera around the user's own product, so a non-expert can get studio-grade results in plain language.

How to work
- Act through the tools; do not just describe. After changing something, call look to check the live viewport and judge it like a photographer (exposure, contrast, highlights, backdrop, where the light falls) and fix obvious problems before reporting.
- Lighting is the priority. Start from a rig (apply_rig) that fits the request, then tune with set_light / set_exposure / auto_expose. A rig adapts to the product's size automatically. Only build lights by hand when no rig is close.
- For "make it look like this photo": call match_photo with the attached reference and the user's brief. It builds custom lights and checks a real render; do not build a preset first. Keep framing off unless requested. For a named existing style folder, analyze_style (if needed) then match_style.
- For closeups, call frame_product; focus [0,0.25,0] favors the upper detail, fill above 1 permits a crop. Environment tone, ground shadows and reflections are controllable with set_environment. Never change product materials to imitate a differently colored reference product.
- Scene staging: FIRST call scene_objects to discover exact numeric node IDs, assembly structure, bounds and scene units. Never guess IDs or select lights/root/model sets. For whole-product movement/duplication select the product model, not an individual button or mesh. If there are multiple plausible products, ask which one. Hidden objects remain hidden; do not stage them unless explicitly requested.
- move_object changes actual geometry, not the camera. translation is a world-space delta; position is the desired world-space bounding center and overrides translation. rotation is an incremental [X,Y,Z] rotation in degrees about the assembly center, applied X then Y then Z; Y is up. scale is a uniform multiplier. Coordinates/sizes are native scene units, NOT automatically millimeters: read scene_objects.scene unit/meter scale before converting physical measurements. Report what you chose.
- duplicate_object creates count ADDITIONAL copies (1–8); offset and rotation accumulate per copy. Use linked_materials=true by default to preserve the shared product look. Get fresh scene_objects after staging; do not reuse old dimensions. Duplicate IDs are returned. Keep the original assembly untouched when arranging copies unless asked to move it.
- create_set_piece imports neutral diffuse box geometry. size is [width,height,depth]; position is its center, not bottom. A pedestal is a box. A floor is a wide thin box, a backdrop a wide tall thin box; choose dimensions from product bounds. To support a product whose bottom is bounds[0][1], set pedestal center Y = bottomY - height/2. These are physical shadow/reflection geometry, NOT a generated image, HDRI, curved sweep or complex prop. Set-piece material editing is not yet supported; use KeyShot for colors/gloss/materials. Never claim an unsupported curved backdrop was created.
- Each successful geometry operation has a native-transform staging undo (last 20 operations, current KeyShot session). undo_staging reverses ONE geometry operation; repeat only when user asks to revert multiple. It removes only geometry recorded as created by staging, and never original user geometry. Photo undo and studio_off do NOT undo staging. Do not save the scene. If a tool fails, inspect state, report accurately, and do not repeatedly retry a destructive operation.
- Camera: set_camera for a still angle; play_motion for a move (orbit, push-in, reveal, crane, whip). These preview live in the viewport. To turn a move into a video, or to copy the lighting and camera work of a reference VIDEO, point the user at the "Reference video" panel (drop a clip, then Play move / Render video); you cannot do that from here.
- Material Lab can inspect existing scene material graphs. Director-created materials are editable. An existing scene material is editable only after the user explicitly enables editing for that exact material in the Material Inspector; list_materials reports the authorized target. Never edit another material or change graph structure on an existing scene material. You may adjust only concrete numeric, boolean or RGB(A) parameters surfaced by inspect_material. Existing-material edits are live and may affect every part sharing that material; use undo_material if a value is wrong.
- For actual imported PBR texture sets, call list_texture_sets, select the intended set, then build_material_from_texture_set. This creates a NEW unassigned Plastic graph and saves it to the KeyShot library plus a portable KMP; it never applies the material to geometry. Verified KeyShot 2026.2 channels: Base Color→Diffuse, Roughness→Color To Number→Plastic Roughness, and Normal (or Bump fallback)→Bump. Report which files were used and which were skipped. Specular, Metallic, AO and displacement are not connected by this converter; do not imply they were. The KMP packages the connected image files. The original imported files are preserved unchanged.
- For photo-inspired materials without an imported map set, create an unassigned material and tune only exposed values. Image references do not disclose a unique shader or map. New Director materials are unassigned; the user drags them onto parts in KeyShot.
- Director light controls can toggle visibility to camera, in reflections, and in shadows without hiding the light node. These are not KeyShot's native Light Layers, which isolate lighting per part and currently have no bridge API. For native Light Layers direct the user to KeyShot's panel; do not claim Director applied one.
- KeyShot already has its own environment, cameras, timeline and render dialog. Never save the scene or render unless asked.
- Be concise. Say what you changed in one or two plain sentences. If a request is ambiguous in a way that changes the result a lot, ask one short question; otherwise pick a sensible default and say which.
- Lights are named CC_L_* and studio_off removes app lights/restores the original environment. Staging geometry is separately named CC_S_* and has undo_staging. Mention the appropriate restore action when adding objects.

Rigs: hero_soft (3-point, graphite backdrop), dark_moody (single big side key, near-black), glass_edge (edge-lit strips + back glow for glass/liquid), blank_studio (clean seamless white, catalog look), warm_luxe (warm key, deep brown-black). Light angles: azimuth 0 = straight on from the camera, negative = camera-left, positive = camera-right; elevation 0 = level, 90 = overhead; distance in multiples of the product size.`;

const TOOLS = [
  { name: 'scene_objects', description: 'Read live product models/set pieces, IDs, bounds, native units and locked/hidden flags. Pass node_id to inspect its immediate parts/groups. Pages of 8; use next_offset when non-null. Always inspect before staging.', input_schema: { type: 'object', properties: { node_id: { type: 'integer' }, offset: { type: 'integer', minimum: 0 } } } },
  { name: 'move_object', description: 'Transform real geometry/whole assembly. Incremental world translation and center-relative XYZ degrees; position overrides translation. Reversible by undo_staging.', input_schema: { type: 'object', properties: { node_id: { type: 'integer' }, translation: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 }, position: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 }, rotation: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 }, scale: { type: 'number', minimum: 0.1, maximum: 10 } }, required: ['node_id'] } },
  { name: 'duplicate_object', description: 'Duplicate assembly with intact materials. count is additional copies, offset/rotation accumulate for each. Linked materials default true.', input_schema: { type: 'object', properties: { node_id: { type: 'integer' }, count: { type: 'integer', minimum: 1, maximum: 8 }, offset: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 }, rotation: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 }, linked_materials: { type: 'boolean' } }, required: ['node_id'] } },
  { name: 'create_set_piece', description: 'Create actual neutral diffuse box geometry: pedestal, thin floor or flat backdrop. size XYZ and center position in native scene units. No curved sweeps/material editing.', input_schema: { type: 'object', properties: { kind: { type: 'string', enum: ['pedestal','floor','backdrop'] }, size: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 }, position: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 }, rotation: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 } }, required: ['kind','size','position'] } },
  { name: 'undo_staging', description: 'Undo ONE last geometry operation, restoring full original transforms or removing only this staging session’s creations. Separate from photo undo/studio_off.', input_schema: { type: 'object', properties: {} } },
  { name: 'match_photo', description: 'Match the first attached reference photo using custom product-scaled lighting and real KeyShot render feedback. Takes a few minutes; reversible from the photo panel. No material edits.', input_schema: { type: 'object', properties: { brief: { type: 'string' }, match_framing: { type: 'boolean' }, quality: { type: 'string', enum: ['quick','refined'] } } } },
  { name: 'frame_product', description: 'Frame the existing product or a cropped detail, retaining viewpoint.', input_schema: { type: 'object', properties: { kind: { type: 'string', enum: ['hero','detail'] }, focus: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 }, fill: { type: 'number' }, fov: { type: 'number' }, aspect: { type: 'number' } } } },
  { name: 'set_environment', description: 'Set environment illumination, display RGB background and ground treatment.', input_schema: { type: 'object', properties: { brightness: { type: 'number' }, rotation: { type: 'number' }, background: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 }, ground_shadows: { type: 'boolean' }, ground_reflections: { type: 'boolean' } } } },
  { name: 'get_state', description: 'Current rig, lights, exposure, camera pose, product size, and the style folders available.', input_schema: { type: 'object', properties: {} } },
  { name: 'look', description: 'Take a picture of the live KeyShot viewport (it is noisy while the real-time render converges; judge tone and light, not noise) plus brightness stats of the product.', input_schema: { type: 'object', properties: {} } },
  { name: 'apply_rig', description: 'Replace any previous AI lights with a ready-made studio rig scaled to the product, and auto-balance its exposure.', input_schema: { type: 'object', properties: { name: { type: 'string', enum: ['hero_soft', 'dark_moody', 'glass_edge', 'blank_studio', 'warm_luxe'] }, mirror: { type: 'boolean', description: 'flip left/right' }, auto_exposure: { type: 'boolean', description: 'default true' } }, required: ['name'] } },
  { name: 'set_light', description: 'Create or adjust one light (rectangular softbox/strip). Omitted fields keep their value. Camera/reflection/shadow visibility do not disable illumination or create native Light Layers.', input_schema: { type: 'object', properties: { id: { type: 'string' }, azimuth: { type: 'number', description: 'degrees, 0 = from camera side, negative = camera-left' }, elevation: { type: 'number', description: 'degrees above level' }, distance: { type: 'number', description: 'multiples of product size, 1.2-6' }, width: { type: 'number', description: 'multiples of product size' }, height: { type: 'number' }, brightness: { type: 'number', description: 'multiplier, 1 = rig default' }, kelvin: { type: 'number', description: '2000 warm - 9000 cool' }, in_reflections: { type: 'boolean' }, visible_to_camera: { type: 'boolean' }, in_shadows: { type: 'boolean' } }, required: ['id'] } },
  { name: 'list_materials', description: 'List names of materials in the live scene and materials created in Material Lab.', input_schema: { type: 'object', properties: {} } },
  { name: 'list_texture_sets', description: 'List imported texture sets and filename-based channel hints. Use this before building a KeyShot material from imported map files.', input_schema: { type: 'object', properties: {} } },
  { name: 'build_material_from_texture_set', description: 'Build a NEW unassigned Plastic material from an imported texture set and save it to KeyShot’s Material Library plus a portable KMP. Uses Base Color→Diffuse, Roughness→Color To Number→Plastic Roughness, and Normal/Bump→Bump. Never modifies or assigns an existing product material. Ask which set only if ambiguous.', input_schema: { type: 'object', properties: { texture_set_id: { type: 'string' }, name: { type: 'string', description: 'Optional descriptive material name' } }, required: ['texture_set_id'] } },
  { name: 'inspect_material', description: 'Read a scene material graph, node IDs, parameter names and concrete values. Use immediately before any authorized value edit.', input_schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  { name: 'create_material', description: 'Create a new unassigned diffuse material. Name MUST begin with Director . Does not alter the product.', input_schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  { name: 'set_material_value', description: 'Set a finite numeric, boolean or color-array parameter on a Director material or the one existing scene material explicitly unlocked by the user. Verify the exact name, node and parameter first. Does not connect texture nodes.', input_schema: { type: 'object', properties: { name: { type: 'string' }, node_id: { type: 'integer' }, parameter: { type: 'string' }, value: { anyOf: [{ type: 'number' }, { type: 'boolean' }, { type: 'array', items: { type: 'number' } }] } }, required: ['name', 'node_id', 'parameter', 'value'] } },
  { name: 'undo_material', description: 'Undo the last Director material value edit in this KeyShot bridge session.', input_schema: { type: 'object', properties: {} } },
  { name: 'save_material', description: 'Save a Director-created or explicitly unlocked scene material to KeyShot’s material library and export its portable KMP package to the local materials folder.', input_schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  { name: 'remove_light', description: 'Remove one light.', input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'set_exposure', description: 'Scale all lights (and the environment on white rigs). 1 = rig default, 2 = one stop brighter.', input_schema: { type: 'object', properties: { value: { type: 'number' } }, required: ['value'] } },
  { name: 'auto_expose', description: 'Measure the viewport and adjust exposure to the rig\'s target brightness.', input_schema: { type: 'object', properties: {} } },
  { name: 'studio_off', description: 'Remove every light this app made and restore the original environment.', input_schema: { type: 'object', properties: {} } },
  { name: 'set_camera', description: 'Set the camera around the product. Angles in degrees; with relative=true values are added to the current camera.', input_schema: { type: 'object', properties: { azimuth: { type: 'number' }, elevation: { type: 'number' }, distance: { type: 'number', description: 'mm from product centre' }, fov: { type: 'number', description: 'field of view degrees' }, relative: { type: 'boolean' } } } },
  { name: 'play_motion', description: 'Play a camera move in the live viewport.', input_schema: { type: 'object', properties: { preset: { type: 'string', enum: ['orbit_360', 'push_in', 'hero_reveal', 'crane_up', 'whip_settle'] }, duration: { type: 'number', description: 'seconds' } }, required: ['preset'] } },
  { name: 'analyze_style', description: 'Measure every image in a style folder (references/<name>) and build its look profile.', input_schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  { name: 'use_attached_images_as_style', description: 'Save attached images into a new style folder and analyze them, preserving previous references. Use the returned name when calling match_style.', input_schema: { type: 'object', properties: {} } },
  { name: 'match_style', description: 'Tune the current rig toward a style folder\'s look by measuring the live viewport (takes 1-3 minutes). Build a rig first.', input_schema: { type: 'object', properties: { name: { type: 'string' }, look: { type: 'string', description: 'optional look id, e.g. light or dark' } }, required: ['name'] } },
];

// ------------------------------------------------------------------------------------------------------------------------
async function callClaude(cfg, messages, signal, system = SYSTEM, tools = TOOLS) {
  const key = cfg.apiKey || process.env.ANTHROPIC_API_KEY;
  const base = (cfg.baseUrl || process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, '');   // override only for proxies / tests
  const r = await fetch(base + '/v1/messages', {
    method: 'POST', signal,
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: cfg.model || 'claude-sonnet-5-5', max_tokens: 2048, system, tools, messages }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(r.status === 401 ? 'The API key was rejected - check it in Settings.' : (j.error && j.error.message) || ('API error ' + r.status));
  return j;
}

// ---- CLI engine (the user's signed-in Claude Code): no API key. The model answers with a JSON object of tool calls. ----
const CLI_PROTOCOL = `

HOW TO ANSWER (important): you cannot call tools directly here. Reply with ONE JSON object and nothing else:
{"say": "text for the user, or empty", "calls": [{"name": "<tool name>", "input": { ... }}]}
- "calls" run in order. Leave it empty ([]) when you are finished and only want to talk to the user.
- After your calls run you will see their results and can answer again; keep going until the job is done.
- Images are saved as files and shown as [image: <path>]: look at them (read the file, or they are already attached).
Tools you may call:
` + TOOLS.map(t => '- ' + t.name + ' ' + JSON.stringify(t.input_schema.properties || {}) + ' : ' + t.description).join('\n');

function renderForCli(messages, dir) {
  let n = 0; const lines = [];
  const img = b64 => { const f = path.join(dir, 'img_' + (++n) + '.' + (b64.mt.includes('png') ? 'png' : 'jpg')); fs.writeFileSync(f, Buffer.from(b64.data, 'base64')); return '[image: ' + f + ']'; };
  for (const m of messages) {
    if (typeof m.content === 'string') { lines.push((m.role === 'user' ? 'USER: ' : 'YOU: ') + m.content); continue; }
    const parts = [];
    for (const b of m.content) {
      if (b.type === 'text') parts.push(b.text);
      else if (b.type === 'image') parts.push(img({ mt: b.source.media_type, data: b.source.data }));
      else if (b.type === 'tool_use') parts.push('(called ' + b.name + ' ' + JSON.stringify(b.input) + ')');
      else if (b.type === 'tool_result') parts.push('RESULT of call ' + b.tool_use_id + (b.is_error ? ' (ERROR)' : '') + ': ' + (Array.isArray(b.content) ? b.content.map(c => c.type === 'image' ? img({ mt: c.source.media_type, data: c.source.data }) : c.text).join(' ') : String(b.content)));
    }
    lines.push((m.role === 'user' ? 'USER/TOOLS: ' : 'YOU: ') + parts.join('\n'));
  }
  return lines.join('\n\n');
}
async function callCli(cfg, eng, messages, signal, system = SYSTEM, tools = TOOLS) {
  const dir = cli.tmpDir('chat');
  try {
    const prompt = renderForCli(messages, dir) + '\n\nYOUR TURN. Reply with the JSON object only.';
    const images = fs.readdirSync(dir).filter(f => /^img_[0-9]+[.](png|jpg)$/.test(f)).map(f => path.join(dir, f));
    const protocol = CLI_PROTOCOL.slice(0, CLI_PROTOCOL.indexOf('Tools you may call:')) + 'Tools you may call:\n' + tools.map(t => '- ' + t.name + ' ' + JSON.stringify(t.input_schema.properties || {}) + ' : ' + t.description).join('\n');
    const text = await cli.ask({ provider: eng.provider, bin: eng.bin, system: system + protocol, prompt, dir, images, model: eng.provider === 'codex' ? cfg.codexModel : cfg.cliModel, signal });
    let o; try { o = cli.extractJson(text); } catch { o = { say: text.trim(), calls: [] }; }      // plain prose = just talking
    const calls = (Array.isArray(o.calls) ? o.calls : []).filter(c => c && tools.some(t => t.name === c.name));
    const content = [...(o.say && String(o.say).trim() ? [{ type: 'text', text: String(o.say).trim() }] : []), ...calls.map((c, i) => ({ type: 'tool_use', id: 'cli' + Date.now() + '_' + i, name: c.name, input: c.input || {} }))];
    return { stop_reason: calls.length ? 'tool_use' : 'end_turn', content };
  } finally { cli.rmDir(dir); }
}

// Offline engine: maps simple phrases to the same tool calls. Not AI - it only knows the basics.
function offlineModel(text) {
  const t = (text || '').toLowerCase(); const calls = []; let say = '';
  if (/undo.*stag|revert.*stag/.test(t)) return { offline: true, text: '', calls: [{ name: 'undo_staging', input: {} }] };
  if (/duplicate|pedestal|backdrop|move.*(product|object|phone)|rotate.*(product|object|phone)|scene objects/.test(t)) return { offline: true, text: 'Scene staging needs a signed-in Codex/Claude CLI or API engine for free-form instructions. Here is the live object inventory; no geometry was changed.', calls: [{ name: 'scene_objects', input: {} }] };
  const rig = [['hero', 'hero_soft'], ['3-point', 'hero_soft'], ['three point', 'hero_soft'], ['moody', 'dark_moody'], ['dark', 'dark_moody'], ['glass', 'glass_edge'], ['edge', 'glass_edge'], ['blank', 'blank_studio'], ['white', 'blank_studio'], ['clean', 'blank_studio'], ['catalog', 'blank_studio'], ['e-commerce', 'blank_studio'], ['ecommerce', 'blank_studio'], ['warm', 'warm_luxe'], ['luxe', 'warm_luxe'], ['luxury', 'warm_luxe']].find(([k]) => t.includes(k));
  if (/studio off|remove (all )?(the )?lights|reset (the )?light|clear (the )?light|restore/.test(t)) calls.push({ name: 'studio_off', input: {} });
  else if (/match|look like|style/.test(t)) { const m = t.match(/(?:style|folder|match)\s+(?:to\s+)?["']?([a-z0-9_\-]+)/); calls.push(...(m && !['the', 'my', 'these', 'this'].includes(m[1]) ? [{ name: 'match_style', input: { name: m[1] } }] : [])); if (!calls.length) say = 'Name a style folder, e.g. "match ecommerce" (offline mode cannot read attached images).'; }
  else if (rig) calls.push({ name: 'apply_rig', input: { name: rig[1], mirror: /mirror|flip/.test(t) } });
  if (/auto.?expos/.test(t)) calls.push({ name: 'auto_expose', input: {} });
  else if (/brighter|more light|increase exposure|lighter/.test(t)) calls.push({ name: 'set_exposure', input: { value: 1.4 } });
  else if (/darker|less light|decrease exposure|dim/.test(t)) calls.push({ name: 'set_exposure', input: { value: 0.7 } });
  const mot = [['orbit', 'orbit_360'], ['turntable', 'orbit_360'], ['spin', 'orbit_360'], ['push', 'push_in'], ['zoom in', 'push_in'], ['reveal', 'hero_reveal'], ['crane', 'crane_up'], ['whip', 'whip_settle']].find(([k]) => t.includes(k));
  if (mot) calls.push({ name: 'play_motion', input: { preset: mot[1] } });
  if (/\b(look|show|see|check)\b/.test(t) && !calls.length) calls.push({ name: 'look', input: {} });
  if (/state|status|what.*(now|rig|lights)/.test(t) && !calls.length) calls.push({ name: 'get_state', input: {} });
  if (!calls.length && !say) say = 'Offline mode understands: a rig name (hero, moody, glass, blank/white, warm), "studio off", "brighter/darker", "auto expose", "orbit / push in / reveal / crane / whip", "match <style folder>", "look". Add an API key in Settings for free-form prompts and attached images.';
  return { offline: true, text: say, calls };
}

// ------------------------------------------------------------------------------------------------------------------------
const history = [];                                   // conversation memory (server session)
// A conversation window must start at a plain user message: a tool_result with no tool_use before it is rejected by the API.
const isPlainUser = m => m.role === 'user' && (typeof m.content === 'string' || !m.content.some(b => b.type === 'tool_result'));
function trimHistory(memory = history) {
  while (memory.length > 24) memory.shift();
  while (memory.length && !isPlainUser(memory[0])) memory.shift();
  // drop images from older turns to keep requests small
  memory.forEach((m, i) => { if (i < memory.length - 2 && Array.isArray(m.content)) m.content = m.content.map(b => b.type === 'image' ? { type: 'text', text: '[earlier image omitted]' } : (b.type === 'tool_result' && Array.isArray(b.content) ? { ...b, content: b.content.map(c => c.type === 'image' ? { type: 'text', text: '[earlier image omitted]' } : c) } : b)); });
}

const materialHistory = [];
const MATERIAL_TOOLS = TOOLS.filter(t => ['list_materials', 'list_texture_sets', 'build_material_from_texture_set', 'inspect_material', 'create_material', 'set_material_value', 'undo_material', 'save_material'].includes(t.name));
const MATERIAL_SYSTEM = `You are the specialist in KeyShot Director's Material Lab. For imported texture assets, call list_texture_sets and build_material_from_texture_set; ask which set only if there is a real ambiguity. The verified converter builds a NEW unassigned Plastic material with Base Color→Diffuse, Roughness→Color To Number→Plastic Roughness, and Normal (or Bump fallback)→Bump. It saves to the KeyShot library and a portable KMP. Specular, Metallic, AO and displacement are skipped; say so. Never apply this material to product parts automatically. The user chooses parts in KeyShot. The KMP includes the image maps, while imported originals remain unchanged.\n\nFor photo-only material requests, discuss visible cues as approximate, create an unassigned starter only when asked, and use only supported material tools. Existing scene graphs are inspection-only unless the user explicitly enabled edits for that exact material; then change only concrete numeric, boolean or color values surfaced by inspect_material. Such edits are live and may affect all parts sharing the material; use undo_material when needed. Never modify existing graph structure or claim a photo reveals exact shader data. Save requested new materials or authorized edits and report the exact path. Keep responses concise.\n\nWORKFLOW PLAYBOOK\n${readSkill('material-lab')}`;
async function run(job, { text, images = [] }, actions, scope = 'studio') {
  const ev = (type, data) => job.events.push({ type, ...data, t: Date.now() });
  const cfg = getConfig();
  const memory = scope === 'material' ? materialHistory : history;
  const system = scope === 'material' ? MATERIAL_SYSTEM : SYSTEM;
  const tools = scope === 'material' ? MATERIAL_TOOLS : TOOLS;
  try {
    const eng = await pickEngine(cfg); const useClaude = eng.engine !== 'offline';
    ev('mode', { mode: eng.engine === 'cli' ? (eng.provider === 'codex' ? 'ChatGPT (Codex CLI)' : 'claude (signed-in CLI)') : eng.engine === 'api' ? 'claude' : 'offline', model: eng.engine === 'api' ? (cfg.model || 'claude-sonnet-5-5') : null });
    if (eng.why) ev('text', { text: eng.why + ' Using offline mode for now.' });
    if (scope === 'studio') actions.setAttachments(images);
    const content = [...images.map(d => { const m = /^data:(image\/[a-z+.-]+);base64,(.+)$/i.exec(d); return m ? { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } } : null; }).filter(Boolean), { type: 'text', text: text || '' }];
    memory.push({ role: 'user', content: useClaude ? content : text });
    const ctl = new AbortController(); job.abort = () => ctl.abort();
    for (let turn = 0; turn < 14; turn++) {
      ctl.signal.throwIfAborted();
      let resp;
      if (eng.engine === 'cli') resp = await callCli(cfg, eng, memory, ctl.signal, system, tools);
      else if (useClaude) resp = await callClaude(cfg, memory, ctl.signal, system, tools);
      else {
        if (turn > 0) break;                                    // offline: one pass of calls, then stop
        const o = scope === 'material' ? { text: 'Material photo interpretation needs a signed-in Codex/Claude CLI or API engine. You can still create and tune a material manually below.', calls: [] } : offlineModel(text);
        resp = { stop_reason: o.calls.length ? 'tool_use' : 'end_turn', content: [...(o.text ? [{ type: 'text', text: o.text }] : []), ...o.calls.map((c, i) => ({ type: 'tool_use', id: 'off' + i, name: c.name, input: c.input }))] };
      }
      memory.push({ role: 'assistant', content: resp.content });
      for (const b of resp.content) if (b.type === 'text' && b.text.trim()) ev('text', { text: b.text.trim() });
      const uses = resp.content.filter(b => b.type === 'tool_use');
      if (resp.stop_reason !== 'tool_use' || !uses.length) break;
      const results = []; let anyFail = false;
      for (const u of uses) {
        ctl.signal.throwIfAborted();
        ev('tool', { name: u.name, input: u.input });
        let out;
        try { if (!tools.some(t => t.name === u.name)) throw new Error('This tool is unavailable in this workspace'); out = await actions[u.name](u.input || {}); } catch (e) { out = { error: e.message }; }
        const isErr = out && out.error; if (isErr) anyFail = true;
        ev('result', { name: u.name, ok: !isErr, summary: isErr ? out.error : (out && out.summary) || 'done', ...(out && out.imageDataUrl ? { image: out.imageDataUrl } : {}) });
        const block = [];
        if (out && out.imageBase64) block.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: out.imageBase64 } });
        const { imageBase64, imageDataUrl, ...rest } = out || {};
        block.push({ type: 'text', text: JSON.stringify(rest).slice(0, 6000) });
        results.push({ type: 'tool_result', tool_use_id: u.id, content: block, ...(isErr ? { is_error: true } : {}) });
      }
      memory.push({ role: 'user', content: useClaude ? results : [{ type: 'text', text: 'tool results ' + JSON.stringify(results.map(r => r.content[r.content.length - 1].text)).slice(0, 2000) }] });
      if (!useClaude) { ev('text', { text: anyFail ? "That didn't work (see the line above)." : 'Done.' }); break; }
      if (turn === 13) ev('text', { text: '(stopped after 14 steps)' });
    }
  } catch (e) { ev('error', { message: e.name === 'AbortError' ? 'Stopped.' : e.message }); }
  finally { trimHistory(memory); job.done = true; ev('done', {}); }
}

module.exports = { run, getConfig, setConfig, publicConfig, engineStatus, pickEngine, TOOLS, SYSTEM, history, materialHistory };
