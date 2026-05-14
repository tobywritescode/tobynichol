# tobynichol.computer // Floating HUD v3.0

A high-performance, framework-less personal landing page. Boots as an interactive CLI, then collapses into a four-module floating HUD on desktop. Zero build steps, zero dependencies, raw WebGL.

## Architecture & Philosophy
Version 3 expands the v2 "Active Terminal" into a multi-module operations console. The main terminal is still the interactive core, but it now shares the surface with three sub-modules (About, Work, Contact). On desktop the modules become draggable floating windows; on mobile they collapse into a tap-to-expand vertical stack. The "Minimalist-Heavy" philosophy is preserved: zero frameworks, zero build steps, and raw WebGL anchoring the visual identity.

## Tech Stack
- **Engine**: [OGL](https://github.com/oframe/ogl) (minimal WebGL library, loaded via `esm.sh`)
- **Styling**: Vanilla CSS3 (Custom Properties, Flexbox, Grid, `:has()` selector)
- **Logic**: Vanilla JavaScript (ES Modules, Async/Await, Pointer Events)
- **Icons**: Inlined SVG (no CDN, no runtime fetches)

## Technical Deep Dive

### 1. The Command Loop (`js/scripts.js`)
The `TerminalCLI` class manages a persistent input buffer:
- **Command Parser**: Maps user input to internal system functions. Tolerates quotes and leading slashes (`help`, `"help"`, `/help` all resolve).
- **Typewriter Utility**: An asynchronous "streaming" function that simulates data being decrypted over a slow link.
- **Boot Sequence**: A scripted boot animation exposed as a promise (`bootPromise`) so the page-load intro can orchestrate around it.

### 2. WebGL CRT Engine
The procedural background remains the visual anchor:
- **Shaders**: Custom GLSL handles scanlines, chromatic aberration, barrel distortion, page-load fade-in, and mouse-influenced intensity.
- **Mobile-aware**: DPR is capped at 1, chromatic aberration is disabled, mouse and page-load animations are suppressed, and the render loop pauses on `visibilitychange` and runs at a 30fps cap.

### 3. Floating HUD Layout (`css/styles.css`, `js/scripts.js`)
On desktop, the natural grid layout is captured on load, then each module is switched to absolute positioning at its captured coordinates:
- **Drag**: Header strips (`#terminal-header` / `.terminal-header`) accept pointer-drag, with a 4px movement threshold so clicks and hover-expands still work.
- **Z-Order**: Interacting with a panel (drag, maximize, hover) brings it to the front via a monotonic z-index counter.
- **Maximize Snap**: The main terminal's maximize button snaps the window to a centered 800×85vh state. The floating position is restored on minimize.
- **Viewport Clamp**: A resize listener clamps any module that would otherwise be stranded off-screen.

### 4. Boot-Sequence Intro
On page load (desktop only), the page plays a scripted arrival sequence:
1. Sub-modules are gated invisible via `body.intro-active`.
2. The main terminal auto-maximizes and the CLI's boot animation types out.
3. After the boot promise resolves, sub-modules cascade in with a staggered fade + slide.
4. The terminal collapses back to its floating header position.
5. A subtle pulse animates the maximize button (`body.intro-complete`) until the user re-opens the terminal for the first time.

### 5. Mobile Path
On `innerWidth < 768` or any touch device, floating mode is skipped entirely:
- Modules render in a vertical flex stack.
- Sub-modules use tap-to-expand instead of hover-expand.
- WebGL render cost is reduced as described above.

### 6. Interactive Focus
- **Auto-Focus**: A global click listener returns focus to the terminal input.
- **Background Dimming**: The CRT background dims and blurs when the main terminal is maximized, via the `body:has(#terminal.maximized)` selector.

## Available Commands
Commands tolerate quotes or a leading slash (e.g., `help`, `"help"`, `/help`).

- `help` — list system capabilities
- `bio` — personnel file decryption
- `logs` — system origin history
- `work` — strategic project deployment
- `links` — external network nodes
- `articles` — intelligence database (briefings)
- `contact` — establish comms link
- `clear` — wipe console buffer

Aliases: `ls` → `work`, `whois` → `bio`.

## Intelligence Database
Standalone tactical briefings designed for technical SEO and high-stakes knowledge transfer.

### The Briefing Compiler (`compile.js`)
A custom, zero-dependency Node.js script generates static briefings:
1. **Source**: Raw text files in `/briefings/` with frontmatter metadata.
2. **Template**: A master HTML/WebGL structure in `/assets/template.html`.
3. **Output**: SEO-optimized static pages in `/articles/` and an `articles.json` index for the CLI.

To generate new briefings:
```bash
node compile.js
```

## Deployment
Hosted on **Vercel** as a zero-config static project.
