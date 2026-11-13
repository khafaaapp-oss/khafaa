import { Server as SocketIOServer } from 'socket.io';
import { verifyToken } from '../utils/jwt.js';
import { User } from '../models/User.js';
import { registerChatHandlers } from './chat.js';

/**
 * Initializes Socket.io on the HTTP server.
 * - Authenticates sockets via JWT (in handshake.auth.token).
 * - Joins each socket to its personal room: `user:<id>`.
 * - Delegates business events to feature handlers.
 */
export function initSockets(httpServer, allowedOrigins) {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: allowedOrigins.length ? allowedOrigins : '*',
      credentials: true,
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 30000,
    pingInterval: 25000,
  });

  // ── Authentication middleware ─────────────────────
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('Missing auth token'));

      const payload = verifyToken(token);
      const user = await User.findById(payload.sub);
      if (!user) return next(new Error('User not found'));
      if (user.isBanned) return next(new Error('Account is banned'));

      socket.userId = user._id.toString();
      socket.userRole = user.role;
      next();
    } catch (err) {
      next(new Error('Invalid or expired token'));
    }
  });

  // ── On connection ─────────────────────────────────
  io.on('connection', async (socket) => {
    const userId = socket.userId;
    const userRoom = `user:${userId}`;
    socket.join(userRoom);

    // Mark user online
    await User.findByIdAndUpdate(userId, { isOnline: true });
    // Notify others (optional — only people in the same chats care, but we
    // keep it simple: broadcast. Clients can filter by known contacts.)
    socket.broadcast.emit('user:online', { userId });

    console.log(`🔌 socket connected: ${socket.id} (user ${userId})`);

    // Register feature handlers
    registerChatHandlers(io, socket);

    // ── Disconnect ──────────────────────────────────
    socket.on('disconnect', async () => {
      console.log(`🔌 socket disconnected: ${socket.id} (user ${userId})`);

      // Check if the user still has other active sockets
      const room = io.sockets.adapter.rooms.get(userRoom);
      const stillOnline = room && room.size > 0;

      if (!stillOnline) {
        const now = new Date();
        await User.findByIdAndUpdate(userId, {
          isOnline: false,
          lastSeenAt: now,
        });
        socket.broadcast.emit('user:offline', { userId, lastSeenAt: now });
      }
    });
  });

  return io;
}
