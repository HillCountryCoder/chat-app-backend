import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { beforeAll, afterAll, afterEach, vi, Mock } from "vitest";
import { Request, Response } from "express";

// Mock Redis client
vi.mock("../../../common/redis/client", () => ({
  redisClient: {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    quit: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue("OK"),
    del: vi.fn().mockResolvedValue(1),
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    keys: vi.fn().mockResolvedValue([]),
    mGet: vi.fn().mockResolvedValue([]),
    multi: vi.fn().mockReturnValue({
      incr: vi.fn().mockReturnThis(),
      expire: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([]),
    }),
  },
}));

vi.mock("../../../common/environment", async (importOriginal) => {
  const actual =
    (await importOriginal()) as typeof import("../../../common/environment");
  return {
    env: {
      ...actual,
      NODE_ENV: "test",
      MONGODB_URI: "mongodb://localhost:27017/test",
      JWT_SECRET: "test-secret-key-for-integration-tests",
      JWT_EXPIRES_IN: "1h",
    },
    environmentService: {
      getInstance: () => ({
        env: {
          NODE_ENV: "test",
          MONGODB_URI: "mongodb://localhost:27017/test",
          JWT_SECRET: "test-secret-key-for-integration-tests",
          JWT_EXPIRES_IN: "1h",
        },
        getMongoDBOptions: () => ({}),
      }),
    },
  };
});

vi.mock("../../../common/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    http: vi.fn(),
  }),
  httpLogger: () => (req: Request, res: Response, next: Mock) => next(),
  createSocketLogger: () => ({
    connection: vi.fn(),
    disconnection: vi.fn(),
    event: vi.fn(),
    error: vi.fn(),
  }),
}));

let mongoServer: MongoMemoryServer;

beforeAll(async function handleSetupBeforeTestRun() {
  mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();

  await mongoose.connect(mongoUri);
});

afterEach(async function handleSetupAfterTestRun() {
  if (mongoose.connection.readyState === 1) {
    const collections = mongoose.connection.collections;
    for (const key in collections) {
      await collections[key].deleteMany({});
    }
  }
});

afterAll(async function handleSetupBeforeAllTestsRun() {
  if (mongoose.connection.readyState === 1) {
    await mongoose.disconnect();
  }
  if (mongoServer) {
    await mongoServer.stop();
  }
});
