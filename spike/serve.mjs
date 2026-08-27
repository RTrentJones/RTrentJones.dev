// Three-origin static server for the WebMCP federation spike.
// On localhost, distinct ports are distinct origins, which is enough to exercise
// the exposedTo / fromOrigins handshake. Deploy to real subdomains before trusting
// the result -- see README.md.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const HERE = new URL('.', import.meta.url).pathname;

const ORIGINS = {
  parent: { port: 8791, file: 'parent.html' },
  childA: { port: 8792, file: 'childA.html' },
  childB: { port: 8793, file: 'childB.html' },
};

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

for (const [name, { port, file }] of Object.entries(ORIGINS)) {
  createServer(async (req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    const target = path === '/' ? file : path.slice(1);
    let body;
    try {
      body = await readFile(join(HERE, target));
    } catch {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[extname(target)] ?? 'application/octet-stream',
      // Required: WebMCP is disabled in documents that are not origin-isolated.
      'Origin-Agent-Cluster': '?1',
      // Must not be framed away by the workbench.
      'Content-Security-Policy': "frame-ancestors 'self' http://localhost:8791",
      'Cache-Control': 'no-store',
    });
    res.end(body);
  }).listen(port, () => console.log(`${name.padEnd(7)} http://localhost:${port}`));
}

console.log('\nOpen the parent in Chrome 149+ with chrome://flags/#enable-webmcp-testing enabled:');
console.log('  http://localhost:8791\n');
