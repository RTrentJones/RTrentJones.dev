// Three-origin static server for the WebMCP federation spike.
// On localhost, distinct ports are distinct origins, which is enough to exercise
// the exposedTo / fromOrigins handshake. Deploy to real subdomains before trusting
// the result -- see README.md.
import { createServer } from 'node:http';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { extname, join } from 'node:path';

const HERE = new URL('.', import.meta.url).pathname;

const ORIGINS = {
  parent: { port: 8791, file: 'parent.html' },
  childA: { port: 8792, file: 'childA.html' },
  childB: { port: 8793, file: 'childB.html' },
};

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

// Beacons land concurrently. Chain the writes and swap via rename so a reader
// never sees a half-written file, and drop out-of-order reports by seq.
let writeChain = Promise.resolve();
let lastRun = null;
let lastSeq = 0;
function saveResults(body) {
  writeChain = writeChain.then(async () => {
    let seq = 0;
    let runId = null;
    try { ({ seq = 0, runId = null } = JSON.parse(body)); } catch { return; }
    // seq restarts at 1 every page load, so the guard is scoped to one run --
    // a global one silently swallows every beacon from the next run.
    if (runId !== lastRun) { lastRun = runId; lastSeq = 0; }
    if (seq <= lastSeq) return;
    lastSeq = seq;
    const dest = join(HERE, 'results.json');
    const tmp = `${dest}.${process.pid}.tmp`;
    await writeFile(tmp, body);
    await rename(tmp, dest);
    console.log(`[results] run=${runId} seq=${seq} ${body.length}B -> spike/results.json`);
  }).catch((err) => console.error('[results] write failed:', err.message));
  return writeChain;
}

for (const [name, { port, file }] of Object.entries(ORIGINS)) {
  createServer(async (req, res) => {
    const path = new URL(req.url, 'http://x').pathname;

    // Automated-run sink: the parent posts its running result set here when
    // loaded with ?report=1, so a headless run needs no copy-paste.
    if (name === 'parent' && req.method === 'POST' && path === '/__results') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks).toString('utf8');
      await saveResults(body);
      res.writeHead(204).end();
      return;
    }

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
