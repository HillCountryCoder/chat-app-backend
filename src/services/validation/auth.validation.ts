import { z } from "zod";
import { createLogger } from "../../common/logger";

const logger = createLogger("auth-validation");

export const registerSchema = z.object({
  email: z.string().email("Invalid email address"),
  username: z
    .string()
    .min(3, "Username must be at least 3 characters long")
    .max(30, "Username ust be at most 30 characters long")
    .regex(
      /^[a-zA-Z0-9_]+$/,
      "Username can only contain letters, numbers, and underscores",
    ),
  password: z
    .string()
    .min(6, "Password must be at least 6 characters long")
    .max(20, "Password can be at max 20 characters long")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[0-9]/, "Password must contain at least one number")
    .regex(/[\W_]/, "Password must contain at least one special character"),
  firstName: z.string().min(3, "First name is required"),
  lastName: z.string().optional(),
  rememberMe: z.boolean().optional().default(false),
});

export const loginSchema = z
  .object({
    // Allow either email or username, but at least one must be provided
    email: z.string().email("Invalid email address").optional(),
    username: z.string().optional(),
    password: z.string().min(8, "Password is required"),
    rememberMe: z.boolean().optional().default(false),
  })
  .refine(
    (data) => {
      console.log("Data in bacekdn", data);
      return data.email || data.username;
    },
    {
      message: "Either email or username must be provided",
      path: ["email", "username"],
    },
  );
export const loginSchemaForMiddleware = z.object({
  // For login, allow a general identifier that could be either email or username
  identifier: z.string().min(1, "Email or username is required"),
  password: z.string().min(8, "Password is required"),
  rememberMe: z.boolean().optional().default(false),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, "Refresh token is required"),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type AuthInput = z.infer<typeof loginSchemaForMiddleware>;
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;
export class AuthValidationService {
  private static instance: AuthValidationService;

  private constructor() {}

  public static getInstance(): AuthValidationService {
    if (!AuthValidationService.instance) {
      AuthValidationService.instance = new AuthValidationService();
    }

    return AuthValidationService.instance;
  }

  public validateRegisterInput(data: unknown): RegisterInput {
    logger.debug("Validating registration data");
    return registerSchema.parse(data);
  }

  public validateLoginInput(data: unknown): LoginInput {
    logger.debug("Validating login data");
    return loginSchema.parse(data);
  }
}
export const authValidationService = AuthValidationService.getInstance();
