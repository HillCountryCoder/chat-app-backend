// src/server.ts - Fixed to work with your actual code structure
import express from "express";
import { createServer } from "http";
import { connectRedis, redisClient } from "./common/redis/client";
import { createLogger } from "./common/logger";
import { initializeSocketServer } from "./socket";
import routes from "./routes";
import cors from "cors";
import { errorMiddleware } from "./common/middlewares";
import { PresenceManager } from "./presence/presence-manager";
import { PresenceHistoryService } from "./presence/services/presence-history.service";
import { initializeDatabase } from "./common/database/init";
import { env } from "./common/environment";
import { ServiceLocator } from "./common/service-locator";

const app = express();
const httpServer = createServer(app);
const serviceLocator = ServiceLocator.getInstance();
const logger = createLogger("main");
const corsOrigins = env.CORS_ORIGIN
  ? env.CORS_ORIGIN.split(",").map((origin) => origin.trim())
  : ["http://localhost:3000", "http://localhost:3001", "http://localhost:5001"];

logger.info("CORS allowed origins:", corsOrigins);

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (like curl, mobile apps, Postman)
      if (!origin) return callback(null, true);

      // Check if origin is in allowed list
      const isAllowed = corsOrigins.some(
        (allowed) => origin === allowed || origin.startsWith(allowed),
      );

      if (isAllowed) {
        callback(null, true);
      } else {
        logger.warn(`CORS blocked: ${origin}`);
        callback(null, false);
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Tenant-ID",
      "X-Requested-With",
    ],
    exposedHeaders: ["Content-Length"],
    maxAge: 86400, // 24 hours
  }),
);
// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

async function startServer() {
  try {
    // Connect to database
    await initializeDatabase();
    logger.info("Connected to MongoDB");

    // Connect to Redis
    await connectRedis();
    logger.info("Connected to Redis");

    // Initialize Presence Manager
    const presenceManager = new PresenceManager(redisClient);
    // Register services in service locator
    serviceLocator.register("presenceManager", presenceManager);

    // Initialize Socket.IO server (this will set up all socket handlers including presence)
    const io = initializeSocketServer(httpServer);
    // Register Socket.IO in service locator
    serviceLocator.register("socketIO", io);
    // Store io instance in app if needed elsewhere
    app.set("io", io);

    // Routes
    app.use("/api", routes);

    // Health check
    app.get("/health", (req, res) => {
      res.json({
        status: "ok",
        timestamp: new Date().toISOString(),
        services: {
          database: "connected",
          redis: "connected",
          presence: "active",
        },
      });
    });

    // Error handling middleware
    app.use(errorMiddleware);

    // Start server
    const PORT = process.env.PORT || 5000;
    httpServer.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
    });

    // Setup background jobs for presence system
    setupBackgroundJobs();

    // Graceful shutdown
    process.on("SIGTERM", async () => {
      logger.info("SIGTERM received, shutting down gracefully");

      // Close HTTP server
      httpServer.close(() => {
        logger.info("HTTP server closed");
      });

      // Cleanup presence manager
      presenceManager.destroy();

      // Close Redis connection
      await redisClient.quit();

      process.exit(0);
    });

    process.on("SIGINT", async () => {
      logger.info("SIGINT received, shutting down gracefully");

      // Close HTTP server
      httpServer.close(() => {
        logger.info("HTTP server closed");
      });

      // Cleanup presence manager
      presenceManager.destroy();

      // Close Redis connection
      await redisClient.quit();

      process.exit(0);
    });
  } catch (error) {
    logger.error("Failed to start server:", error);
    process.exit(1);
  }
}

// Background jobs for presence system
// Background jobs for presence system
function setupBackgroundJobs() {
  // Clean up old presence history daily
  const cleanupJob = setInterval(async () => {
    try {
      await PresenceHistoryService.cleanupAllTenants(90);
      logger.info(`Presence cleanup job completed for all tenants`);
    } catch (error) {
      logger.error("Error in presence cleanup job:", error);
    }
  }, 24 * 60 * 60 * 1000);

  // End orphaned sessions every hour
  const sessionCleanupJob = setInterval(async () => {
    try {
      await PresenceHistoryService.cleanupOrphanedSessionsAllTenants();
      logger.info(`Session cleanup completed for all tenants`);
    } catch (error) {
      logger.error("Error in session cleanup job:", error);
    }
  }, 60 * 60 * 1000);

  // Cleanup jobs on shutdown
  process.on("SIGTERM", () => {
    clearInterval(cleanupJob);
    clearInterval(sessionCleanupJob);
  });

  process.on("SIGINT", () => {
    clearInterval(cleanupJob);
    clearInterval(sessionCleanupJob);
  });
}

// Start the server
startServer();

// Export for testing
export { app, httpServer };
