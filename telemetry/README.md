# TELEMETRY_GRID v2.0 // ETH_MAINNET

A high-fidelity, retro-militaristic telemetry dashboard for the Ethereum Network. A real-time "command center" view of global RPC latency, block propagation, and network volatility — rendered as a 3D tactical interface with a hand-written CRT shader aesthetic.

Lives at [`/telemetry`](https://tobynichol.computer/telemetry) on tobynichol.computer.

## //The Mission
The **TELEMETRY_GRID** is built for node operators and network enthusiasts who want a low-latency, high-contrast read on Ethereum's global health. It turns raw JSON-RPC data into a 3D visualization with a custom CRT post-processing stack.

## //Features
- **Global Sensor Network:** Polls 9 regional public RPC sensors (London, NY, Singapore, Tokyo, San Francisco, Frankfurt, Sydney, Sao Paulo, Toronto) directly from the browser.
- **Spectral Density Monitor:** A 64-bar real-time frequency analyzer modulated by network congestion and base-fee volatility.
- **Tactical HUD:** Interactive documentation keys with hover-activated pointers and tooltips.
- **3D Regional Deep-Dive:** Raycasted 3D nodes that surface per-region telemetry (latency, GWEI) on hover.
- **CRT Post-Processing:** Hand-written GLSL shaders for barrel distortion, chromatic aberration, scanline simulation, and Gaussian noise.

## //Technical Architecture

Fully **client-side** — no backend, no API key, no build step.

- **Data:** Each sensor issues an `eth_getBlockByNumber` JSON-RPC `POST` straight to a public, keyless RPC endpoint. Latency is measured per request; base fee is read from the returned block. Non-responsive or CORS-blocked sensors are silently filtered so the grid only reflects live nodes.
- **Rendering:** A dual-scene WebGL pipeline (3D perspective world map + 2D orthographic HUD) built on [Three.js](https://threejs.org/), loaded from a CDN via an `importmap` — no bundler, no `node_modules`.
- **World map:** Country outlines are fetched at runtime from the public [natural-earth-vector](https://github.com/nvkelso/natural-earth-vector) dataset.

### Files
- `index.html` — page shell + Three.js import map.
- `main.js` — the entire app: RPC polling, scene graph, HUD, and CRT shader passes.

## //Deployment
No build required. The folder is served as static files at `/telemetry` as part of the tobynichol.computer site. Drop it on any static host and it runs as-is.

To run locally, serve the repo root with any static server and open `/telemetry/`:
```bash
python3 -m http.server 8080
# then visit http://localhost:8080/telemetry/
```

## //Configuration
Tune the aesthetic in `main.js` via the `CONFIG` object:
```javascript
const CONFIG = {
    CRT: {
        curvature: 0.06,
        scanline: 0.1,
        chroma: 0.001,
        noise: 0.04
    }
};
```

The sensor list lives in the `REGIONAL_RPCS` array in `main.js`. Endpoints must send permissive CORS headers (`Access-Control-Allow-Origin`) to be reachable from the browser.

---
*Created by [toby-nichol](https://tobynichol.computer)*
