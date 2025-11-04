// src/socket/middleware/__tests__/auth.middleware.test.ts
import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import { socketAuthMiddleware } from "../auth.middleware";
import { authService } from "../../../services/auth.service";
import { userService } from "../../../services/user.service";
import { UnauthorizedError } from "../../../common/errors";
import mongoose from "mongoose";
import { Socket } from "socket.io";

// Mock services
vi.mock("../../../services/auth.service", () => ({
  authService: {
    verifyToken: vi.fn(),
  },
}));

vi.mock("../../../services/user.service", () => ({
  userService: {
    getUserById: vi.fn(),
  },
}));

vi.mock("../../../common/logger", () => ({
  createLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe("Socket Auth Middleware", () => {
  let mockSocket: Socket;
  let mockNext: Mock;
  let userId: string;
  let username: string;
  let email: string;
  let tenantId: string;

  beforeEach(() => {
    vi.clearAllMocks();

    userId = new mongoose.Types.ObjectId().toString();
    username = "testUser1";
    email = "test@email.com";
    tenantId = "test-tenant";

    mockSocket = {
      handshake: {
        auth: {},
        headers: {},
        query: {},
        time: new Date().toISOString(),
        address: "127.0.0.1",
        xdomain: false,
        secure: false,
        issued: Date.now(),
        url: "/",
      },
      data: {},
    } as Partial<Socket> as Socket;

    mockNext = vi.fn();
  });

  it("should authorize socket with valid token in auth", async () => {
    // Setup
    mockSocket.handshake.auth.token = "valid-token";

    const mockUser = {
      _id: userId,
      lastSeen: new Date(),
      save: vi.fn().mockResolvedValueOnce(undefined),
    };

    vi.mocked(authService.verifyToken).mockReturnValueOnce({
      _id: userId,
      username,
      email,
      tenantId,
    });
    vi.mocked(userService.getUserById).mockResolvedValueOnce(mockUser as any);

    // Execute
    await socketAuthMiddleware(mockSocket, mockNext);

    // Assert
    expect(authService.verifyToken).toHaveBeenCalledWith("valid-token");
    expect(userService.getUserById).toHaveBeenCalledWith(userId);
    expect(mockSocket.data.user).toBe(mockUser);
    expect(mockUser.save).toHaveBeenCalled();
    expect(mockNext).toHaveBeenCalledWith();
  });

  it("should authorize socket with valid token in headers", async () => {
    // Setup
    mockSocket.handshake.headers.authorization = "Bearer valid-token";

    const mockUser = {
      _id: userId,
      lastSeen: new Date(),
      save: vi.fn().mockResolvedValueOnce(undefined),
    };

    vi.mocked(authService.verifyToken).mockReturnValueOnce({
      _id: userId,
      username,
      email,
      tenantId,
    });
    vi.mocked(userService.getUserById).mockResolvedValueOnce(mockUser as any);

    // Execute
    await socketAuthMiddleware(mockSocket, mockNext);

    // Assert
    expect(authService.verifyToken).toHaveBeenCalledWith("valid-token");
    expect(mockNext).toHaveBeenCalledWith();
  });

  it("should authorize socket with valid token in query", async () => {
    // Setup
    mockSocket.handshake.query.token = "valid-token";

    const mockUser = {
      _id: userId,
      lastSeen: new Date(),
      save: vi.fn().mockResolvedValueOnce(undefined),
    };

    vi.mocked(authService.verifyToken).mockReturnValueOnce({
      _id: userId,
      username,
      email,
      tenantId,
    });
    vi.mocked(userService.getUserById).mockResolvedValueOnce(mockUser as any);

    // Execute
    await socketAuthMiddleware(mockSocket, mockNext);

    // Assert
    expect(authService.verifyToken).toHaveBeenCalledWith("valid-token");
    expect(mockNext).toHaveBeenCalledWith();
  });

  it("should reject socket with missing token", async () => {
    // Execute
    await socketAuthMiddleware(mockSocket, mockNext);

    // Assert
    expect(mockNext).toHaveBeenCalledWith(expect.any(UnauthorizedError));
    expect(mockNext.mock.calls[0][0].message).toContain("missing");
  });

  it("should reject socket with invalid token", async () => {
    // Setup
    mockSocket.handshake.auth.token = "invalid-token";

    vi.mocked(authService.verifyToken).mockImplementationOnce(() => {
      throw new UnauthorizedError("Invalid token");
    });

    // Execute
    await socketAuthMiddleware(mockSocket, mockNext);

    // Assert
    expect(mockNext).toHaveBeenCalledWith(expect.any(UnauthorizedError));
  });

  it("should reject socket when user not found", async () => {
    // Setup
    mockSocket.handshake.auth.token = "valid-token";

    vi.mocked(authService.verifyToken).mockReturnValueOnce({
      _id: userId,
      username,
      email,
      tenantId,
    });
    vi.mocked(userService.getUserById).mockImplementationOnce(() => {
      throw new Error("User not found");
    });

    // Execute
    await socketAuthMiddleware(mockSocket, mockNext);

    // Assert
    expect(mockNext).toHaveBeenCalledWith(expect.any(UnauthorizedError));
  });
});
