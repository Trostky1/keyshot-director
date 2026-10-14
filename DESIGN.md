---
name: KeyShot Director
description: A premium, scene-first workbench for directing KeyShot
colors:
  bg: "#f1f2f4"
  fg: "#20242a"
  dim: "#68707a"
  line: "#d9dde2"
  surface: "#fff"
  blue: "#2767d8"
  blue-hover: "#1c56bd"
  graphite: "#1d2631"
typography:
  headline:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif'
    fontSize: "29px"
    fontWeight: 650
    lineHeight: 1.1
    letterSpacing: "-.025em"
  title:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif'
    fontSize: "20px"
    fontWeight: 650
    lineHeight: 1.2
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif'
    fontSize: "14px"
    lineHeight: 1.45
  label:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif'
    fontSize: "12px"
    fontWeight: 550
  mono:
    fontFamily: 'Consolas, "SF Mono", Menlo, monospace'
    fontSize: "11px"
rounded:
  control: "9px"
  reference: "12px"
  panel: "18px"
  pill: "999px"
spacing:
  control-gap: "7px"
  panel-inline: "22px"
  panel-block: "21px"
  canvas-gap: "18px"
components:
  button-primary:
    backgroundColor: "{colors.blue}"
    textColor: "{colors.surface}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "8px 11px"
    height: "38px"
  button-primary-hover:
    backgroundColor: "{colors.blue-hover}"
    textColor: "{colors.surface}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.fg}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "8px 11px"
    height: "38px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.fg}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "8px 11px"
  inspector:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.panel}"
---

# Design System: KeyShot Director

## Overview

**Creative North Star: "The Scene-First Creative Instrument"**

A real KeyShot render anchors a premium workbench. A deep graphite navigation rail sits above a soft silver workspace; bright white cards, graphite type and restrained blue actions keep the interface legible without competing with the product image. The page uses system typography, rounded controls, fine dividers and selective ambient depth. This direction is expressed by the later-loaded `server/public/director.css`.

The operating hierarchy follows the direction contract in the first body comment of `server/public/index.html`: see the live scene, set light or material intent, then refine through conversation. Studio and Materials share one navigation and move the same live preview between workspaces. Material inspection reflects the live KeyShot graph and only exposes controls the bridge can safely edit. This document records reusable visual rules. The page-specific order and workflow remain in the surface brief.

**Key Characteristics:**

- The user's actual KeyShot scene carries the visual emphasis.
- Graphite navigation, silver canvas, white surfaces, graphite type and blue actions.
- Rounded controls and panels with quiet borders.
- Readable task guidance and distinct focus, disabled and connected states.

## Colors

A cool neutral foundation reserves saturated color for action and state.

### Primary

- **Director Blue** (`blue`): primary actions, interactive links, selected checkboxes and focus within the photo task.
- **Director Blue Hover** (`blue-hover`): the primary action's hover state.

### Neutral

- **Silver Canvas** (`bg`): page backing and low-emphasis control fills.
- **Working White** (`surface`): the live scene, conversation, inspector and fields.
- **Graphite** (`fg`): headings, body copy and structural emphasis.
- **Muted Graphite** (`dim`): secondary descriptions, status and metadata.
- **Soft Divider** (`line`): panel boundaries and quiet outlines.

A small green dot signals a connected KeyShot bridge. The reference drop zone has a faint blue tint; the ready phase uses a pale green status pill. These are component states, not additional global accents.

**The Render Owns the Color Rule.** Keep interface color restrained so the user's genuine product render and reference can supply the visual character.

## Typography

**Display and Body Font:** the platform system stack in the frontmatter.
**Technical Font:** Consolas, SF Mono, Menlo and monospace for commands and logs.

**Character:** Direct, compact and readable. Sentence-case headings and controls replace the old tracked uppercase workbench language. Weight, size and spacing distinguish task levels without a decorative display face.

### Hierarchy

- **Studio headline:** the headline token leads the main canvas; it becomes (26px) on narrow phones.
- **Inspector title:** the title token marks the active lighting or material panel; other tool headings stay smaller (16px).
- **Conversation heading:** medium heading (18px) between the scene and prompt.
- **Body:** the body token serves the shell and explanatory copy; assistant messages are (13px).
- **Labels:** the label token serves fields and secondary control information.
- **Technical output:** the mono token identifies commands, recipes and logs.

**The Sentence-Case Rule.** Use natural-case labels and short instructions in the active interface; type hierarchy comes from scale and weight.

