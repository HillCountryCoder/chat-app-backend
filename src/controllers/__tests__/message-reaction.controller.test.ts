import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import { MessageReactionController } from "../message-reaction.controller";
import { messageReactionService } from "../../services/message-reaction.service";
import { Response } from "express";
import { AuthenticatedRequest } from "../../common/types/auth.type";
import { ValidationError, UnauthorizedError } from "../../common/errors";
import mongoose from "mongoose";
import { Reaction } from "../../models";

vi.mock("../../services/message-reaction.service", () => ({
  messageReactionService: {
    addReaction: vi.fn(),
    removeReaction: vi.fn(),
    getReactions: vi.fn(),
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

describe("MessageReactionController", () => {
  let mockRequest: Partial<AuthenticatedRequest>;
  let mockResponse: Partial<Response>;
  let nextFunction: Mock;
  const messageId = "message123";
  const userId = "67d3d995d6a7946dc1cf1340";
  const emoji = "👍";

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequest = {
      params: { id: messageId, emoji },
      body: { emoji },
      user: {
        _id: new mongoose.Types.ObjectId(userId),
      } as any,
    };

    mockResponse = {
      json: vi.fn().mockReturnThis(),
      status: vi.fn().mockReturnThis(),
    };

    nextFunction = vi.fn();
  });

  describe("addReaction", () => {
    it("should add reaction and return success response", async () => {
      const mockReactions = [{ emoji, count: 1, users: [userId] }];
      const mockMessage = {
        _id: messageId,
        content: "Test message",
        reactions: mockReactions,
      };

      vi.mocked(messageReactionService.addReaction).mockResolvedValue(
        mockMessage as any,
      );

      await MessageReactionController.addReaction(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response,
        nextFunction,
      );

      expect(messageReactionService.addReaction).toHaveBeenCalledWith(
        messageId,
        userId,
        emoji,
      );
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: true,
        reactions: mockReactions,
      });
      expect(nextFunction).not.toHaveBeenCalled();
    });
    it("should handle validation errors", async () => {
      // Arrange
      mockRequest.body = {}; // Missing emoji

      // Act
      await MessageReactionController.addReaction(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response,
        nextFunction,
      );

      // Assert
      expect(nextFunction).toHaveBeenCalledWith(expect.any(ValidationError));
      expect(messageReactionService.addReaction).not.toHaveBeenCalled();
    });
    it("should handle unauthorized errors", async () => {
      // Arrange
      mockRequest.user = undefined;

      // Act
      await MessageReactionController.addReaction(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response,
        nextFunction,
      );

      // Assert
      expect(nextFunction).toHaveBeenCalledWith(expect.any(UnauthorizedError));
      expect(messageReactionService.addReaction).not.toHaveBeenCalled();
    });

    it("should handle service errors", async () => {
      // Arrange
      const error = new Error("Service error");
      vi.mocked(messageReactionService.addReaction).mockRejectedValue(error);

      // Act
      await MessageReactionController.addReaction(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response,
        nextFunction,
      );

      // Assert
      expect(nextFunction).toHaveBeenCalledWith(error);
    });
  });
  describe("removeReaction", () => {
    it("should remove reaction and return success response", async () => {
      // Arrange
      const mockReactions: Reaction[] = [];
      const mockMessage = {
        _id: messageId,
        content: "Test message",
        reactions: mockReactions,
      };

      vi.mocked(messageReactionService.removeReaction).mockResolvedValue(
        mockMessage as any,
      );

      // Act
      await MessageReactionController.removeReaction(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response,
        nextFunction,
      );

      // Assert
      expect(messageReactionService.removeReaction).toHaveBeenCalledWith(
        messageId,
        userId,
        emoji,
      );
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: true,
        reactions: mockReactions,
      });
      expect(nextFunction).not.toHaveBeenCalled();
    });

    it("should handle unauthorized errors", async () => {
      // Arrange
      mockRequest.user = undefined;

      // Act
      await MessageReactionController.removeReaction(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response,
        nextFunction,
      );

      // Assert
      expect(nextFunction).toHaveBeenCalledWith(expect.any(UnauthorizedError));
      expect(messageReactionService.removeReaction).not.toHaveBeenCalled();
    });

    it("should handle service errors", async () => {
      // Arrange
      const error = new Error("Service error");
      vi.mocked(messageReactionService.removeReaction).mockRejectedValue(error);

      // Act
      await MessageReactionController.removeReaction(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response,
        nextFunction,
      );

      // Assert
      expect(nextFunction).toHaveBeenCalledWith(error);
    });
  });

  describe("getReactions", () => {
    it("should return reactions for a message", async () => {
      // Arrange
      const mockReactions = [
        { emoji: "👍", count: 2, users: [userId, "user456"] },
        { emoji: "❤️", count: 1, users: ["user789"] },
      ];

      vi.mocked(messageReactionService.getReactions).mockResolvedValue(
        mockReactions as any,
      );

      // Act
      await MessageReactionController.getReactions(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response,
        nextFunction,
      );

      // Assert
      expect(messageReactionService.getReactions).toHaveBeenCalledWith(
        messageId,
      );
      expect(mockResponse.json).toHaveBeenCalledWith(mockReactions);
      expect(nextFunction).not.toHaveBeenCalled();
    });

    it("should handle service errors", async () => {
      // Arrange
      const error = new Error("Service error");
      vi.mocked(messageReactionService.getReactions).mockRejectedValue(error);

      // Act
      await MessageReactionController.getReactions(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response,
        nextFunction,
      );

      // Assert
      expect(nextFunction).toHaveBeenCalledWith(error);
    });
  });
});
