import { User, UserStatus } from "../../../models";

export const testUsers = {
  valid: {
    email: "test@example.com",
    username: "testuser",
    password: "Password123!",
    firstName: "Test",
    lastName: "User",
  },
  existing: {
    email: "existing@example.com",
    username: "existinguser",
    password: "Password123!",
    firstName: "Existing",
    lastName: "User",
  },
  invalid: {
    email: "invalid-email",
    username: "inv",
    password: "short",
    firstName: "",
    lastName: "",
  },
};

// Original login credentials format for reference
export const loginCredentials = {
  valid: {
    email: "existing@example.com",
    password: "Password123!",
  },
  validUsername: {
    username: "existinguser",
    password: "Password123!",
  },
  invalidEmail: {
    email: "nonexistent@example.com",
    password: "Password123!",
  },
  invalidPassword: {
    email: "existing@example.com",
    password: "WrongPassword123!",
  },
};

// New format with identifier field for direct API usage
export const authCredentials = {
  valid: {
    identifier: "existing@example.com",
    password: "Password123!",
  },
  validUsername: {
    identifier: "existinguser",
    password: "Password123!",
  },
  invalidEmail: {
    identifier: "nonexistent@example.com",
    password: "Password123!",
  },
  invalidPassword: {
    identifier: "existing@example.com",
    password: "WrongPassword123!",
  },
};

export async function seedTestUser() {
  const { email, username, password, firstName, lastName } = testUsers.existing;

  // Create a new User instance which will trigger the pre-save hook
  const user = new User({
    email,
    username,
    passwordHash: password, // This will be hashed by the pre-save hook
    displayName: `${firstName} ${lastName}`,
    status: UserStatus.OFFLINE,
  });

  // Save to trigger the pre-save hook
  await user.save();
}
