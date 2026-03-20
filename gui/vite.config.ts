import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import type { IncomingMessage, ServerResponse } from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'data-api',
      configureServer(server) {
        const DATA_ROOT = path.resolve(__dirname, '../Data');
        server.middlewares.use(
          '/api/countries',
          (req: IncomingMessage, res: ServerResponse, next: () => void) => {
            const urlPath = decodeURIComponent(req.url ?? '/').replace(/\.\./g, '');
            const filePath = path.join(DATA_ROOT, urlPath);

            // Security: ensure resolved path stays within Data/
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
                  ext === '.json' ? 'application/json' : 'application/xml'
                );
                res.end(fs.readFileSync(filePath));
              }
            } catch {
              next();
            }
          }
        );
      },
    },
  ],
  server: {
    port: 3000,
  },
});
