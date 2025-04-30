import { describe, it, expect, vi, beforeEach } from "vitest";
import { MessageReactionService } from "../message-reaction.service";
import { messageService } from "../message.service";
import { NotFoundError } from "../../common/errors";
import mongoose from "mongoose";

// Mock dependencies
vi.mock("../message.service", () => ({
  messageService: {
    getMessageByIdOrThrowError: vi.fn(),
    findReactionByEmoji: vi.fn(),
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

describe("MessageReactionService", () => {
  let messageReactionService: MessageReactionService;

  beforeEach(() => {
    vi.clearAllMocks();
    messageReactionService = MessageReactionService.getInstance();
  });

  describe("addReaction", () => {
    it("should add a new reaction when emoji doesn't exist", async () => {
      // Arrange
      const messageId = "message123";
      const userId = "user123";
      const emoji = "👍";

      const mockMessage = {
        _id: messageId,
        content: "Test message",
        reactions: [],
        save: vi.fn().mockResolvedValue(true),
      };

      vi.mocked(messageService.getMessageByIdOrThrowError).mockResolvedValue(
        mockMessage as any,
      );
      vi.mocked(messageService.findReactionByEmoji).mockImplementation(() => {
        throw new NotFoundError("reaction");
      });

      // Act
      const result = await messageReactionService.addReaction(
        messageId,
        userId,
        emoji,
      );

      // Assert
      expect(result).toBe(mockMessage);
      expect(mockMessage.reactions).toEqual([
        {
          emoji: "👍",
          count: 1,
          users: [expect.any(mongoose.Types.ObjectId)],
        },
      ]);
      expect(mockMessage.save).toHaveBeenCalled();
    });

    it("should add user to existing reaction", async () => {
      // Arrange
      const messageId = "message123";
      const userId = "user123";
      const emoji = "👍";
      const existingUserId = new mongoose.Types.ObjectId();

      const mockReaction = {
        emoji,
        count: 1,
        users: [existingUserId],
      };

      const mockMessage = {
        _id: messageId,
        content: "Test message",
        reactions: [mockReaction],
        save: vi.fn().mockResolvedValue(true),
      };

      vi.mocked(messageService.getMessageByIdOrThrowError).mockResolvedValue(
        mockMessage as any,
      );
      vi.mocked(messageService.findReactionByEmoji).mockReturnValue(
        mockReaction as any,
      );

      // Act
      const result = await messageReactionService.addReaction(
        messageId,
        userId,
        emoji,
      );

      // Assert
      expect(result).toBe(mockMessage);
      expect(mockReaction.users.length).toBe(2);
      expect(mockReaction.count).toBe(2);
      expect(mockMessage.save).toHaveBeenCalled();
    });

    it("should do nothing if user already reacted with this emoji", async () => {
      // Arrange
      const messageId = "message123";
      const userId = "67d3d995d6a7946dc1cf1340";
      const emoji = "👍";
      const userObjectId = new mongoose.Types.ObjectId(userId);

      const mockReaction = {
        emoji,
        count: 1,
        users: [userObjectId],
      };

      const mockMessage = {
        _id: messageId,
        content: "Test message",
        reactions: [mockReaction],
        save: vi.fn().mockResolvedValue(true),
      };

      vi.mocked(messageService.getMessageByIdOrThrowError).mockResolvedValue(
        mockMessage as any,
      );
      // Mock findReactionByEmoji to return the existing reaction
      vi.mocked(messageService.findReactionByEmoji).mockReturnValue(
        mockReaction as any,
      );

      // Act
      const result = await messageReactionService.addReaction(
        messageId,
        userId,
        emoji,
      );

      // Assert
      expect(result).toBe(mockMessage);
      expect(mockMessage.save).not.toHaveBeenCalled();
      expect(mockReaction.users.length).toBe(1);
      expect(mockReaction.count).toBe(1);
    });
  });

  describe("removeReaction", () => {
    it("should remove user from reaction", async () => {
      // Arrange
      const messageId = "message123";
      const userId = "67d3d995d6a7946dc1cf1340";
      const emoji = "👍";
      const userObjectId = new mongoose.Types.ObjectId(userId);
      const otherUserId = new mongoose.Types.ObjectId();

      const mockReaction = {
        emoji,
        count: 2,
        users: [userObjectId, otherUserId],
      };

      const mockMessage = {
        _id: messageId,
        content: "Test message",
        reactions: [mockReaction],
        save: vi.fn().mockResolvedValue(true),
      };

      vi.mocked(messageService.getMessageByIdOrThrowError).mockResolvedValue(
        mockMessage as any,
      );
      vi.mocked(messageService.findReactionByEmoji).mockReturnValue(
        mockReaction as any,
      );

      // Act
      const result = await messageReactionService.removeReaction(
        messageId,
        userId,
        emoji,
      );

      // Assert
      expect(result).toBe(mockMessage);
      expect(mockReaction.users.length).toBe(1);
      expect(mockReaction.count).toBe(1);
      expect(mockMessage.save).toHaveBeenCalled();
    });

    it("should remove reaction entirely when no users left", async () => {
      // Arrange
      const messageId = "message123";
      const userId = "67d3d995d6a7946dc1cf1340";
      const emoji = "👍";
      const userObjectId = new mongoose.Types.ObjectId(userId);

      const mockReaction = {
        emoji,
        count: 1,
        users: [userObjectId],
      };

      const mockMessage = {
        _id: messageId,
        content: "Test message",
        reactions: [mockReaction],
        save: vi.fn().mockResolvedValue(true),
      };

      vi.mocked(messageService.getMessageByIdOrThrowError).mockResolvedValue(
        mockMessage as any,
      );
      vi.mocked(messageService.findReactionByEmoji).mockReturnValue(
        mockReaction as any,
      );

      // Act
      const result = await messageReactionService.removeReaction(
        messageId,
        userId,
        emoji,
      );

      // Assert
      expect(result).toBe(mockMessage);
      expect(result.reactions).toEqual([]);
      expect(mockMessage.save).toHaveBeenCalled();
    });

    it("should do nothing if reaction not found", async () => {
      // Arrange
      const messageId = "message123";
      const userId = "67d3d995d6a7946dc1cf1340";
      const emoji = "👍";

      const mockMessage = {
        _id: messageId,
        content: "Test message",
        reactions: [],
        save: vi.fn().mockResolvedValue(true),
      };

      vi.mocked(messageService.getMessageByIdOrThrowError).mockResolvedValue(
        mockMessage as any,
      );
      vi.mocked(messageService.findReactionByEmoji).mockImplementation(() => {
        throw new NotFoundError("reaction");
      });

      // Act
      const result = await messageReactionService.removeReaction(
        messageId,
        userId,
        emoji,
      );

      // Assert
      expect(result).toBe(mockMessage);
      expect(mockMessage.save).not.toHaveBeenCalled();
    });

    it("should do nothing if user didn't react", async () => {
      // Arrange
      const messageId = "message123";
      const userId = "user123";
      const emoji = "👍";
      const otherUserId = new mongoose.Types.ObjectId();

      const mockReaction = {
        emoji,
        count: 1,
        users: [otherUserId],
      };

      const mockMessage = {
        _id: messageId,
        content: "Test message",
        reactions: [mockReaction],
        save: vi.fn().mockResolvedValue(true),
      };

      vi.mocked(messageService.getMessageByIdOrThrowError).mockResolvedValue(
        mockMessage as any,
      );
      vi.mocked(messageService.findReactionByEmoji).mockReturnValue(
        mockReaction as any,
      );

      // Act
      const result = await messageReactionService.removeReaction(
        messageId,
        userId,
        emoji,
      );

      // Assert
      expect(result).toBe(mockMessage);
      expect(mockReaction.users.length).toBe(1);
      expect(mockReaction.count).toBe(1);
      expect(mockMessage.save).not.toHaveBeenCalled();
    });
  });

  describe("getReactions", () => {
    it("should return all reactions for a message", async () => {
      // Arrange
      const messageId = "message123";
      const mockReactions = [
        {
          emoji: "👍",
          count: 2,
          users: [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()],
        },
        { emoji: "❤️", count: 1, users: [new mongoose.Types.ObjectId()] },
      ];

      const mockMessage = {
        _id: messageId,
        content: "Test message",
        reactions: mockReactions,
      };

      vi.mocked(messageService.getMessageByIdOrThrowError).mockResolvedValue(
        mockMessage as any,
      );

      // Act
      const result = await messageReactionService.getReactions(messageId);

      // Assert
      expect(result).toEqual(mockReactions);
    });

    it("should throw NotFoundError when message not found", async () => {
      // Arrange
      const messageId = "message123";

      vi.mocked(messageService.getMessageByIdOrThrowError).mockImplementation(
        () => {
          throw new NotFoundError("message");
        },
      );

      // Act & Assert
      await expect(
        messageReactionService.getReactions(messageId),
      ).rejects.toThrow(NotFoundError);
    });
  });
});
