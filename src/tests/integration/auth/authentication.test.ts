import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createTestApp } from "../../helpers/test-app";
import "../setup"; // Import the setup file for MongoDB in-memory testing
import { loginCredentials, seedTestUser } from "../fixtures/auth-fixtures";
import jwt from "jsonwebtoken";
import { env } from "../../../common/environment";

describe("Authentication Middleware Integration", () => {
  const app = createTestApp();
  let authToken: string;

  beforeEach(async () => {
    // Seed a test user
    await seedTestUser();

    // Login to get a valid token
    const loginResponse = await request(app)
      .post("/api/auth/login")
      .send(loginCredentials.valid);

    authToken = loginResponse.body.token;
  });

  it("should allow access to protected routes with valid token", async () => {
    const response = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);

    expect(response.body).toHaveProperty("user");
    expect(response.body.user.email).toBe(loginCredentials.valid.email);
  });

  it("should deny access to protected routes without token", async () => {
    const response = await request(app).get("/api/auth/me").expect(401);

    expect(response.body).toHaveProperty("code", "UNAUTHORIZED");
    expect(response.body.message).toContain("header missing or invalid");
  });

  it("should deny access with invalid token format", async () => {
    const response = await request(app)
      .get("/api/auth/me")
      .set("Authorization", "InvalidFormat")
      .expect(401);

    expect(response.body).toHaveProperty("code", "UNAUTHORIZED");
  });

  it("should deny access with expired token", async () => {
    // Create an expired token
    const expiredToken = jwt.sign(
      { _id: "123456789012", email: loginCredentials.valid.email },
      env.JWT_SECRET,
      { expiresIn: "0s" }, // Expire immediately
    );

    // Wait a moment to ensure expiration
    await new Promise((resolve) => setTimeout(resolve, 10));

    const response = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${expiredToken}`)
      .expect(401);

    expect(response.body).toHaveProperty("code", "UNAUTHORIZED");
  });

  it("should deny access with tampered token", async () => {
    // Create a tampered token by modifying a character
    const tamperedToken =
      authToken.substring(0, authToken.length - 5) + "TAMPER";

    const response = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${tamperedToken}`)
      .expect(401);

    expect(response.body).toHaveProperty("code", "UNAUTHORIZED");
  });
});
