import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { createLogger, httpLogger } from "./common/logger";

// Create logs directory if it doesn't exist
const logsDir = path.join(process.cwd(), "logs");
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

// Initialize environment variables
dotenv.config();

// Create main application logger
const logger = createLogger("main");

// Initialize Express app
const app = express();

// Middlewares
app.use(cors());
app.use(express.json());
app.use(httpLogger(logger)); // Add HTTP request logging

// Connect to MongoDB
mongoose
  .connect(process.env.MONGODB_URI || "mongodb://localhost:27017/chat-app")
  .then(() => {
    logger.info("Connected to MongoDB", {
      uri: process.env.MONGODB_URI || "mongodb://localhost:27017/chat-app",
    });
  })
  .catch((err) => {
    logger.error("MongoDB connection error", { error: err.message });
  });

// Define routes
app.get("/", (req, res) => {
  res.send("Chat Application is running!!");
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  logger.info(`Server started successfully`, { port: PORT });
  logger.info(`Server is running at http://localhost:${PORT}`);
});

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
