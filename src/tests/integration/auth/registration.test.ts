import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createTestApp } from "../../helpers/test-app";
import "../setup"; // Import the setup file for MongoDB in-memory testing
import { testUsers, seedTestUser } from "../fixtures/auth-fixtures";
import { User } from "../../../models";

describe("User Registration Integration", () => {
  const app = createTestApp();

  beforeEach(async () => {
    await seedTestUser();
  });

  it("should register a new user successfully", async () => {
    // Act
    const response = await request(app)
      .post("/api/auth/register")
      .send(testUsers.valid)
      .expect(201);

    // UPDATED: Assert new response structure
    expect(response.body).toHaveProperty("success", true);
    expect(response.body).toHaveProperty(
      "message",
      "User registered successfully",
    );
    expect(response.body).toHaveProperty("user");
    expect(response.body).toHaveProperty("accessToken"); // CHANGED: from "access_token"
    expect(response.body).toHaveProperty("refreshToken"); // ADD: Check for refresh token
    expect(response.body).toHaveProperty("expiresIn"); // ADD: Check for expiration

    // Verify user data
    expect(response.body.user).toHaveProperty("_id");
    expect(response.body.user.email).toBe(testUsers.valid.email);
    expect(response.body.user.username).toBe(testUsers.valid.username);
    expect(response.body.user).toHaveProperty("displayName");

    // Verify token structure
    expect(typeof response.body.accessToken).toBe("string");
    expect(typeof response.body.refreshToken).toBe("string");
    expect(response.body.expiresIn).toBe("7d"); // Should be 7 days for rememberMe: false

    // Verify user was created in database
    const user = await User.findOne({ email: testUsers.valid.email });
    expect(user).not.toBeNull();
    expect(user!.username).toBe(testUsers.valid.username);

    // Verify password is not stored in plain text
    expect(user!.passwordHash).not.toBe(testUsers.valid.password);

    // Verify password is actually hashed
    expect(user!.passwordHash).toMatch(/^\$2[aby]?\$\d+\$/); // bcrypt hash pattern
  });

  it("should register with remember me enabled", async () => {
    // Test remember me functionality
    const response = await request(app)
      .post("/api/auth/register")
      .send({
        ...testUsers.valid,
        email: "rememberme@example.com", // Different email to avoid conflict
        username: "remembermeusr",
        rememberMe: true,
      })
      .expect(201);

    // VERIFY: Remember me should return 30-day expiration
    expect(response.body).toHaveProperty("success", true);
    expect(response.body).toHaveProperty("expiresIn", "30d"); // Should be 30 days for rememberMe: true
    expect(response.body).toHaveProperty("accessToken");
    expect(response.body).toHaveProperty("refreshToken");
  });

  it("should return 409 when trying to register with an existing email", async () => {
    const response = await request(app)
      .post("/api/auth/register")
      .send({
        ...testUsers.valid,
        email: testUsers.existing.email,
      })
      .expect(409);

    expect(response.body).toHaveProperty("code", "CONFLICT");
    expect(response.body.message).toContain("email already exists");
  });

  it("should return 409 when trying to register with an existing username", async () => {
    const response = await request(app)
      .post("/api/auth/register")
      .send({
        ...testUsers.valid,
        email: "newemail@example.com", // Different email
        username: testUsers.existing.username, // Same username
      })
      .expect(409);

    expect(response.body).toHaveProperty("code", "CONFLICT");
    expect(response.body.message).toContain("username already exists");
  });

  it("should return 422 when trying to register with invalid data", async () => {
    const response = await request(app)
      .post("/api/auth/register")
      .send(testUsers.invalid)
      .expect(422);

    expect(response.body).toHaveProperty("code", "VALIDATION_ERROR");
  });

  it("should return 422 when missing required fields", async () => {
    const response = await request(app)
      .post("/api/auth/register")
      .send({
        email: "test@example.com",
        // Missing username, password, firstName
      })
      .expect(422);

    expect(response.body).toHaveProperty("code", "VALIDATION_ERROR");
  });

  it("should return 422 when password does not meet requirements", async () => {
    const response = await request(app)
      .post("/api/auth/register")
      .send({
        email: "test@example.com",
        username: "testuser",
        password: "weak", // Doesn't meet requirements
        firstName: "Test",
        lastName: "User",
      })
      .expect(422);

    expect(response.body).toHaveProperty("code", "VALIDATION_ERROR");
    expect(response.body.message).toContain("Password must");
  });

  it("should return 422 when email format is invalid", async () => {
    const response = await request(app)
      .post("/api/auth/register")
      .send({
        email: "invalid-email-format",
        username: "testuser",
        password: "Password123!",
        firstName: "Test",
        lastName: "User",
      })
      .expect(422);

    expect(response.body).toHaveProperty("code", "VALIDATION_ERROR");
    expect(response.body.message).toContain("Invalid email address");
  });

  it("should return 422 when username is too short", async () => {
    const response = await request(app)
      .post("/api/auth/register")
      .send({
        email: "test@example.com",
        username: "ab", // Too short (less than 3 characters)
        password: "Password123!",
        firstName: "Test",
        lastName: "User",
      })
      .expect(422);

    expect(response.body).toHaveProperty("code", "VALIDATION_ERROR");
    expect(response.body.message).toContain(
      "Username must be at least 3 characters",
    );
  });

  it("should successfully register without lastName (optional field)", async () => {
    const response = await request(app)
      .post("/api/auth/register")
      .send({
        email: "nolastname@example.com",
        username: "nolastname",
        password: "Password123!",
        firstName: "Test",
        rememberMe: false,
        // lastName is optional
      })
      .expect(201);

    expect(response.body).toHaveProperty("success", true);
    expect(response.body.user.displayName).toBe("Test"); // Should just be firstName
  });

  it("should create display name correctly with both first and last name", async () => {
    const response = await request(app)
      .post("/api/auth/register")
      .send({
        email: "fullname@example.com",
        username: "fullname",
        password: "Password123!",
        firstName: "John",
        lastName: "Doe",
        rememberMe: false,
      })
      .expect(201);

    expect(response.body).toHaveProperty("success", true);
    expect(response.body.user.displayName).toBe("John Doe");
  });
});
