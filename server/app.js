import express from 'express';
import { runtime } from './db.js';
import { attachUser } from './auth.js';
import authRoutes from './routes/auth.js';
import publicationRoutes from './routes/publications.js';
import taxonomyRoutes from './routes/taxonomy.js';
import userRoutes from './routes/users.js';
import analyticsRoutes from './routes/analytics.js';
import discoverRoutes from './routes/discover.js';
import uploadRoutes from './routes/uploads.js';
import maintenanceRoutes from './routes/maintenance.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));
  app.use(attachUser);

  app.get('/api/health', (_req, res) => {
    // `commit` lets a deployment be identified from the outside (Vercel sets the
    // variable at build time), which makes "is the fix live yet?" answerable.
    res.json({
      ok: true,
      service: 'nakhonmaesot-library',
      commit: (process.env.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 7) || null,
      // Answers "where is the data?" for this deployment without exposing
      // credentials: 'blob' | 'db' | 'fs' for uploads, plus the database host.
      storage: runtime.storageBackend,
      database: runtime.databaseHost,
      time: new Date().toISOString(),
    });
  });

  app.use('/api/uploads', uploadRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/publications', publicationRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/analytics', analyticsRoutes);
  app.use('/api', taxonomyRoutes);
  app.use('/api', discoverRoutes);
  app.use('/api/maintenance', maintenanceRoutes);

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'ไม่พบ API ที่ร้องขอ' });
  });

  app.use((error, _req, res, _next) => {
    console.error('[nakhonmaesot]', error);
    if (res.headersSent) return;
    const status = error.status || (error.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
    // Admins also get the underlying reason: on a host without log access an
    // opaque 500 is impossible to diagnose from the screen.
    const canSeeDetail = _req.user?.role === 'admin' && !error.expose && status >= 500;
    res.status(status).json({
      error:
        status === 413
          ? 'ไฟล์ใหญ่เกินกำหนด'
          : error.expose || error.status
            ? error.message
            : 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์',
      ...(canSeeDetail ? { detail: String(error.message ?? error).slice(0, 300) } : {}),
    });
  });

  return app;
}

export const app = createApp();
