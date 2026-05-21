import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// --- CONFIGURATION ---
const CONFIG = {
    CRT: {
        curvature: 0.06,
        scanline: 0.1,
        chroma: 0.001,
        noise: 0.04
    },
    COLORS: {
        primary: 0x00ffff,
        grid: 0x003333,
        gridAlert: 0x331100
    },
    HUD: {
        padding: 40,
        fontSize: 'bold 14px "Courier New", monospace',
        keyFontSize: 'bold 10px "Courier New", monospace'
    }
};

const HUD_KEYS = [
    { id: 'geo', label: '[GEO_SENSORS]', desc: 'GLOBAL RPC LATENCY SENSORS', rx: 0.5, ry: 0.5 },
    { id: 'sys', label: '[SYSTEM_LOG]', desc: 'BLOCK PROGRESS & BASE FEE', rx: 0.1, ry: 0.1 },
    { id: 'spec', label: '[SPECTRAL_OSC]', desc: 'NETWORK VOLATILITY FREQUENCY', rx: 0.5, ry: 0.9 }
];

// --- STATE ---
let scene, camera, renderer, composer, grid, mapGroup;
let hudScene, hudCamera, hudPlane, hudCtx, hudCanvas, hudTexture;
let nodes = [];
let heartbeat = new Array(64).fill(0);
let globalData = { timeSinceBlock: 0, avgGwei: 0 };
let raycaster = new THREE.Raycaster();
let mouse = new THREE.Vector2();
let hoveredNode = null;
let hoveredKey = null;
let lastFrameTime = 0;

