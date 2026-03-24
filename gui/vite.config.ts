import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import type { IncomingMessage, ServerResponse } from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Scripts that are permitted to run via /api/run-script
const ALLOWED_SCRIPTS = new Set(['fetch_country_metrics.py', 'json_to_xml_converter.py']);

export default defineConfig({
  plugins: [
    react(),

    // ── Serve Data/ directory as a REST-like API ────────────────────────────
    {
      name: 'data-api',
      configureServer(server) {
        const DATA_ROOT = path.resolve(__dirname, '../Data');
        server.middlewares.use(
          '/api/countries',
          (req: IncomingMessage, res: ServerResponse, next: () => void) => {
            const urlPath = decodeURIComponent(req.url ?? '/').replace(/\.\./g, '');
            const filePath = path.join(DATA_ROOT, urlPath);

            if (!filePath.startsWith(DATA_ROOT)) {
              res.statusCode = 403;
              res.end('Forbidden');
              return;
            }

            try {
              const stat = fs.statSync(filePath);
              if (stat.isDirectory()) {
                const files = fs.readdirSync(filePath);
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify(files));
              } else {
                const ext = path.extname(filePath).toLowerCase();
                res.setHeader(
                  'Content-Type',
                  ext === '.json' ? 'application/json' : 'application/xml',
                );
                res.end(fs.readFileSync(filePath));
              }
            } catch {
              next();
            }
          },
        );
      },
    },

    // ── Run Python scripts and stream output via SSE ────────────────────────
    {
      name: 'script-runner',
      configureServer(server) {
        const SCRIPT_DIR  = path.resolve(__dirname, '../script');
        const PROJECT_ROOT = path.resolve(__dirname, '..');

        server.middlewares.use(
          '/api/run-script',
          (req: IncomingMessage, res: ServerResponse, next: () => void) => {
            if (req.method !== 'POST') { next(); return; }

            const scriptName = decodeURIComponent((req.url ?? '/').replace(/^\//, ''));

            if (!ALLOWED_SCRIPTS.has(scriptName)) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: `Script "${scriptName}" not permitted.` }));
              return;
            }

            const scriptPath = path.join(SCRIPT_DIR, scriptName);
            if (!fs.existsSync(scriptPath)) {
              res.statusCode = 404;
              res.end(JSON.stringify({ error: `Script not found: ${scriptName}` }));
              return;
            }

            // Server-Sent Events headers
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('Access-Control-Allow-Origin', '*');

            const send = (type: string, text: string) =>
              res.write(`data: ${JSON.stringify({ type, text })}\n\n`);

            send('start', `▶ Running ${scriptName} …`);

            const proc = spawn('python', [scriptPath], { cwd: PROJECT_ROOT });

            proc.stdout.on('data', (d: Buffer) => {
              d.toString().split('\n').filter(Boolean).forEach(line => send('stdout', line));
            });
            proc.stderr.on('data', (d: Buffer) => {
              d.toString().split('\n').filter(Boolean).forEach(line => send('stderr', line));
            });
            proc.on('error', (e: Error) => {
              send('error', e.message);
              res.end();
            });
            proc.on('close', (code: number | null) => {
              send('done', String(code ?? 0));
              res.end();
            });
          },
        );
      },
    },
  ],

  server: {
    port: 3000,
    proxy: {
      '/api/ted': {
        target: 'http://localhost:5001',
        changeOrigin: true,
      },
    },
  },
});
