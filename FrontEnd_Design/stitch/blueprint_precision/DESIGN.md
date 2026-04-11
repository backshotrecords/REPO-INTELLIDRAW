# Design System Strategy: The Architect’s Canvas

## 1. Overview & Creative North Star
The Creative North Star for this design system is **"The Precision Atelier."** 

We are moving away from the "SaaS-in-a-box" aesthetic toward a high-end, editorial environment that mimics a physical architect's studio. This design system treats the digital canvas as a premium space where intelligence meets effortless flow. We reject the rigid, boxed-in layouts of traditional productivity tools. Instead, we embrace **intentional asymmetry**, high-contrast typography scales, and a layout that breathes through negative space. 

The goal is to make the user feel like they are directing an AI from a position of authority and clarity. Every element must feel intentional, as if placed by a master drafter.

---

## 2. Colors & Tonal Depth
This system utilizes a sophisticated deep-sea palette to ground the user in a sense of reliability and intelligence.

### The "No-Line" Rule
**Explicit Instruction:** Traditional 1px solid borders for sectioning are strictly prohibited. We define boundaries through tonal shifts. A sidebar is not "separated" by a line; it exists because it is a `surface-container-low` section resting on a `surface` background. This creates a more organic, seamless interface that feels expansive rather than restrictive.

### Surface Hierarchy & Nesting
Treat the UI as a series of physical layers. Use the surface tiers to create depth:
- **Base Layer:** `surface` (#f7fafc) for the primary canvas.
- **Secondary Tier:** `surface-container-low` (#f1f4f6) for global navigation or side panels.
- **Interaction Tier:** `surface-container-lowest` (#ffffff) for active work areas or elevated cards to create a "lifted" feel.

### The "Glass & Gradient" Rule
To elevate the "Modern" brand pillar, floating menus and AI-suggestion panels must use **Glassmorphism**. Use `surface` colors at 70% opacity with a `24px` backdrop-blur. 

### Signature Textures
Main CTAs and Hero backgrounds should utilize a subtle linear gradient (from `primary` #041627 to `primary_container` #1a2b3c) at a 135-degree angle. This prevents the "flatness" of standard UI and provides a sense of premium "soul."

---

## 3. Typography: Editorial Authority
We pair the structural precision of **Manrope** for displays with the hyper-readability of **Inter** for functional data.

- **Display & Headlines (Manrope):** These are your "Editorial" voices. Use `display-lg` (3.5rem) with tight letter-spacing (-0.02em) to create an authoritative, modern look. Headlines should be used asymmetrically—often left-aligned with significant white space to the right.
- **Titles & Body (Inter):** These are the "Functional" voices. Use `body-md` (0.875rem) for all AI-generated labels and diagram descriptions to ensure maximum legibility against the deep `primary` background.
- **Visual Contrast:** High contrast between `headline-lg` and `body-sm` creates a hierarchy that feels curated, not just organized.

---

## 4. Elevation & Depth
In this system, depth is a tool for focus, not just decoration.

- **The Layering Principle:** Stack containers to show importance. A `surface-container-lowest` card placed on a `surface-container-high` section creates a natural "pop" without a single line of code for shadows.
- **Ambient Shadows:** When an element must float (e.g., a mobile bottom sheet), use an ultra-diffused shadow: `0px 12px 32px rgba(24, 28, 30, 0.06)`. Note the use of the `on_surface` color for the shadow tint rather than pure black; this ensures the shadow feels like a natural lighting effect.
- **The "Ghost Border" Fallback:** If a container lacks sufficient contrast against its neighbor, use a "Ghost Border": `outline-variant` (#c4c6cd) at **15% opacity**.
- **Glassmorphism:** For the mobile navigation bar, use a `surface_container_lowest` token with 80% opacity and a blur effect to let the canvas colors bleed through, maintaining the user’s context.

---

## 5. Components: The Precision Set

### Buttons
- **Primary:** Gradient fill (`primary` to `primary_container`) with `rounded-md` (0.375rem). No border.
- **Secondary:** `secondary` (#0058bc) text on a `secondary_fixed` background.
- **Tertiary:** `on_surface_variant` text. High interaction states should shift the background to `surface_container_high`.

### Chips
Use `rounded-full` for all chips. AI-suggested tags should use `tertiary_fixed` (#b7eaff) to visually distinguish "AI-generated" from "User-generated" content.

### Input Fields
Avoid the "box" look. Use `surface_container_high` as a solid background fill with a `rounded-sm` corner. The label (`label-md`) should sit 8px above the field in `on_surface_variant`. On focus, the field should transition to a `secondary` ghost border.

### Cards & Lists
**Strict Rule:** No dividers. Separate list items using `12px` of vertical white space. For cards, use `rounded-xl` (0.75rem) to soften the "Intelligent" personality, making it feel approachable.

### AI-Specific: The "Insight" Tooltip
A custom tooltip variant for AI suggestions. Use a `tertiary_container` (#002e3a) background with `on_tertiary_fixed` text. This high-contrast, dark-mode-style shift signals that the information is an AI "intelligence" layer.

---

## 6. Do’s and Don’ts

### Do:
- **Do** use large amounts of white space (32px+) between major functional groups to emphasize the "Atelier" feel.
- **Do** use the `secondary` (#0058bc) color sparingly as a surgical accent for "Success" or "Action" states.
- **Do** prioritize touch targets of at least 48px for all mobile canvas controls.

### Don’t:
- **Don’t** use 1px dividers to separate menu items; use background tonal shifts (`surface-dim`) instead.
- **Don’t** use pure black (#000000) for text. Always use `on_surface` (#181c1e) to maintain a soft, premium contrast.
- **Don’t** crowd the canvas. If the AI is drawing, hide non-essential UI elements using a "Focus Mode" transition.