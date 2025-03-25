import { describe, it, expect, beforeEach, afterEach } from "vitest";
import mongoose from "mongoose";
import { BaseRepository } from "../../../repositories/base.repository";
import { User } from "../../../models";
import "../setup";

class TestUserRepository extends BaseRepository<typeof User.prototype> {
  constructor() {
    super(User);
  }
}

describe("BaseRepository Integration Tests", () => {
  let repository: TestUserRepository;
  let testUserId: string;

  const testUser = {
    email: "test@example.com",
    username: "testuser",
    passwordHash: "hashedpassword",
    displayName: "Test User",
    status: "offline",
  };

  beforeEach(async () => {
    repository = new TestUserRepository();

    const user = (await User.create(testUser)) as mongoose.Document<
      typeof User
    >;
    testUserId = user._id.toString();
  });
  afterEach(async () => {
    await User.deleteMany({});
  });
  describe("findById", () => {
    it("should find a document by ID", async () => {
      const user = await repository.findById(testUserId);

      expect(user).not.toBeNull();
      expect(user?._id.toString()).toBe(testUserId);
      expect(user?.email).toBe(testUser.email);
    });

    it("should return null for non-existent ID", async () => {
      const nonExistentId = new mongoose.Types.ObjectId().toString();
      const user = await repository.findById(nonExistentId);

      expect(user).toBeNull();
    });

    it("should handle invalid ID format", async () => {
      await expect(repository.findById("invalid-id")).rejects.toThrow();
    });
  });

  describe("findOne", () => {
    it("should find a document by email", async () => {
      const user = await repository.findOne({ email: testUser.email });

      expect(user).not.toBeNull();
      expect(user.email).toBe(testUser.email);
    });

    it("should return null for non-existent criteria", async () => {
      const user = await repository.findOne({
        email: "nonexistent@example.com",
      });

      expect(user).toBeNull();
    });
  });
  describe("find", () => {
    it("should find multiple documents", async () => {
      // Create another user
      await User.create({
        ...testUser,
        email: "another@example.com",
        username: "anotheruser",
      });

      const users = await repository.find({});

      expect(users.length).toBe(2);
    });

    it("should find documents matching criteria", async () => {
      // Create several more users with different statuses
      await User.create({
        ...testUser,
        email: "online1@example.com",
        username: "onlineuser1",
        status: "online",
      });

      await User.create({
        ...testUser,
        email: "online2@example.com",
        username: "onlineuser2",
        status: "online",
      });

      const onlineUsers = await repository.find({ status: "online" });

      expect(onlineUsers.length).toBe(2);
      onlineUsers.forEach((user) => {
        expect(user.status).toBe("online");
      });
    });

    it("should return empty array when no documents match", async () => {
      const nonExistentUsers = await repository.find({ status: "nonexistent" });

      expect(nonExistentUsers).toEqual([]);
    });
  });
  describe("create", () => {
    it("should create a new document", async () => {
      const newUser = {
        email: "new@example.com",
        username: "newuser",
        passwordHash: "hashedpassword",
        displayName: "New User",
        status: "offline",
      };

      const createdUser = await repository.create(newUser);

      expect(createdUser._id).toBeDefined();
      expect(createdUser.email).toBe(newUser.email);

      // Verify it's in the database
      const foundUser = await User.findById(createdUser._id);
      expect(foundUser).not.toBeNull();
      expect(foundUser?.email).toBe(newUser.email);
    });

    it("should reject duplicate unique fields", async () => {
      const duplicateUser = { ...testUser };

      await expect(repository.create(duplicateUser)).rejects.toThrow();
    });

    it("should validate required fields", async () => {
      const invalidUser = {
        // Missing email and username which are required
        passwordHash: "hashedpassword",
        displayName: "Invalid User",
      };

      await expect(repository.create(invalidUser as any)).rejects.toThrow();
    });
  });
  describe("update", () => {
    it("should update an existing document", async () => {
      const updatedData = {
        displayName: "Updated Name",
        status: "online",
      };

      const updatedUser = await repository.update(testUserId, updatedData);

      expect(updatedUser).not.toBeNull();
      expect(updatedUser?.displayName).toBe(updatedData.displayName);
      expect(updatedUser?.status).toBe(updatedData.status);

      // Original fields should remain unchanged
      expect(updatedUser?.email).toBe(testUser.email);
    });

    it("should return null for non-existent document", async () => {
      const nonExistentId = new mongoose.Types.ObjectId().toString();
      const updatedUser = await repository.update(nonExistentId, {
        displayName: "New Name",
      });

      expect(updatedUser).toBeNull();
    });

    it("should handle invalid data", async () => {
      const invalidEmails = ["", null];
      invalidEmails.forEach(async (invalidEmail) => {
        await expect(
          repository.update(testUserId, { email: invalidEmail } as any),
        ).rejects.toThrow();
      });
    });
  });

  describe("delete", () => {
    it("should delete an existing document", async () => {
      const deletedUser = await repository.delete(testUserId);

      expect(deletedUser).not.toBeNull();
      expect(deletedUser?._id.toString()).toBe(testUserId);

      // Verify it's gone from the database
      const foundUser = await User.findById(testUserId);
      expect(foundUser).toBeNull();
    });

    it("should return null for non-existent document", async () => {
      const nonExistentId = new mongoose.Types.ObjectId().toString();
      const deletedUser = await repository.delete(nonExistentId);

      expect(deletedUser).toBeNull();
    });
  });
});
