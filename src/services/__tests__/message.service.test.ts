// src/services/__tests__/message.service.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";
import { MessageService } from "../message.service";
import { messageRepository } from "../../repositories/message.repository";
import { NotFoundError } from "../../common/errors";
import mongoose from "mongoose";

// Mock dependencies
vi.mock("../../repositories/message.repository", () => ({
  messageRepository: {
    findById: vi.fn(),
    find: vi.fn(),
  },
}));

vi.mock("../../common/logger", () => ({
  createLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe("MessageService", () => {
  let messageService: MessageService;

  beforeEach(() => {
    vi.clearAllMocks();
    messageService = MessageService.getInstance();
  });

  describe("getMessageByIdOrThrowError", () => {
    it("should return message when found", async () => {
      // Arrange
      const mockMessage = {
        _id: "message123",
        content: "Test message",
        reactions: [],
      };

      vi.mocked(messageRepository.findById).mockResolvedValue(
        mockMessage as any,
      );

      // Act
      const result = await messageService.getMessageByIdOrThrowError(
        "message123",
      );

      // Assert
      expect(result).toEqual(mockMessage);
      expect(messageRepository.findById).toHaveBeenCalledWith("message123");
    });

    it("should throw NotFoundError when message is not found", async () => {
      // Arrange
      vi.mocked(messageRepository.findById).mockResolvedValue(null);

      // Act & Assert
      await expect(
        messageService.getMessageByIdOrThrowError("message123"),
      ).rejects.toThrow(NotFoundError);

      expect(messageRepository.findById).toHaveBeenCalledWith("message123");
    });
  });

  describe("getMessagesByIdsOrThrowError", () => {
    it("should return messages when found", async () => {
      // Arrange
      const mockMessages = [
        { _id: "message1", content: "Test message 1", reactions: [] },
        { _id: "message2", content: "Test message 2", reactions: [] },
      ];

      vi.mocked(messageRepository.find).mockResolvedValue(mockMessages as any);

      // Act
      const result = await messageService.getMessagesByIdsOrThrowError([
        "message1",
        "message2",
      ]);

      // Assert
      expect(result).toEqual(mockMessages);
      expect(messageRepository.find).toHaveBeenCalledWith({
        _id: { $in: ["message1", "message2"] },
      });
    });

    it("should throw NotFoundError when no messages are found", async () => {
      // Arrange
      vi.mocked(messageRepository.find).mockResolvedValue([]);

      // Act & Assert
      await expect(
        messageService.getMessagesByIdsOrThrowError(["message1", "message2"]),
      ).rejects.toThrow(NotFoundError);

      expect(messageRepository.find).toHaveBeenCalledWith({
        _id: { $in: ["message1", "message2"] },
      });
    });
  });

  describe("findReactionByEmoji", () => {
    it("should return reaction when found", () => {
      // Arrange
      const mockReaction = {
        emoji: "👍",
        count: 1,
        users: [new mongoose.Types.ObjectId()],
      };
      const mockMessage = {
        _id: "message123",
        content: "Test message",
        reactions: [mockReaction],
      };

      // Act
      const result = messageService.findReactionByEmoji(
        mockMessage as any,
        "👍",
      );

      // Assert
      expect(result).toEqual(mockReaction);
    });

    it("should throw NotFoundError when reaction is not found", () => {
      // Arrange
      const mockMessage = {
        _id: "message123",
        content: "Test message",
        reactions: [{ emoji: "❤️", count: 1, users: [] }],
      };

      // Act & Assert
      expect(() =>
        messageService.findReactionByEmoji(mockMessage as any, "👍"),
      ).toThrow(NotFoundError);
    });
  });
});
