import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createTestApp } from "../../helpers/test-app";
import "../setup"; // Import the setup file for MongoDB in-memory testing
import { testUsers, seedTestUser } from "../fixtures/auth-fixtures";
import { User } from "../../../models";
import mongoose from "mongoose";

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
    // Assert
    expect(response.body).toHaveProperty("user");
    expect(response.body).toHaveProperty("token");
    expect(response.body.user).toHaveProperty("_id");
    expect(response.body.user.email).toBe(testUsers.valid.email);
    expect(response.body.user.username).toBe(testUsers.valid.username);
    const user = await User.findOne({ email: testUsers.valid.email });
    expect(user).not.toBeNull();
    expect(user!.username).toBe(testUsers.valid.username);

    // Verify password is not stored in plain text
    expect(user!.passwordHash).not.toBe(testUsers.valid.password);
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
  it("should return 422 when trying to register with invalid data", async () => {
    const response = await request(app)
      .post("/api/auth/register")
      .send(testUsers.invalid)
      .expect(422);

    expect(response.body).toHaveProperty("code", "VALIDATION_ERROR");
  });
});
