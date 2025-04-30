/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import "../../../tests/integration/setup"; // Import MongoDB test setup
import mongoose from "mongoose";
import { messageRepository } from "../../../repositories/message.repository";
import { ContentType, Message, MessageInterface, User } from "../../../models";

describe("MessageRepository", () => {
  let messageId1: string;
  let messageId2: string;
  let userId: string;
  let userDoc: any;
  let directMessageId: string;

  beforeEach(async () => {
    // Create actual test user first
    userDoc = await User.create({
      email: "test@example.com",
      username: "testuser",
      passwordHash: "hashedpassword",
      displayName: "Test User",
      status: "offline",
    });

    userId = userDoc._id.toString();
    directMessageId = new mongoose.Types.ObjectId().toString();

    // Create test messages with reference to real user
    const message1: MessageInterface = await Message.create({
      messageId: `${Date.now()}_1`,
      senderId: userDoc._id, // Use the actual user document ID
      directMessageId,
      content: "Test message 1",
      contentType: ContentType.TEXT,
      createdAt: new Date(Date.now() - 1000), // 1 second ago
    });

    const message2 = await Message.create({
      messageId: `${Date.now()}_2`,
      senderId: userDoc._id, // Use the actual user document ID
      directMessageId,
      content: "Test message 2",
      contentType: ContentType.TEXT,
      createdAt: new Date(), // now
    });

    messageId1 = message1._id.toString();
    messageId2 = message2._id.toString();
  });

  afterEach(async () => {
    await Message.deleteMany({});
    await User.deleteMany({});
  });

  describe("findByDirectMessageId", () => {
    it("should return messages for a direct message", async () => {
      const messages = await messageRepository.findByDirectMessageId(
        directMessageId,
      );

      expect(messages).toHaveLength(2);
      expect(messages[0].content).toBe("Test message 2"); // Most recent first
      expect(messages[1].content).toBe("Test message 1");
    });

    it("should limit results when limit option is provided", async () => {
      const messages = await messageRepository.findByDirectMessageId(
        directMessageId,
        { limit: 1 },
      );

      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe("Test message 2"); // Most recent
    });

    it("should filter messages by date when before option is provided", async () => {
      const messages = await messageRepository.findByDirectMessageId(
        directMessageId,
        {
          before: new Date().toISOString(),
        },
      );

      expect(messages).toHaveLength(2);
    });
  });

  describe("createMessage", () => {
    it("should create a new message", async () => {
      const newMessage = await messageRepository.createMessage({
        messageId: `${Date.now()}_3`,
        senderId: userId,
        directMessageId,
        content: "New test message",
        contentType: ContentType.TEXT,
      });

      expect(newMessage).toBeDefined();
      expect(newMessage.content).toBe("New test message");

      // Verify it's in the database
      const found = await Message.findById(newMessage._id);
      expect(found).not.toBeNull();
    });
  });
});
