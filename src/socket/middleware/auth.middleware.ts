import { ExtendedError, Socket } from "socket.io";
import { createLogger } from "../../common/logger";
import { authService } from "../../services/auth.service";
import { userService } from "../../services/user.service";
import { UnauthorizedError } from "../../common/errors";

const logger = createLogger("socket-auth-middleware");

export const socketAuthMiddleware = async (
  socket: Socket,
  next: (err?: ExtendedError) => void,
) => {
  try {
    const token =
      socket.handshake.auth.token ||
      socket.handshake.headers.authorization?.split(" ")[1] ||
      socket.handshake.query.token;
    if (!token) {
      return next(new UnauthorizedError("Authentication token is missing"));
    }

    const decodedUser = authService.verifyToken(token as string);

    if (!decodedUser || !decodedUser._id) {
      return next(new UnauthorizedError("Invalid authentication token"));
    }

    const userFromDatabase = await userService.getUserById(
      decodedUser._id.toString(),
    );
    // Attach user to socket data
    socket.data.user = userFromDatabase;

    // Update last seen
    userFromDatabase.lastSeen = new Date();
    await userFromDatabase.save();

    next();
  } catch (error) {
    if (error instanceof Error) {
      logger.error("Socket authentication failed", { error: error.message });
      next(new UnauthorizedError("Authentication failed"));
    }
  }
};
