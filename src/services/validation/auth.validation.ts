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
    .min(8, "Password must be at least 8 characters long")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/[0-9]/, "Password must contain at least one number"),
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().optional(),
});

export const loginSchema = z
  .object({
    // Allow either email or username, but at least one must be provided
    email: z.string().email("Invalid email address").optional(),
    username: z.string().optional(),
    password: z.string().min(8, "Password is required"),
  })
  .refine((data) => data.email || data.username, {
    message: "Either email or username must be provided",
    path: ["email", "username"],
  });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

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
