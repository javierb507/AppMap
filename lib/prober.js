const http = require('http');
const https = require('https');
const url = require('url');

/**
 * Probes an HTTP/HTTPS port on localhost
 * @param {number} port
 * @param {string} host default '127.0.0.1'
 * @param {number} timeoutMs default 1500
 */
async function probePort(port, host = '127.0.0.1', timeoutMs = 1500) {
  const targetUrl = `http://${host}:${port}/`;
  const startTime = Date.now();

  return new Promise((resolve) => {
    let hasResolved = false;

    const timer = setTimeout(() => {
      if (!hasResolved) {
        hasResolved = true;
        resolve({
          isHttp: false,
          isOnline: false,
          status: null,
          statusText: 'Timeout',
          latencyMs: Date.now() - startTime,
          title: null,
          description: null,
          favicon: null,
          framework: null,
          headers: {}
        });
      }
    }, timeoutMs);

    try {
      const parsedUrl = new URL(targetUrl);
      const req = http.get({
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: parsedUrl.pathname,
        headers: {
          'User-Agent': 'AppMap-DevScanner/1.0 (Macintosh; Localhost Scanner)',
          'Accept': 'text/html,application/xhtml+xml,application/json,*/*'
        },
        timeout: timeoutMs
      }, (res) => {
        const latencyMs = Date.now() - startTime;
        let body = '';

        // Only read up to 64KB for performance and security
        let bytesRead = 0;
        const maxBytes = 64 * 1024;

        res.on('data', (chunk) => {
          if (bytesRead < maxBytes) {
            bytesRead += chunk.length;
            body += chunk.toString('utf8');
          }
        });

        res.on('end', () => {
          if (hasResolved) return;
          hasResolved = true;
          clearTimeout(timer);

          const result = analyzeResponse({
            statusCode: res.statusCode,
            statusMessage: res.statusMessage,
            headers: res.headers,
            body,
            port,
            host,
            latencyMs
          });

          resolve(result);
        });
      });

      req.on('timeout', () => {
        req.destroy();
      });

      req.on('error', (err) => {
        if (hasResolved) return;
        hasResolved = true;
        clearTimeout(timer);

        // Analyze whether it might be a raw TCP server (Postgres, Redis, SSH, etc.)
        const isRawTcp = ['HPE_INVALID_CONSTANT', 'ECONNRESET', 'EPROTO', 'DEPTH_ZERO_SELF_SIGNED_CERT'].includes(err.code);
        resolve({
          isHttp: false,
          isOnline: true, // The port answered the TCP handshake, even if it rejected HTTP
          isRawTcp,
          errorCode: err.code,
          status: null,
          statusText: isRawTcp ? 'TCP Service (Non-HTTP)' : err.message,
          latencyMs: Date.now() - startTime,
          title: null,
          description: null,
          favicon: null,
          framework: detectRawFramework(port, err),
          headers: {}
        });
      });
    } catch (e) {
      if (!hasResolved) {
        hasResolved = true;
        clearTimeout(timer);
        resolve({
          isHttp: false,
          isOnline: false,
          status: null,
          statusText: e.message,
          latencyMs: Date.now() - startTime,
          title: null,
          description: null,
          favicon: null,
          framework: null,
          headers: {}
        });
      }
    }
  });
}

/**
 * Analyzes the HTTP response body and headers
 */
function analyzeResponse({ statusCode, statusMessage, headers, body, port, host, latencyMs }) {
  // Extract Title
  let title = null;
  const titleMatch = body.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch && titleMatch[1]) {
    title = titleMatch[1].trim();
  }

  // Extract Meta Description
  let description = null;
  const descMatch = body.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i) ||
                    body.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i);
  if (descMatch && descMatch[1]) {
    description = descMatch[1].trim();
  }

  // Extract Favicon
  const favicon = extractFavicon(body, host, port);

  // Detect Framework
  const framework = detectFramework({ headers, body, port });

  // If title is missing, try OpenGraph title or JSON API keys
  if (!title) {
    const ogTitle = body.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
    if (ogTitle && ogTitle[1]) {
      title = ogTitle[1].trim();
    }
  }

  // If still no title and body is JSON (e.g., API root or Ollama)
  if (!title && headers['content-type'] && headers['content-type'].includes('application/json')) {
    try {
      const parsedJson = JSON.parse(body);
      if (parsedJson.name) title = parsedJson.name;
      else if (parsedJson.title) title = parsedJson.title;
      else if (parsedJson.message) title = parsedJson.message;
      else if (parsedJson.version) title = `API v${parsedJson.version}`;
      else title = 'JSON API Endpoint';
    } catch (_) {}
  }

  // Ollama specific detection: returns "Ollama is running"
  if (body.includes('Ollama is running') || port === 11434) {
    title = title || 'Ollama AI Runner';
  }

  return {
    isHttp: true,
    isOnline: true,
    status: statusCode,
    statusText: statusMessage,
    latencyMs,
    title,
    description,
    favicon,
    framework,
    server: headers['server'] || headers['x-powered-by'] || null,
    headers: {
      server: headers['server'],
      poweredBy: headers['x-powered-by'],
      contentType: headers['content-type']
    }
  };
}

