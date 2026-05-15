const PROXY = '/api/proxy';
const MAX_SIZE_PROBES = 24; // max HEAD requests for size estimation

// ─── Fetch ────────────────────────────────────────────────────────────────────

async function fetchPage(url) {
  const res = await fetch(`${PROXY}?url=${encodeURIComponent(url)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  const html = await res.text();
  const finalUrl = res.headers.get('X-Final-URL') || url;
  const httpStatus = res.headers.get('X-Status') || '200';
  const htmlSize = parseInt(res.headers.get('X-Body-Size') || '0', 10) || new Blob([html]).size;
  const truncated = res.headers.get('X-Truncated') === 'true';
  return { html, finalUrl, httpStatus, htmlSize, truncated };
}

async function headResource(url) {
  try {
    const res = await fetch(`${PROXY}?url=${encodeURIComponent(url)}&mode=head`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ─── Parse ────────────────────────────────────────────────────────────────────

function resolveUrl(href, baseUrl) {
  if (!href || href.startsWith('data:') || href.startsWith('blob:') || href.startsWith('javascript:')) return null;
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return null;
  }
}

function parseResources(html, baseUrl) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const resources = [];

  // Honour <base href> if present
  const baseEl = doc.querySelector('base[href]');
  const base = baseEl ? resolveUrl(baseEl.getAttribute('href'), baseUrl) || baseUrl : baseUrl;

  doc.querySelectorAll('script[src]').forEach((el) => {
    const url = resolveUrl(el.getAttribute('src'), base);
    if (url) resources.push({ type: 'script', url, blocking: !el.defer && !el.async && !!el.closest('head') });
  });

  doc.querySelectorAll('link[rel="stylesheet"][href]').forEach((el) => {
    const url = resolveUrl(el.getAttribute('href'), base);
    if (url) resources.push({ type: 'stylesheet', url, blocking: true });
  });

  doc.querySelectorAll('img[src]').forEach((el) => {
    const url = resolveUrl(el.getAttribute('src'), base);
    if (url) resources.push({ type: 'image', url, blocking: false });
  });

  doc.querySelectorAll('link[rel="preload"][href], link[rel="modulepreload"][href]').forEach((el) => {
    const url = resolveUrl(el.getAttribute('href'), base);
    if (url) resources.push({ type: 'preload', url, blocking: false });
  });

  doc.querySelectorAll('source[src], video[src], audio[src]').forEach((el) => {
    const url = resolveUrl(el.getAttribute('src'), base);
    if (url) resources.push({ type: 'media', url, blocking: false });
  });

  // Inline script count (no src)
  const inlineScripts = doc.querySelectorAll('script:not([src])').length;

  return { resources, inlineScripts };
}

// ─── Origins ──────────────────────────────────────────────────────────────────

function categorizeOrigins(resources, baseUrl) {
  const base = new URL(baseUrl);
  const firstParty = [];
  const thirdParty = [];

  for (const r of resources) {
    try {
      const u = new URL(r.url);
      // Same hostname or same apex domain counts as first-party
      if (u.hostname === base.hostname || sameApex(u.hostname, base.hostname)) {
        firstParty.push(r);
      } else {
        thirdParty.push(r);
      }
    } catch {
      firstParty.push(r);
    }
  }

  return { firstParty, thirdParty };
}

function sameApex(a, b) {
  const apexA = a.split('.').slice(-2).join('.');
  const apexB = b.split('.').slice(-2).join('.');
  return apexA === apexB;
}

function uniqueHostnames(resources) {
  const seen = new Set();
  for (const r of resources) {
    try {
      seen.add(new URL(r.url).hostname);
    } catch {}
  }
  return [...seen];
}

// ─── Frameworks ───────────────────────────────────────────────────────────────

const SIGNATURES = [
  {
    name: 'React',
    tag: 'FRAMEWORK',
    html: [/__REACT_DEVTOOLS/, /_reactRootContainer/, /data-reactroot/, /"__reactFiber/, /window\.__REACT_/],
    url: [/react\.production\.min/, /react\.development/, /\/react@\d/, /\/react-dom@\d/],
  },
  {
    name: 'Next.js',
    tag: 'FRAMEWORK',
    html: [/__NEXT_DATA__/, /\/_next\/static/, /<div id="__next"/, /next\/dist\//],
    url: [/\/_next\//, /next\.js/],
  },
  {
    name: 'Vue.js',
    tag: 'FRAMEWORK',
    html: [/__vue_app__/, /data-v-[a-f0-9]{6,}/, /\bVue\.version\b/, /<div id="app"[^>]*>/],
    url: [/vue\.global/, /vue\.esm/, /\/vue@\d/],
  },
  {
    name: 'Nuxt',
    tag: 'FRAMEWORK',
    html: [/__NUXT__/, /\/_nuxt\//, /nuxt\.config/],
    url: [/\/_nuxt\//],
  },
  {
    name: 'Angular',
    tag: 'FRAMEWORK',
    html: [/ng-version=/, /data-ng-app/, /\bangular\.min\.js/, /\bangular\.js\b/],
    url: [/angular\.min\.js/, /\/angular@\d/],
  },
  {
    name: 'Svelte',
    tag: 'FRAMEWORK',
    html: [/__svelte/, /svelte-\d+/, /\.svelte\./],
    url: [/svelte\.js/, /\/svelte@\d/],
  },
  {
    name: 'jQuery',
    tag: 'LIBRARY',
    html: [/jQuery v\d/, /window\.jQuery/, /\$.fn\.jquery/],
    url: [/jquery\.min\.js/, /jquery-\d+\.\d+/, /\/jquery@\d/],
  },
  {
    name: 'Bootstrap',
    tag: 'LIBRARY',
    html: [/bootstrap\.bundle\.min/, /class="navbar navbar-/, /class="container-fluid"/],
    url: [/bootstrap\.min\.css/, /bootstrap\.bundle\.min/, /\/bootstrap@\d/],
  },
  {
    name: 'Tailwind CSS',
    tag: 'LIBRARY',
    html: [/tailwind\.config/, /class="[^"]*(?:flex|grid|p-\d|m-\d|bg-\w+-\d{3})[^"]*"/],
    url: [/tailwindcss/, /tailwind\.min\.css/],
  },
  {
    name: 'Google Analytics',
    tag: 'TRACKER',
    html: [/gtag\(/, /google-analytics\.com\/analytics\.js/, /ga\('create'/, /'UA-\d{6,}'/],
    url: [/google-analytics\.com/, /googletagmanager\.com/],
  },
  {
    name: 'Google Tag Manager',
    tag: 'TRACKER',
    html: [/googletagmanager\.com\/gtm\.js/, /GTM-[A-Z0-9]{6,}/],
    url: [/googletagmanager\.com\/gtm/],
  },
  {
    name: 'Meta Pixel',
    tag: 'TRACKER',
    html: [/fbevents\.js/, /fbq\(/, /facebook\.net\/en_US\/fbevents/],
    url: [/connect\.facebook\.net/, /fbevents\.js/],
  },
  {
    name: 'Hotjar',
    tag: 'TRACKER',
    html: [/hotjar\.com/, /hjid:\d/, /window\.hj\s*=/],
    url: [/hotjar\.com/, /hotjar\.io/],
  },
  {
    name: 'Segment',
    tag: 'TRACKER',
    html: [/analytics\.identify\(/, /analytics\.track\(/, /cdn\.segment\.com/],
    url: [/cdn\.segment\.com/, /segment\.io/],
  },
  {
    name: 'Cloudflare',
    tag: 'INFRA',
    html: [/cloudflareinsights\.com/, /data-cf-beacon/, /cf-ray:/i],
    url: [/cloudflareinsights\.com/, /challenges\.cloudflare\.com/],
  },
  {
    name: 'Sentry',
    tag: 'INFRA',
    html: [/Sentry\.init\(/, /sentry\.io/, /\@sentry\/browser/],
    url: [/sentry\.io/, /sentry\.min\.js/],
  },
  {
    name: 'WordPress',
    tag: 'CMS',
    html: [/wp-content\//, /wp-includes\//, /wp-json\//, /generator.*WordPress/i],
    url: [/\/wp-content\//, /\/wp-includes\//],
  },
  {
    name: 'Shopify',
    tag: 'PLATFORM',
    html: [/cdn\.shopify\.com/, /Shopify\.shop\s*=/, /myshopify\.com/],
    url: [/cdn\.shopify\.com/, /shopifycloud\.com/],
  },
  {
    name: 'Wix',
    tag: 'PLATFORM',
    html: [/wixstatic\.com/, /wix\.com\/lpvideo/, /wixapps\.net/],
    url: [/wixstatic\.com/, /wix\.com\/services/],
  },
  {
    name: 'Intercom',
    tag: 'TRACKER',
    html: [/Intercom\(/, /intercomcdn\.com/, /widget\.intercom\.io/],
    url: [/widget\.intercom\.io/, /intercomcdn\.com/],
  },
];

function detectFrameworks(html, resources) {
  const resourceUrls = resources.map((r) => r.url).join(' ');
  const detected = [];

  for (const sig of SIGNATURES) {
    const inHtml = sig.html.some((p) => p.test(html));
    const inUrls = sig.url.some((p) => p.test(resourceUrls));
    if (inHtml || inUrls) {
      detected.push({ name: sig.name, tag: sig.tag, confidence: inHtml && inUrls ? 'CONFIRMED' : 'DETECTED' });
    }
  }

  return detected;
}

// ─── Render-blocking ──────────────────────────────────────────────────────────

function findRenderBlocking(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const blocking = [];

  // Synchronous scripts in head
  doc.querySelectorAll('head script[src]').forEach((el) => {
    if (!el.defer && !el.async) blocking.push({ type: 'script', url: el.getAttribute('src') });
  });

  // Stylesheets in head (always blocking unless media=print etc.)
  doc.querySelectorAll('head link[rel="stylesheet"]').forEach((el) => {
    const media = el.getAttribute('media') || '';
    if (!media || media === 'all' || media === 'screen') {
      blocking.push({ type: 'stylesheet', url: el.getAttribute('href') });
    }
  });

  return blocking;
}

// ─── Size estimation ─────────────────────────────────────────────────────────

async function estimateSizes(resources) {
  // Probe scripts and stylesheets only, capped at MAX_SIZE_PROBES
  const probeTargets = resources
    .filter((r) => r.type === 'script' || r.type === 'stylesheet')
    .slice(0, MAX_SIZE_PROBES);

  const results = await Promise.all(probeTargets.map((r) => headResource(r.url)));
  let total = 0;
  let known = 0;
  for (const r of results) {
    if (r && r.contentLength) {
      total += r.contentLength;
      known++;
    }
  }
  return { total, known, probed: probeTargets.length };
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

function score(results) {
  let risk = 0;
  const factors = [];

  const totalKb = (results.htmlSize + results.estimatedJsCss) / 1024;
  if (totalKb > 2000) { risk += 3; factors.push('PAYLOAD > 2 MB'); }
  else if (totalKb > 800) { risk += 2; factors.push('PAYLOAD > 800 KB'); }
  else if (totalKb > 300) { risk += 1; factors.push('PAYLOAD > 300 KB'); }

  const tp = results.thirdPartyHostnames.length;
  if (tp >= 8) { risk += 3; factors.push(`${tp} THIRD-PARTY ORIGINS`); }
  else if (tp >= 4) { risk += 2; factors.push(`${tp} THIRD-PARTY ORIGINS`); }
  else if (tp >= 2) { risk += 1; factors.push(`${tp} THIRD-PARTY ORIGINS`); }

  const trackers = results.frameworks.filter((f) => f.tag === 'TRACKER').length;
  if (trackers >= 3) { risk += 2; factors.push(`${trackers} ACTIVE TRACKERS`); }
  else if (trackers >= 1) { risk += 1; factors.push(`${trackers} ACTIVE TRACKER`); }

  const rb = results.renderBlocking.length;
  if (rb >= 6) { risk += 2; factors.push(`${rb} RENDER-BLOCKING ASSETS`); }
  else if (rb >= 3) { risk += 1; factors.push(`${rb} RENDER-BLOCKING ASSETS`); }

  let verdict, riskLevel;
  if (risk === 0) { verdict = 'CLEAN'; riskLevel = 'MINIMAL'; }
  else if (risk <= 2) { verdict = 'ACCEPTABLE'; riskLevel = 'LOW'; }
  else if (risk <= 4) { verdict = 'HEAVY'; riskLevel = 'ELEVATED'; }
  else if (risk <= 6) { verdict = 'COMPROMISED'; riskLevel = 'HIGH'; }
  else { verdict = 'CRITICAL'; riskLevel = 'CRITICAL'; }

  return { verdict, riskLevel, factors };
}

// ─── Rendering ────────────────────────────────────────────────────────────────

function fmtBytes(bytes) {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function pad(label, value, width = 46) {
  const dots = width - label.length - String(value).length;
  return `${label} ${'.'.repeat(Math.max(2, dots))} ${value}`;
}

const TAG_CLASSES = { FRAMEWORK: 'tag-framework', LIBRARY: 'tag-library', TRACKER: 'tag-tracker', INFRA: 'tag-infra', CMS: 'tag-cms', PLATFORM: 'tag-platform' };

function renderReport(container, url, data) {
  const { httpStatus, htmlSize, estimatedJsCss, sizesKnown, resourceCount, firstPartyCount, thirdPartyCount, thirdPartyHostnames, frameworks, renderBlocking, inlineScripts, verdict, riskLevel, factors } = data;
  const hostname = new URL(url).hostname;

  const html = `
<div class="audit-divider"></div>

<div class="audit-block">
  <div class="audit-section-title">// THREAT ASSESSMENT REPORT</div>
  <div class="audit-row"><span class="audit-label">TARGET</span><span class="audit-value">${escHtml(hostname)}</span></div>
  <div class="audit-row"><span class="audit-label">STATUS</span><span class="audit-value status-${httpStatus.startsWith('2') ? 'ok' : 'warn'}">${escHtml(httpStatus)}</span></div>
</div>

<div class="audit-divider"></div>

<div class="audit-block">
  <div class="audit-section-title">// PAYLOAD MATRIX</div>
  <div class="audit-mono">
    <div>${escHtml(pad('HTML Document', fmtBytes(htmlSize)))}</div>
    <div>${escHtml(pad('JS + CSS Estimated', estimatedJsCss > 0 ? fmtBytes(estimatedJsCss) + (sizesKnown < resourceCount ? ' (partial)' : '') : 'n/a'))}</div>
    <div>${escHtml(pad('Total Resources', resourceCount + ' refs'))}</div>
    <div>${escHtml(pad('First-party', firstPartyCount))}</div>
    <div>${escHtml(pad('Third-party', thirdPartyCount))}</div>
    <div>${escHtml(pad('Inline Scripts', inlineScripts))}</div>
  </div>
</div>

<div class="audit-divider"></div>

<div class="audit-block">
  <div class="audit-section-title">// THIRD-PARTY INTEL${thirdPartyHostnames.length === 0 ? ' — NONE DETECTED' : ''}</div>
  ${thirdPartyHostnames.length > 0 ? thirdPartyHostnames.map((h) => `<div class="audit-mono audit-row-tree">├── ${escHtml(h)}</div>`).join('') : ''}
</div>

<div class="audit-divider"></div>

<div class="audit-block">
  <div class="audit-section-title">// FRAMEWORK SIGNATURES${frameworks.length === 0 ? ' — CLEAN' : ''}</div>
  ${frameworks.length > 0 ? frameworks.map((f) => `<div class="audit-fw-row"><span class="audit-fw-name">${escHtml(f.name)}</span><span class="audit-tag ${TAG_CLASSES[f.tag] || ''}">${escHtml(f.tag)}</span><span class="audit-confidence confidence-${f.confidence.toLowerCase()}">${escHtml(f.confidence)}</span></div>`).join('') : ''}
</div>

<div class="audit-divider"></div>

<div class="audit-block">
  <div class="audit-section-title">// RENDER-BLOCKING ASSETS${renderBlocking.length === 0 ? ' — NONE' : ` — ${renderBlocking.length} DETECTED`}</div>
  ${renderBlocking.slice(0, 10).map((r) => `<div class="audit-mono audit-row-tree">├── <span class="rb-type">${r.type.toUpperCase()}</span> ${escHtml(truncUrl(r.url))}</div>`).join('')}
  ${renderBlocking.length > 10 ? `<div class="audit-mono audit-row-tree">└── ...and ${renderBlocking.length - 10} more</div>` : ''}
</div>

<div class="audit-divider"></div>

<div class="audit-block verdict-block verdict-${verdict.toLowerCase()}">
  <div class="verdict-line">VERDICT: <strong>${escHtml(verdict)}</strong> // OPERATIONAL RISK: <strong>${escHtml(riskLevel)}</strong></div>
  ${factors.length > 0 ? factors.map((f) => `<div class="verdict-factor">⚑ ${escHtml(f)}</div>`).join('') : '<div class="verdict-factor">No significant risk factors detected.</div>'}
</div>
`;

  container.innerHTML = html;
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncUrl(url, max = 55) {
  if (!url) return '';
  return url.length > max ? url.slice(0, max) + '…' : url;
}

// ─── Main audit orchestrator ──────────────────────────────────────────────────

export async function runAudit(rawUrl, onStatus) {
  // Normalise URL
  let url = rawUrl.trim();
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  new URL(url); // throws if still invalid

  onStatus('FETCHING TARGET…');
  const { html, finalUrl, httpStatus, htmlSize } = await fetchPage(url);

  onStatus('PARSING RESOURCE MAP…');
  const { resources, inlineScripts } = parseResources(html, finalUrl);

  onStatus('IDENTIFYING THREAT SIGNATURES…');
  const frameworks = detectFrameworks(html, resources);

  onStatus('CLASSIFYING ORIGINS…');
  const { firstParty, thirdParty } = categorizeOrigins(resources, finalUrl);
  const thirdPartyHostnames = uniqueHostnames(thirdParty);

  onStatus('LOCATING RENDER-BLOCKING ASSETS…');
  const renderBlocking = findRenderBlocking(html);

  onStatus(`PROBING ${Math.min(resources.filter(r => r.type === 'script' || r.type === 'stylesheet').length, MAX_SIZE_PROBES)} RESOURCE ENDPOINTS…`);
  const { total: estimatedJsCss, known: sizesKnown } = await estimateSizes(resources);

  onStatus('COMPILING THREAT ASSESSMENT…');

  const results = {
    url: finalUrl,
    httpStatus,
    htmlSize,
    estimatedJsCss,
    sizesKnown,
    resourceCount: resources.length,
    firstPartyCount: firstParty.length,
    thirdPartyCount: thirdParty.length,
    thirdPartyHostnames,
    frameworks,
    renderBlocking,
    inlineScripts,
  };

  const { verdict, riskLevel, factors } = score(results);
  return { ...results, verdict, riskLevel, factors };
}
