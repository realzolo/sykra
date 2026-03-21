# Spec-Axis UI Spec (Geist-Aligned)

This is the project-level UI standard. Apply it to all UI work.

## Fonts
- Primary: Geist Sans via `geist` package (CSS variable `--font-geist-sans`).
- Mono: Geist Mono via `geist` package (CSS variable `--font-geist-mono`).
- Applied on `<html>` in `src/app/layout.tsx`.

## Color Semantics (HSL tokens)
Use semantic tokens, not raw HSL in components.
- Backgrounds: `--ds-background-1` (page), `--ds-background-2` (elevated).
- Surfaces: `--ds-surface-1` (subtle panels), `--ds-surface-2`, `--ds-surface-3`.
- Borders: `--ds-border-1` (default), `--ds-border-2`, `--ds-border-3`.
- Text: `--ds-text-1` (primary), `--ds-text-2` (secondary/muted).
- Accent: `--ds-accent-7/8/9` for interactive emphasis.
- Status: `--ds-success-7`, `--ds-warning-7`, `--ds-danger-7`.

Mapped shadcn-style variables:
- `--background`, `--card`, `--muted`, `--border`, `--foreground`, `--muted-foreground`
- `--primary`, `--secondary`, `--accent`, `--success`, `--warning`, `--danger`

## Radius Tokens
- `--radius-1`: 6px (inputs, small controls)
- `--radius-2`: 10px (cards, tiles)
- `--radius-3`: 14px (large panels)
- `--radius-4`: 20px (hero containers)

## Typography Scale (Utility Classes)
Use the classes defined in `src/app/globals.css`:
- Headings: `text-heading-72/64/56/48/40/32/24/20/18`
- Labels: `text-label-24/20/18/16/14/13/12/11/10`
- Body copy: `text-copy-20/18/16/14/12`
- Buttons: `text-button-16/14/12`

Rules:
- Headings are semibold with tight tracking.
- Labels are medium weight; uppercase only when explicitly needed.
- Body copy uses muted foreground by default.
- `strong` inside label/copy should be primary text with semibold weight.

## Components (Baseline)
Button (`src/components/ui/button.tsx`)
- Radius: `--radius-1`
- Sizes: `sm` h-8, `default` h-9, `lg` h-10
- Text size comes from `text-button-*` classes.
- Primary actions should use an explicit solid fill with high contrast against the surrounding surface.
- Secondary dialog actions should use a filled neutral surface instead of transparent outline-only cancel buttons.

Dialog (`src/components/ui/dialog.tsx`)
- `DialogContent` is container-only: it owns shell geometry, border, shadow, and focus suppression, but does not add implicit content padding.
- Standard dialog composition is explicit: `DialogHeader` + `DialogBody` + `DialogFooter`.
- `DialogBody` owns content padding and scrolling. `DialogFooter` owns action spacing and should remain a direct child of `DialogContent`.
- Do not nest footer rails inside form wrappers or generic body containers.

Input (`src/components/ui/input.tsx`)
- Radius: `--radius-1`
- Height: h-9 (allow overrides for h-10 in auth flows)
- Text: `text-copy-14`

Card (`src/components/ui/card.tsx`)
- Radius: `--radius-2`
- Border: `--border`
- Shadow: subtle (`0_1px_2px_rgba(0,0,0,0.12)`)
- Title: `text-label-16`
- Description: `text-copy-14`

Badge (`src/components/ui/badge.tsx`)
- Text: `text-label-12` (default), `text-label-11` (sm)
- Status variants use `success/warning/danger` with low-opacity fills.

## Layout + Background
- Prefer clean panels with borders and subtle shadows.
- Avoid heavy gradients; use soft radial hints only.
- Grid overlays are allowed as a faint structural layer (default 56px grid, ~0.2 opacity).
- Keep spacing generous; avoid cluttered UI.

## Interaction + Emphasis
- Accent color is reserved for primary actions and active states.
- Hover states are subtle (`bg-muted/70`, `bg-foreground/90`).
- Use thin borders to define structure rather than heavy drop shadows.
- Modal footers should feel compact and conclusive: tighter bottom padding, secondary cancel action on the left, solid primary action on the right, and a single grouped action rail.
- Modal containers must not expose browser default focus outlines. Focus emphasis belongs on interactive controls inside the dialog, not on the outer shell.
