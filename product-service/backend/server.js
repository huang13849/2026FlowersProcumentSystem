import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { existsSync } from 'fs';
import { connectDB } from './config/db.js';
import authRoutes from './routes/auth.js';
import productRoutes from './routes/products.js';
import imageRoutes from './routes/images.js';
import exportRoutes from './routes/export.js';
import logRoutes from './routes/logs.js';
import userRoutes from './routes/users.js';
import tagRoutes from './routes/tags.js';
import publishTaskRoutes from './routes/publishTasks.js';
import syncRoutes from './routes/sync.js';


const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(morgan('dev'));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000 }));

// Image serving
const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
// Fix MIME types for static assets
express.static.mime && express.static.mime.define && express.static.mime.define({'application/javascript': ['js'], 'text/css': ['css']});

app.use('/images', express.static(UPLOAD_DIR));

// Frontend static files. Prefer the Vite build output in ../frontend/dist.
// In k3s the process starts from /app/backend; an old backend/dist can exist in the image,
// so preferring ./dist serves stale UI assets.
const frontendDir = existsSync('../frontend/dist') ? '../frontend/dist' : './dist';
app.use(express.static(frontendDir, {
  setHeaders: (res, path) => {
    if (path.endsWith('.js')) res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    if (path.endsWith('.css')) res.setHeader('Content-Type', 'text/css; charset=utf-8');
  }
}));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/images', imageRoutes);
app.use('/api/export', exportRoutes);
app.use('/api/publish-tasks', publishTaskRoutes);
app.use('/api/logs', logRoutes);
app.use('/api/users', userRoutes);
app.use('/api/tags', tagRoutes);
app.use('/api/sync', syncRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile('index.html', { root: frontendDir });
});

async function start() {
  await connectDB();
  app.listen(PORT, '0.0.0.0', () => {
    console.log('Supply Chain System running on http://0.0.0.0:' + PORT);
  });
}
start();
