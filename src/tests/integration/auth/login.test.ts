import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createTestApp } from "../../helpers/test-app";
import "../setup"; // Import the setup file for MongoDB in-memory testing
import { loginCredentials, seedTestUser } from "../fixtures/auth-fixtures";
import { User } from "../../../models";

describe("User Login Integration", () => {
  const app = createTestApp();

  beforeEach(async () => {
    // Seed a test user for login testing
    await seedTestUser();
  });

  it("should login successfully with valid email and password", async () => {
    const response = await request(app)
      .post("/api/auth/login")
      .send({
        identifier: loginCredentials.valid.email,
        password: loginCredentials.valid.password,
        rememberMe: false,
      })
      .expect(200);

    // Verify response structure
    expect(response.body).toHaveProperty("success", true);
    expect(response.body).toHaveProperty("message", "Login successful");
    expect(response.body).toHaveProperty("user");
    expect(response.body).toHaveProperty("accessToken"); // CHANGED: from "token" to "accessToken"
    expect(response.body).toHaveProperty("refreshToken"); // ADD: Check for refresh token
    expect(response.body).toHaveProperty("expiresIn");
    // Verify the lastSeen timestamp was updated
    expect(response.body.user.email).toBe(loginCredentials.valid.email);

    // Verify token structure
    expect(typeof response.body.accessToken).toBe("string");
    expect(typeof response.body.refreshToken).toBe("string");
    expect(response.body.expiresIn).toBe("7d"); // Should be 7 days for rememberMe: false

    // Verify the lastSeen timestamp was updated
    const user = await User.findOne({ email: loginCredentials.valid.email });
    const fiveSecondsAgo = new Date(Date.now() - 5000);
    expect(user!.lastSeen).toBeInstanceOf(Date);
    expect(user!.lastSeen > fiveSecondsAgo).toBe(true);
  });

  it("should login successfully with valid username and password", async () => {
    const response = await request(app)
      .post("/api/auth/login")
      .send({
        identifier: loginCredentials.validUsername.username,
        password: loginCredentials.validUsername.password,
        rememberMe: false,
      })
      .expect(200);

    // Verify response structure
    expect(response.body).toHaveProperty("success", true);
    expect(response.body).toHaveProperty("message", "Login successful");
    expect(response.body).toHaveProperty("user");
    expect(response.body).toHaveProperty("accessToken"); // CHANGED: from "token" to "accessToken"
    expect(response.body).toHaveProperty("refreshToken"); // ADD: Check for refresh token
    expect(response.body).toHaveProperty("expiresIn"); // ADD: Check for expiration

    // Verify user data
    expect(response.body.user.username).toBe(
      loginCredentials.validUsername.username,
    );

    // Verify token structure
    expect(typeof response.body.accessToken).toBe("string");
    expect(typeof response.body.refreshToken).toBe("string");
    expect(response.body.expiresIn).toBe("7d");
  });

  it("should return 404 with non-existent email", async () => {
    const response = await request(app)
      .post("/api/auth/login")
      .send({
        identifier: loginCredentials.invalidEmail.email,
        password: loginCredentials.invalidEmail.password,
      })
      .expect(404);

    expect(response.body).toHaveProperty("code", "NOT_FOUND");
  });

  it("should return 401 with incorrect password", async () => {
    const response = await request(app)
      .post("/api/auth/login")
      .send({
        identifier: loginCredentials.invalidPassword.email,
        password: loginCredentials.invalidPassword.password,
      })
      .expect(401);

    expect(response.body).toHaveProperty("code", "UNAUTHORIZED");
    expect(response.body.message).toContain("Invalid credentials");
  });

  it("should return 422 with invalid data format", async () => {
    const response = await request(app)
      .post("/api/auth/login")
      .send({ invalid: "data" })
      .expect(422);

    expect(response.body).toHaveProperty("code", "VALIDATION_ERROR");
  });
});
