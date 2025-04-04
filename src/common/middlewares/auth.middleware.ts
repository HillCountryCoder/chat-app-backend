import { Response, NextFunction } from "express";
import { AuthenticatedRequest } from "../types/auth.type";
import { authService } from "../../services/auth.service";
import { userService } from "../../services/user.service";
import { UnauthorizedError } from "../errors";

export async function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new UnauthorizedError("Authorized header missing or invalid");
    }

    const token = authHeader.split(" ")[1];
    const decodedUser = authService.verifyToken(token);

    if (!decodedUser || !decodedUser._id) {
      throw new UnauthorizedError("Invalid token");
    }

    const user = await userService.getUserById(decodedUser._id.toString());
    if (!user) {
      throw new UnauthorizedError("User not found");
    }
    (req as AuthenticatedRequest).user = user;

    next();
  } catch (error) {
    next(error);
  }
}