## Layout

A wide scene and focused inspector form Studio. The main grid has an elastic scene column and a (390px) inspector, with an (18px) gap and a (1900px) maximum width. Lighting controls lead the inspector; framing, connection and secondary workflows follow. Materials uses the same shell: the live scene and Material Director share the primary column, while the actual scene material inspector stays alongside them. Texture sets, KeyShot library and saved materials sit in a compact tab rail below. At (980px), both workspaces stack; at phone width, controls use larger targets and the live scene moves to (4:3).

Inspector sections share a white surface and fine horizontal rules, with about (20px) padding on wide screens. The Director brief stays directly under the scene. At phone width, the header wraps and interactive controls target at least (44px).

**The Scene-First Rule.** The live render leads the visual hierarchy; reference matching remains in the unified Director composer directly beneath it.

## Elevation & Depth

The system uses tonal separation and borders for most structure. Only high-value surfaces receive soft elevation: the live scene has an ambient shadow, the floating live-preview control has a smaller shadow and blur, and the Settings dialog and toast rise above the workspace. Inspector sections remain flat within their rounded shell.

### Shadow Vocabulary

- **Scene ambient:** `0 10px 30px #1d1d1f0a`; gives the live render a quiet edge against silver.
- **Floating preview control:** `0 2px 12px #0000000b`; supports the compact overlay.
- **Dialog:** `0 24px 70px #1115`; separates modal settings from the dimmed backdrop.
- **Toast:** `0 8px 24px #0003`; lifts transient feedback.

**The Selective Depth Rule.** Use elevation for the scene and truly overlaid controls; use borders and surface tone for ordinary inspector sections.

## Shapes

Corners are gently rounded: controls use the control radius, the reference picker uses the reference radius, and the stage and inspector use the panel radius. Status and suggestion chips are pills. Borders are generally thin and cool gray; the reference picker retains a dashed outline to signal drop input. The connected indicator is circular. Real render and reference images retain their own content geometry within contain-fit frames.

## Components

### Buttons

Primary actions use Director Blue with white text; hover deepens to Director Blue Hover. Secondary actions use white surfaces and a cool gray border, shifting to a pale gray hover. Buttons use the control radius, sentence-case labels and a (38px) baseline minimum height; narrow phones raise interactive targets to (44px). Disabled actions retain their context with reduced opacity (.45). A visible blue focus outline is (3px) with a (2px) offset. State changes use short (.16s) transitions, which collapse under reduced-motion preferences.

### Inputs / Fields

Fields are white, softly bordered and rounded. Textareas have generous internal padding (11px 12px) and allow vertical resizing. The Director brief is at least (68px) tall. Checkboxes and range controls use Director Blue. Placeholder and helper copy use muted neutrals; focus uses the shared blue outline.

### Navigation

The graphite header carries a compact brand mark, Studio/Materials navigation, bridge state, optional provider status and Settings. The connected dot turns green with a faint halo. The header wraps on narrow phones and keeps the connection state legible.

### Cards / Containers

The rounded white Studio inspector leads with active lighting controls and groups secondary tools with fine dividers. The scene has its own rounded white frame. The conversation log and Director brief form a joined card with rounded top and bottom edges. Materials pairs its live scene with the connected scene material inspector; exposed values and graph inputs stay factual and read-only where required. Texture, library and saved-material tools use a compact tab row.

### Reference Picker and Status

The reference picker is a pale blue-tinted dashed button with a rounded edge; hover and drag-over strengthen the blue. Once selected, the actual reference image appears inside it. A small green phase pill communicates readiness. Comparison figures show actual KeyShot renders with contain fitting, captions and blue download links.

### Disclosure and Light Rows

Secondary tasks use sentence-case disclosure summaries with understated chevrons. Editable light rows have fine borders and rounded corners; their swatch is circular. These controls remain compact enough for the inspector while labels and sliders stay readable.

## Do's and Don'ts

### Do:

- **Do** keep the live KeyShot render prominent and unaltered by decorative image substitutes.
- **Do** use silver, white, graphite and restrained blue for the reusable interface.
- **Do** preserve visible focus, useful disabled states and reduced-motion behavior.
- **Do** use rounded surfaces and fine dividers for tool grouping.

### Don't:

- **Don't** bring back the former square, monochrome workbench as the governing style.
- **Don't** use generated product geometry or imagery in place of real KeyShot evidence.
- **Don't** turn secondary sections into floating shadowed cards.
