import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { DEV, HOST, PORT, WEB_DIST, getSettings, DATA_DIR } from './config.ts';
import { markInterruptedRuns } from './db.ts';
import { coreRoutes } from './routes/core.ts';
import { workspaceRoutes } from './routes/workspace.ts';
import { observabilityRoutes } from './routes/observability.ts';
import { closeMcp, syncMcp } from './mcp.ts';
import { stopAllBackground } from './shell.ts';
import { closeBrowser } from './browser.ts';
import { probeCapabilities } from './llm/client.ts';
import { resumeThread } from './agent/loop.ts';
import { activeByThread } from './agent/runs.ts';

const interrupted = markInterruptedRuns();

const app = Fastify({ logger: false, bodyLimit: 20 * 1024 * 1024 });

app.setErrorHandler((err: any, _req, reply) => {
  const code = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
  if (code >= 500) console.error('[http]', err);
  reply.code(code).send({ error: err.message });
});

coreRoutes(app);
workspaceRoutes(app);
observabilityRoutes(app);

const serveStatic = fs.existsSync(WEB_DIST) && !DEV;
if (serveStatic) {
  await app.register(fastifyStatic, {
    root: WEB_DIST,
    prefix: '/',
    setHeaders: (res, filePath) => {
      res.header('Cache-Control', filePath.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
    },
  });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/') || req.url.startsWith('/assets/')) return reply.code(404).send({ error: 'not found' });
    return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
  });
}

try {
  await app.listen({ port: PORT, host: HOST });
} catch (e: any) {
  if (e?.code === 'EADDRINUSE') {
    console.error(`\n  ✖ Port ${PORT} on ${HOST} is already in use by another program.\n    Stop it, or start Hearth on another port, e.g. (PowerShell)  $env:HEARTH_PORT=3005; npm start\n                                                  (bash)        HEARTH_PORT=3005 npm start\n`);
    process.exit(1);
  }
  throw e;
}
const shownHost = HOST === '0.0.0.0' || HOST === '::' ? 'localhost' : HOST;
const s = getSettings();
console.log(
  `\n  Hearth server listening on http://${shownHost}:${PORT}` +
    (serveStatic ? '  (serving web UI)' : DEV ? '  (API only; open the UI at http://localhost:3000)' : '  (API only; run "npm run build" to serve the UI)'),
);
console.log(`  Data dir: ${DATA_DIR}`);
console.log(`  Model: ${s.model.model} @ ${s.model.baseUrl}`);
void warnIfLocalhostShadowed();

syncMcp().catch((e) => console.error('[mcp] initial sync failed', e));
probeCapabilities(s.model, true)
  .then((c) =>
    console.log(
      c.reachable
        ? `  LLM reachable. Tool mode: ${c.effectiveToolMode} (native=${c.nativeTools}, template=${c.templateTools}), reasoning=${c.reasoning}, context=${c.maxModelLen ?? '?'}`
        : `  ⚠ LLM not reachable: ${c.error}`,
    ),
  )
  .catch(() => {});
void autoResume();

/**
 * Browsers resolve "localhost" to ::1 (IPv6) first. If another program listens on
 * [::]:PORT while we bind 127.0.0.1, http://localhost:PORT silently shows that app.
 */
async function warnIfLocalhostShadowed() {
  if (HOST !== '127.0.0.1') return;
  try {
    const r = await fetch(`http://[::1]:${PORT}/api/health`, { signal: AbortSignal.timeout(1500) });
    const j: any = await r.json().catch(() => null);
    if (j?.name !== 'hearth')
      console.warn(`  ⚠ Another program answers on http://localhost:${PORT} (IPv6). Open Hearth at http://127.0.0.1:${PORT} instead, or set HEARTH_PORT to a free port.`);
  } catch {}
}

/** Resume long-run tasks that were interrupted by a crash/restart (checkpoint resume). */
async function autoResume() {
  const settings = getSettings();
  const candidates = interrupted.filter((r) => r.options?.longRun?.enabled && r.source !== 'eval' && Date.now() - r.startedAt < 24 * 3600_000);
  if (!candidates.length) return;
  if (!settings.longRun.autoResume) {
    console.log(`  ${candidates.length} interrupted long-run task(s) can be resumed from the UI.`);
    return;
  }
  // wait (up to 10 min) for the model server, e.g. when both were restarted together
  for (let i = 0; i < 20; i++) {
    if ((await probeCapabilities(settings.model, true)).reachable) break;
    await new Promise((r) => setTimeout(r, 30_000));
  }
  const seen = new Set<string>();
  for (const r of candidates) {
    if (seen.has(r.threadId) || activeByThread.has(r.threadId)) continue;
    seen.add(r.threadId);
    try {
      const h = resumeThread(r.threadId, 'auto-resume');
      console.log(`  ↻ Resumed interrupted long-run task in thread ${r.threadId} (run ${h.id})`);
    } catch (e) {
      console.error('[resume] failed', e);
    }
  }
}

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  stopAllBackground();
  await Promise.race([Promise.all([closeBrowser(), closeMcp(), app.close()]), new Promise((r) => setTimeout(r, 3000))]);
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
