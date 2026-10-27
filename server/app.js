import express from 'express';
import { attachUser } from './auth.js';
import authRoutes from './routes/auth.js';
import publicationRoutes from './routes/publications.js';
import taxonomyRoutes from './routes/taxonomy.js';
import userRoutes from './routes/users.js';
import analyticsRoutes from './routes/analytics.js';
import discoverRoutes from './routes/discover.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));
  app.use(attachUser);

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'lumen-library', time: new Date().toISOString() });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/publications', publicationRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/analytics', analyticsRoutes);
  app.use('/api', taxonomyRoutes);
  app.use('/api', discoverRoutes);

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'ไม่พบ API ที่ร้องขอ' });
  });

  app.use((error, _req, res, _next) => {
    console.error('[lumen]', error);
    if (res.headersSent) return;
    const status = error.status || (error.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
    res.status(status).json({
      error:
        status === 413
          ? 'ไฟล์ใหญ่เกินกำหนด'
          : error.expose || error.status
            ? error.message
            : 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์',
    });
  });

  return app;
}

export const app = createApp();
