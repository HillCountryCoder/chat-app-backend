import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createTestApp } from "../../helpers/test-app";
import "../setup"; // Import the setup file for MongoDB in-memory testing
import { loginCredentials, seedTestUser } from "../fixtures/auth-fixtures";
import * as jwt from "jsonwebtoken";
import { env } from "../../../common/environment";

describe("Authentication Middleware Integration", () => {
  const app = createTestApp();
  let authToken: string;

  beforeEach(async () => {
    // Seed a test user
    await seedTestUser();

    // Login to get a valid token
    const loginResponse = await request(app).post("/api/auth/login").send({
      identifier: loginCredentials.valid.email,
      password: loginCredentials.valid.password,
      rememberMe: false, // ADD: Include rememberMe field
    });

    // FIXED: Extract correct token property
    authToken = loginResponse.body.accessToken; // CHANGED: from 'token' to 'accessToken'
    
    // Debug log to ensure token is extracted
    console.log('Login response body:', loginResponse.body);
    console.log('Extracted authToken:', authToken);
  });

  it("should allow access to protected routes with valid token", async () => {
    // Ensure we have a valid token
    expect(authToken).toBeDefined();
    expect(typeof authToken).toBe("string");
    expect(authToken.length).toBeGreaterThan(0);

    const response = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);

    // UPDATED: Check correct response structure
    expect(response.body).toHaveProperty("success", true);
    expect(response.body).toHaveProperty("user");
    expect(response.body.user.email).toBe(loginCredentials.valid.email);
    expect(response.body.user).toHaveProperty("_id");
    expect(response.body.user).toHaveProperty("username");
  });

  it("should deny access to protected routes without token", async () => {
    const response = await request(app).get("/api/auth/me").expect(401);

    expect(response.body).toHaveProperty("code", "UNAUTHORIZED");
    // UPDATED: Check actual error message from middleware
    expect(response.body.message).toContain("Access token is required");
  });

  it("should deny access with invalid token format", async () => {
    const response = await request(app)
      .get("/api/auth/me")
      .set("Authorization", "InvalidFormat") // Missing "Bearer " prefix
      .expect(401);

    expect(response.body).toHaveProperty("code", "UNAUTHORIZED");
    expect(response.body.message).toContain("Access token is required");
  });

  it("should deny access with malformed Authorization header", async () => {
    const response = await request(app)
      .get("/api/auth/me")
      .set("Authorization", "Bearer") // Missing token part
      .expect(401);

    expect(response.body).toHaveProperty("code", "UNAUTHORIZED");
    expect(response.body.message).toContain("Access token is required");
  });

  it("should deny access with expired token", async () => {
    // Create an expired token with proper payload structure
    const expiredToken = jwt.sign(
      { 
        _id: "123456789012", 
        email: loginCredentials.valid.email,
        username: "testuser"
      },
      env.JWT_SECRET,
      { 
        expiresIn: "0s", // Expire immediately
        issuer: "chat-app",
        audience: "chat-app-users"
      }
    );

    // Wait a moment to ensure expiration
    await new Promise((resolve) => setTimeout(resolve, 100));

    const response = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${expiredToken}`)
      .expect(401);

    expect(response.body).toHaveProperty("code", "UNAUTHORIZED");
    expect(response.body.message).toContain("Invalid token");
  });

  it("should deny access with tampered token", async () => {
    // Ensure we have a valid token first
    expect(authToken).toBeDefined();
    expect(typeof authToken).toBe("string");
    
    // FIXED: Add safety check for undefined token
    if (!authToken || authToken.length < 10) {
      throw new Error("authToken is undefined or too short for tampering test");
    }

    // Create a tampered token by modifying a character
    const tamperedToken =
      authToken.substring(0, authToken.length - 5) + "TAMPER";

    const response = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${tamperedToken}`)
      .expect(401);

    expect(response.body).toHaveProperty("code", "UNAUTHORIZED");
    expect(response.body.message).toContain("Invalid token");
  });

  it("should deny access with token signed by wrong secret", async () => {
    // Create a token with wrong secret
    const wrongSecretToken = jwt.sign(
      { 
        _id: "123456789012", 
        email: loginCredentials.valid.email,
        username: "testuser"
      },
      "wrong-secret", // Wrong secret
      { 
        expiresIn: "1h",
        issuer: "chat-app",
        audience: "chat-app-users"
      }
    );

    const response = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${wrongSecretToken}`)
      .expect(401);

    expect(response.body).toHaveProperty("code", "UNAUTHORIZED");
    expect(response.body.message).toContain("Invalid token");
  });

  it("should deny access with token for non-existent user", async () => {
    // Create a valid token but for a user that doesn't exist in the database
    const nonExistentUserToken = jwt.sign(
      { 
        _id: "507f1f77bcf86cd799439011", // Valid ObjectId but non-existent user
        email: "nonexistent@example.com",
        username: "nonexistent"
      },
      env.JWT_SECRET,
      { 
        expiresIn: "1h",
        issuer: "chat-app",
        audience: "chat-app-users"
      }
    );

    const response = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${nonExistentUserToken}`)
      .expect(401);

    expect(response.body).toHaveProperty("code", "UNAUTHORIZED");
    // This might be "Authentication failed" or "User not found" depending on your middleware
  });

  it("should handle token refresh flow", async () => {
    // First, get both access and refresh tokens
    const loginResponse = await request(app).post("/api/auth/login").send({
      identifier: loginCredentials.valid.email,
      password: loginCredentials.valid.password,
      rememberMe: false,
    });

    expect(loginResponse.body).toHaveProperty("accessToken");
    expect(loginResponse.body).toHaveProperty("refreshToken");

    const { accessToken, refreshToken } = loginResponse.body;

    // Use the access token for a protected route
    const protectedResponse = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);

    expect(protectedResponse.body).toHaveProperty("success", true);
    expect(protectedResponse.body).toHaveProperty("user");

    // Test token refresh
    const refreshResponse = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken })
      .expect(200);

    expect(refreshResponse.body).toHaveProperty("success", true);
    expect(refreshResponse.body).toHaveProperty("accessToken");
    expect(refreshResponse.body).toHaveProperty("refreshToken");

    // Use the new access token
    const newAccessToken = refreshResponse.body.accessToken;
    const newProtectedResponse = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${newAccessToken}`)
      .expect(200);

    expect(newProtectedResponse.body).toHaveProperty("success", true);
  });

  it("should handle logout and token invalidation", async () => {
    // Get tokens from login
    const loginResponse = await request(app).post("/api/auth/login").send({
      identifier: loginCredentials.valid.email,
      password: loginCredentials.valid.password,
      rememberMe: false,
    });

    const { accessToken, refreshToken } = loginResponse.body;

    // Verify access token works
    await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);

    // Logout with refresh token
    await request(app)
      .post("/api/auth/logout")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ refreshToken })
      .expect(200);

    // Try to use the refresh token after logout (should fail)
    await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken })
      .expect(401);
  });
});