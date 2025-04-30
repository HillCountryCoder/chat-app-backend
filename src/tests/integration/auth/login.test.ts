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
      })
      .expect(200);

    // Verify response structure
    expect(response.body).toHaveProperty("user");
    expect(response.body).toHaveProperty("token");
    expect(response.body.user.email).toBe(loginCredentials.valid.email);

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
      })
      .expect(200);

    // Verify response structure
    expect(response.body).toHaveProperty("user");
    expect(response.body).toHaveProperty("token");
    expect(response.body.user.username).toBe(
      loginCredentials.validUsername.username,
    );
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
