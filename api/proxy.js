const BLOCKED = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i,
];

const MAX_BODY = 2 * 1024 * 1024; // 2 MB
const TIMEOUT_MS = 9000;

function isBlocked(hostname) {
  return BLOCKED.some((p) => p.test(hostname));
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { url, mode } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url parameter' });

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return res.status(400).json({ error: 'Only HTTP/HTTPS URLs are permitted' });
  }

  if (isBlocked(parsed.hostname)) {
    return res.status(400).json({ error: 'Blocked hostname' });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const upstream = await fetch(url, {
      method: mode === 'head' ? 'HEAD' : 'GET',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; PageWeightForensics/1.0; +https://tobynichol.computer/forensics)',
        Accept: 'text/html,application/xhtml+xml,application/javascript,text/css,*/*',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timer);

    const contentType = upstream.headers.get('content-type') || '';
    const contentLength = upstream.headers.get('content-length');

    if (mode === 'head') {
      return res.status(200).json({
        status: upstream.status,
        contentType,
        contentLength: contentLength ? parseInt(contentLength, 10) : null,
        finalUrl: upstream.url,
      });
    }

    // Return metadata only for binary resources
    const isText =
      contentType.includes('text/') ||
      contentType.includes('application/javascript') ||
      contentType.includes('application/json') ||
      contentType.includes('application/xml');

    if (!isText) {
      return res.status(200).json({
        status: upstream.status,
        contentType,
        contentLength: contentLength ? parseInt(contentLength, 10) : null,
        finalUrl: upstream.url,
        metadataOnly: true,
      });
    }

    // Stream body with 2 MB cap
    const reader = upstream.body.getReader();
    const chunks = [];
    let received = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      if (received > MAX_BODY) {
        await reader.cancel();
        break;
      }
    }

    const body = Buffer.concat(chunks.map((c) => Buffer.from(c)));

    res.setHeader('Content-Type', contentType || 'text/plain; charset=utf-8');
    res.setHeader('X-Final-URL', upstream.url);
    res.setHeader('X-Status', String(upstream.status));
    res.setHeader('X-Body-Size', String(body.length));
    res.setHeader('X-Truncated', String(received > MAX_BODY));
    return res.status(200).send(body);
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'Request timed out after 9s' });
    }
    return res.status(502).json({ error: `Upstream fetch failed: ${err.message}` });
  }
};
