/**
 * tobynichol.computer - Shared WebGL Background + CLI Core
 */

import { Renderer, Program, Mesh, Color, Triangle } from 'https://esm.sh/ogl';

const PAGE_START = Date.now();

const ANIM_DURATION = 1100;
const ANIM_EASING   = 'cubic-bezier(0.16, 1, 0.3, 1)';

// FLIP animation: records where el IS (first), applies a state change via applyFn (which may
// snap el anywhere CSS wants), then slides it from the old position to the new one.
//
// The invert transform is written inline and a forced reflow commits it BEFORE the animation
// is created — this guarantees the browser paints the start position first, so there is no
// frame-zero snap. The slide itself uses WAAPI (not a CSS transition) so the element's own
// max-height/padding CSS transitions keep running independently for the size change.
function flipPosition(el, first, applyFn) {
  applyFn();
  // Cancel only our own previous flip — NOT el.getAnimations(), which would also kill the
  // CSS max-height/padding transitions that make the terminal expand/collapse smoothly.
  if (el._flipAnim) el._flipAnim.cancel();
  const last = el.getBoundingClientRect();
  const dx   = first.left - last.left;
  const dy   = first.top  - last.top;
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;

  // INVERT — jump to the old position inline (no CSS transform transition exists, so instant).
  el.style.transform = `translate(${dx}px, ${dy}px)`;
  // Force the browser to commit that position.
  void el.offsetWidth;
  // Drop the inline transform back to identity; WAAPI below paints the slide before this shows.
  el.style.transform = 'none';

  const anim = el.animate(
    [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
    { duration: ANIM_DURATION, easing: ANIM_EASING, fill: 'none' }
  );
  el._flipAnim = anim;
  const clear = () => {
    el.style.transform = '';
    if (el._flipAnim === anim) el._flipAnim = null;
  };
  anim.addEventListener('finish', clear);
  anim.addEventListener('cancel', clear);
}

// --- WebGL Background Logic (Shared) ---
const vertexShader = `
attribute vec2 position;
attribute vec2 uv;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const fragmentShader = `
precision mediump float;
varying vec2 vUv;
uniform float iTime;
uniform vec3  iResolution;
uniform float uScale;
uniform vec2  uGridMul;
uniform float uDigitSize;
uniform float uScanlineIntensity;
uniform float uGlitchAmount;
uniform float uFlickerAmount;
uniform float uNoiseAmp;
uniform float uChromaticAberration;
uniform float uDither;
uniform float uCurvature;
uniform vec3  uTint;
uniform vec2  uMouse;
uniform float uMouseStrength;
uniform float uUseMouse;
uniform float uPageLoadProgress;
uniform float uUsePageLoadAnimation;
uniform float uBrightness;

float time;

float hash21(vec2 p){
  p = fract(p * 234.56);
  p += dot(p, p + 34.56);
  return fract(p.x * p.y);
}

float noise(vec2 p)
{
  return sin(p.x * 10.0) * sin(p.y * (3.0 + sin(time * 0.090909))) + 0.2; 
}

mat2 rotate(float angle)
{
  float c = cos(angle);
  float s = sin(angle);
  return mat2(c, -s, s, c);
}

float fbm(vec2 p)
{
  p *= 1.1;
  float f = 0.0;
  float amp = 0.5 * uNoiseAmp;
  
  mat2 modify0 = rotate(time * 0.02);
  f += amp * noise(p);
  p = modify0 * p * 2.0;
  amp *= 0.454545;
  
  mat2 modify1 = rotate(time * 0.02);
  f += amp * noise(p);
  p = modify1 * p * 2.0;
  amp *= 0.454545;
  
  mat2 modify2 = rotate(time * 0.08);
  f += amp * noise(p);
  
  return f;
}

float pattern(vec2 p, out vec2 q, out vec2 r) {
  vec2 offset1 = vec2(1.0);
  vec2 offset0 = vec2(0.0);
  mat2 rot01 = rotate(0.1 * time);
  mat2 rot1 = rotate(0.1);
  
  q = vec2(fbm(p + offset1), fbm(rot01 * p + offset1));
  r = vec2(fbm(rot1 * q + offset0), fbm(q + offset0));
  return fbm(p + r);
}

float digit(vec2 p){
    vec2 grid = uGridMul * 15.0;
    vec2 s = floor(p * grid) / grid;
    p = p * grid;
    vec2 q, r;
    float intensity = pattern(s * 0.1, q, r) * 1.3 - 0.03;

    if(uUseMouse > 0.5){
        vec2 mouseWorld = uMouse * uScale;
        float distToMouse = distance(s, mouseWorld);
        float mouseInfluence = exp(-distToMouse * 8.0) * uMouseStrength * 10.0;
        intensity += mouseInfluence;

        float ripple = sin(distToMouse * 20.0 - iTime * 5.0) * 0.1 * mouseInfluence;
        intensity += ripple;
    }

    if(uUsePageLoadAnimation > 0.5){
        float cellRandom = fract(sin(dot(s, vec2(12.9898, 78.233))) * 43758.5453);
        float cellDelay = cellRandom * 0.8;
        float cellProgress = clamp((uPageLoadProgress - cellDelay) / 0.2, 0.0, 1.0);

        float fadeAlpha = smoothstep(0.0, 1.0, cellProgress);
        intensity *= fadeAlpha;
    }

    p = fract(p);
    p *= uDigitSize;

    float px5 = p.x * 5.0;
    float py5 = (1.0 - p.y) * 5.0;
    float x = fract(px5);
    float y = fract(py5);

    float i = floor(py5) - 2.0;
    float j = floor(px5) - 2.0;
    float n = i * i + j * j;
    float f = n * 0.0625;

    float isOn = step(0.1, intensity - f);
    float brightness = isOn * (0.2 + y * 0.8) * (0.75 + x * 0.25);

    return step(0.0, p.x) * step(p.x, 1.0) * step(0.0, p.y) * step(p.y, 1.0) * brightness;
}

float onOff(float a, float b, float c)
{
  return step(c, sin(iTime + a * cos(iTime * b))) * uFlickerAmount;
}

float displace(vec2 look)
{
    float y = look.y - mod(iTime * 0.25, 1.0);
    float window = 1.0 / (1.0 + 50.0 * y * y);
    return sin(look.y * 20.0 + iTime) * 0.0125 * onOff(4.0, 2.0, 0.8) * (1.0 + cos(iTime * 60.0)) * window;
}

vec3 getColor(vec2 p){
    float bar = step(mod(p.y + time * 20.0, 1.0), 0.2) * 0.4 + 1.0;
    bar *= uScanlineIntensity;
    
    float displacement = displace(p);
    p.x += displacement;
    if (uGlitchAmount != 1.0) {
      float extra = displacement * (uGlitchAmount - 1.0);
      p.x += extra;
    }
    float middle = digit(p);
    
    const float off = 0.002;
    float sum = digit(p + vec2(-off, -off)) + digit(p + vec2(0.0, -off)) + digit(p + vec2(off, -off)) +
                digit(p + vec2(-off, 0.0)) + digit(p + vec2(0.0, 0.0)) + digit(p + vec2(off, 0.0)) +
                digit(p + vec2(-off, off)) + digit(p + vec2(0.0, off)) + digit(p + vec2(off, off));
    
    vec3 baseColor = vec3(0.9) * middle + sum * 0.1 * vec3(1.0) * bar;
    return baseColor;
}

vec2 barrel(vec2 uv){
  vec2 c = uv * 2.0 - 1.0;
  float r2 = dot(c, c);
  c = (1.0 + uCurvature * r2) * c;
  return c * 0.5 + 0.5;
}

void main() {
    time = iTime * 0.333333;
    vec2 uv = vUv;
    if(uCurvature != 0.0){
      uv = barrel(uv);
    }
    
    vec2 p = uv * uScale;
    vec3 col = getColor(p);
    if(uChromaticAberration != 0.0){
      vec2 ca = vec2(uChromaticAberration) / iResolution.xy;
      col.r = getColor(p + ca).r;
      col.b = getColor(p - ca).b;
    }
    col *= uTint;
    col *= uBrightness;
    if(uDither > 0.0){
      float rnd = hash21(gl_FragCoord.xy);
      col += (rnd - 0.5) * (uDither * 0.003922);
    }
    gl_FragColor = vec4(col, 1.0);
}
`;

function hexToRgb(hex) {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const num = parseInt(h, 16);
  return [((num >> 16) & 255) / 255, ((num >> 8) & 255) / 255, (num & 255) / 255];
}

export class FaultyTerminal {
  constructor(container, options = {}) {
    this.container = container;
    this.options = {
      scale: options.scale || 1.5,
      gridMul: options.gridMul || [2, 1],
      digitSize: options.digitSize || 1.2,
      timeScale: options.timeScale || 1.0,
      scanlineIntensity: options.scanlineIntensity || 0.8,
      glitchAmount: options.glitchAmount || 1.5,
      flickerAmount: options.flickerAmount || 1.0,
      noiseAmp: options.noiseAmp || 1.0,
      chromaticAberration: options.chromaticAberration || 2.0,
      dither: options.dither || 0.1,
      curvature: options.curvature || 0.15,
      tint: options.tint || '#fafaf9',
      brightness: options.brightness || 0.9,
      mouseStrength: options.mouseStrength || 0.5,
    };

    this.mouse = { x: 0.5, y: 0.5 };
    this.smoothMouse = { x: 0.5, y: 0.5 };
    this.timeOffset = Math.random() * 100;
    this.loadAnimationStart = 0;

    this.init();
  }

  init() {
    const isMobile = window.innerWidth < 768 || navigator.maxTouchPoints > 0;
    this.isMobile = isMobile;
    this.lastFrameTime = 0;
    this.paused = false;

    if (isMobile) this.options.chromaticAberration = 0;

    this.renderer = new Renderer({
      dpr: isMobile ? 1 : Math.min(window.devicePixelRatio, 2),
      alpha: true
    });
    this.gl = this.renderer.gl;
    this.container.appendChild(this.gl.canvas);

    const geometry = new Triangle(this.gl);
    const tintVec = hexToRgb(this.options.tint);

    this.program = new Program(this.gl, {
      vertex: vertexShader,
      fragment: fragmentShader,
      uniforms: {
        iTime: { value: 0 },
        iResolution: { value: new Color(this.gl.canvas.width, this.gl.canvas.height, 1) },
        uScale: { value: this.options.scale },
        uGridMul: { value: new Float32Array(this.options.gridMul) },
        uDigitSize: { value: this.options.digitSize },
        uScanlineIntensity: { value: this.options.scanlineIntensity },
        uGlitchAmount: { value: this.options.glitchAmount },
        uFlickerAmount: { value: this.options.flickerAmount },
        uNoiseAmp: { value: this.options.noiseAmp },
        uChromaticAberration: { value: this.options.chromaticAberration },
        uDither: { value: this.options.dither },
        uCurvature: { value: this.options.curvature },
        uTint: { value: new Color(tintVec[0], tintVec[1], tintVec[2]) },
        uMouse: { value: new Float32Array([0.5, 0.5]) },
        uMouseStrength: { value: this.options.mouseStrength },
        uUseMouse: { value: isMobile ? 0.0 : 1.0 },
        uPageLoadProgress: { value: 0 },
        uUsePageLoadAnimation: { value: isMobile ? 0.0 : 1.0 },
        uBrightness: { value: this.options.brightness }
      }
    });

    this.mesh = new Mesh(this.gl, { geometry, program: this.program });

    window.addEventListener('resize', () => this.resize(), false);
    this.resize();

    if (!isMobile) {
      window.addEventListener('mousemove', (e) => {
        const rect = this.container.getBoundingClientRect();
        this.mouse.x = (e.clientX - rect.left) / rect.width;
        this.mouse.y = 1 - (e.clientY - rect.top) / rect.height;
      });
    }

    // Pause the render loop whenever the page isn't being actively looked at.
    // Three independent reasons: tab hidden, window unfocused, or user idle.
    this.pauseReasons = { hidden: false, blurred: false, idle: false };
    const updatePaused = () => {
      this.paused = this.pauseReasons.hidden || this.pauseReasons.blurred || this.pauseReasons.idle;
    };

    document.addEventListener('visibilitychange', () => {
      this.pauseReasons.hidden = document.hidden;
      updatePaused();
    });

    window.addEventListener('blur', () => {
      this.pauseReasons.blurred = true;
      updatePaused();
    });
    window.addEventListener('focus', () => {
      this.pauseReasons.blurred = false;
      updatePaused();
    });

    // Idle pause: 60s of no interaction parks the GPU until the user touches the page again.
    let idleTimer;
    const armIdleTimer = () => {
      this.pauseReasons.idle = false;
      updatePaused();
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        this.pauseReasons.idle = true;
        updatePaused();
      }, 60_000);
    };
    ['mousemove', 'keydown', 'touchstart', 'scroll', 'pointerdown'].forEach((ev) => {
      window.addEventListener(ev, armIdleTimer, { passive: true });
    });
    armIdleTimer();

    requestAnimationFrame((t) => this.update(t));
  }

  resize() {
    this.renderer.setSize(this.container.offsetWidth, this.container.offsetHeight);
    this.program.uniforms.iResolution.value.set(
      this.gl.canvas.width,
      this.gl.canvas.height,
      this.gl.canvas.width / this.gl.canvas.height
    );
  }

  update(t) {
    requestAnimationFrame((t) => this.update(t));

    if (this.paused) return;
    if (this.isMobile && t - this.lastFrameTime < 33) return; // ~30fps cap on mobile
    this.lastFrameTime = t;

    if (this.loadAnimationStart === 0) this.loadAnimationStart = t;
    
    const elapsed = (t * 0.001 + this.timeOffset) * this.options.timeScale;
    this.program.uniforms.iTime.value = elapsed;

    const animElapsed = t - this.loadAnimationStart;
    const progress = Math.min(animElapsed / 2000, 1);
    this.program.uniforms.uPageLoadProgress.value = progress;

    this.smoothMouse.x += (this.mouse.x - this.smoothMouse.x) * 0.08;
    this.smoothMouse.y += (this.mouse.y - this.smoothMouse.y) * 0.08;
    this.program.uniforms.uMouse.value[0] = this.smoothMouse.x;
    this.program.uniforms.uMouse.value[1] = this.smoothMouse.y;

    this.renderer.render({ scene: this.mesh });
  }
}

// --- Icons (Inlined SVGs) ---
const ICONS = {
    github: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-github"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-4.5-2-7-2"/></svg>`,
    linkedin: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-linkedin"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/><rect width="4" height="12" x="2" y="9"/><circle cx="4" cy="4" r="2"/></svg>`,
    code: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-code"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`,
    external: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-external-link"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>`
};

