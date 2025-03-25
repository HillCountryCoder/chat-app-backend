import mongoose from "mongoose";
import {
  User,
  UserStatus,
  Space,
  SpaceVisibility,
  SpaceType,
  Channel,
  ChannelType,
} from "../../../models";

export const userFixtures = {
  regular: {
    email: "regular@example.com",
    username: "regularuser",
    passwordHash: "hashedpassword",
    displayName: "Regular User",
    status: UserStatus.OFFLINE,
  },
  admin: {
    email: "admin@example.com",
    username: "adminuser",
    passwordHash: "hashedpassword",
    displayName: "Admin User",
    status: UserStatus.ONLINE,
  },
  inactive: {
    email: "inactive@example.com",
    username: "inactiveuser",
    passwordHash: "hashedpassword",
    displayName: "Inactive User",
    status: UserStatus.OFFLINE,
    lastSeen: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
  },
};

export const spaceFixtures = {
  team: {
    name: "Team Space",
    description: "A space for our team",
    visibility: SpaceVisibility.PRIVATE,
    type: SpaceType.TEAM,
  },
  project: {
    name: "Project Space",
    description: "A space for our project",
    visibility: SpaceVisibility.PUBLIC,
    type: SpaceType.PROJECT,
  },
};
export const channelFixtures = {
  general: {
    name: "general",
    description: "General discussion",
    type: ChannelType.TEXT,
    isArchived: false,
  },
  announcements: {
    name: "announcements",
    description: "Important announcements",
    type: ChannelType.ANNOUNCEMENT,
    isArchived: false,
  },
  archived: {
    name: "archived-channel",
    description: "This channel is archived",
    type: ChannelType.TEXT,
    isArchived: true,
  },
};
export async function seedUsers(count = 3) {
  const users = [];

  // Add fixture users first
  for (const key in userFixtures) {
    users.push(userFixtures[key as keyof typeof userFixtures]);
  }

  // Add random users if needed
  for (let i = users.length; i < count; i++) {
    users.push({
      email: `user${i}@example.com`,
      username: `user${i}`,
      passwordHash: "hashedpassword",
      displayName: `User ${i}`,
      status: i % 2 === 0 ? UserStatus.ONLINE : UserStatus.OFFLINE,
    });
  }

  // Create all users
  const createdUsers = await User.insertMany(users);
  return createdUsers;
}

// Seed spaces with an owner
export async function seedSpaces(ownerId: string, count = 2) {
  const spaces = [];

  // Add fixture spaces first
  for (const key in spaceFixtures) {
    spaces.push({
      ...spaceFixtures[key as keyof typeof spaceFixtures],
      creatorId: ownerId,
    });
  }

  // Add random spaces if needed
  for (let i = spaces.length; i < count; i++) {
    spaces.push({
      name: `Space ${i}`,
      description: `Description for Space ${i}`,
      creatorId: ownerId,
      visibility:
        i % 2 === 0 ? SpaceVisibility.PUBLIC : SpaceVisibility.PRIVATE,
      type:
        i % 3 === 0
          ? SpaceType.TEAM
          : i % 3 === 1
          ? SpaceType.PROJECT
          : SpaceType.SOCIAL,
    });
  }

  // Create all spaces
  const createdSpaces = await Space.insertMany(spaces);
  return createdSpaces;
}

// Seed channels for a space
export async function seedChannels(spaceId: string, count = 3) {
  const channels = [];

  // Add fixture channels first
  for (const key in channelFixtures) {
    channels.push({
      ...channelFixtures[key as keyof typeof channelFixtures],
      spaceId,
    });
  }

  // Add random channels if needed
  for (let i = channels.length; i < count; i++) {
    channels.push({
      name: `channel-${i}`,
      description: `Description for Channel ${i}`,
      spaceId,
      type: i % 2 === 0 ? ChannelType.TEXT : ChannelType.VOICE,
      isArchived: false,
    });
  }

  // Create all channels
  const createdChannels = await Channel.insertMany(channels);
  return createdChannels;
}

// Clean up all test data
export async function cleanupRepositoryTestData() {
  await User.deleteMany({});
  await Space.deleteMany({});
  await Channel.deleteMany({});
}
