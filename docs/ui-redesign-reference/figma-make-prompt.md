# Figma Make prompt — KeyShot Director UI redesign

Use the attached SVG references as the current-state source of truth:

- `current-ui-desktop.svg` — current desktop composition
- `current-ui-mobile.svg` — current mobile composition

Redesign the UI for **KeyShot Director**, a companion creative workspace used beside KeyShot Studio. This is an operating tool for 3D artists, product designers, and visualization professionals who want to shape lighting, framing, materials, references, and motion without losing sight of the real KeyShot scene.

## Preserve the product truth

Keep these capabilities and labels recognizable:

- Live KeyShot scene preview with orbit, pan, zoom, live preview, and refresh controls.
- Ask Director conversation for natural-language requests about lighting, framing, scene layout, and motion.
- Match a look: upload/drop a reference photo, describe what to borrow, optionally match framing, choose refinement quality, then match, stop/restore, or undo.
- Frame & background controls for full product, detail close-up, upper detail, output aspect ratio, backdrop, ground shadows, and reflections.
- KeyShot connection status and connection instructions.
- Reference video & animation tools.
- Studio lighting rigs, exposure, mirror controls, stage/light positioning, editable light rows, add-light and studio-off actions.
- Styles/reference library.
- Materials workspace with read-only safeguards, texture/reference assets, material editing, save/discard, and an assistant conversation.
- Responsive behavior: desktop is a wide scene-first workspace; mobile is a clear vertical sequence.

Do not invent a different product, fake render-quality promises, similarity scores, or destructive automatic scene changes. The user’s real KeyShot render remains the visual source of truth.

## Redesign goal

Create a premium, focused creative instrument that feels closer to a beautifully made pro photography/3D studio than to an admin dashboard. The current interface is functionally strong but visually too quiet and card-heavy. Improve the information hierarchy, scanability, grouping, state communication, and perceived craft while keeping the live scene dominant.

## Visual direction

- Overall mood: calm, premium, cinematic, precise, and unmistakably made for visual work.
- Use a restrained neutral shell: warm off-white or very light silver workspace chrome, graphite text, and a deep charcoal scene canvas where appropriate.
- Let the actual KeyShot render carry the color. Use one controlled electric-blue accent for primary actions and focus states; use green only for connected/ready status.
- Use a strong typographic hierarchy with a contemporary grotesk/sans-serif. Use sentence case, not all-caps labels.
- Use generous spacing, thin cool-gray dividers, subtle depth, and a small, consistent radius system. Avoid a grid of identical floating cards.
- The live scene should feel like the hero canvas. The inspector should feel like one coherent instrument panel with clear sections, not a stack of unrelated widgets.
- Use authored line icons or a consistent icon library; never use emoji or random Unicode symbols as icons.
- Avoid gradients, neon effects, excessive glassmorphism, decorative blobs, generic dashboard KPI cards, and unnecessary shadows.

## Target desktop experience

Design a polished desktop app frame at approximately 1440 × 980:

1. A compact top bar with KeyShot Director identity, connection state, workspace navigation (Studio / References / Materials), provider state, and Settings.
2. The main Studio view uses a large live scene canvas on the left and a focused inspector rail on the right.
3. The scene canvas includes a tasteful toolbar overlay for live preview and refresh, plus a compact interaction hint that does not obscure the render.
4. Place Ask Director immediately below the scene as a conversational command surface with an empty state, prompt field, attachments, send/stop/new-chat actions, and suggestion chips.
5. Start the inspector with Match a look. Give the reference drop zone a strong visual affordance and show a clear state progression: empty → reference selected → analyzing → matched with before/after evidence → restored/error.
6. Group lower-priority tools into calm disclosure sections: Frame & background, Connect KeyShot, Reference video & animation, Studio lighting, Styles, Camera motion, Open on phone.
7. Make status and reversibility obvious. Match, stop/restore, undo, disabled, busy, connected, disconnected, empty, and error states should all be designed.

## Target mobile experience

Design a responsive mobile frame at approximately 390 × 844 and a tall scroll state:

- Keep the order: Studio scene → Match a look → Ask Director → Frame & background → connection/animation → Studio lighting → Styles → remaining tools.
- Use larger touch targets, sticky or easily reachable primary actions, readable helper text, and no cramped two-column controls.
- Keep the scene prominent at the top, but make the tool sequence easy to scan with section headers and concise descriptions.
- Show how the inspector rail collapses into a single-column flow without losing state or context.

## Additional screens

Create companion desktop views for:

- **References:** reference-photo library, style folders, selected-reference preview, matching brief, analysis state, and recent match evidence.
- **Materials:** material selector, read-only/edit mode distinction, material property controls, texture/reference assets, save/discard actions, and assistant chat.

## Interaction and component requirements

- Define reusable tokens for color, type, spacing, radii, borders, focus rings, and elevation.
- Include hover, pressed, focus-visible, disabled, loading, connected, disconnected, empty, error, and success states for key controls.
- Make primary actions visually dominant but not oversized.
- Use progressive disclosure for advanced controls, preserving the current product’s depth without overwhelming first-time users.
- Keep copy concise and action-oriented. Preserve the product’s existing factual wording where it describes safety, provider sharing, previews, rollback, and the fact that materials remain untouched.
- Show realistic synthetic UI content using the existing wording and a believable product render placeholder; label anything illustrative as a preview.
- Include keyboard focus visibility and accessible contrast.

## Deliverable

Return a coherent mini design system and high-fidelity responsive UI, not isolated mockups. Include the Studio desktop and mobile screens first, then References and Materials. Make the redesign feel like a confident next version of the existing KeyShot Director product: scene-first, visually exacting, calm under pressure, and fast to understand.
