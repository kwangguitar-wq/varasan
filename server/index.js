import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { ROOT, UPLOAD_DIR, DB_PATH } from './paths.js';
import { createSqliteDriver } from './drivers/sqlite.js';
import { createFsStorage } from './drivers/fs-storage.js';
import { db, setDatabaseDriver, runtime } from './db.js';
import { setStorageDriver } from './storage.js';
import { createApp } from './app.js';

const PORT = Number(process.env.PORT) || 4000;

runtime.platform = 'node';
setDatabaseDriver(createSqliteDriver(DB_PATH));
setStorageDriver(createFsStorage(UPLOAD_DIR));

const users = (await db.prepare('SELECT COUNT(*) AS n FROM users').get()).n;
if (!users) {
  const { seedDatabase } = await import('./seed.js');
  await seedDatabase();
}

const app = createApp();

app.use(
  '/uploads',
  express.static(UPLOAD_DIR, {
    maxAge: '7d',
    setHeaders(res, filePath) {
      if (filePath.endsWith('.pdf')) res.setHeader('Content-Type', 'application/pdf');
    },
  }),
);

const distDir = path.join(ROOT, 'dist');
if (fs.existsSync(distDir)) {
  app.use(
    express.static(distDir, {
      maxAge: '1h',
      index: false,
      setHeaders(res, filePath) {
        // service worker/ตัวติดตั้ง: ต้องตรวจของใหม่ได้ทันที
        if (/\.(webmanifest|html)$/.test(filePath) || filePath.endsWith('sw.js')) {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    }),
  );
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next();
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[lumen] API ready on http://localhost:${PORT}`);
});
