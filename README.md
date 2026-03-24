# tobynichol.com // Interactive Terminal HUD v2.0

A high-performance, framework-less personal landing page evolved into a fully interactive Command Line Interface (CLI).

## Architecture & Philosophy
Version 2 moves from a "Passive HUD" to an "Active Terminal" experience. The site is a single-module intelligence console that requires user interaction (`/help`) to decrypt personnel files and project data. It maintains the "Minimalist-Heavy" philosophy: zero frameworks, zero build steps, and raw WebGL power.

## Tech Stack
- **Engine**: [OGL](https://github.com/oframe/ogl) (Minimal WebGL library)
- **Styling**: Vanilla CSS3 (Custom Properties, Flexbox, `:has()` selector)
- **Logic**: Vanilla JavaScript (ES Modules, Async/Await for "streaming" effects)
- **Icons**: [Lucide](https://lucide.dev/) via CDN

## Technical Deep Dive

### 1. The Command Loop (`js/scripts.js`)
The core of v2 is the `TerminalCLI` class, which manages a persistent input buffer:
- **Command Parser**: A custom listener that maps user input to internal system functions.
- **Typewriter Utility**: An asynchronous "streaming" function that simulates data being decrypted or received over a slow link, enhancing the tactile feel of the terminal.
- **Boot Sequence**: A scripted sequence of system checks that runs on initialization to set the narrative tone.

### 2. WebGL CRT Engine
The WebGL background from v1 remains the visual anchor:
- **Shaders**: Custom GLSL handles scanlines, chromatic aberration, and barrel distortion.
- **Interactivity**: Normalized global mouse tracking ensures the "grid" reacts to movement even while the user is typing.

### 3. Unified Module Design (`css/styles.css`)
- **Single-Module Layout**: The 12x12 grid from v1 was collapsed into a centered `flex` layout for v2 to focus the user's attention on the console.
- **Visual Consistency**: Retains the v1 "Deconstructed" markers (corner brackets and metadata tags) but applies them to a single, high-contrast glassmorphism container.

### 4. Interactive Focus
- **Auto-Focus**: A global listener ensures that clicking anywhere on the page returns focus to the terminal input, maintaining the "immersion."
- **Focus Dimming**: The background subtly dims and blurs when the terminal is hovered, using the CSS `:has()` selector.

## Available Commands
- `/help`: List system capabilities.
- `/bio`: Personnel file decryption.
- `/work`: Active system modules (projects).
- `/links`: External network nodes.
- `/contact`: Establish comms link.
- `/articles`: Access intelligence database (Briefings).
- `/clear`: Wipe console buffer.

## Intelligence Database
Standalone tactical briefings designed for technical SEO and high-stakes knowledge transfer.

### The Briefing Compiler (`compile.js`)
Instead of bloated toolchains, the site uses a custom, zero-dependency Node.js script to generate static briefings:
1.  **Source**: Raw text files in `/briefings/` with technical metadata.
2.  **Template**: A master HTML/WebGL structure in `/assets/template.html`.
3.  **Output**: SEO-optimized static pages in `/articles/` and an `articles.json` index for the CLI.

To generate new briefings:
```bash
node compile.js
```

## Deployment
Hosted on **Vercel** as a zero-config static project.
