// Specialist lighting guidance for the shared Director agent.
// Playbooks are composable: shot scale, lighting mood, and material behavior are separate axes.
const FOCUS = [
  { id: 'catalog_studio', label: 'Clean catalog studio', rig: 'blank_studio', axis: 'look' },
  { id: 'hero_product', label: 'Soft hero product', rig: 'hero_soft', axis: 'look' },
  { id: 'macro_detail', label: 'Close-up / macro detail', rig: null, axis: 'scale' },
  { id: 'low_key_moody', label: 'Low-key / moody', rig: 'dark_moody', axis: 'look' },
  { id: 'dramatic_color', label: 'Dramatic color', rig: 'color_drama', axis: 'color' },
  { id: 'controlled_beam', label: 'Controlled spotlight beam', rig: null, axis: 'source' },
  { id: 'photometric_fixture', label: 'IES fixture profile', rig: null, axis: 'source' },
  { id: 'glass_transparency', label: 'Glass / transparent', rig: 'glass_edge', axis: 'material' },
  { id: 'reflective_metal', label: 'Reflective metal', rig: 'hero_soft', axis: 'material' },
];

const PLAYBOOKS = {
  catalog_studio: {
    id: 'catalog_studio', label: 'Clean catalog studio', axis: 'look', rig: 'blank_studio',
    goal: 'A neutral, legible product image with a clean light background and a controlled contact shadow.',
    inspect: ['background neutrality and clipping', 'whether broad faces retain shape', 'contact shadow strength', 'color cast on the product'],
    principles: ['Keep broad sources large and close enough for soft transitions.', 'Use fill to reveal dark faces without flattening all form.', 'Treat white background and product exposure as separate targets.'],
    avoid: ['Do not raise product exposure just to whiten an already-white background.', 'Do not remove every shadow; retain a restrained grounding cue.'],
  },
  hero_product: {
    id: 'hero_product', label: 'Soft hero product', axis: 'look', rig: 'hero_soft',
    goal: 'A polished hero image with readable volume, attractive highlight structure, and deliberate separation from the stage.',
    inspect: ['key direction and highlight shape', 'edge separation', 'shadow detail', 'negative space around the product'],
    principles: ['Establish one dominant key before adding fill or rim sources.', 'Use panels to create controlled reflected shapes on glossy surfaces.', 'Keep the fill subordinate so the key still describes form.'],
    avoid: ['Do not assume that more lights create more polish.', 'Do not add a rim if the silhouette already separates cleanly.'],
  },
  macro_detail: {
    id: 'macro_detail', label: 'Close-up / macro detail', axis: 'scale', rig: null,
    goal: 'Make a chosen product detail fill the frame while preserving believable highlight shape and material texture.',
    inspect: ['the intended visible region, not the whole-product histogram', 'highlight width relative to the crop', 'focus point and crop boundaries', 'whether the visible material needs a different reflection shape'],
    principles: ['Treat camera crop and lighting scale as coupled decisions.', 'When framing changes, aim and scale the sources around the visible camera target.', 'Meter and compare only the visible product region when a valid mask is available.', 'Prefer one broad shaped source plus a restrained edge or fill, then refine against the crop.'],
    avoid: ['Do not auto-expose from the entire product when most of it is outside the crop.', 'Do not claim part-aware lighting when no part or region was selected.', 'A camera crop adapts lights around its target, but it does not identify a semantic product part by itself.'],
  },
  low_key_moody: {
    id: 'low_key_moody', label: 'Low-key / moody', axis: 'look', rig: 'dark_moody',
    goal: 'Keep the stage dark while preserving the product’s essential form, material cues, and intentional highlights.',
    inspect: ['product-only shadow crush and highlight clipping', 'edge separation against the background', 'direct versus reflection contribution', 'whether the floor reflection is intentional'],
    principles: ['Use negative fill and selective keys; light the product, not the whole frame.', 'Place a narrow edge source only where a silhouette needs separation.', 'Judge p95/highlights and shadow detail on a product mask, never from a mostly-black full-frame average.'],
    avoid: ['Do not brighten the whole environment to rescue one dark facet.', 'Do not treat a near-black background as proof that the product itself is correctly exposed.'],
  },
  dramatic_color: {
    id: 'dramatic_color', label: 'Dramatic colored light', axis: 'color', rig: 'color_drama',
    goal: 'Use intentional colored illumination to create a cinematic mood while keeping material identity readable.',
    inspect: ['which surfaces receive each hue', 'colored highlight placement and separation', 'loss of product color identity', 'whether the background is illuminated or merely tinted'],
    principles: ['Assign distinct color roles, such as a cool key and warm edge, rather than tinting every source alike.', 'Use Area sources to shape colored reflections; use a Spotlight when the reference contains a localized beam or pool.', 'Keep broad diffuse illumination restrained when hue accuracy matters; place stronger color in edge/reflection regions.', 'Use RGB for saturated hues; Kelvin is only a warm-to-cool white balance control.'],
    avoid: ['Do not use Kelvin values to imitate saturated blue, red, or magenta light.', 'Do not change product materials to compensate for colored illumination.', 'Do not assume RGB preview color is physically calibrated; verify it in the KeyShot render.'],
  },
  controlled_beam: {
    id: 'controlled_beam', label: 'Controlled Spotlight beam', axis: 'source', rig: null,
    goal: 'Create a deliberate pool of light with a controlled edge and a readable shadow direction.',
    inspect: ['beam footprint at the product and ground', 'edge transition and falloff', 'whether the beam misses or spills beyond the intended region', 'shadow softness relative to the source radius'],
    principles: ['Aim the Spotlight axis at the intended target; local -Y is the live-observed KeyShot 2026.2 emission direction.', 'Use beam angle to set coverage, falloff to shape the edge, and radius to soften shadows.', 'Keep total power behavior fixed while comparing beam angles, then refine one control at a time.'],
    avoid: ['Do not use a narrow Spotlight to create broad softbox reflections.', 'Do not judge beam direction from the carrier plane orientation; the beam axis is the control.', 'Do not use multiple overlapping spots until one beam is aimed and measured.'],
  },
  photometric_fixture: {
    id: 'photometric_fixture', label: 'IES photometric fixture', axis: 'source', rig: null,
    goal: 'Recreate a real fixture distribution using one installed KeyShot IES profile and a controlled aim.',
    inspect: ['profile fixture identity and distribution', 'beam footprint and orientation', 'lumen multiplier and shadow radius', 'whether the profile file exists in the installed library'],
    principles: ['Call list_light_profiles and use an exact returned asset_id; favor its parsed candela distribution, dominant-lobe widths, and lumen reference over the filename.', 'Treat dominant-lobe width as an estimate of sampled angular distribution, not the manufacturer beam-angle label; it does not represent secondary lobes. A tighter dominant lobe suits a focused pool while broad coverage may call for a different source.', 'Leave Kelvin/RGB unset to preserve the fixture color and start at multiplier 1; the installed KeyShot manual says the profile contains its lumen value and multiplier adjusts it, so change multiplier only to match product-masked render evidence.', 'Keep source position, target, profile, and product region fixed; preserve the profile axis unless a controlled render supports a change.'],
    avoid: ['Do not invent a profile path or infer a fixture from its filename alone.', 'Do not treat an IES fixture as a broad rectangular reflection source; use Area for designed softbox reflections.', 'Do not claim photometric matching when the profile is missing or its distribution could not be parsed.'],
  },
  glass_transparency: {
    id: 'glass_transparency', label: 'Glass / transparent materials', axis: 'material', rig: 'glass_edge',
    goal: 'Reveal transparent form through reflections, edge contrast, and controlled transmission cues.',
    inspect: ['bright/dark contour transitions', 'reflection shapes in the glass', 'background contrast visible through the object', 'edge and liquid separation'],
    principles: ['Use large bright and dark regions around the object to create reflected structure.', 'Use strips to draw edges and a backlight only when it creates useful transmission or liquid glow.', 'Keep a small front fill available so the front does not disappear.'],
    avoid: ['Do not flood the scene with uniform fill; glass needs contrast to read.', 'Do not call a flat-panel Area Light a native Planar Light.'],
  },
  reflective_metal: {
    id: 'reflective_metal', label: 'Reflective metal', axis: 'material', rig: 'hero_soft',
    goal: 'Shape broad, deliberate reflections that reveal curvature, polish, and edge transitions.',
    inspect: ['reflected panel outlines', 'highlight clipping and size', 'dark-field transitions across curved metal', 'whether the source is visible in reflections'],
    principles: ['Think of each area source as a shape reflected by the product, not only as a quantity of illumination.', 'Use large soft panels for broad gradients and narrow strips for crisp edge accents.', 'Rotate or resize a source when the reflected shape is wrong; changing power alone cannot fix it.'],
    avoid: ['Do not add small point-like highlights to replace a missing broad reflection.', 'Do not flatten polished metal with uniform environment fill.'],
  },
};

