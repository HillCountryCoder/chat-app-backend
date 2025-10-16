/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Server, Socket } from "socket.io";
import mongoose from "mongoose";
import { messageReactionService } from "../services/message-reaction.service";
import { messageRepository } from "../repositories/message.repository";
import { registerMessageReactionHandlers } from "../socket/message-reaction.handler";

// Mock dependencies
vi.mock("../services/message-reaction.service", () => ({
  messageReactionService: {
    addReaction: vi.fn(),
    removeReaction: vi.fn(),
  },
}));

vi.mock("../repositories/message.repository", () => ({
  messageRepository: {
    findById: vi.fn(),
  },
}));

// Mock ValidationError differently to simulate how it's used in the handler
const mockValidationError = new Error("Validation failed");
mockValidationError.name = "ValidationError";

vi.mock("../common/errors", () => ({
  ErrorHandler: vi.fn().mockImplementation(() => ({
    handleSocketError: vi.fn(),
  })),
  ValidationError: vi.fn().mockImplementation((message) => {
    const error = new Error(message);
    error.name = "ValidationError";
    return error;
  }),
}));

vi.mock("../common/logger", () => ({
  createLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  createSocketLogger: vi.fn().mockReturnValue({
    connection: vi.fn(),
    disconnection: vi.fn(),
    event: vi.fn(),
    error: vi.fn(),
  }),
}));