// --- CRT Shader ---
const CRTShader = {
    uniforms: {
        "tDiffuse": { value: null },
        "iTime": { value: 0 },
        "uCurvature": { value: CONFIG.CRT.curvature },
        "uScanlineIntensity": { value: CONFIG.CRT.scanline },
        "uChromaticAberration": { value: CONFIG.CRT.chroma },
        "uNoiseAmp": { value: CONFIG.CRT.noise }
    },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float iTime;
        uniform float uCurvature;
        uniform float uScanlineIntensity;
        uniform float uChromaticAberration;
        uniform float uNoiseAmp;
        varying vec2 vUv;

        vec2 barrel(vec2 uv) {
            vec2 c = uv * 2.0 - 1.0;
            float r2 = dot(c, c);
            c = (1.0 + uCurvature * r2) * c;
            return c * 0.5 + 0.5;
        }

        float random(vec2 p) {
            return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
        }

        void main() {
            vec2 uv = barrel(vUv);
            if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
                gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
                return;
            }

            float r = texture2D(tDiffuse, uv + vec2(uChromaticAberration, 0.0)).r;
            float g = texture2D(tDiffuse, uv).g;
            float b = texture2D(tDiffuse, uv - vec2(uChromaticAberration, 0.0)).b;
            vec3 col = vec3(r, g, b);

            float scanline = sin(uv.y * 800.0 + iTime * 5.0) * uScanlineIntensity;
            col -= scanline;
            col += (random(uv + iTime) - 0.5) * uNoiseAmp;

            float vignette = 1.0 - smoothstep(0.4, 1.5, length(vUv * 2.0 - 1.0));
            col *= vignette;
            gl_FragColor = vec4(col, 1.0);
        }
    `
};

// --- CORE FUNCTIONS ---

async function init() {
    initScene();
    initHUD();
    initPostProcessing();
    initEventListeners();
    
    await loadWorldMap();
    startPolling();
    animate();
}

function initScene() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 2000);
    adjustCamera();
    camera.lookAt(0, 0, 0);

    renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('three-canvas'), antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);

    mapGroup = new THREE.Group();
    mapGroup.rotation.x = -Math.PI / 8;
    scene.add(mapGroup);

    const gridGeom = new THREE.PlaneGeometry(2000, 2000, 80, 80);
    const gridMat = new THREE.MeshBasicMaterial({ color: CONFIG.COLORS.grid, wireframe: true, transparent: true, opacity: 0.5 });
    grid = new THREE.Mesh(gridGeom, gridMat);
    mapGroup.add(grid);
}

function initHUD() {
    hudCanvas = document.getElementById('hud-canvas');
    hudCtx = hudCanvas.getContext('2d');
    resizeHud();
    
    hudTexture = new THREE.CanvasTexture(hudCanvas);
    hudScene = new THREE.Scene();
    hudCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const hudMat = new THREE.MeshBasicMaterial({ map: hudTexture, transparent: true });
    hudPlane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), hudMat);
    hudScene.add(hudPlane);
}

function initPostProcessing() {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    
    const hudPass = new RenderPass(hudScene, hudCamera);
    hudPass.clear = false;
    composer.addPass(hudPass);
    
    const crtPass = new ShaderPass(CRTShader);
    composer.addPass(crtPass);
}

function initEventListeners() {
    window.addEventListener('resize', onWindowResize);
    window.addEventListener('mousemove', (e) => {
        mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    });
}

function onWindowResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    adjustCamera();
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    composer.setSize(w, h);
    resizeHud();
    
    if (hudTexture) {
        hudTexture.dispose();
        hudTexture = new THREE.CanvasTexture(hudCanvas);
        hudPlane.material.map = hudTexture;
    }
}

async function loadWorldMap() {
    try {
        const response = await fetch('https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson');
        const data = await response.json();
        
        const linePoints = [];
        data.features.forEach(feature => {
            const processRing = (ring) => {
                for (let i = 0; i < ring.length - 1; i++) {
                    linePoints.push(new THREE.Vector3(ring[i][0] * 2, ring[i][1] * 2, 0.5));
                    linePoints.push(new THREE.Vector3(ring[i+1][0] * 2, ring[i+1][1] * 2, 0.5));
                }
            };
            if (feature.geometry.type === 'Polygon') feature.geometry.coordinates.forEach(processRing);
            else if (feature.geometry.type === 'MultiPolygon') feature.geometry.coordinates.forEach(poly => poly.forEach(processRing));
        });
        
        const mapGeom = new THREE.BufferGeometry().setFromPoints(linePoints);
        const mapMat = new THREE.LineBasicMaterial({ color: CONFIG.COLORS.primary, transparent: true, opacity: 0.4 });
        mapGroup.add(new THREE.LineSegments(mapGeom, mapMat));
    } catch (e) { console.error("Map Load Failed:", e); }
}

function adjustCamera() {
    const aspect = window.innerWidth / window.innerHeight;
    let dist = 350; 
    if (aspect < 2.0) dist = 350 * (2.0 / aspect);
    camera.position.z = Math.min(800, dist);
}

function resizeHud() {
    hudCanvas.width = window.innerWidth;
    hudCanvas.height = window.innerHeight;
}

const REGIONAL_RPCS = [
    { id: 'LDN-RPC-01', url: 'https://eth.drpc.org',                    lat: 51.5074,  lon: -0.1278   },
    { id: 'NYC-RPC-02', url: 'https://eth.rpc.blxrbdn.com',              lat: 40.7128,  lon: -74.0060  },
    { id: 'SIN-RPC-03', url: 'https://1rpc.io/eth',                      lat: 1.3521,   lon: 103.8198  },
    { id: 'TYO-RPC-04', url: 'https://ethereum.publicnode.com',          lat: 35.6895,  lon: 139.6917  },
    { id: 'SFO-RPC-05', url: 'https://rpc.flashbots.net',                lat: 37.7749,  lon: -122.4194 },
    { id: 'FRA-RPC-06', url: 'https://eth-pokt.nodies.app',              lat: 50.1109,  lon: 8.6821    },
    { id: 'SYD-RPC-10', url: 'https://cloudflare-eth.com',               lat: -33.8688, lon: 151.2093  },
    { id: 'GRU-RPC-08', url: 'https://ethereum-rpc.publicnode.com',      lat: -23.5505, lon: -46.6333  },
    { id: 'TOR-RPC-07', url: 'https://eth.drpc.org',                     lat: 45.6532,  lon: -82.3832  },
];

let lastBlockHash = null;
let lastBlockTime = Date.now();
let lastBlockBaseFee = 0;
let blockVolatility = 0;

async function pollNode(node) {
    const start = performance.now();
    try {
        const res = await fetch(node.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_getBlockByNumber', params: ['latest', false], id: 1 }),
            signal: AbortSignal.timeout(4000)
        });
        if (!res.ok) return null;
        const data = await res.json();
        const result = data.result;
        if (!result) return null;
        const latency = performance.now() - start;
        const gwei = parseInt(result.baseFeePerGas, 16) / 1e9;
        return { id: node.id, lat: node.lat, lon: node.lon, latency, gwei: Math.round(gwei * 10) / 10, hash: result.hash };
    } catch (e) {
        return null;
    }
}

function computeHeartbeat(nodesData) {
    const avgLat = nodesData.length > 0 ? nodesData.reduce((a, b) => a + b.latency, 0) / nodesData.length : 0;
    const t = Date.now() / 1000;
    return Array.from({ length: 64 }, (_, i) => {
        const freq = 1.0 + (i / 64) * 5.0;
        const phase = i * (Math.PI / 32);
        const noise = Math.sin(t * freq + phase) * 0.4 + Math.sin(t * (freq * 0.5) + phase) * 0.6;
        const activity = 0.2 + avgLat / 400 + blockVolatility * 1.2;
        return Math.max(0.05, Math.min(1.0, Math.abs(noise * activity)));
    });
}

async function poll() {
    const results = await Promise.all(REGIONAL_RPCS.map(n => pollNode(n)));
    const nodesData = results.filter(Boolean);

    const latest = nodesData.find(n => n.hash);
    if (latest && latest.hash !== lastBlockHash) {
        if (lastBlockBaseFee > 0) blockVolatility = Math.abs(latest.gwei - lastBlockBaseFee);
        lastBlockHash = latest.hash;
        lastBlockTime = Date.now();
        lastBlockBaseFee = latest.gwei;
    }

    heartbeat = computeHeartbeat(nodesData);
    updateNodes(nodesData);
    globalData = {
        timeSinceBlock: (Date.now() - lastBlockTime) / 1000,
        avgGwei: nodesData.length > 0 ? nodesData.reduce((a, b) => a + b.gwei, 0) / nodesData.length : 0
    };
}

function startPolling() {
    poll();
    setInterval(poll, 5000);
}

function updateNodes(nodeData) {
    nodeData.forEach((data) => {
        let node = nodes.find(n => n.name === data.id);
        if (!node) {
            node = createNode(data.id);
            mapGroup.add(node);
            nodes.push(node);
        }
        
        node.userData.telemetry = data;
        node.position.set(data.lon * 2, data.lat * 2, 2);

        if (node.userData.labelSprite) {
            node.userData.labelSprite.position.set(node.position.x + 40, node.position.y + 25, 20);
        }
        
        const health = Math.max(0, 1 - (data.latency / 200));
        node.material.color.setHSL(0.5 * health, 1, 0.5);
        if (node.userData.glow) node.userData.glow.material.color.copy(node.material.color);
        
        const scale = 1 + Math.sin(Date.now() * 0.01 * (1 + health)) * 0.2;
        node.scale.set(scale, scale, scale);
    });
}

function createNode(id) {
    const geom = new THREE.SphereGeometry(4, 16, 16);
    const mat = new THREE.MeshBasicMaterial({ color: CONFIG.COLORS.primary });
    const node = new THREE.Mesh(geom, mat);
    node.name = id;
    
    // Node Glow
    const glowCanvas = document.createElement('canvas');
    glowCanvas.width = glowCanvas.height = 64;
    const gCtx = glowCanvas.getContext('2d');
    const grad = gCtx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    gCtx.fillStyle = grad;
    gCtx.fillRect(0, 0, 64, 64);
    
    const glowSprite = new THREE.Sprite(new THREE.SpriteMaterial({ 
        map: new THREE.CanvasTexture(glowCanvas), 
        transparent: true, 
        blending: THREE.AdditiveBlending 
    }));
    glowSprite.scale.set(20, 20, 1);
    node.add(glowSprite);
    node.userData.glow = glowSprite;

    // Node Labels
    const canvas = document.createElement('canvas');
    canvas.width = 1024; canvas.height = 512;
    const tex = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(200, 100, 1);
    sprite.visible = false;
    sprite.renderOrder = 999;
    mapGroup.add(sprite);
    
    node.userData.labelCanvas = canvas;
    node.userData.labelTex = tex;
    node.userData.labelSprite = sprite;
    
    return node;
}

function updateHoveredNode() {
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(nodes);
    
    if (intersects.length > 0) {
        const node = intersects[0].object;
        if (hoveredNode !== node) {
            if (hoveredNode && hoveredNode.userData.labelSprite) hoveredNode.userData.labelSprite.visible = false;
            hoveredNode = node;
            if (hoveredNode.userData.labelSprite) hoveredNode.userData.labelSprite.visible = true;
        }
        
        if (node.userData.labelCanvas && node.userData.telemetry) {
            const data = node.userData.telemetry;
            const canvas = node.userData.labelCanvas;
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = 'rgba(20, 20, 20, 0.95)';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.strokeStyle = '#ffffff'; 
            ctx.lineWidth = 12;
            ctx.strokeRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#ffffff'; 
            ctx.font = 'bold 68px "Courier New", monospace';
            ctx.fillText(`REGION: ${data.id}`, 40, 120);
            ctx.font = '60px "Courier New", monospace';
            ctx.fillText(`LATENCY: ${data.latency.toFixed(1)}ms`, 40, 240);
            ctx.fillText(`NETWORK: ${data.gwei.toFixed(1)} GWEI`, 40, 360);
            node.userData.labelTex.needsUpdate = true;
        }
    } else {
        if (hoveredNode && hoveredNode.userData.labelSprite) hoveredNode.userData.labelSprite.visible = false;
        hoveredNode = null;
    }
}

function checkHudHover() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    
    let ux = (mouse.x + 1) * 0.5;
    let uy = (-mouse.y + 1) * 0.5;
    
    const curv = CONFIG.CRT.curvature; 
    let cx = ux * 2.0 - 1.0;
    let cy = uy * 2.0 - 1.0;
    let r2 = cx * cx + cy * cy;
    let dx = (1.0 + curv * r2) * cx;
    let dy = (1.0 + curv * r2) * cy;
    
    const mx = (dx * 0.5 + 0.5) * w;
    const my = (dy * 0.5 + 0.5) * h;
    
    hoveredKey = null;
    HUD_KEYS.forEach((key, i) => {
        const kx = CONFIG.HUD.padding;
        const ky = 120 + (i * 20);
        if (mx > kx - 10 && mx < kx + 140 && my > ky - 5 && my < ky + 15) {
            hoveredKey = key;
        }
    });
}

function drawHud() {
    hudCtx.clearRect(0, 0, hudCanvas.width, hudCanvas.height);
    const w = hudCanvas.width;
    const h = hudCanvas.height;
    const pad = CONFIG.HUD.padding;
    
    // Status
    hudCtx.fillStyle = '#00ffff';
    hudCtx.font = CONFIG.HUD.fontSize;
    hudCtx.textBaseline = 'top';
    if (Math.random() > 0.98) hudCtx.fillStyle = '#ffffff';
    hudCtx.fillText(`SYSTEM: ETH_MAINNET_V2 // ACTIVE`, pad, pad);
    hudCtx.fillStyle = '#00ffff';
    hudCtx.fillText(`BLOCK_DELTA: ${globalData.timeSinceBlock.toFixed(1)}s`, pad, pad + 25);
    hudCtx.fillText(`AVG_BASE_FEE: ${globalData.avgGwei.toFixed(1)} GWEI`, pad, pad + 50);

    // Keys
    hudCtx.font = CONFIG.HUD.keyFontSize;
    HUD_KEYS.forEach((key, i) => {
        const ky = 120 + (i * 20);
        const active = hoveredKey === key;
        hudCtx.fillStyle = active ? '#ffffff' : 'rgba(0, 255, 255, 0.85)';
        hudCtx.fillText(key.label, pad, ky);
        if (active) {
            hudCtx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
            hudCtx.lineWidth = 0.5;
            hudCtx.beginPath();
            hudCtx.moveTo(pad + 110, ky + 5);
            hudCtx.lineTo(w * key.rx, h * key.ry);
            hudCtx.stroke();
            hudCtx.fillText(`> ${key.desc}`, pad + 110, ky + 5);
        }
    });

    // Spectral Bars
    const sliceWidth = w / 64;
    const bottomY = h - 40;
    for (let i = 0; i < 64; i++) {
        const val = heartbeat[i];
        const bh = val * h * 0.15;
        const x = i * sliceWidth;
        hudCtx.fillStyle = 'rgba(0, 255, 255, 0.05)';
        hudCtx.fillRect(x, bottomY, sliceWidth - 2, -(h * 0.15));
        hudCtx.fillStyle = `rgba(0, 255, 255, ${0.3 + val * 0.7})`;
        hudCtx.fillRect(x, bottomY, sliceWidth - 2, -bh);
        if (val > 0.05) {
            hudCtx.fillStyle = '#ffffff';
            hudCtx.fillRect(x, bottomY - bh, sliceWidth - 2, 2);
        }
    }
    hudTexture.needsUpdate = true;
}

function animate(t) {
    requestAnimationFrame(animate);
    const time = t || 0;
    const dt = (time - lastFrameTime) * 0.001;
    lastFrameTime = time;

    if (globalData.timeSinceBlock < 60) globalData.timeSinceBlock += Math.max(0, dt);

    checkHudHover();
    updateHoveredNode();
    drawHud();
    
    const df = Math.max(0.1, 1 - (globalData.timeSinceBlock / 12));
    grid.position.y = (grid.position.y - (0.5 * df)) % 25;
    grid.material.color.setHex(globalData.timeSinceBlock > 12 ? CONFIG.COLORS.gridAlert : CONFIG.COLORS.grid);
    
    if (composer.passes[2]) composer.passes[2].uniforms.iTime.value = time * 0.001;
    composer.render();
}

init();