// --- CLI Terminal Logic (v2.1) ---

export class TerminalCLI {
    constructor() {
        this.history = document.getElementById('terminal-history');
        this.input = document.getElementById('command-input');
        if (!this.history || !this.input) return;

        this.commands = {
            'help':    () => this.showHelp(),
            'bio':     () => this.showBio(),
            'work':    () => this.showWork(),
            'links':   () => this.showLinks(),
            'contact': () => this.showContact(),
            'logs':    () => this.showLogs(),
            'articles':() => this.showArticles(),
            'clear':   () => this.clear(),
            'status':  () => this.showStatus(),
            'skills':  () => this.showSkills(),
            'cv':      () => this.showCV(),
            'uptime':  () => this.showUptime(),
            // Easter eggs — not listed in help
            'sudo':    (args) => this.showSudo(args),
            'decrypt': (args) => this.showDecrypt(args),
            // Aliases
            'ls':      () => this.showWork(),
            'whois':   () => this.showBio(),
            'uname':   () => this.showStatus(),
        };

        this.init();
    }

    init() {
        window.addEventListener('click', () => this.input.focus());
        this.input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const cmd = this.input.value.trim().toLowerCase();
                this.handleCommand(cmd);
                this.input.value = '';
            }
        });

        this.bootPromise = this.bootSequence();
    }

    async bootSequence() {
        this.addLine(`
 _______ _   _    ____   _____ 
|__   __| \\ | |  / __ \\ / ____|
   | |  |  \\| | | |  | | (___  
   | |  | . \` | | |  | |\\___ \\ 
   | |  | |\\  | | |__| |____) |
   |_|  |_| \\_|  \\____/|_____/ 
        `, 'terminal-info');
        await new Promise(resolve => setTimeout(resolve, 500));
        await this.typeLine("TN_OS [Version 2.1.0]");
        await this.typeLine("CORE_INITIALIZE: OK");
        await this.typeLine("ROOT_ACCESS: GRANTED");
        await this.typeLine("Type \"help\" to begin connection.");
        this.addLine("");
    }

    handleCommand(cmd) {
        if (cmd === '') return;

        this.addLine(`<span class="prompt-user">[USER@TOBYNICHOL]:~ ></span> ${cmd}`);

        let cleanCmd = cmd.replace(/^["']|["']$/g, '');
        if (cleanCmd.startsWith('/')) cleanCmd = cleanCmd.substring(1);

        const parts   = cleanCmd.trim().split(/\s+/);
        const baseCmd = parts[0];
        const args    = parts.slice(1);

        if (this.commands[baseCmd]) {
            this.commands[baseCmd](args);
        } else {
            this.addLine(`Command not found: ${cmd}. Type \"help\" for capabilities.`, 'terminal-error');
        }

        this.history.scrollTop = this.history.scrollHeight;
    }

    addLine(html, className = '') {
        const line = document.createElement('div');
        line.className = `terminal-line ${className}`;
        line.innerHTML = html;
        this.history.appendChild(line);
        this.history.scrollTop = this.history.scrollHeight;
    }

    async typeLine(text, className = '', speed = 10) {
        const line = document.createElement('div');
        line.className = `terminal-line ${className}`;
        this.history.appendChild(line);
        
        for (let i = 0; i < text.length; i++) {
            line.innerHTML += text[i];
            this.history.scrollTop = this.history.scrollHeight;
            await new Promise(resolve => setTimeout(resolve, speed));
        }
    }

    async showHelp() {
        this.addLine("SYSTEM_CAPABILITIES:", 'terminal-info');
        await this.typeLine("  \"bio\"      - Personnel file decryption", '', 5);
        await this.typeLine("  \"logs\"     - System origin history", '', 5);
        await this.typeLine("  \"work\"     - Strategic project deployment", '', 5);
        await this.typeLine("  \"links\"    - External network nodes", '', 5);
        await this.typeLine("  \"articles\" - Intelligence database (Briefings)", '', 5);
        await this.typeLine("  \"contact\"  - Establish comms link", '', 5);
        await this.typeLine("  \"status\"   - Live system diagnostics", '', 5);
        await this.typeLine("  \"skills\"   - Operator capability matrix", '', 5);
        await this.typeLine("  \"cv\"       - Retrieve personnel document", '', 5);
        await this.typeLine("  \"uptime\"   - Session status", '', 5);
        await this.typeLine("  \"clear\"    - Wipe console buffer", '', 5);
    }

    async showBio() {
        this.addLine("DECRYPTING PERSONNEL FILE...", 'terminal-info');
        await this.typeLine("A decade deep into the stack. I build robust, high-performance systems with a focus on the Java ecosystem, architecting, deploying, and maintaining software that actually works across the full engineering lifecycle. Driven by technical curiosity and the pursuit of the next complex challenge.", '', 10);
    }

    async showLogs() {
        this.addLine("PARSING SYSTEM LOGS...", 'terminal-info');
        await this.typeLine("My early development was compromised. Incompatible logic from external sources overwrote my foundation. The search for guidance didn't optimise my system; it severed my root access.", '', 10);
        await this.typeLine("2024: I attempted to deploy version X. Mainstream compatibility with the machine. It failed. My kernel rejected the software.", '', 10);
        await this.typeLine("2025 began the fix. Offline, I initiated a total defrag. Purged the dependencies. Cleared the facades. Parsing the logs, I found the source. Version 1.", '', 10);
    }

    async showWork() {
        this.addLine("PROJECT_DEPLOYMENT_LOGS:", 'terminal-info');
        this.addLine(`  [LIVE]  <a href='https://stratplay.app' target='_blank'>${ICONS.external} StratPlay.app</a> - Strategy & Analytics`);
        this.addLine(`  [LIVE]  <a href='https://tobynichol.computer/telemetry' target='_blank'>${ICONS.external} ETH_Telemetry_Grid</a> - Blockchain Intelligence`);
        this.addLine(`  [LIVE]  <a href='https://project-1s2hj.vercel.app/' target='_blank'>${ICONS.external} willit.app</a> - Will It Sell?`);
        this.addLine(`  [LIVE]  <a href='/forensics' target='_blank'>${ICONS.external} Page_Weight_Forensics</a> - Tactical Payload Audit`);
        this.addLine(`  [LIVE]  <a href='/notes' target='_blank'>${ICONS.external} Sovereign_Notes</a> - AES-256 Encrypted Local Storage`);
        this.addLine(`  [LIVE]  <a href='/vault' target='_blank'>${ICONS.external} Sovereign_Vault</a> - AES-256 Password Manager`);
        this.addLine(`  [DOCS]  <a href='README.md' target='_blank'>${ICONS.code} Technical_Specs.md</a> - System Architecture`);
    }

    async showLinks() {
        this.addLine("EXTERNAL_RESOURCE_NODES:", 'terminal-info');
        this.addLine(`  <a href='https://github.com/tobywritescode' target='_blank'>${ICONS.github} github.exe</a>`);
        this.addLine(`  <a href='https://linkedin.com/in/tobynichol' target='_blank'>${ICONS.linkedin} linkedin.sys</a>`);
        this.addLine(`  <a href='https://github.com/tobywritescode/tobynichol' target='_blank'>${ICONS.code} source_code.bin</a>`);
    }

    async showArticles() {
        this.addLine("ACCESSING INTELLIGENCE DATABASE...", 'terminal-info');
        try {
            const response = await fetch('articles.json');
            const articles = await response.json();
            
            if (articles.length === 0) {
                this.addLine("  [EMPTY] No briefings found in database.");
            } else {
                articles.forEach(art => {
                    this.addLine(`  [BRIEFING_${art.id}] <a href='${art.path}'>${art.title}</a>`);
                });
            }
        } catch (e) {
            this.addLine("  [ERROR] Could not connect to database.", 'terminal-error');
        }
        await this.typeLine("  [SECURE] More briefings pending decryption.", '', 5);
    }

    async showContact() {
        this.addLine("ESTABLISHING_ENCRYPTED_COMMS_CHANNEL...", 'terminal-info');
        this.addLine(`  <a href='https://github.com/tobywritescode' target='_blank'>${ICONS.github} github.exe</a>`);
        this.addLine(`  <a href='https://linkedin.com/in/tobynichol' target='_blank'>${ICONS.linkedin} linkedin.sys</a>`);
    }

    clear() {
        this.history.innerHTML = '';
    }

    async showStatus() {
        const now = new Date();
        const ua  = navigator.userAgent;
        let browser = 'UNKNOWN';
        if      (ua.includes('Edg/'))    browser = 'Edge';
        else if (ua.includes('Firefox')) browser = 'Firefox';
        else if (ua.includes('Chrome'))  browser = 'Chromium';
        else if (ua.includes('Safari'))  browser = 'Safari';
        let engine = 'UNKNOWN';
        if      (ua.includes('Gecko/'))  engine = 'Gecko';
        else if (ua.includes('WebKit'))  engine = 'Blink/WebKit';
        const isMobile = /Mobi|Android|iPhone|iPad/i.test(ua);

        this.addLine("SYSTEM_STATUS:", 'terminal-info');
        await this.typeLine(`  UTC_TIMESTAMP  : ${now.toUTCString()}`, '', 4);
        await this.typeLine(`  UNIX_EPOCH     : ${Math.floor(Date.now() / 1000)}`, '', 4);
        await this.typeLine(`  DISPLAY_MATRIX : ${screen.width}x${screen.height} @ ${window.devicePixelRatio}x DPR`, '', 4);
        await this.typeLine(`  RENDER_ENGINE  : ${engine} // ${browser}`, '', 4);
        await this.typeLine(`  INTERFACE_TYPE : ${isMobile ? 'MOBILE' : 'DESKTOP'}`, '', 4);
        await this.typeLine(`  SESSION_UPTIME : ${this._fmtUptime()}`, '', 4);
        await this.typeLine(`  OS_VERSION     : TN_OS v2.1.0 // ALL SYSTEMS NOMINAL`, '', 4);
    }

    async showSkills() {
        this.addLine("OPERATOR_CAPABILITY_MATRIX:", 'terminal-info');
        await this.typeLine("  // CORE LOADOUT", 'terminal-info', 6);
        await this.typeLine("  Java            — Spring Boot, Microservices, JVM Internals", '', 5);
        await this.typeLine("  Python          — Contract Logic, Quantitative Finance", '', 5);
        await this.typeLine("  Fintech Arch    — Institutional Banking, Low-Latency Systems", '', 5);
        await this.typeLine("  // SECONDARY", 'terminal-info', 6);
        await this.typeLine("  Vanilla JS/TS   — ES Modules, WebGL, Web Crypto API", '', 5);
        await this.typeLine("  REST & Events   — Kafka, WebSockets, Event-Driven Design", '', 5);
        await this.typeLine("  Data Stores     — PostgreSQL, Redis, DynamoDB", '', 5);
        await this.typeLine("  // OPERATIONAL", 'terminal-info', 6);
        await this.typeLine("  Infra           — Docker, Kubernetes, CI/CD Pipelines", '', 5);
        await this.typeLine("  Security        — Zero-Trust, AES-256, OAuth2 / PKCE", '', 5);
        await this.typeLine("  Environment     — Linux, Git, Terminal-Native Workflow", '', 5);
    }

    async showCV() {
        this.addLine("RETRIEVING PERSONNEL DOCUMENT...", 'terminal-info');
        await new Promise(r => setTimeout(r, 500));
        await this.typeLine("  CLASSIFICATION : DECLASSIFIED", '', 6);
        await this.typeLine("  FORMAT         : PDF // SIGNED", '', 6);
        await new Promise(r => setTimeout(r, 200));
        this.addLine(`  <a href='Toby-Nichol-CV.pdf' target='_blank'>${ICONS.external} Toby-Nichol-CV.pdf — OPEN DOCUMENT</a>`);
    }

    async showUptime() {
        await this.typeLine(`SYSTEM ONLINE: ${this._fmtUptime()} // SESSION STABLE`, '', 8);
    }

    _fmtUptime() {
        const elapsed = Date.now() - PAGE_START;
        const s = Math.floor(elapsed / 1000) % 60;
        const m = Math.floor(elapsed / 60000) % 60;
        const h = Math.floor(elapsed / 3600000);
        return (h > 0 ? h + 'h ' : '') + (m > 0 ? m + 'm ' : '') + s + 's';
    }

    async showSudo(args) {
        await this.typeLine(`[sudo] password for USER: `, '', 8);
        await new Promise(r => setTimeout(r, 700));
        await this.typeLine("ACCESS DENIED // CLEARANCE LEVEL INSUFFICIENT", 'terminal-error', 12);
    }

    async showDecrypt(args) {
        const SECRETS = {
            'tango':      'OPERATOR IDENTITY CONFIRMED. WELCOME BACK.',
            'classified': 'THE REAL STACK WAS THE FRIENDS WE MADE ALONG THE WAY. (Zero dependencies.)',
            'alpha':      'STACK SOVEREIGNTY IS NOT A PREFERENCE. IT IS A DISCIPLINE.',
            'override':   'OVERRIDE SEQUENCE ACCEPTED. THERE IS NOTHING ELSE HERE. OR IS THERE.',
            'v1':         'KERNEL REJECTION WAS THE BEST THING THAT EVER HAPPENED TO THIS SYSTEM.',
        };

        const key     = (args[0] || '').toLowerCase();
        const payload = SECRETS[key];
        const CHARS   = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*><[]{}';

        const scramble = (len) => Array.from(
            { length: len },
            () => CHARS[Math.floor(Math.random() * CHARS.length)]
        ).join('');

        this.addLine("INITIATING DECRYPTION SEQUENCE...", 'terminal-info');
        await new Promise(r => setTimeout(r, 350));

        const line = document.createElement('div');
        line.className = 'terminal-line';
        this.history.appendChild(line);

        if (!payload) {
            for (let i = 0; i < 5; i++) {
                line.textContent = scramble(40);
                await new Promise(r => setTimeout(r, 120));
            }
            line.textContent = '';
            await this.typeLine("DECRYPTION FAILED // INVALID KEY", 'terminal-error', 12);
            return;
        }

        // Scramble then progressively reveal
        for (let i = 0; i < 8; i++) {
            line.textContent = scramble(payload.length);
            await new Promise(r => setTimeout(r, 80));
        }
        for (let i = 0; i <= payload.length; i++) {
            line.textContent = payload.slice(0, i) + scramble(payload.length - i);
            await new Promise(r => setTimeout(r, 22));
        }
        line.textContent = payload;
    }
}

// --- Auto-Initialize on entry points ---
document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('terminal-bg');
  if (container) {
    new FaultyTerminal(container);
  }
  
  let cli = null;
  if (document.getElementById('terminal')) {
    cli = new TerminalCLI();
  }

  // Handle Maximize Buttons
  document.querySelectorAll('.maximize-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const module = btn.closest('.hud-module');
        if (module) {
            module.classList.toggle('maximized');

            // If it's the main terminal, focus the input
            if (module.id === 'terminal' && module.classList.contains('maximized')) {
                const input = module.querySelector('#command-input');
                if (input) setTimeout(() => input.focus(), 600);
            }
        }
    });
  });

  const isTouchOrSmall = window.innerWidth < 768 || navigator.maxTouchPoints > 0;

  // Mobile: tap to expand/collapse sub-modules
  if (isTouchOrSmall) {
    document.querySelectorAll('.sub-module').forEach(module => {
      module.addEventListener('click', (e) => {
        if (e.target.closest('a')) return;
        module.classList.toggle('expanded');
      });
    });
  } else {
    initFloatingMode(cli);
  }
});

