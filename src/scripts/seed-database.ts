// src/scripts/seed-database.ts
import { initializeDatabase } from "../common/database/init";
import { databaseConnection } from "../common/database/connection";
import { User, UserStatus } from "../models";
import { createLogger } from "../common/logger";
import bcrypt from "bcrypt";

const logger = createLogger("database-seed");

async function seedUsers() {
  const existingUsers = await User.countDocuments();
  if (existingUsers > 0) {
    logger.info("Users already exist, skipping user seed");
    return;
  }

  const passwordHash = await bcrypt.hash("password123", 10);

  const users = [
    {
      email: "admin@example.com",
      username: "admin",
      passwordHash,
      displayName: "Admin User",
      status: UserStatus.ONLINE,
    },
    {
      email: "user1@example.com",
      username: "user1",
      passwordHash,
      displayName: "User One",
      status: UserStatus.ONLINE,
    },
    {
      email: "user2@example.com",
      username: "user2",
      passwordHash,
      displayName: "User Two",
      status: UserStatus.OFFLINE,
    },
  ];

  await User.insertMany(users);
  logger.info(`Seeded ${users.length} users`);
}

async function seedDatabase() {
  try {
    await initializeDatabase();

    logger.info("Starting database seed");

    await seedUsers();

    logger.info("Database seed completed successfully");
  } catch (error: any) {
    logger.error("Error seeding database", { error: error.message });
  } finally {
    await databaseConnection.disconnect();
  }
}

// Run the seed function
seedDatabase();