const PATTERNS = [
  ['photometric_fixture', /\b(ies|photometric|fixture profile|light distribution)\b/i],
  ['controlled_beam', /\b(spotlight|spot light|beam|pool of light|light cone|gobo)\b/i],
  ['macro_detail', /\b(close[ -]?up|macro|detail shot|tight crop|zoom in|surface detail|texture detail)\b/i],
  ['low_key_moody', /\b(moody|low[ -]?key|dark|shadowed|noir|cinematic dark)\b/i],
  ['dramatic_color', /\b(colou?r(?:ed)? light(?:ing)?|dramatic(?:ally)? colou?r|neon|teal|cyan|magenta|saturated light|red light|blue light|gel lighting)\b/i],
  ['glass_transparency', /\b(glass|transparent|translucent|clear bottle|liquid|crystal)\b/i],
  ['reflective_metal', /\b(metal|chrome|polished|mirror finish|brushed metal|aluminum|aluminium|stainless)\b/i],
  ['catalog_studio', /\b(catalog|catalogue|e[ -]?commerce|product listing|white background|clean studio|blank studio)\b/i],
  ['hero_product', /\b(hero|premium|polished|editorial|product shot|studio light)\b/i],
];

function selectedPlaybooks(text = '', focus = 'auto') {
  const chosen = [];
  if (focus !== 'auto' && PLAYBOOKS[focus]) chosen.push(focus);
  for (const [id, pattern] of PATTERNS) {
    if (focus !== 'auto' && PLAYBOOKS[focus] && PLAYBOOKS[focus].axis === PLAYBOOKS[id].axis) continue;
    if (pattern.test(text) && !chosen.includes(id)) chosen.push(id);
    if (chosen.length >= 4) break;
  }
  if (!chosen.length) chosen.push('hero_product');
  return chosen.slice(0, 4).map(id => PLAYBOOKS[id]);
}

