import fs from 'node:fs';
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

markInterruptedRuns();

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
  await app.register(fastifyStatic, { root: WEB_DIST, prefix: '/', wildcard: false });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not found' });
    return reply.sendFile('index.html');
  });
}

await app.listen({ port: PORT, host: HOST });
const s = getSettings();
console.log(
  `\n  Hearth server listening on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}` +
    (serveStatic ? '  (serving web UI)' : DEV ? '  (API only; open the UI at http://localhost:3000)' : '  (API only; run "npm run build" to serve the UI)'),
);
console.log(`  Data dir: ${DATA_DIR}`);
console.log(`  Model: ${s.model.model} @ ${s.model.baseUrl}`);

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
