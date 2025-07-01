import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createTestApp } from "../../helpers/test-app";
import "../setup"; // Import the setup file for MongoDB in-memory testing
import { seedTestUser, loginCredentials } from "../fixtures/auth-fixtures";
import { Message, User, DirectMessage } from "../../../models";
import mongoose from "mongoose";

describe("Message Reaction Routes Integration Tests", () => {
  const app = createTestApp();
  let authToken: string;
  let userId: string;
  let messageId: string;
  let directMessageId: string;

  beforeEach(async () => {
    // Seed test user and get token
    await seedTestUser();

    const loginResponse = await request(app).post("/api/auth/login").send({
      identifier: loginCredentials.valid.email,
      password: loginCredentials.valid.password,
      rememberMe: false,
    });
    authToken = loginResponse.body.accessToken;
    userId = loginResponse.body.user._id;

    // First create a direct message (conversation)
    const directMessage = new DirectMessage({
      participantIds: [
        new mongoose.Types.ObjectId(userId),
        new mongoose.Types.ObjectId(), // Another random user
      ],
      createdAt: new Date(),
      lastActivity: new Date(),
    });

    await directMessage.save();
    directMessageId = directMessage._id.toString();

    // Create a test message that belongs to the direct message
    const message = new Message({
      messageId: `${Date.now()}_test`,
      senderId: new mongoose.Types.ObjectId(userId),
      directMessageId: directMessageId, // This is the key fix - specify the context
      content: "Test message for reactions",
      contentType: "text",
      createdAt: new Date(),
      isEdited: false,
      isPinned: false,
      reactions: [],
    });

    await message.save();
    messageId = message._id.toString();
  });

  describe("POST /api/messages/:id/reactions", () => {
    it("should add a reaction to a message", async () => {
      // Act
      const response = await request(app)
        .post(`/api/messages/${messageId}/reactions`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({ emoji: "👍" })
        .expect(200);

      // Assert
      expect(response.body).toHaveProperty("success", true);
      expect(response.body).toHaveProperty("reactions");
      expect(response.body.reactions).toHaveLength(1);
      expect(response.body.reactions[0]).toHaveProperty("emoji", "👍");
      expect(response.body.reactions[0]).toHaveProperty("count", 1);
      expect(response.body.reactions[0].users).toContain(userId);

      // Verify in database
      const updatedMessage = await Message.findById(messageId);
      expect(updatedMessage?.reactions).toHaveLength(1);
      expect(updatedMessage?.reactions[0].emoji).toBe("👍");
    });

    it("should not duplicate a reaction from the same user", async () => {
      // Arrange - Add a reaction first
      await request(app)
        .post(`/api/messages/${messageId}/reactions`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({ emoji: "👍" })
        .expect(200);

      // Act - Try to add the same reaction again
      const response = await request(app)
        .post(`/api/messages/${messageId}/reactions`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({ emoji: "👍" })
        .expect(200);

      // Assert
      expect(response.body.reactions).toHaveLength(1);
      expect(response.body.reactions[0].count).toBe(1);
      expect(response.body.reactions[0].users).toHaveLength(1);

      // Verify in database
      const updatedMessage = await Message.findById(messageId);
      expect(updatedMessage?.reactions).toHaveLength(1);
      expect(updatedMessage?.reactions[0].users).toHaveLength(1);
    });

    it("should handle adding different reactions", async () => {
      // Arrange - Add first reaction
      await request(app)
        .post(`/api/messages/${messageId}/reactions`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({ emoji: "👍" })
        .expect(200);

      // Act - Add second reaction
      const response = await request(app)
        .post(`/api/messages/${messageId}/reactions`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({ emoji: "❤️" })
        .expect(200);

      // Assert
      expect(response.body.reactions).toHaveLength(1);

      // Verify in database
      const updatedMessage = await Message.findById(messageId);
      expect(updatedMessage?.reactions).toHaveLength(1);
      expect(updatedMessage?.reactions.map((r) => r.emoji)).toContain("❤️");
    });

    it("should return 401 when not authenticated", async () => {
      await request(app)
        .post(`/api/messages/${messageId}/reactions`)
        .send({ emoji: "👍" })
        .expect(401);
    });

    it("should return 422 when emoji is missing", async () => {
      await request(app)
        .post(`/api/messages/${messageId}/reactions`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({})
        .expect(422);
    });

    it("should return 404 when message does not exist", async () => {
      const nonExistentId = new mongoose.Types.ObjectId().toString();

      await request(app)
        .post(`/api/messages/${nonExistentId}/reactions`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({ emoji: "👍" })
        .expect(404);
    });
  });

  describe("DELETE /api/messages/:id/reactions/:emoji", () => {
    it("should remove a reaction from a message", async () => {
      // Arrange - Add a reaction first
      await request(app)
        .post(`/api/messages/${messageId}/reactions`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({ emoji: "👍" })
        .expect(200);

      // Act - Remove the reaction
      const response = await request(app)
        .delete(`/api/messages/${messageId}/reactions/👍`)
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      // Assert
      expect(response.body).toHaveProperty("success", true);
      expect(response.body.reactions).toHaveLength(0);

      // Verify in database
      const updatedMessage = await Message.findById(messageId);
      expect(updatedMessage?.reactions).toHaveLength(0);
    });

    it("should only remove the reaction for the requesting user", async () => {
      // Arrange - Create another user and add reactions from both users
      const user2 = await User.create({
        email: "user2@example.com",
        username: "user2",
        passwordHash: "hashedpassword",
        displayName: "User Two",
      });

      const user2Id = user2._id.toString();

      // Manually add reactions for both users
      await Message.findByIdAndUpdate(messageId, {
        $push: {
          reactions: {
            emoji: "👍",
            count: 2,
            users: [
              new mongoose.Types.ObjectId(userId),
              new mongoose.Types.ObjectId(user2Id),
            ],
          },
        },
      });

      // Act - Remove the reaction for the first user
      const response = await request(app)
        .delete(`/api/messages/${messageId}/reactions/👍`)
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      // Assert
      expect(response.body.reactions).toHaveLength(1);
      expect(response.body.reactions[0].count).toBe(1);
      expect(response.body.reactions[0].users).toContain(user2Id);
      expect(response.body.reactions[0].users).not.toContain(userId);

      // Verify in database
      const updatedMessage = await Message.findById(messageId);
      expect(updatedMessage?.reactions).toHaveLength(1);
      expect(updatedMessage?.reactions[0].users).toHaveLength(1);
      expect(updatedMessage?.reactions[0].users[0].toString()).toBe(user2Id);
    });

    it("should return 401 when not authenticated", async () => {
      await request(app)
        .delete(`/api/messages/${messageId}/reactions/👍`)
        .expect(401);
    });

    it("should return 404 when message does not exist", async () => {
      const nonExistentId = new mongoose.Types.ObjectId().toString();

      await request(app)
        .delete(`/api/messages/${nonExistentId}/reactions/👍`)
        .set("Authorization", `Bearer ${authToken}`)
        .expect(404);
    });

    it("should do nothing if the reaction doesn't exist", async () => {
      // Act
      const response = await request(app)
        .delete(`/api/messages/${messageId}/reactions/👍`)
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      // Assert
      expect(response.body).toHaveProperty("success", true);
      expect(response.body.reactions).toHaveLength(0);
    });
  });

  describe("GET /api/messages/:id/reactions", () => {
    it("should get all reactions for a message", async () => {
      // Arrange - Add multiple reactions
      await Message.findByIdAndUpdate(messageId, {
        $push: {
          reactions: [
            {
              emoji: "👍",
              count: 2,
              users: [
                new mongoose.Types.ObjectId(userId),
                new mongoose.Types.ObjectId(),
              ],
            },
            {
              emoji: "❤️",
              count: 1,
              users: [new mongoose.Types.ObjectId()],
            },
          ],
        },
      });

      // Act
      const response = await request(app)
        .get(`/api/messages/${messageId}/reactions`)
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      // Assert
      expect(response.body).toHaveLength(2);
      expect(response.body[0]).toHaveProperty("emoji", "👍");
      expect(response.body[0]).toHaveProperty("count", 2);
      expect(response.body[0].users).toHaveLength(2);
      expect(response.body[1]).toHaveProperty("emoji", "❤️");
      expect(response.body[1]).toHaveProperty("count", 1);
      expect(response.body[1].users).toHaveLength(1);
    });

    it("should return empty array when message has no reactions", async () => {
      // Act
      const response = await request(app)
        .get(`/api/messages/${messageId}/reactions`)
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      // Assert
      expect(response.body).toEqual([]);
    });

    it("should return 401 when not authenticated", async () => {
      await request(app)
        .get(`/api/messages/${messageId}/reactions`)
        .expect(401);
    });

    it("should return 404 when message does not exist", async () => {
      const nonExistentId = new mongoose.Types.ObjectId().toString();

      await request(app)
        .get(`/api/messages/${nonExistentId}/reactions`)
        .set("Authorization", `Bearer ${authToken}`)
        .expect(404);
    });
  });
});
