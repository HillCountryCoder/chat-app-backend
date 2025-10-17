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
import { runInTenantContext } from "../plugins/tenantPlugin";

export interface AuthResponse {
  user: Partial<User>;
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
  accessTokenExpiresIn: string;
  refreshTokenExpiresIn: string;
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
    return runInTenantContext("default", async () => {
      // Check for existing user - we don't need validation here because Zod already did it
      const existingUser = await userRepository.findOne({
        $or: [{ email: userData.email }, { username: userData.username }],
      });

      if (existingUser) {
        const existingField =
          existingUser.email === userData.email ? "email" : "username";
        throw new ConflictError(
          `User with this ${existingField} already exists`,
        );
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
    });
  }

  public async registerUser(userData: RegisterInput): Promise<AuthResponse> {
    return runInTenantContext("default", async () => {
      const newUser = await this.createUser(userData);

      // Generate token pair and return user data
      const tokens = await authService.generateTokenPair(
        newUser,
        userData.rememberMe || false,
        // Add default device info since controller doesn't pass it
        "Registration Device",
        "Unknown IP",
        "Unknown User Agent",
      );

      return {
        user: {
          _id: newUser._id,
          email: newUser.email,
          username: newUser.username,
          displayName: newUser.displayName,
        },
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.expiresIn,
        accessTokenExpiresIn: tokens.accessTokenExpiresIn,
        refreshTokenExpiresIn: tokens.refreshTokenExpiresIn,
      };
    });
  }

  public async loginUser(credentials: LoginInput): Promise<AuthResponse> {
    return runInTenantContext("default", async () => {
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

      // Generate token pair and return response
      const tokens = await authService.generateTokenPair(
        user,
        credentials.rememberMe || false,
        // Add default device info since controller doesn't pass it
        "Login Device",
        "Unknown IP",
        "Unknown User Agent",
      );

      return {
        user: {
          _id: user._id,
          email: user.email,
          username: user.username,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
          status: user.status,
        },
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.expiresIn,
        accessTokenExpiresIn: tokens.accessTokenExpiresIn,
        refreshTokenExpiresIn: tokens.refreshTokenExpiresIn,
      };
    });
  }

  // Get user by ID
  public async getUserById(id: string): Promise<User> {
    return runInTenantContext("default", async () => {
      const user = await userRepository.findById(id);
      if (!user) {
        throw new NotFoundError("user");
      }
      return user;
    });
  }

  public async getAllUsers(
    options: {
      search?: string;
      page?: number;
      limit?: number;
      currentUserId?: string;
    } = {},
  ): Promise<UserListResponse> {
    return runInTenantContext("default", async () => {
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
    });
  }

  async checkIfUserExists(userId: string): Promise<UserInterface> {
    return runInTenantContext("default", async () => {
      const user = await userRepository.findById(userId);
      if (!user) {
        throw new NotFoundError("user");
      }
      return user;
    });
  }

  async checkIfUsersExists(userIds: string[]): Promise<UserInterface[]> {
    return runInTenantContext("default", async () => {
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
    });
  }

  async getUserByEmail(email: string): Promise<UserInterface | null> {
    return runInTenantContext("default", async () => {
      const user = await userRepository.findByEmail(email);
      return user;
    });
  }

  async getUserByUsername(username: string): Promise<UserInterface | null> {
    return runInTenantContext("default", async () => {
      const user = await userRepository.findByUsername(username);
      return user;
    });
  }
  // ENHANCED: Add overloaded methods that accept device info

  public async registerUserWithDeviceInfo(
    userData: RegisterInput,
    deviceInfo?: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<AuthResponse> {
    return runInTenantContext("default", async () => {
      const newUser = await this.createUser(userData);

      const tokens = await authService.generateTokenPair(
        newUser,
        userData.rememberMe || false,
        deviceInfo || "Registration Device",
        ipAddress || "Unknown IP",
        userAgent || "Unknown User Agent",
      );

      return {
        user: {
          _id: newUser._id,
          email: newUser.email,
          username: newUser.username,
          displayName: newUser.displayName,
        },
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.expiresIn,
        accessTokenExpiresIn: tokens.accessTokenExpiresIn,
        refreshTokenExpiresIn: tokens.refreshTokenExpiresIn,
      };
    });
  }

  public async loginUserWithDeviceInfo(
    credentials: LoginInput,
    deviceInfo?: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<AuthResponse> {
    return runInTenantContext("default", async () => {
      let user;
      if (credentials.email) {
        user = await userRepository.findByEmail(credentials.email);
      } else if (credentials.username) {
        user = await userRepository.findByUsername(credentials.username);
      }

      if (!user) {
        throw new NotFoundError("user");
      }

      const isPasswordValid = await user.comparePassword(credentials.password);
      if (!isPasswordValid) {
        throw new UnauthorizedError("Invalid credentials");
      }

      user.lastSeen = new Date();
      await user.save();

      const tokens = await authService.generateTokenPair(
        user,
        credentials.rememberMe || false,
        deviceInfo || "Login Device",
        ipAddress || "Unknown IP",
        userAgent || "Unknown User Agent",
      );

      return {
        user: {
          _id: user._id,
          email: user.email,
          username: user.username,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
          status: user.status,
        },
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.expiresIn,
        accessTokenExpiresIn: tokens.accessTokenExpiresIn,
        refreshTokenExpiresIn: tokens.refreshTokenExpiresIn,
      };
    });
  }
}

export const userService = UserService.getInstance();
