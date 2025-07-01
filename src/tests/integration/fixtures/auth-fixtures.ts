import { User, UserStatus } from "../../../models";

export const testUsers = {
  valid: {
    email: "test@example.com",
    username: "testuser",
    password: "Password123!",
    firstName: "Test",
    lastName: "User",
    rememberMe: false,
  },
  existing: {
    email: "existing@example.com",
    username: "existinguser",
    password: "Password123!",
    firstName: "Existing",
    lastName: "User",
    rememberMe: false, // ADD: Include rememberMe field
  },
  invalid: {
    email: "invalid-email",
    username: "inv",
    password: "short",
    firstName: "",
    lastName: "",
    rememberMe: false, // ADD: Include rememberMe field
  },
  withRememberMe: { // ADD: New test user for remember me testing
    email: "rememberme@example.com",
    username: "rememberuser",
    password: "Password123!",
    firstName: "Remember",
    lastName: "Me",
    rememberMe: true,
  },
  minimalValid: { // ADD: For testing required fields only
    email: "minimal@example.com",
    username: "minimal",
    password: "Password123!",
    firstName: "Minimal",
    rememberMe: false,
    // lastName omitted (optional)
  },
};

// Original login credentials format for reference
export const loginCredentials = {
  valid: {
    email: "existing@example.com",
    password: "Password123!",
    rememberMe: false, // ADD: Include rememberMe
  },
  validUsername: {
    username: "existinguser",
    password: "Password123!",
    rememberMe: false, // ADD: Include rememberMe
  },
  invalidEmail: {
    email: "nonexistent@example.com",
    password: "Password123!",
    rememberMe: false, // ADD: Include rememberMe
  },
  invalidPassword: {
    email: "existing@example.com",
    password: "WrongPassword123!",
    rememberMe: false, // ADD: Include rememberMe
  },
};

// New format with identifier field for direct API usage
export const authCredentials = {
  valid: {
    identifier: "existing@example.com",
    password: "Password123!",
    rememberMe: false, // ADD: Include rememberMe
  },
  validUsername: {
    identifier: "existinguser",
    password: "Password123!",
    rememberMe: false, // ADD: Include rememberMe
  },
  invalidEmail: {
    identifier: "nonexistent@example.com",
    password: "Password123!",
    rememberMe: false, // ADD: Include rememberMe
  },
  invalidPassword: {
    identifier: "existing@example.com",
    password: "WrongPassword123!",
    rememberMe: false, // ADD: Include rememberMe
  },
  withRememberMe: { // ADD: New format for remember me testing
    identifier: "existing@example.com",
    password: "Password123!",
    rememberMe: true,
  },
};

export async function seedTestUser() {
  const { email, username, password, firstName, lastName } = testUsers.existing;

  // Check if user already exists to avoid duplicate key errors
  const existingUser = await User.findOne({ 
    $or: [{ email }, { username }] 
  });
  
  if (existingUser) {
    return existingUser; // Return existing user if found
  }

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
  return user;
}

// ADD: Helper function to clean up test users
export async function cleanupTestUsers() {
  const testEmails = [
    testUsers.valid.email,
    testUsers.existing.email,
    testUsers.withRememberMe.email,
    testUsers.minimalValid.email,
    "rememberme@example.com",
    "newemail@example.com",
    "nolastname@example.com",
    "fullname@example.com",
  ];
  
  await User.deleteMany({ 
    email: { $in: testEmails } 
  });
}