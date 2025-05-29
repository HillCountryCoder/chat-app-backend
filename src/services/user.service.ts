// src/services/user.service.ts
import { createLogger } from "../common/logger";
import winston from "winston";
import { UserInterface as User, UserInterface, UserStatus } from "../models";
import {
  ConflictError,
  NotFoundError,
  UnauthorizedError,
} from "../common/errors";
import { userRepository } from "../repositories/user.repository";
import { authService } from "./auth.service";
import { LoginInput, RegisterInput } from "./validation/auth.validation";

export interface AuthResponse {
  user: Partial<User>;
  token: string;
}
export interface UserListResponse {
  users: Partial<User>[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
const logger = createLogger("user-service");

export class UserService {
  private static instance: UserService;
  private logger: winston.Logger;

  private constructor(logger: winston.Logger) {
    this.logger = logger;
  }

  public static getInstance(): UserService {
    if (!UserService.instance) {
      UserService.instance = new UserService(logger);
    }
    return UserService.instance;
  }

  // User creation
  public async createUser(userData: RegisterInput): Promise<User> {
    // Check for existing user - we don't need validation here because Zod already did it
    const existingUser = await userRepository.findOne({
      $or: [{ email: userData.email }, { username: userData.username }],
    });

    if (existingUser) {
      const existingField =
        existingUser.email === userData.email ? "email" : "username";
      throw new ConflictError(`User with this ${existingField} already exists`);
    }

    // Create display name
    const displayName = userData.lastName
      ? `${userData.firstName} ${userData.lastName}`
      : userData.firstName;

    // Create new user
    try {
      return await userRepository.create({
        email: userData.email,
        username: userData.username,
        passwordHash: userData.password, // Will be hashed in the pre-save hook
        displayName,
        status: UserStatus.OFFLINE,
      });
    } catch (error) {
      this.logger.error("Error creating user", { error });
      throw error;
    }
  }

  // User registration
  public async registerUser(userData: RegisterInput): Promise<AuthResponse> {
    const newUser = await this.createUser(userData);

    // Generate token and return user data
    const token = authService.generateToken(newUser);

    return {
      user: {
        _id: newUser._id,
        email: newUser.email,
        username: newUser.username,
        displayName: newUser.displayName,
      },
      token,
    };
  }

  // User login
  public async loginUser(credentials: LoginInput): Promise<AuthResponse> {
    // Find user - we don't need validation here because Zod already did it
    let user;
    if (credentials.email) {
      user = await userRepository.findByEmail(credentials.email);
    } else if (credentials.username) {
      user = await userRepository.findByUsername(credentials.username);
    }

    if (!user) {
      throw new NotFoundError("user");
    }

    // Verify password
    const isPasswordValid = await user.comparePassword(credentials.password);
    if (!isPasswordValid) {
      throw new UnauthorizedError("Invalid credentials");
    }

    // Update last seen
    user.lastSeen = new Date();
    await user.save();

    // Generate token and return response
    const token = authService.generateToken(user);

    return {
      user: {
        _id: user._id,
        email: user.email,
        username: user.username,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        status: user.status,
      },
      token,
    };
  }

  // Get user by ID
  public async getUserById(id: string): Promise<User> {
    const user = await userRepository.findById(id);
    if (!user) {
      throw new NotFoundError("user");
    }
    return user;
  }

  public async getAllUsers(
    options: {
      search?: string;
      page?: number;
      limit?: number;
      currentUserId?: string;
    } = {},
  ): Promise<UserListResponse> {
    const { search, page = 1, limit = 20, currentUserId } = options;

    const skip = (page - 1) * limit;
    // Get users and total count in parallel
    const [users, total] = await Promise.all([
      userRepository.findAllUsers({
        search,
        limit,
        skip,
        excludeId: currentUserId,
      }),
      userRepository.countUsers({
        search,
        excludeId: currentUserId,
      }),
    ]);
    const totalPages = Math.ceil(total / limit);

    return {
      users,
      total,
      page,
      limit,
      totalPages,
    };
  }

  async checkIfUserExists(userId: string): Promise<UserInterface> {
    const user = await userRepository.findById(userId);
    if (!user) {
      throw new NotFoundError("user");
    }
    return user;
  }

  async checkIfUsersExists(userIds: string[]): Promise<UserInterface[]> {
    if (!userIds || userIds.length === 0) {
      return [];
    }
    const users = await userRepository.findByIds(userIds);
    if (!users || users.length === 0) {
      throw new NotFoundError("users");
    }

    // Check if all userIds are found
    const notFoundIds = userIds.filter(
      (id) => !users.some((user) => user._id.toString() === id),
    );
    if (notFoundIds.length > 0) {
      throw new NotFoundError(`users with IDs: ${notFoundIds.join(", ")}`);
    }

    return users;
  }
}

export const userService = UserService.getInstance();
