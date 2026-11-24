import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import mongoose from 'mongoose';
import { env } from './config/env.js';
import routes from './routes/index.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { UPLOAD_ROOT } from './middleware/upload.js';

const app = express();

app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: env.clientUrls, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
if (!env.isProd) app.use(morgan('dev'));

app.use('/uploads', express.static(UPLOAD_ROOT, { maxAge: '7d', index: false }));

app.get('/api/health', (_req, res) => {
  res.json({ success: true, status: 'ok', db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected', time: new Date().toISOString() });
});

app.use('/api', routes);
app.use(notFound);
app.use(errorHandler);

export default app;
