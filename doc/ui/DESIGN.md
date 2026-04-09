# Design System: High-End Editorial for Chrome Extensions

## 1. Overview & Creative North Star
This design system moves away from the cluttered, "utility-first" aesthetics common in browser extensions toward a philosophy we call **"The Digital Archivist."** 

The Creative North Star is a focus on **intentionality and quiet authority**. Inspired by tools like Linear and Notion, we prioritize high-information density without the visual noise. We achieve this by rejecting "boxy" layouts in favor of asymmetric breathing room, sophisticated tonal layering, and an editorial typographic hierarchy that makes prompt management feel like a premium writing experience rather than a database entry task.

## 2. Colors & Surface Philosophy
The palette is a deeply sophisticated dark mode built on carbon and midnight tones, accented by a refined periwinkle primary.

### The "No-Line" Rule
To achieve a high-end feel, **never use 1px solid borders for sectioning.** A 1px border is a visual interrupt. Instead, define boundaries through:
- **Tonal Shifts:** Place a `surface_container_low` section against a `background` base.
- **Proximity:** Use negative space to imply containment.
- **Glassmorphism:** Use semi-transparent layers for floating sidebars or modals.

### Surface Hierarchy & Nesting
Treat the sidebar as a series of physical layers. Use the following tokens to create depth without shadows:
1.  **Base Layer:** `surface` (#0c0e10) — The absolute background.
2.  **Middle Layer:** `surface_container` (#161a1e) — Used for the main content area or list container.
3.  **Top Layer:** `surface_container_highest` (#20262c) — Used for individual prompt cards or active navigation elements.

### The "Glass & Gradient" Rule
For primary actions or key headers, use a subtle gradient from `primary` (#bdc2ff) to `primary_container` (#2e3aa2) at a 135-degree angle. For elements that hover over content (like tooltips or floating action buttons), apply a backdrop-blur of `12px` and use `surface_variant` at 70% opacity.

## 3. Typography
We utilize a dual-font strategy to balance utility with editorial elegance.

*   **Inter (Display, Headline, Title, Body):** Chosen for its mathematical precision and exceptional legibility at small sizes. 
    *   *Usage:* Use `headline-sm` for category titles. Use `body-md` for the prompt text itself to ensure long-form readability.
*   **Manrope (Labels):** A modern geometric sans-serif used exclusively for `label-md` and `label-sm`. 
    *   *Usage:* Metadata, tags, and small button text. The slightly wider tracking of Manrope adds an "architectural" feel to the UI.

**Editorial Hierarchy:** Always ensure a significant jump between `title-sm` (the prompt title) and `body-sm` (the prompt preview). Use `on_surface_variant` for secondary text to reduce visual weight.

## 4. Elevation & Depth
In this system, elevation is a product of light and material, not just black shadows.

*   **Tonal Layering:** Avoid shadows on static cards. Instead, nest a `surface_container_highest` card inside a `surface_container` background.
*   **Ambient Shadows:** For floating menus, use a diffused shadow: `0px 12px 32px rgba(0, 0, 0, 0.4)`. The shadow should feel like a soft glow of darkness, never a harsh outline.
*   **The "Ghost Border" Fallback:** If a border is required for accessibility on interactive elements (like input fields), use `outline_variant` (#42494f) at **15% opacity**. This creates a "suggestion" of an edge that disappears into the background.
*   **Glassmorphism:** Use `surface_bright` with `backdrop-filter: blur(8px)` for the sidebar's header to allow content to scroll underneath beautifully.

## 5. Components

### Prompt Cards
*   **Structure:** No borders. Use `surface_container_highest`.
*   **Padding:** `1rem` (16px) all around.
*   **Interaction:** On hover, shift the background to `surface_bright` and apply a `sm` (2px) lift using an ambient shadow.
*   **Content:** Forbid dividers. Separate the title from the body using `0.5rem` of vertical space.

### Buttons
*   **Primary:** Gradient of `primary` to `primary_container`. Use `label-md` (Manrope) for text, all-caps with 0.05em tracking for an authoritative look.
*   **Secondary/Tertiary:** `surface_container_low` background. Use `on_surface` text.
*   **Rounding:** Always use `md` (0.375rem) for a modern, slightly softened "Linear-style" edge.

### Chips & Tags
*   **Style:** Minimalist. Use `secondary_container` backgrounds with `on_secondary_container` text.
*   **Rounding:** `full` (9999px) for a distinct pill shape that contrasts with the squareness of cards.

### Input Fields
*   **Style:** `surface_container_low` background. 
*   **State:** On focus, the "Ghost Border" becomes `primary` at 40% opacity with a subtle `primary` outer glow (2px blur).

### Navigation (Sidebar Tabs)
*   **Active State:** Use a vertical "pill" indicator (2px wide) on the left in `primary` color, rather than highlighting the entire background. This maintains a clean, editorial look.

## 6. Do's and Don'ts

### Do
*   **DO** use whitespace as a separator. If you feel the need for a line, try adding 8px of padding instead.
*   **DO** use `label-sm` for "meta" information (date created, character count) to keep the hierarchy clear.
*   **DO** use subtle transitions (200ms ease-out) for all hover states to reinforce the premium feel.

### Don't
*   **DON'T** use 100% white (#ffffff) for text. Use `on_surface` (#e0e6ed) to reduce eye strain in dark mode.
*   **DON'T** use standard system scrolls. Use a custom, thin scrollbar in `outline_variant` that only appears on hover.
*   **DON'T** crowd the sidebar. If there are too many actions, hide them behind a "More" (ellipsis) menu to maintain the "Digital Archivist" minimalist aesthetic.