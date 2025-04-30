import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Server } from "socket.io";
import { io as ioc, Socket as ClientSocket } from "socket.io-client";
import { createServer } from "http";
import { AddressInfo } from "net";
import { initializeSocketServer } from "../../../socket";
import { seedTestUser, loginCredentials } from "../fixtures/auth-fixtures";
import "../setup"; // Import MongoDB test setup
import request from "supertest";
import { createTestApp } from "../../helpers/test-app";
import { User } from "../../../models";
import { authService } from "../../../services/auth.service";
import { Server as HttpServer } from "http";

// Mock the unreadMessagesService to avoid Redis issues
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

describe("Direct Message Socket Integration Tests", () => {
  const app = createTestApp();
  let httpServer: HttpServer;
  let socketServer: Server;
  let clientSocket1: ClientSocket;
  let clientSocket2: ClientSocket;
  let token1: string;
  let token2: string;
  let userId1: string;
  let userId2: string;
  let port: number;

  beforeEach(async () => {
    // Create HTTP server
    httpServer = createServer();

    // Initialize Socket.IO
    socketServer = initializeSocketServer(httpServer);

    // Start server on a random port
    httpServer.listen(0);
    port = (httpServer.address() as AddressInfo).port;

    // Seed users and get tokens
    await seedTestUser();

    const loginResponse1 = await request(app).post("/api/auth/login").send({
      identifier: loginCredentials.valid.email,
      password: loginCredentials.valid.password,
    });

    token1 = loginResponse1.body.token;
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
    token2 = authService.generateToken(user2);

    // Wait a bit for server to be ready
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  afterEach(() => {
    // Clean up
    if (clientSocket1) {
      clientSocket1.disconnect();
    }
    if (clientSocket2) {
      clientSocket2.disconnect();
    }
    if (socketServer) {
      socketServer.close();
    }
    if (httpServer) {
      httpServer.close();
    }
  });

  const connectSocket = (token: string): Promise<ClientSocket> => {
    return new Promise((resolve, reject) => {
      const socket = ioc(`http://localhost:${port}`, {
        auth: { token },
        autoConnect: true,
        reconnection: false,
        forceNew: true,
        transports: ["websocket"],
      });

      socket.on("connect", () => {
        resolve(socket);
      });

      socket.on("connect_error", (err) => {
        reject(err);
      });

      // Set timeout
      setTimeout(() => reject(new Error("Connection timeout")), 2000);
    });
  };

  it("should connect successfully with valid token", async () => {
    clientSocket1 = await connectSocket(token1);
    expect(clientSocket1.connected).toBe(true);
  });

  it("should reject connection with invalid token", async () => {
    await expect(connectSocket("invalid-token")).rejects.toThrow();
  });

  it("should send and receive direct messages", async () => {
    // Connect both users
    clientSocket1 = await connectSocket(token1);
    clientSocket2 = await connectSocket(token2);

    // Set up a promise to receive message on client 2
    const messagePromise = new Promise<any>((resolve) => {
      clientSocket2.on("new_direct_message", (data) => {
        resolve(data);
      });
    });

    // Send message from client 1 to client 2
    await new Promise<void>((resolve, reject) => {
      clientSocket1.emit(
        "send_direct_message",
        {
          receiverId: userId2,
          content: "Hello from socket test",
        },
        (response: any) => {
          if (response && response.success) {
            resolve();
          } else {
            reject(new Error(response?.error || "Failed to send message"));
          }
        },
      );
    });

    // Wait for client 2 to receive the message
    const receivedMessage = await messagePromise;

    // Assertions
    expect(receivedMessage).toBeDefined();
    expect(receivedMessage.message).toBeDefined();
    expect(receivedMessage.directMessage).toBeDefined();
    expect(receivedMessage.message.content).toBe("Hello from socket test");
    expect(receivedMessage.directMessage.participantIds).toContain(userId1);
    expect(receivedMessage.directMessage.participantIds).toContain(userId2);
  });

  it("should send message to existing direct message", async () => {
    // Connect both users
    clientSocket1 = await connectSocket(token1);
    clientSocket2 = await connectSocket(token2);

    // First create a direct message
    const dmResponse = await new Promise<any>((resolve, reject) => {
      clientSocket1.emit(
        "send_direct_message",
        {
          receiverId: userId2,
          content: "First message",
        },
        (response: any) => {
          if (response && response.success) {
            resolve(response);
          } else {
            reject(new Error(response?.error || "Failed to send message"));
          }
        },
      );
    });

    const dmId = dmResponse.directMessage._id;

    // Set up a promise to receive second message on client 2
    const messagePromise = new Promise<any>((resolve) => {
      clientSocket2.on("new_direct_message", (data) => {
        resolve(data);
      });
    });

    // Send second message to the same direct message
    await new Promise<void>((resolve, reject) => {
      clientSocket1.emit(
        "send_direct_message",
        {
          directMessageId: dmId,
          content: "Second message",
        },
        (response: any) => {
          if (response && response.success) {
            resolve();
          } else {
            reject(new Error(response?.error || "Failed to send message"));
          }
        },
      );
    });

    // Wait for client 2 to receive the message
    const receivedMessage = await messagePromise;

    // Assertions
    expect(receivedMessage.message.content).toBe("Second message");
    expect(receivedMessage.directMessage._id).toBe(dmId);
  });

  it("should handle validation errors", async () => {
    // Connect user
    clientSocket1 = await connectSocket(token1);

    // Try to send invalid message (missing content)
    const response = await new Promise((resolve) => {
      clientSocket1.emit(
        "send_direct_message",
        {
          receiverId: userId2,
          // Missing content field
        },
        (response: any) => {
          resolve(response);
        },
      );
    });

    // Assert error response
    expect(response).toHaveProperty("success", false);
    expect(response).toHaveProperty("error");
  });
});
