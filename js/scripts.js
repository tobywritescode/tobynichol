/**
 * tobynichol.computer - Shared WebGL Background + CLI Core
 */

import { Renderer, Program, Mesh, Color, Triangle, Texture } from 'https://esm.sh/ogl';

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
uniform sampler2D uTexture;

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
    vec2 grid = uGridMul * 40.0; // Reverted to 40.0 for smaller pixels
    vec2 s = floor(p * grid) / grid;
    
    // Calculate aspect ratios for full screen coverage
    float screenAspect = iResolution.x / iResolution.y;
    // We'll use "cover" logic: scale the texture so it fills the screen, cropping the edges
    vec2 centeredUv = s / uScale;
    
    centeredUv.x *= screenAspect;
    centeredUv.x -= (screenAspect - 1.0) * 0.5;
    
    // Add floating/jitter effect to texture coordinates
    vec2 q_noise, r_noise;
    float jitter = pattern(s * 0.05 + time * 0.05, q_noise, r_noise);
    centeredUv += (q_noise - 0.5) * 0.035; // Slight adjustment to jitter for smaller pixels
    
    // Sample texture for intensity
    vec4 texColor = texture2D(uTexture, centeredUv);
    float lum = dot(texColor.rgb, vec3(0.299, 0.587, 0.114));
    
    // If out of bounds of the actual image, just use procedural noise
    if(centeredUv.x < 0.0 || centeredUv.x > 1.0 || centeredUv.y < 0.0 || centeredUv.y > 1.0) {
        lum = 0.0;
    }
    
    p = p * grid;
    vec2 q, r;
    // Base procedural intensity mixed with image luminance
    float procedural = pattern(s * 0.1, q, r) * 0.4;
    // Ensure there's always a base level of "broken scanning" pixels across the whole screen
    float intensity = (lum * 1.8 + procedural) - 0.1;
    
    if(uUseMouse > 0.5){
        vec2 mouseWorld = uMouse * uScale;
        float distToMouse = distance(s, mouseWorld);
        // Large falloff (4.0) and even fainter strength (1.0)
        float mouseInfluence = exp(-distToMouse * 4.0) * uMouseStrength * 1.0;
        // Make it "like static" by mixing with procedural noise
        intensity += mouseInfluence * (0.4 + procedural * 0.6);
        
        float ripple = sin(distToMouse * 15.0 - iTime * 3.0) * 0.02 * mouseInfluence;
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
    
    // Refine the dot shape for the smaller grid
    float dist = distance(p, vec2(0.5));
    float dotShape = smoothstep(0.45, 0.05, dist);
    
    // Remove binary step to allow for greyscale/detail
    // We use a slight threshold to keep the background clean, but let intensity drive brightness
    float brightness = clamp(intensity * 1.2, 0.0, 1.0) * dotShape;
    
    // Add back some procedural sparkle/jitter to the brightness
    brightness *= (0.7 + procedural * 0.3);
    
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
    this.renderer = new Renderer({ 
      dpr: Math.min(window.devicePixelRatio, 2),
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
        uUseMouse: { value: 1.0 },
        uPageLoadProgress: { value: 0 },
        uUsePageLoadAnimation: { value: 1.0 },
        uBrightness: { value: this.options.brightness },
        uTexture: { value: new Texture(this.gl, { generateMipmaps: false }) }
      }
    });

    this.mesh = new Mesh(this.gl, { geometry, program: this.program });

    // Load texture image
    const image = new Image();
    image.src = 'assets/me.png';
    image.onload = () => {
      this.program.uniforms.uTexture.value.image = image;
    };

    window.addEventListener('resize', () => this.resize(), false);
    this.resize();

    window.addEventListener('mousemove', (e) => {
      const rect = this.container.getBoundingClientRect();
      this.mouse.x = (e.clientX - rect.left) / rect.width;
      this.mouse.y = 1 - (e.clientY - rect.top) / rect.height;
    });

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
            'help': () => this.showHelp(),
            'bio': () => this.showBio(),
            'work': () => this.showWork(),
            'links': () => this.showLinks(),
            'contact': () => this.showContact(),
            'logs': () => this.showLogs(),
            'articles': () => this.showArticles(),
            'clear': () => this.clear(),
            'ls': () => this.showWork(),
            'whois': () => this.showBio()
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

        this.bootSequence();
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

        // Strip leading/trailing quotes and leading slash
        let cleanCmd = cmd.replace(/^["']|["']$/g, '');
        if (cleanCmd.startsWith('/')) {
            cleanCmd = cleanCmd.substring(1);
        }

        if (this.commands[cleanCmd]) {
            this.commands[cleanCmd]();
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
        await this.typeLine("  \"clear\"    - Wipe console buffer", '', 5);
    }

    async showBio() {
        this.addLine("DECRYPTING PERSONNEL FILE...", 'terminal-info');
        await this.typeLine("A decade deep into the stack. I build robust, high-performance systems with a focus on the Java ecosystem. Over a decade of engineering across the full lifecycle, I specialise in architecting, deploying, and maintaining software that actually works. Driven by technical curiosity and the pursuit of the next complex challenge.", '', 10);
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
        this.addLine(`  [DOCS]  <a href='README.md' target='_blank'>${ICONS.code} Technical_Specs.md</a> - System Architecture`);
        this.addLine("  [WAIT]  Project_Beta - In Development");
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
        await this.typeLine("COMMS_OPEN_AT: hello@tobynichol.computer", '', 10);
    }

    clear() {
        this.history.innerHTML = '';
    }
}

// --- Auto-Initialize on entry points ---
document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('terminal-bg');
  if (container) {
    new FaultyTerminal(container);
  }
  
  if (document.getElementById('terminal')) {
    new TerminalCLI();
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
});
