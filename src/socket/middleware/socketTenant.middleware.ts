import { Server, Socket } from "socket.io";
import { TenantService } from "../../services/tenant.service";
import { runInTenantContext } from "../../plugins/tenantPlugin";

interface SocketData {
  tenantId: string;
  userId: string;
  email: string;
}

/**
 * Socket.IO middleware for tenant isolation
 *
 * This middleware:
 * 1. Authenticates socket connections using tenant + session token
 * 2. Validates tenant is active
 * 3. Checks origin against tenant's allowed origins
 * 4. Stores tenant context in socket.data for all subsequent events
 */

export function socketTenantMiddleware(io: Server) {
  io.use(async (socket: Socket, next) => {
    try {
      const { token, tenantId, origin } = socket.handshake.auth;
      // 1. Validate required auth data
      if (!token || !tenantId) {
        return next(new Error("Missing authentication data"));
      }
      // 2. Get tenant
      const tenant = await TenantService.getTenant(tenantId);
      if (!tenant) {
        return next(new Error("Tenant not found"));
      }

      if (!tenant.isActive || tenant.status !== "verified") {
        return next(new Error("Tenant not active"));
      }

      // 3. Validate origin
      if (
        origin &&
        !tenant.allowedOrigins.some((allowed) => origin.startsWith(allowed))
      ) {
        console.error("Socket connection from unauthorized origin:", origin);
        return next(new Error("Origin not allowed"));
      }

      // 4. Verify session token
      // TODO: Implement Redis session verification
      // const sessionStr = await redis.get(`chat_session:${token}`);
      // if (!sessionStr) {
      //   return next(new Error('Invalid or expired session'));
      // }
      // const session = JSON.parse(sessionStr);

      // For now, mock session data (REPLACE WITH REAL REDIS LOOKUP)

      // For now, mock session data (REPLACE WITH REAL REDIS LOOKUP)
      const session = {
        tenantId,
        userId: "mock_user_id",
        email: "mock@example.com",
      };

      // 5. Verify tenant match
      if (session.tenantId !== tenantId) {
        return next(new Error("Tenant mismatch"));
      }

      // 6. Store tenant context in socket
      socket.data = {
        tenantId: session.tenantId,
        userId: session.userId,
        email: session.email,
      } as SocketData;

      console.log(
        `✅ Socket authenticated: User ${session.userId} in tenant ${tenantId}`,
      );

      next();
    } catch (error) {
      console.error("Socket authentication error:", error);
      next(new Error("Authentication failed"));
    }
  });
}

