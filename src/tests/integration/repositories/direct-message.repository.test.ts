import { describe, it, expect, beforeEach, afterEach } from "vitest";
import "./../setup"; // Import MongoDB test setup
import mongoose from "mongoose";
import { DirectMessage } from "../../../models";
import { directMessageRepository } from "../../../repositories/direct-message.repository";

describe("DirectMessageRepository", () => {
  let userId1: string;
  let userId2: string;
  let userId3: string;
  let directMessageId: string;

  beforeEach(async () => {
    // Create test user IDs
    userId1 = new mongoose.Types.ObjectId().toString();
    userId2 = new mongoose.Types.ObjectId().toString();
    userId3 = new mongoose.Types.ObjectId().toString();

    const directMessage = await DirectMessage.create({
      participantIds: [userId1, userId2].sort(),
      createdAt: new Date(),
      lastActivity: new Date(),
    });

    directMessageId = directMessage._id.toString();
  });

  afterEach(async () => {
    await DirectMessage.deleteMany({});
  });

  describe("findByParticipants", () => {
    it("should find a direct message between two participants", async () => {
      const dm = await directMessageRepository.findByParticipants(
        userId1,
        userId2,
      );

      expect(dm).not.toBeNull();
      expect(dm?._id.toString()).toBe(directMessageId);
    });
    it("should find the same direct message regardless of parameter order", async () => {
      const dm1 = await directMessageRepository.findByParticipants(
        userId1,
        userId2,
      );
      const dm2 = await directMessageRepository.findByParticipants(
        userId2,
        userId1,
      );

      expect(dm1?._id.toString()).toBe(dm2?._id.toString());
    });

    it("should return null when no direct message exists between participants", async () => {
      const dm = await directMessageRepository.findByParticipants(
        userId1,
        userId3,
      );

      expect(dm).toBeNull();
    });
  });
  describe("findAllByUserId", () => {
    it("should find all direct messages for a user", async () => {
      const dms = await directMessageRepository.findAllByUserId(userId1);

      expect(dms).toHaveLength(1);
      expect(dms[0]._id.toString()).toBe(directMessageId);
    });

    it("should return empty array when user has no direct messages", async () => {
      const dms = await directMessageRepository.findAllByUserId(userId3);

      expect(dms).toEqual([]);
    });
  });
});
