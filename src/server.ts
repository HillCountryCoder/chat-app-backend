import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import fs from "fs";
import path from "path";
import { createLogger, httpLogger } from "./common/logger";
import { env, environmentService } from "./common/environment";
import { NotFoundError } from "./common/errors";
import { errorMiddleware } from "./common/middlewares/error.middleware";
import { initializeDatabase } from "./common/database/init";

const logsDir = path.join(process.cwd(), "logs");
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

const logger = createLogger("main");

const app = express();

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
app.use((req, res, next) => {
  next(new NotFoundError("route"));
});

app.use(errorMiddleware);

// Start server
const PORT = env.PORT;
async function startApplication() {
  try {
    await initializeDatabase();

    app.listen(PORT, () => {
      logger.info(`Server started successfully in ${env.NODE_ENV} mode`, {
        port: PORT,
      });
      logger.info(`Server is running at http://localhost:${PORT}`);
    });
  } catch (error: any) {
    logger.error("Failed to start application", { error: error.message });
    process.exit(1);
  }
}

startApplication();
// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
  logger.error("Uncaught Exception", {
    error: error.message,
    stack: error.stack,
  });
  process.exit(1);
});

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled Rejection", {
    reason: reason instanceof Error ? reason.message : reason,
    stack: reason instanceof Error ? reason.stack : undefined,
  });
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