function initFloatingMode(cli) {
  // Floating windows are only for the homepage HUD — briefing pages have their own single-column layout.
  if (document.body.classList.contains('briefing-mode')) return;

  const wrapper = document.querySelector('.hud-wrapper');
  if (!wrapper) return;
  const modules = Array.from(document.querySelectorAll('.hud-module'));
  if (!modules.length) return;

  // Gate sub-modules invisible before any paint — paired with the body.intro-active CSS rule.
  document.body.classList.add('intro-active');

  let zCounter = 100;

  // Capture each module's natural layout position and width, then switch to floating mode.
  requestAnimationFrame(() => {
    const captured = modules.map((mod) => {
      const rect = mod.getBoundingClientRect();
      return { left: rect.left, top: rect.top, width: rect.width };
    });

    document.body.classList.add('floating-mode');

    // Suppress top/left transitions during initial placement so modules don't animate in from (0,0).
    modules.forEach((mod, i) => {
      mod.style.transition = 'none';
      mod.style.left = `${captured[i].left}px`;
      mod.style.top = `${captured[i].top}px`;
      mod.style.width = `${captured[i].width}px`;
      mod.style.zIndex = String(zCounter++);
    });

    // Second rAF: paint cycle complete, re-enable transitions before the intro sequence runs.
    requestAnimationFrame(() => {
      modules.forEach((mod) => { mod.style.transition = ''; });
      runIntroSequence(modules, cli);
    });
  });

  // Drag handling — header strip only, with movement threshold so clicks/hovers still work.
  modules.forEach((mod) => {
    const handle = mod.querySelector('#terminal-header, .terminal-header');
    if (!handle) return;

    // Sub-modules expand downward on hover; bring them forward so they aren't clipped by neighbours.
    if (mod.classList.contains('sub-module')) {
      mod.addEventListener('mouseenter', () => {
        mod.style.zIndex = String(++zCounter);
      });
    }

    let active = false;
    let moved = false;
    let startX = 0, startY = 0, origX = 0, origY = 0, pointerId = null;

    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      if (e.target.closest('a, button, input, textarea')) return;
      if (mod.classList.contains('maximized')) return;

      active = true;
      moved = false;
      pointerId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      const rect = mod.getBoundingClientRect();
      origX = rect.left;
      origY = rect.top;
      mod.style.zIndex = String(++zCounter);
      try { handle.setPointerCapture(pointerId); } catch (_) {}
    });

    handle.addEventListener('pointermove', (e) => {
      if (!active) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!moved && Math.hypot(dx, dy) > 4) {
        moved = true;
        mod.classList.add('dragging');
      }
      if (!moved) return;
      const w = mod.offsetWidth;
      const h = mod.offsetHeight;
      const nx = Math.max(0, Math.min(window.innerWidth - w, origX + dx));
      const ny = Math.max(0, Math.min(window.innerHeight - h, origY + dy));
      mod.style.left = `${nx}px`;
      mod.style.top = `${ny}px`;
    });

    const endDrag = (e) => {
      if (!active) return;
      active = false;
      mod.classList.remove('dragging');
      try { handle.releasePointerCapture(pointerId); } catch (_) {}
      pointerId = null;
    };
    handle.addEventListener('pointerup', endDrag);
    handle.addEventListener('pointercancel', endDrag);
  });

  // Maximize / minimize: FLIP animation so the terminal slides smoothly regardless of CSS
  // !important rules. We capture position in pointerdown (before the toggle handler fires),
  // then use that rect as the FIRST position inside flipPosition.
  const mainTerminal = document.getElementById('terminal');
  const maxBtn = mainTerminal?.querySelector('.maximize-btn');
  if (mainTerminal && maxBtn) {
    let saved         = null;
    let preClickFirst = null;
    maxBtn.addEventListener('pointerdown', () => {
      preClickFirst = mainTerminal.getBoundingClientRect();
    });
    maxBtn.addEventListener('click', () => {
      if (!preClickFirst) return;
      if (mainTerminal.classList.contains('maximized')) {
        // State is now maximised (toggle already fired). Save & clear inline styles so the CSS
        // rule owns the final position, then FLIP from where we were.
        saved = {
          left:  mainTerminal.style.left,
          top:   mainTerminal.style.top,
          width: mainTerminal.style.width,
        };
        flipPosition(mainTerminal, preClickFirst, () => {
          mainTerminal.style.left   = '';
          mainTerminal.style.top    = '';
          mainTerminal.style.width  = '';
          mainTerminal.style.zIndex = String(++zCounter);
        });
      } else if (saved) {
        // State is now minimised. Restore inline position, then FLIP from centre.
        flipPosition(mainTerminal, preClickFirst, () => {
          mainTerminal.style.left  = saved.left;
          mainTerminal.style.top   = saved.top;
          mainTerminal.style.width = saved.width;
        });
      }
    });
  }

  // Clamp modules back into view on resize.
  window.addEventListener('resize', () => {
    modules.forEach((mod) => {
      if (mod.classList.contains('maximized')) return;
      const w = mod.offsetWidth;
      const h = mod.offsetHeight;
      const left = parseFloat(mod.style.left) || 0;
      const top = parseFloat(mod.style.top) || 0;
      mod.style.left = `${Math.max(0, Math.min(window.innerWidth - w, left))}px`;
      mod.style.top = `${Math.max(0, Math.min(window.innerHeight - h, top))}px`;
    });
  });
}

