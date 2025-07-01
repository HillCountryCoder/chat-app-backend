import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { createTestApp } from "../../helpers/test-app";
import "../setup"; // Import the setup file for MongoDB in-memory testing
import { seedTestUser, loginCredentials } from "../fixtures/auth-fixtures";
import { User, DirectMessage, Message } from "../../../models";

// Mock the unreadMessagesService to prevent Redis connection issues
vi.mock("../../../services/unread-messages.service", () => ({
  unreadMessagesService: {
    incrementUnreadCount: vi.fn().mockResolvedValue(undefined),
    markAsRead: vi.fn().mockResolvedValue(undefined),
    getAllUnreadCounts: vi
      .fn()
      .mockResolvedValue({ directMessages: {}, channels: {} }),
    getUnreadCount: vi.fn().mockResolvedValue(0),
    getTotalUnreadCount: vi.fn().mockResolvedValue(0),
  },
}));

describe("Direct Messaging Integration Tests", () => {
  const app = createTestApp();
  let authToken1: string;
  let userId1: string;
  let userId2: string;
  let directMessageId: string;

  beforeEach(async () => {
    // Seed first user and get token
    await seedTestUser();

    const loginResponse1 = await request(app).post("/api/auth/login").send({
      identifier: loginCredentials.valid.email,
      password: loginCredentials.valid.password,
      rememberMe: false,
    });

    authToken1 = loginResponse1.body.accessToken;
    userId1 = loginResponse1.body.user._id;

    // Create and login second user
    const user2 = await User.create({
      email: "user2@example.com",
      username: "user2",
      passwordHash: "Password123!",
      displayName: "User Two",
      status: "offline",
    });

    userId2 = user2._id.toString();

    await request(app).post("/api/auth/login").send({
      identifier: "user2@example.com",
      password: "Password123!",
    });
  });

  describe("Create Direct Message", () => {
    it("should create a new direct message conversation", async () => {
      const response = await request(app)
        .post("/api/direct-messages/messages")
        .set("Authorization", `Bearer ${authToken1}`)
        .send({
          receiverId: userId2,
          content: "Hello, this is a test message",
        })
        .expect(201);

      expect(response.body.message).toBeDefined();
      expect(response.body.directMessage).toBeDefined();
      expect(response.body.message.content).toBe(
        "Hello, this is a test message",
      );

      // Save direct message ID for later tests
      directMessageId = response.body.directMessage._id;

      // Verify in database
      const dm = await DirectMessage.findById(directMessageId);
      expect(dm).not.toBeNull();
      expect(dm?.participantIds).toHaveLength(2);
      expect(dm?.participantIds.map((id) => id.toString())).toContain(userId1);
      expect(dm?.participantIds.map((id) => id.toString())).toContain(userId2);

      // Verify message in database
      const messageId = response.body.message._id;
      const message = await Message.findById(messageId);
      expect(message).not.toBeNull();
      expect(message?.content).toBe("Hello, this is a test message");
    });
  });

  describe("Get Direct Messages", () => {
    it("should list all direct messages for a user", async () => {
      // First create a direct message
      const sendResponse = await request(app)
        .post("/api/direct-messages/messages")
        .set("Authorization", `Bearer ${authToken1}`)
        .send({
          receiverId: userId2,
          content: "Hello, this is a test message",
        });

      // Now get all direct messages
      const response = await request(app)
        .get("/api/direct-messages")
        .set("Authorization", `Bearer ${authToken1}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
      expect(response.body[0]._id).toBe(sendResponse.body.directMessage._id);
    });

    it("should get conversation details by ID", async () => {
      // First create a direct message
      const sendResponse = await request(app)
        .post("/api/direct-messages/messages")
        .set("Authorization", `Bearer ${authToken1}`)
        .send({
          receiverId: userId2,
          content: "Hello, this is a test message",
        });

      const dmId = sendResponse.body.directMessage._id;

      // Now get the direct message by ID
      const response = await request(app)
        .get(`/api/direct-messages/${dmId}`)
        .set("Authorization", `Bearer ${authToken1}`)
        .expect(200);

      expect(response.body._id).toBe(dmId);
      expect(response.body.participantIds).toHaveLength(2);
    });
  });

  describe("Send and Get Messages", () => {
    it("should send and retrieve messages in a conversation", async () => {
      // First create a direct message
      const sendResponse = await request(app)
        .post("/api/direct-messages/messages")
        .set("Authorization", `Bearer ${authToken1}`)
        .send({
          receiverId: userId2,
          content: "First message",
        });

      const dmId = sendResponse.body.directMessage._id;

      // Send a second message
      await request(app)
        .post("/api/direct-messages/messages")
        .set("Authorization", `Bearer ${authToken1}`)
        .send({
          directMessageId: dmId,
          content: "Second message",
        })
        .expect(201);

      // Now get the messages
      const response = await request(app)
        .get(`/api/direct-messages/${dmId}/messages`)
        .set("Authorization", `Bearer ${authToken1}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBe(2);

      // Messages should be in reverse chronological order (newest first)
      expect(response.body[0].content).toBe("Second message");
      expect(response.body[1].content).toBe("First message");
    });

    it("should prevent unauthorized access to messages", async () => {
      // Create a third user who is not part of the conversation
      await User.create({
        email: "user3@example.com",
        username: "user3",
        passwordHash: "Password123!",
        displayName: "User Three",
        status: "offline",
      });

      const loginResponse3 = await request(app).post("/api/auth/login").send({
        identifier: "user3@example.com",
        password: "Password123!",
        rememberMe: false,
      });

      const authToken3 = loginResponse3.body.accessToken;

      // First create a direct message between user1 and user2
      const sendResponse = await request(app)
        .post("/api/direct-messages/messages")
        .set("Authorization", `Bearer ${authToken1}`)
        .send({
          receiverId: userId2,
          content: "Private message",
        });

      const dmId = sendResponse.body.directMessage._id;

      // User3 tries to access messages
      await request(app)
        .get(`/api/direct-messages/${dmId}/messages`)
        .set("Authorization", `Bearer ${authToken3}`)
        .expect(403); // Forbidden
    });
  });

  describe("Pagination and Filtering", () => {
    it("should limit the number of messages returned", async () => {
      // First create a direct message
      const sendResponse = await request(app)
        .post("/api/direct-messages/messages")
        .set("Authorization", `Bearer ${authToken1}`)
        .send({
          receiverId: userId2,
          content: "Message 1",
        });

      const dmId = sendResponse.body.directMessage._id;

      // Send more messages
      await request(app)
        .post("/api/direct-messages/messages")
        .set("Authorization", `Bearer ${authToken1}`)
        .send({
          directMessageId: dmId,
          content: "Message 2",
        });

      await request(app)
        .post("/api/direct-messages/messages")
        .set("Authorization", `Bearer ${authToken1}`)
        .send({
          directMessageId: dmId,
          content: "Message 3",
        });

      // Get with limit
      const response = await request(app)
        .get(`/api/direct-messages/${dmId}/messages?limit=2`)
        .set("Authorization", `Bearer ${authToken1}`)
        .expect(200);

      expect(response.body.length).toBe(2);
      expect(response.body[0].content).toBe("Message 3"); // Latest
      expect(response.body[1].content).toBe("Message 2");
    });
  });
});