/**
 * Detect framework from HTTP response hints
 */
/**
 * Robust Favicon extractor supporting order-independent attributes,
 * apple-touch-icon, SVGs, PNGs, and Data URIs.
 */
function extractFavicon(body, host, port) {
  if (!body) return `http://${host}:${port}/favicon.ico`;

  try {
    const linkRegex = /<link\b([^>]+)>/gi;
    let match;
    let candidateHref = null;

    while ((match = linkRegex.exec(body)) !== null) {
      const attrs = match[1];
      const isIconRel = /rel=["']?[^"'>]*(?:icon|apple-touch-icon)[^"'>]*["']?/i.test(attrs);
      if (isIconRel) {
        const hrefMatch = attrs.match(/href=["']?([^"'\s>]+)["']?/i);
        if (hrefMatch && hrefMatch[1]) {
          candidateHref = hrefMatch[1].trim();
          // If it's an explicit SVG or PNG, take it immediately
          if (candidateHref.endsWith('.svg') || candidateHref.endsWith('.png')) {
            break;
          }
        }
      }
    }

    if (candidateHref) {
      // 1. Data URI (e.g. data:image/svg+xml,... or data:image/png;base64,...)
      if (candidateHref.startsWith('data:')) {
        return candidateHref;
      }
      // 2. Protocol relative
      if (candidateHref.startsWith('//')) {
        return `http:${candidateHref}`;
      }
      // 3. Full HTTP/HTTPS URL
      if (candidateHref.startsWith('http://') || candidateHref.startsWith('https://')) {
        return candidateHref;
      }
      // 4. Absolute path
      if (candidateHref.startsWith('/')) {
        return `http://${host}:${port}${candidateHref}`;
      }
      // 5. Relative path
      return `http://${host}:${port}/${candidateHref}`;
    }
  } catch (_) {}

  return `http://${host}:${port}/favicon.ico`;
}

function detectFramework({ headers, body, port }) {
  const lowerBody = (body || '').toLowerCase();
  const server = ((headers && headers['server']) || '').toLowerCase();
  const poweredBy = ((headers && headers['x-powered-by']) || '').toLowerCase();

  // Known port heuristics + body checks
  if (port === 11434 || lowerBody.includes('ollama is running')) return 'Ollama';
  if (lowerBody.includes('/@vite/client') || lowerBody.includes('vite.svg') || lowerBody.includes('vite_plugin')) return 'Vite';
  if (lowerBody.includes('__next_data__') || lowerBody.includes('/_next/static') || poweredBy.includes('next.js')) return 'Next.js';
  if (lowerBody.includes('react') || lowerBody.includes('data-reactroot')) return 'React';
  if (lowerBody.includes('svelte') || lowerBody.includes('__svelte__')) return 'Svelte';
  if (lowerBody.includes('astro-island') || lowerBody.includes('data-astro')) return 'Astro';
  if (lowerBody.includes('vue') || lowerBody.includes('data-v-')) return 'Vue';
  if (lowerBody.includes('ng-version') || lowerBody.includes('app-root')) return 'Angular';
  if (lowerBody.includes('swagger') || lowerBody.includes('fastapi') || lowerBody.includes('openapi.json')) return 'FastAPI';
  if (lowerBody.includes('streamlit') || lowerBody.includes('st-emotion-cache')) return 'Streamlit';
  if (lowerBody.includes('jupyter') || lowerBody.includes('notebook_app')) return 'Jupyter';
  if (lowerBody.includes('gradio') || lowerBody.includes('gradio-app')) return 'Gradio';
  if (lowerBody.includes('laravel')) return 'Laravel';
  if (lowerBody.includes('django')) return 'Django';
  if (lowerBody.includes('flask')) return 'Flask';

  if (poweredBy.includes('express')) return 'Express';
  if (server.includes('uvicorn')) return 'FastAPI / Uvicorn';
  if (server.includes('gunicorn')) return 'Python Gunicorn';
  if (server.includes('werkzeug')) return 'Flask';
  if (server.includes('caddy')) return 'Caddy';
  if (server.includes('nginx')) return 'Nginx';

  return null;
}

/**
 * Fallback for known raw TCP ports
 */
function detectRawFramework(port, err) {
  if (port === 5432) return 'PostgreSQL';
  if (port === 6379) return 'Redis';
  if (port === 27017) return 'MongoDB';
  if (port === 3306) return 'MySQL';
  if (port === 9200) return 'Elasticsearch';
  if (port === 5672) return 'RabbitMQ';
  if (port === 11434) return 'Ollama';
  return null;
}

module.exports = {
  probePort,
  detectFramework
};
