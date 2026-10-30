---
name: KeyShot Director
description: A scene-first workbench for directing KeyShot, styled with the orchid system
colors:
  ink: "#1d2029"
  muted: "#49505d"
  soft: "#f2f4f7"
  line: "rgba(29,32,41,.12)"
  paper: "#ffffff"
  night: "#0d0f14"
  hero-ink: "#151515"
  hero-muted: "#6b6862"
  accent: "#e76d1a"
  accent-wash: "rgba(231,109,26,.12)"
  on-night: "rgba(255,255,255,.8)"
  ok: "#1f8a4c"
  danger: "#b42318"
typography:
  display:
    fontFamily: '"IBM Plex Sans", sans-serif'
    fontSize: "88px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-.03em"
  h2:
    fontFamily: '"IBM Plex Sans", sans-serif'
    fontSize: "48px"
    fontWeight: 500
    lineHeight: 1.1
    letterSpacing: "-.025em"
  h4:
    fontFamily: '"IBM Plex Sans", sans-serif'
    fontSize: "28px"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "-.01em"
  title:
    fontFamily: '"IBM Plex Sans", sans-serif'
    fontSize: "24px"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "-.02em"
  body:
    fontFamily: '"IBM Plex Sans", sans-serif'
    fontSize: "16px"
    lineHeight: 1.5
  control:
    fontFamily: '"IBM Plex Sans", sans-serif'
    fontSize: "14px"
    fontWeight: 500
  label-caps:
    fontFamily: '"IBM Plex Sans", sans-serif'
    fontSize: "14px"
    letterSpacing: ".1em"
    textTransform: uppercase
  mono:
    fontFamily: 'Consolas, "SF Mono", Menlo, monospace'
    fontSize: "12px"
rounded:
  sm: "8px"
  md: "12px"
  lg: "16px"
  pill: "100px"
spacing:
  scale: "4px"
  app-gutter: "40px"
  home-gutter: "96px"
  phone-gutter: "20px"
  gap: "12px"
components:
  button-accent:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
  button-dark:
    backgroundColor: "{colors.hero-ink}"
    textColor: "{colors.paper}"
    rounded: "0"
    padding: "12px 24px"
  chip:
    borderColor: "{colors.line}"
    rounded: "{rounded.pill}"
  field:
    backgroundColor: "{colors.soft}"
    rounded: "{rounded.sm}"
    padding: "11px 16px"
  scene-card:
    backgroundColor: "{colors.night}"
    rounded: "{rounded.lg}"
---

# Design System: KeyShot Director

## Overview

**Creative North Star: "The Orchid Workbench"**

Director now follows the orchid system from the orchid template and `website-reference/main.css`: white pages, soft grey surfaces, one night-black feature surface for the live scene, IBM Plex Sans, and a single orange accent. The design lives in Figma as **Orchid Style Handoff** (foundations, 36 components, desktop 1440 and phone 375 screens) and in code in `server/public/orchid.css`, which loads after `director.css` and re-themes every existing control without changing markup, ids or scripts.

The operating hierarchy is unchanged: see the live scene, set light or material intent, then refine through conversation. Studio and Materials share one top bar and move the same live preview between workspaces. Home is a new orchid-style page (hero, featured card, capabilities, how it works, stats, boundaries, FAQ, closing call to action) that opens from the Home link.

## Colors

- **Ink / Hero ink** (`--ink`, `--hero-ink`): headings, body and the dark primary button.
- **Muted** (`--muted`, `--hero-muted`): secondary copy and labels.
- **Soft** (`--soft`): fields, chips, cards and the composer.
- **Night** (`--night`): the live scene card and the Home feature card.
- **Accent** (`--accent`, `#e76d1a`): primary actions, active nav, progress, eyebrow labels. Change `--accent` in one place to re-brand.
- **Ok / Danger** (`--ok`, `--danger`): small extensions for bridge and error states only.

Legacy variables (`--bg`, `--fg`, `--dim`, `--blue`, `--orange`) are aliased to these tokens so `director.css` and the script-built widgets inherit the new palette.

## Typography

IBM Plex Sans (variable, bundled in `server/public/fonts`, SIL OFL 1.1). Headings are weight 500 with tight negative tracking; the Home hero name is 700 uppercase. Navigation and small labels are uppercase and tracked. Controls use 14px; helper text 12 to 13px. Commands and logs use the system monospace stack.

## Components

- **Pill:** soft rounded label with an orange dot, above every section heading and for scene state.
- **Buttons:** accent pill for primary in-app actions, outlined pill for secondary, square dark (`.btn-dark`) for import and apply, text button with a moving arrow for tertiary.
- **Segmented tabs:** soft pill container, white active tab with accent text (Frame mode, Material tools).
- **Fields:** soft fill, 8px radius, no border; focus is a 2px ink outline.
- **Scene card:** night surface, 16px radius, overlay controls in translucent night.
- **Messages:** Director replies in soft bubbles with an accent eyebrow, user messages in ink.
- **Disclosures:** plain rows with a plus or minus on the right.

## Layout

App pages use a 40px gutter and a 12px gap: an elastic scene column and a 448px inspector. Home uses a 96px gutter at desktop width. Under 1100px both stack; under 760px the top bar becomes a logo and burger that opens a full-screen menu, controls reach 44px, and the gutter is 20px.

## Motion

Sections on Home fade up on scroll with `cubic-bezier(.2,.7,.2,1)`. A 2px accent bar in the top bar sweeps while a request or lighting match is running. `prefers-reduced-motion` turns all of it off.

## Do's and Don'ts

- **Do** keep the live render prominent and unaltered; the scene card is the only dark surface in the app.
- **Do** use the accent sparingly: actions, active state, eyebrows.
- **Don't** add new colors or radii; use the tokens above.
- **Don't** replace real KeyShot evidence with generated imagery. Home placeholders are neutral and show the live preview when one exists.