/**
 * Setup tenant-scoped Socket.IO event handlers
 *
 * All events are automatically scoped to tenant rooms to prevent
 * cross-tenant data leaks
 */ export function setupTenantSocketHandlers(io: Server) {
  io.on("connection", async (socket: Socket) => {
    const { tenantId, userId, email } = socket.data as SocketData;

    console.log(`🔌 User connected: ${userId} (tenant: ${tenantId})`);

    // Join tenant-specific room
    socket.join(`tenant:${tenantId}`);
    socket.join(`tenant:${tenantId}:user:${userId}`);

    // Broadcast user online status to tenant
    socket.to(`tenant:${tenantId}`).emit("user:online", {
      userId,
      email,
      timestamp: new Date(),
    });

    // ===== CHANNEL EVENTS =====

    socket.on("channel:join", async (data) => {
      const { channelId } = data;

      // Run in tenant context to enforce isolation
      await runInTenantContext(tenantId, async () => {
        // TODO: Verify user has access to this channel
        // const channel = await Channel.findById(channelId);
        // if (!channel) return;

        const roomName = `tenant:${tenantId}:channel:${channelId}`;
        socket.join(roomName);

        console.log(
          `📢 User ${userId} joined channel ${channelId} in tenant ${tenantId}`,
        );

        socket.to(roomName).emit("channel:user-joined", {
          userId,
          channelId,
          timestamp: new Date(),
        });
      });
    });

    socket.on("channel:leave", async (data) => {
      const { channelId } = data;

      const roomName = `tenant:${tenantId}:channel:${channelId}`;
      socket.leave(roomName);

      socket.to(roomName).emit("channel:user-left", {
        userId,
        channelId,
        timestamp: new Date(),
      });
    });

    socket.on("channel:message", async (data) => {
      const { channelId, message } = data;

      // Run in tenant context
      await runInTenantContext(tenantId, async () => {
        // TODO: Save message to database with tenantId
        // const savedMessage = await Message.create({
        //   channelId,
        //   senderId: userId,
        //   content: message.content,
        // });

        const roomName = `tenant:${tenantId}:channel:${channelId}`;

        // Broadcast to channel room (tenant-scoped)
        io.to(roomName).emit("channel:new-message", {
          channelId,
          message: {
            id: "mock_message_id",
            content: message.content,
            senderId: userId,
            timestamp: new Date(),
          },
        });
      });
    });

    // ===== DIRECT MESSAGE EVENTS =====

    socket.on("dm:start", async (data) => {
      const { recipientId } = data;

      // Create conversation ID (sorted to ensure consistency)
      const conversationId = [userId, recipientId].sort().join("_");
      const roomName = `tenant:${tenantId}:dm:${conversationId}`;

      socket.join(roomName);

      // Add recipient to room if they're online
      const recipientSockets = await io
        .in(`tenant:${tenantId}:user:${recipientId}`)
        .fetchSockets();
      if (recipientSockets.length > 0) {
        recipientSockets[0].join(roomName);
      }

      socket.emit("dm:started", { conversationId, recipientId });
    });

    socket.on("dm:message", async (data) => {
      const { recipientId, message } = data;

      // Run in tenant context
      await runInTenantContext(tenantId, async () => {
        // TODO: Save DM to database with tenantId

        const conversationId = [userId, recipientId].sort().join("_");
        const roomName = `tenant:${tenantId}:dm:${conversationId}`;

        // Send to conversation room (tenant-scoped)
        io.to(roomName).emit("dm:new-message", {
          conversationId,
          message: {
            id: "mock_dm_id",
            content: message.content,
            senderId: userId,
            recipientId,
            timestamp: new Date(),
          },
        });
      });
    });

    // ===== TYPING INDICATORS =====

    socket.on("typing:start", (data) => {
      const { channelId, conversationId } = data;

      let roomName: string;
      if (channelId) {
        roomName = `tenant:${tenantId}:channel:${channelId}`;
      } else if (conversationId) {
        roomName = `tenant:${tenantId}:dm:${conversationId}`;
      } else {
        return;
      }

      socket.to(roomName).emit("typing:user-started", {
        userId,
        channelId,
        conversationId,
      });
    });

    socket.on("typing:stop", (data) => {
      const { channelId, conversationId } = data;

      let roomName: string;
      if (channelId) {
        roomName = `tenant:${tenantId}:channel:${channelId}`;
      } else if (conversationId) {
        roomName = `tenant:${tenantId}:dm:${conversationId}`;
      } else {
        return;
      }

      socket.to(roomName).emit("typing:user-stopped", {
        userId,
        channelId,
        conversationId,
      });
    });

    // ===== DISCONNECT =====

    socket.on("disconnect", () => {
      console.log(`🔌 User disconnected: ${userId} (tenant: ${tenantId})`);

      // Broadcast offline status to tenant
      socket.to(`tenant:${tenantId}`).emit("user:offline", {
        userId,
        timestamp: new Date(),
      });
    });
  });
}

/**
 * Helper to emit event to specific tenant
 */
export function emitToTenant(
  io: Server,
  tenantId: string,
  event: string,
  data: unknown,
) {
  io.to(`tenant:${tenantId}`).emit(event, data);
}

/**
 * Helper to emit event to specific user in tenant
 */
export function emitToUser(
  io: Server,
  tenantId: string,
  userId: string,
  event: string,
  data: unknown,
) {
  io.to(`tenant:${tenantId}:user:${userId}`).emit(event, data);
}

/**
 * Helper to emit event to channel in tenant
 */
export function emitToChannel(
  io: Server,
  tenantId: string,
  channelId: string,
  event: string,
  data: unknown,
) {
  io.to(`tenant:${tenantId}:channel:${channelId}`).emit(event, data);
}
