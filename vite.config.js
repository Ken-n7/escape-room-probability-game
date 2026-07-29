import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

// Dev-only fps telemetry sink. The game beacons an fps sample every 0.5s to
// /__fps while playing (see the local stream in src/net/perf.js); this appends
// each one to fps-telemetry.jsonl and echoes a compact line to the terminal, so
// LAN/phone runs (which have no on-screen overlay) can be analysed here.
// `apply: 'serve'` → never part of the production build.
function fpsTelemetry() {
  const logFile = path.resolve('fps-telemetry.jsonl');
  return {
    name: 'fps-telemetry',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__fps', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }
        let body = '';
        req.on('data', c => { body += c; if (body.length > 1e5) req.destroy(); });
        req.on('end', () => {
          try {
            const d = JSON.parse(body || '{}');
            fs.appendFile(logFile, JSON.stringify({ ...d, at: Date.now() }) + '\n', () => {});
            const gpu = d.gpu ? ` · ${String(d.gpu).replace(/^ANGLE \(|\)$/g, '').slice(0, 40)}` : '';
            console.log(`[phone-fps] ${String(d.fps ?? '?').padStart(5)} (min ${d.fps_min ?? '?'}) · dpr${d.dpr ?? '?'}${d.is_mobile ? ' · mobile' : ''}${gpu}`);
          } catch { /* ignore malformed */ }
          res.statusCode = 204; res.end();
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [fpsTelemetry()],
});
