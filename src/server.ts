// src/server.ts
import express from "express";
import http from "http";
import mongoose from "mongoose";
import cors from "cors";
import fs from "fs";
import path from "path";
import { createLogger, httpLogger } from "./common/logger";
import { env } from "./common/environment";
import { NotFoundError } from "./common/errors";
import { errorMiddleware } from "./common/middlewares/error.middleware";
import { initializeDatabase } from "./common/database/init";
import routes from "./routes";
import { initializeSocketServer } from "./socket";
import { connectRedis } from "./common/redis/client";

const logsDir = path.join(process.cwd(), "logs");
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

const logger = createLogger("main");

const app = express();
// Create HTTP server
const server = http.createServer(app);

// Initialize Socket.IO with the HTTP server - IMPORTANT: Do this before defining Express routes
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const io = initializeSocketServer(server);

// Middlewares
app.use(
  cors({
    origin: env.CORS_ORIGIN,
    credentials: true,
  }),
);
app.use(express.json());
app.use(httpLogger(logger)); // Add HTTP request logging
app.use(
  "/favicon.ico",
  express.static(path.join(__dirname, "../public/favicon.ico")),
);

// Define routes
app.get("/", (req, res) => {
  res.send("Chat Application is running!!");
});

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "up",
    environment: env.NODE_ENV,
    timestamp: new Date().toISOString(),
  });
});

app.use("/api", routes);

// IMPORTANT: This 404 handler should only run for non-socket.io routes
app.use((req, res, next) => {
  // Skip handling socket.io routes
  if (req.url.startsWith("/socket.io/")) {
    return next();
  }
  next(new NotFoundError("route"));
});

app.use(errorMiddleware);

// Start server
const PORT = env.PORT;
async function startApplication() {
  try {
    await initializeDatabase();

    await connectRedis();

    server.listen(PORT, () => {
      logger.info(`Server started successfully in ${env.NODE_ENV} mode`, PORT);
      logger.info(`Server is running at http://localhost:${PORT}`);
    });
  } catch (error: any) {
    logger.error("Failed to start application", error);
    process.exit(1);
  }
}

startApplication();
// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
  const errorObject = {
    error: error.message,
    stack: error.stack,
  };
  logger.error("Uncaught Exception", errorObject);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason) => {
  const errorObject = {
    reason: reason instanceof Error ? reason.message : reason,
    stack: reason instanceof Error ? reason.stack : undefined,
  };
  logger.error("Unhandled Rejection", errorObject);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  logger.info("SIGTERM received, shutting down gracefully");
  mongoose.connection.close();
  process.exit(0);
});

process.on("SIGINT", () => {
  logger.info("SIGINT received, shutting down gracefully");
  mongoose.connection.close();
  process.exit(0);
});