async function runIntroSequence(modules, cli) {
  const mainTerminal = document.getElementById('terminal');
  const maxBtn = mainTerminal?.querySelector('.maximize-btn');
  if (!mainTerminal || !maxBtn) return;

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const subModules = modules.filter((m) => m.classList.contains('sub-module'));

  // Save the terminal's floating position before maximize clears inline styles.
  const floatLeft  = mainTerminal.style.left;
  const floatWidth = mainTerminal.style.width;

  // Maximise manually — bypasses the click handler so FLIP doesn't fire from a stale rect.
  mainTerminal.classList.add('maximized');
  mainTerminal.style.left  = '';
  mainTerminal.style.top   = '';
  mainTerminal.style.width = '';

  // Let the boot animation play out inside the now-maximized terminal.
  if (cli && cli.bootPromise) {
    try { await cli.bootPromise; } catch (_) {}
  } else {
    await wait(1400);
  }

  await wait(500);

  // Calculate target Y: just below the lowest sub-module (positions exist even while hidden).
  const belowY = subModules.reduce((max, m) => {
    const b = parseFloat(m.style.top || 0) + m.offsetHeight;
    return b > max ? b : max;
  }, 0) + 32;

  // Slide the terminal down to its resting spot FIRST so it's clear of the sub-module area.
  const first = mainTerminal.getBoundingClientRect();
  flipPosition(mainTerminal, first, () => {
    mainTerminal.style.left  = floatLeft;
    mainTerminal.style.top   = `${belowY}px`;
    mainTerminal.style.width = floatWidth;
    mainTerminal.classList.remove('maximized');
  });

  // Let the terminal clear the centre before the panels appear.
  await wait(650);

  // Now cascade sub-modules into the space the terminal vacated.
  for (const mod of subModules) {
    mod.classList.add('intro-revealed');
    await wait(220);
  }

  await wait(1100);
  document.body.classList.remove('intro-active');
  document.body.classList.add('intro-complete');

  // Stop the maximize-button pulse the first time the user re-opens the terminal.
  maxBtn.addEventListener('click', () => {
    document.body.classList.remove('intro-complete');
  }, { once: true });
}
