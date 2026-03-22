# tobynichol.com // Deconstructed Terminal HUD

A high-performance, framework-less personal landing page built with a focus on abstract digital art and technical aesthetics.

## Architecture & Philosophy
The site follows a "Minimalist-Heavy" approach: zero frameworks (No React/Vue/Svelte), zero build steps, and maximum visual impact. It leverages modern browser features to achieve a complex, interactive experience with a tiny footprint.

## Tech Stack
- **Engine**: [OGL](https://github.com/oframe/ogl) (Minimal WebGL library)
- **Styling**: Vanilla CSS3 (Custom Properties, CSS Grid, `:has()` selector)
- **Logic**: Vanilla JavaScript (ES Modules)
- **Icons**: [Lucide](https://lucide.dev/) via CDN

## Technical Deep Dive

### 1. WebGL Background (`js/scripts.js`)
The core visual is a custom port of a WebGL-based CRT terminal component.
- **Shaders**: Written in GLSL. The **Fragment Shader** handles the heavy lifting:
    - **FBM (Fractional Brownian Motion)**: Generates the "noise" and "digits" pattern.
    - **Barrel Distortion**: Simulates the curvature of a vintage CRT monitor.
    - **Chromatic Aberration**: Offsets RGB channels based on screen position.
    - **Dynamic Glitch**: Uses sine wave displacement and flicker functions to simulate hardware faults.
- **Interactivity**: Global mouse tracking is normalized to WebGL coordinates, creating a "ripple" and intensity change in the shader's grid pattern.

### 2. Deconstructed HUD Layout (`css/styles.css`)
The UI is built on a **12x12 CSS Grid**.
- **Module Placement**: Each `.hud-module` is manually assigned to grid spans (e.g., `grid-column: 8 / 12`) to create an asymmetrical, "scattered" OS feel.
- **Glassmorphism**: Achieved using `backdrop-filter: blur(12px)` and high-contrast dark backgrounds (`rgba(0, 0, 0, 0.85)`).
- **HUD Markers**: Pseudo-elements (`::before`/`::after`) create the glowing corner brackets, while absolute-positioned `<span>` tags act as technical metadata labels.

### 3. Interactive Dimming & Focus
The site uses the modern CSS **`:has()` selector** to manage global state without JavaScript:
```css
/* Dims other modules when one is hovered */
.hud-wrapper:has(.hud-module:hover) .hud-module:not(:hover) {
  opacity: 0.2;
  filter: blur(2px) grayscale(0.5);
}

/* Dims the WebGL background when a module is active */
.hud-wrapper:has(.hud-module:hover) ~ #terminal-bg {
  opacity: 0.45;
  filter: blur(4px);
}
```

### 4. Responsive Engineering
- **Desktop**: The layout is a fixed-height grid (`85vh`) centered in the viewport. Internal scrolling is applied to text-heavy modules (like `About`) to prevent layout "leaks" while keeping technical markers visible.
- **Mobile**: The grid collapses into a `flex-direction: column` stack. The `body` overflow is toggled to `auto`, and internal module scrolling is disabled to provide a natural mobile browsing experience.

## Deployment
Hosted on **Vercel** as a static project. The repository structure is optimized for zero-config deployment.
