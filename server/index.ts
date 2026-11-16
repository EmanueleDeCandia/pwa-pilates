import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import cookieParser from 'cookie-parser';
import { getDb, DEFAULT_DB_PATH } from './db.js';
import { seedDatabase } from './seed.js';
import { createApiRouter } from './routes.js';
import { attachRealtimeServer } from './realtime.js';
import { initVapidKeys, startReminderCronJob } from './push.js';

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const isProduction = process.env.NODE_ENV === 'production';

async function bootstrap(): Promise<void> {
  // 1. Inizializza database locale SQLite + dati dimostrativi al primo avvio
  const db = getDb();
  seedDatabase(db, { force: false });
  initVapidKeys();

  // 2. Configura Express
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  // Header sicurezza compatibili con anteprima iframe live e PWA Service Worker
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.path === '/sw.js') {
      res.setHeader('Service-Worker-Allowed', '/');
      res.setHeader('Cache-Control', 'no-cache');
    }
    next();
  });

  // 3. API REST
  app.use('/api', createApiRouter());

  // 4. Server HTTP + WebSocket Real-Time (/ws)
  const server = http.createServer(app);
  attachRealtimeServer(server);
  startReminderCronJob();

  // 5. Frontend PWA (Vite middleware in sviluppo, build statica ottimizzata in produzione)
  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        hmr: {
          server,
          path: '/__vite_hmr',
        },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const clientDist = path.resolve(process.cwd(), 'dist/client');
    app.use(
      express.static(clientDist, {
        index: false,
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('sw.js') || filePath.endsWith('manifest.webmanifest')) {
            res.setHeader('Cache-Control', 'no-cache');
          }
        },
      })
    );
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) {
        next();
        return;
      }
      const indexHtml = path.join(clientDist, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Build client non trovata. Esegui npm run build.');
      }
    });
  }

  server.listen(PORT, HOST, () => {
    console.log(
      `[Atelier Élan PWA] Server attivo su http://${HOST}:${PORT} (${isProduction ? 'production' : 'development'})`
    );
    console.log(`[Atelier Élan PWA] Database locale SQLite: ${DEFAULT_DB_PATH}`);
  });
}

bootstrap().catch((err) => {
  console.error('Errore fatale di avvio:', err);
  process.exit(1);
});
