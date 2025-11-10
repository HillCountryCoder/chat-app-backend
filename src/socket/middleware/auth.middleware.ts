/* eslint-disable @typescript-eslint/no-explicit-any */
import { ExtendedError, Socket } from "socket.io";
import { createLogger } from "../../common/logger";
import { authService } from "../../services/auth.service";
import { userService } from "../../services/user.service";
import { UnauthorizedError } from "../../common/errors";
import { tenantContext } from "../../plugins/tenantPlugin";
import { SSOTokenService } from "../../services/sso-token.service";

const logger = createLogger("socket-auth-middleware");

export const socketAuthMiddleware = async (
  socket: Socket,
  next: (err?: ExtendedError) => void
) => {
  try {
    const ssoToken =
      socket.handshake.auth.ssoToken || socket.handshake.query.ssoToken;
    const ssoSignature =
      socket.handshake.auth.ssoSignature || socket.handshake.query.ssoSignature;

    if (ssoToken && ssoSignature) {
      logger.info("Authenticating via SSO token", {
        socketId: socket.id,
      });

      const payload = await SSOTokenService.validateToken(
        ssoToken as string,
        ssoSignature as string
      );

      const user = await SSOTokenService.findOrCreateUser(payload);

      // Generate JWT tokens for future use
      const { accessToken, refreshToken } = await authService.generateTokenPair(
        user,
        false,
        socket.handshake.headers["user-agent"],
        socket.handshake.address,
        socket.handshake.headers["user-agent"]
      );

      // Attach user to socket data
      socket.data.user = user;
      socket.data.tenantId = user.tenantId;

      // update last seen
      user.lastSeen = new Date();
      await user.save();

      logger.info(
        `User ${user._id} authenticated via SSO on socket ${socket.id}`
      );

      // Send tokens to client
      socket.emit("authenticated", {
        sucess: true,
        accessToken,
        refreshToken,
        user: {
          _id: user._id,
          username: user.username,
          email: user.email,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
          status: user.status,
        },
      });

      // run next in tenant Context
      return tenantContext.run({tenantId: user.tenantId}, () => {
        next();
      });
    }

    // Fallback to standard token authentication
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

    const userFromDatabase = await userService.getUserByIdWithTenantId(
      decodedUser._id.toString(),
      decodedUser.tenantId
    );

    // Attach user to socket data
    socket.data.user = userFromDatabase;
    socket.data.tenantId = userFromDatabase.tenantId;

    logger.info(
      `User ${userFromDatabase._id} with tenant ${userFromDatabase.tenantId} authenticated on socket ${socket.id}`
    );

    // Update last seen
    userFromDatabase.lastSeen = new Date();
    await userFromDatabase.save();

    // Run next() INSIDE tenant context
    tenantContext.run({ tenantId: userFromDatabase.tenantId }, () => {
      next();
    });

    // REMOVE the second next() call - it was here
  } catch (error) {
    if (error instanceof Error) {
      logger.error("Socket authentication failed", error);
      next(new UnauthorizedError("Authentication failed"));
    }
  }
};