describe("Message Reaction Socket Handlers", () => {
  let mockIo: Partial<Server>;
  let mockSocket: Partial<Socket>;
  let userId: string;
  let eventHandlers: Record<string, (data: any, callback: (response: any) => void) => void> = {};

  beforeEach(() => {
    vi.clearAllMocks();

    userId = new mongoose.Types.ObjectId().toString();

    // Clear event handlers for fresh test
    eventHandlers = {};

    // Create a proper mock socket with an 'on' method
    mockSocket = {
      id: "socket123",
      emit: vi.fn(),
      join: vi.fn(),
      to: vi.fn().mockReturnThis(),
      on: vi.fn().mockImplementation((event, handler) => {
        eventHandlers[event] = handler;
        return mockSocket;
      }),
    };

    mockIo = {
      to: vi.fn().mockReturnThis(),
      emit: vi.fn(),
    };

    // Reset any handlers from previous tests
    vi.resetModules();
  });

  describe("add_reaction handler", () => {
    it("should add reaction and emit update event for direct message", async () => {
      // Arrange
      const messageId = "message123";
      const emoji = "👍";
      const directMessageId = "dm123";

      const mockCallback = vi.fn();

      const mockMessage = {
        _id: messageId,
        directMessageId,
        reactions: [{ emoji, count: 1, users: [userId] }],
      };

      vi.mocked(messageReactionService.addReaction).mockResolvedValue(
        mockMessage as any,
      );
      vi.mocked(messageRepository.findById).mockResolvedValue(
        mockMessage as any,
      );

      // Act
      registerMessageReactionHandlers(
        mockIo as Server,
        mockSocket as Socket,
        userId,
        "test-tenant"
      );

      // Simulate the socket event
      await eventHandlers["add_reaction"]({ messageId, emoji }, mockCallback);

      // Assert
      expect(messageReactionService.addReaction).toHaveBeenCalledWith(
        messageId,
        userId,
        emoji,
      );
      expect(messageRepository.findById).toHaveBeenCalledWith(messageId);

      expect(mockIo.to).toHaveBeenCalledWith(
        `direct_message:${directMessageId}`,
      );
      expect(mockIo.emit).toHaveBeenCalledWith("message_reaction_updated", {
        messageId,
        reactions: mockMessage.reactions,
      });

      expect(mockCallback).toHaveBeenCalledWith({
        success: true,
        reactions: mockMessage.reactions,
      });
    });

    it("should add reaction and emit update event for channel message", async () => {
      // Arrange
      const messageId = "message123";
      const emoji = "👍";
      const channelId = "channel123";

      const mockCallback = vi.fn();

      const mockMessage = {
        _id: messageId,
        channelId,
        reactions: [{ emoji, count: 1, users: [userId] }],
      };

      vi.mocked(messageReactionService.addReaction).mockResolvedValue(
        mockMessage as any,
      );
      vi.mocked(messageRepository.findById).mockResolvedValue(
        mockMessage as any,
      );

      // Act
      registerMessageReactionHandlers(
        mockIo as Server,
        mockSocket as Socket,
        userId,
        "test-tenant"
      );

      // Simulate the socket event
      await eventHandlers["add_reaction"]({ messageId, emoji }, mockCallback);

      // Assert
      expect(messageReactionService.addReaction).toHaveBeenCalledWith(
        messageId,
        userId,
        emoji,
      );
      expect(messageRepository.findById).toHaveBeenCalledWith(messageId);

      expect(mockIo.to).toHaveBeenCalledWith(`channel:${channelId}`);
      expect(mockIo.emit).toHaveBeenCalledWith("message_reaction_updated", {
        messageId,
        reactions: mockMessage.reactions,
      });

      expect(mockCallback).toHaveBeenCalledWith({
        success: true,
        reactions: mockMessage.reactions,
      });
    });

    it("should handle validation errors", async () => {
      // Arrange
    //   const messageId = "message123";
      // Missing emoji
      const mockCallback = vi.fn();

      // Act
      registerMessageReactionHandlers(
        mockIo as Server,
        mockSocket as Socket,
        userId,
        "test-tenant"
      );

      // Simulate the socket event with missing required data to trigger validation error
      await eventHandlers["add_reaction"](
        { messageId: "message123" },
        mockCallback,
      );

      // Assert
      expect(messageReactionService.addReaction).not.toHaveBeenCalled();
      expect(mockCallback).toHaveBeenCalledWith({
        success: false,
        error: expect.any(String),
      });
    });

    it("should handle service errors", async () => {
      // Arrange
      const messageId = "message123";
      const emoji = "👍";

      const mockCallback = vi.fn();
      const error = new Error("Service error");

      vi.mocked(messageReactionService.addReaction).mockRejectedValue(error);

      // Act
      registerMessageReactionHandlers(
        mockIo as Server,
        mockSocket as Socket,
        userId,
        "test-tenant"
      );

      // Simulate the socket event
      await eventHandlers["add_reaction"]({ messageId, emoji }, mockCallback);

      // Assert
      expect(messageReactionService.addReaction).toHaveBeenCalledWith(
        messageId,
        userId,
        emoji,
      );
      expect(mockCallback).toHaveBeenCalledWith({
        success: false,
        error: "Service error",
      });
    });
  });

  describe("remove_reaction handler", () => {
    it("should remove reaction and emit update event", async () => {
      // Arrange
      const messageId = "message123";
      const emoji = "👍";
      const channelId = "channel123";

      const mockCallback = vi.fn();

      const mockMessage = {
        _id: messageId,
        channelId,
        reactions: [], // No reactions after removal
      };

      vi.mocked(messageReactionService.removeReaction).mockResolvedValue(
        mockMessage as any,
      );
      vi.mocked(messageRepository.findById).mockResolvedValue(
        mockMessage as any,
      );

      // Act
      registerMessageReactionHandlers(
        mockIo as Server,
        mockSocket as Socket,
        userId,
        "test-tenant"
      );

      // Simulate the socket event
      await eventHandlers["remove_reaction"](
        { messageId, emoji },
        mockCallback,
      );

      // Assert
      expect(messageReactionService.removeReaction).toHaveBeenCalledWith(
        messageId,
        userId,
        emoji,
      );
      expect(messageRepository.findById).toHaveBeenCalledWith(messageId);

      expect(mockIo.to).toHaveBeenCalledWith(`channel:${channelId}`);
      expect(mockIo.emit).toHaveBeenCalledWith("message_reaction_updated", {
        messageId,
        reactions: mockMessage.reactions,
      });

      expect(mockCallback).toHaveBeenCalledWith({
        success: true,
        reactions: mockMessage.reactions,
      });
    });

    it("should handle validation errors", async () => {
      // Arrange
      const mockCallback = vi.fn();

      // Act
      registerMessageReactionHandlers(
        mockIo as Server,
        mockSocket as Socket,
        userId,
        "test-tenant"
      );

      // Simulate the socket event with missing required data to trigger validation error
      await eventHandlers["remove_reaction"](
        { messageId: "message123" },
        mockCallback,
      );

      // Assert
      expect(messageReactionService.removeReaction).not.toHaveBeenCalled();
      expect(mockCallback).toHaveBeenCalledWith({
        success: false,
        error: expect.any(String),
      });
    });

    it("should handle service errors", async () => {
      // Arrange
      const messageId = "message123";
      const emoji = "👍";

      const mockCallback = vi.fn();
      const error = new Error("Service error");

      vi.mocked(messageReactionService.removeReaction).mockRejectedValue(error);

      // Act
      registerMessageReactionHandlers(
        mockIo as Server,
        mockSocket as Socket,
        userId,
        "test-tenant"
      );

      // Simulate the socket event
      await eventHandlers["remove_reaction"](
        { messageId, emoji },
        mockCallback,
      );

      // Assert
      expect(messageReactionService.removeReaction).toHaveBeenCalledWith(
        messageId,
        userId,
        emoji,
      );
      expect(mockCallback).toHaveBeenCalledWith({
        success: false,
        error: "Service error",
      });
    });
  });
});
