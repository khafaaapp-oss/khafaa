import 'dotenv/config';
import express from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { Server as SocketIOServer } from 'socket.io';

import { connectDB } from './config/db.js';
import authRoutes from './routes/auth.js';
import usersRoutes from './routes/users.js';
import chatsRoutes from './routes/chats.js';
import messagesRoutes from './routes/messages.js';

const PORT = process.env.PORT || 8000;
const NODE_ENV = process.env.NODE_ENV || 'development';

async function bootstrap() {
  // 1. Connect to MongoDB
  await connectDB();

  // 2. Express
  const app = express();
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));

  // CORS
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin) return cb(null, true); // mobile / curl
        if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
          return cb(null, true);
        }
        return cb(new Error('Not allowed by CORS'));
      },
      credentials: true,
    })
  );

  // Rate limit on /api
  app.use(
    '/api',
    rateLimit({
      windowMs: 60 * 1000,
      max: 120,
      standardHeaders: true,
      legacyHeaders: false,
    })
  );
  // Routes
app.use('/api/auth', authRoutes);
  app.use('/api/users', usersRoutes);
  app.use('/api/chats', chatsRoutes);
  app.use('/api/messages', messagesRoutes);

  // Health check
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      env: NODE_ENV,
      uptimeSec: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  // Placeholder
  app.get('/api', (_req, res) => {
    res.json({ message: 'Chat API v1' });
  });

  // 404
  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

  // Error handler
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    console.error('💥 Error:', err.message);
    res.status(err.status || 500).json({
      error: NODE_ENV === 'production' ? 'Internal server error' : err.message,
    });
  });

  // 3. HTTP + Socket.io
  const httpServer = http.createServer(app);
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: allowedOrigins.length ? allowedOrigins : '*',
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  io.on('connection', (socket) => {
    console.log('🔌 socket connected:', socket.id);
    socket.on('disconnect', () => {
      console.log('🔌 socket disconnected:', socket.id);
    });
  });

  // 4. Listen
  httpServer.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT} (${NODE_ENV})`);
  });
}

bootstrap().catch((err) => {
  console.error('❌ Bootstrap failed:', err);
  process.exit(1);
});
