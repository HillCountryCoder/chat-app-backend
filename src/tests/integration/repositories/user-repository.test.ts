// src/tests/integration/repositories/user-repository.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { userRepository } from "../../../repositories/user.repository";
import { User, UserStatus } from "../../../models";
import "../setup"; // Import the setup file for MongoDB in-memory testing
import {
  userFixtures,
  seedUsers,
  cleanupRepositoryTestData,
} from "../fixtures/repository-fixtures";

describe("UserRepository Integration Tests", () => {
  // Store created users from fixtures for test reference
  let users: any[];

  beforeEach(async () => {
    // Seed test users using our fixture helper
    users = await seedUsers(5); // Creates user fixtures + additional random users
  });

  afterEach(async () => {
    // Clean up all test data using our helper
    await cleanupRepositoryTestData();
  });

  describe("findByEmail", () => {
    it("should find a user by email", async () => {
      // Use the admin user from fixtures
      const adminEmail = userFixtures.admin.email;

      const user = await userRepository.findByEmail(adminEmail);

      expect(user).not.toBeNull();
      expect(user?.email).toBe(adminEmail);
      expect(user?.displayName).toBe(userFixtures.admin.displayName);
    });

    it("should return null for non-existent email", async () => {
      const user = await userRepository.findByEmail("nonexistent@example.com");

      expect(user).toBeNull();
    });

    it("should perform case-insensitive email search", async () => {
      const user = await userRepository.findByEmail(
        userFixtures.regular.email.toUpperCase(),
      );

      expect(user).not.toBeNull();
      expect(user?.email).toBe(userFixtures.regular.email);
    });
  });

  describe("findByUsername", () => {
    it("should find a user by username", async () => {
      const user = await userRepository.findByUsername(
        userFixtures.inactive.username,
      );

      expect(user).not.toBeNull();
      expect(user?.username).toBe(userFixtures.inactive.username);
      expect(user?.email).toBe(userFixtures.inactive.email);
    });

    it("should return null for non-existent username", async () => {
      const user = await userRepository.findByUsername("nonexistentuser");

      expect(user).toBeNull();
    });
  });

  describe("findByEmailOrUsername", () => {
    it("should find a user by email", async () => {
      const user = await userRepository.findByEmailOrUsername(
        userFixtures.admin.email,
      );

      expect(user).not.toBeNull();
      expect(user?.email).toBe(userFixtures.admin.email);
    });

    it("should find a user by username", async () => {
      const user = await userRepository.findByEmailOrUsername(
        userFixtures.regular.username,
      );

      expect(user).not.toBeNull();
      expect(user?.username).toBe(userFixtures.regular.username);
    });

    it("should return null for non-existent email or username", async () => {
      const user = await userRepository.findByEmailOrUsername("nonexistent");

      expect(user).toBeNull();
    });

    it("should handle special characters in search", async () => {
      // Create a user with special characters
      const specialUser = {
        email: "special+user@example.com",
        username: "special-user",
        passwordHash: "hashedpassword",
        displayName: "Special User",
        status: UserStatus.ONLINE,
      };

      await User.create(specialUser);

      const user = await userRepository.findByEmailOrUsername(
        specialUser.email,
      );
      expect(user).not.toBeNull();
      expect(user?.email).toBe(specialUser.email);

      const userByUsername = await userRepository.findByEmailOrUsername(
        specialUser.username,
      );
      expect(userByUsername).not.toBeNull();
      expect(userByUsername?.username).toBe(specialUser.username);
    });
  });

  describe("index usage", () => {
    it("should use indexes for email lookup", async () => {
      // Create many users to ensure index usage matters
      const manyUsers = Array.from({ length: 100 }, (_, i) => ({
        email: `bulk${i}@example.com`,
        username: `bulkuser${i}`,
        passwordHash: "hashedpassword",
        displayName: `Bulk User ${i}`,
        status: UserStatus.OFFLINE,
      }));

      await User.insertMany(manyUsers);

      // This assertion verifies the operation completes quickly
      // which indirectly tests index usage
      const startTime = Date.now();
      const result = await userRepository.findByEmail("bulk50@example.com");
      const endTime = Date.now();

      expect(result).not.toBeNull();

      // With proper indexing, this should be fast (under 50ms in most environments)
      const queryTime = endTime - startTime;
      expect(queryTime).toBeLessThan(50);
    });
  });

  describe("error handling", () => {
    it("should handle duplicate key errors", async () => {
      const duplicateUser = {
        email: userFixtures.admin.email, // Duplicate email
        username: "uniqueusername",
        passwordHash: "hashedpassword",
        displayName: "Duplicate User",
        status: UserStatus.OFFLINE,
      };

      await expect(userRepository.create(duplicateUser)).rejects.toThrow();
    });

    it("should handle invalid ObjectId errors", async () => {
      await expect(userRepository.findById("invalid-id")).rejects.toThrow();
    });
  });

  describe("edge cases", () => {
    it("should handle empty strings in search", async () => {
      const result = await userRepository.findByEmailOrUsername("");
      expect(result).toBeNull();
    });

    it("should handle very long usernames that exceed the schema limits", async () => {
      const longUsername = "a".repeat(50); // Longer than the 30 char limit in schema

      // This should throw an error because our User schema has maxLength: 30
      await expect(
        User.create({
          email: "long@example.com",
          username: longUsername,
          passwordHash: "hashedpassword",
          displayName: "Long Username User",
          status: UserStatus.OFFLINE,
        }),
      ).rejects.toThrow();
    });

    it("should find users based on their status", async () => {
      // Find online users (should include admin fixture)
      const onlineUsers = await User.find({ status: UserStatus.ONLINE });

      // At least one user (admin fixture) should be online
      expect(onlineUsers.length).toBeGreaterThanOrEqual(1);

      // Make sure at least one of the users is our admin fixture
      const adminUser = onlineUsers.find(
        (user) => user.email === userFixtures.admin.email,
      );
      expect(adminUser).toBeDefined();
    });

    it("should find inactive users based on lastSeen date", async () => {
      // Find users not seen for at least 15 days
      const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
      const inactiveUsers = await User.find({
        lastSeen: { $lt: fifteenDaysAgo },
      });

      // Should find at least one inactive user (from fixtures)
      expect(inactiveUsers.length).toBeGreaterThanOrEqual(1);

      // One of them should be our inactive fixture
      const inactiveUser = inactiveUsers.find(
        (user) => user.email === userFixtures.inactive.email,
      );
      expect(inactiveUser).toBeDefined();
    });
  });
});
