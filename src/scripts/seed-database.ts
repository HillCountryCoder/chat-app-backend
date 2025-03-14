// src/scripts/seed-database.ts
import { initializeDatabase } from "../common/database/init";
import { databaseConnection } from "../common/database/connection";
import {
  User,
  UserStatus,
  Space,
  SpaceVisibility,
  SpaceType,
  Channel,
  ChannelType,
} from "../models";
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

async function seedSpacesAndChannels() {
  const existingSpaces = await Space.countDocuments();
  if (existingSpaces > 0) {
    logger.info("Spaces already exist, skipping space/channel seed");
    return;
  }

  const admin = await User.findOne({ username: "admin" });
  if (!admin) {
    logger.error("Admin user not found, cannot seed spaces");
    return;
  }

  // Create a general space
  const generalSpace = await Space.create({
    name: "General",
    description: "General discussion space",
    creatorId: admin._id,
    visibility: SpaceVisibility.PUBLIC,
    type: SpaceType.TEAM,
  });

  // Create default channels
  const channels = [
    {
      spaceId: generalSpace._id,
      name: "general",
      description: "General discussions",
      type: ChannelType.TEXT,
    },
    {
      spaceId: generalSpace._id,
      name: "random",
      description: "Random topics",
      type: ChannelType.TEXT,
    },
    {
      spaceId: generalSpace._id,
      name: "announcements",
      description: "Important announcements",
      type: ChannelType.ANNOUNCEMENT,
    },
  ];

  await Channel.insertMany(channels);
  logger.info(`Seeded 1 space and ${channels.length} channels`);
}

async function seedDatabase() {
  try {
    await initializeDatabase();

    logger.info("Starting database seed");

    await seedUsers();
    await seedSpacesAndChannels();

    logger.info("Database seed completed successfully");
  } catch (error: any) {
    logger.error("Error seeding database", { error: error.message });
  } finally {
    await databaseConnection.disconnect();
  }
}

// Run the seed function
seedDatabase();