function promptFor(text = '', { focus = 'auto', hasImages = false } = {}) {
  const chosen = selectedPlaybooks(text, focus);
  const sections = chosen.map(item => [
    `${item.label} (${item.axis}${item.rig ? `; starting rig ${item.rig}` : '; no dedicated rig yet'})`,
    `Goal: ${item.goal}`,
    `Inspect: ${item.inspect.join('; ')}.`,
    `Use: ${item.principles.join(' ')}`,
    `Avoid: ${item.avoid.join(' ')}`,
  ].join('\n'));
  return `LIGHTING PLAYBOOKS — apply these as specialist decision rules, not as a fixed recipe. Shot scale and lighting/material intent can combine. Choose the closest supported rig, then adapt to the current product and check the actual viewport.\n${hasImages ? 'The attached reference is primary evidence. Read its crop, background, highlight shapes, shadow density, and color before selecting a recipe; one image does not uniquely reveal the original physical setup.' : 'When the user names a reference look, use match_photo or match_style rather than forcing a generic preset.'}\nSOURCE SELECTION: Area is the default for broad sources, reflection shape, and softbox gradients. Point is a compact local source with radius controlling shadow softness. Spotlight creates a directional beam with angle, falloff, and radius; its local -Y axis is the installed KeyShot 2026.2 observation. IES reproduces a specific photometric fixture only when list_light_profiles provides an exact installed profile. Use the visual cue that distinguishes the source; do not choose by mood label alone.\n${sections.join('\n\n')}`;
}

function list() {
  return Object.values(PLAYBOOKS).map(({ id, label, axis, rig, goal }) => ({ id, label, axis, rig, goal }));
}

module.exports = { FOCUS, PLAYBOOKS, selectedPlaybooks, promptFor, list };
