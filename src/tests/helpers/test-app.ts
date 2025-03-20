import express from "express";
import cors from "cors";
import routes from "../../routes";
import { errorMiddleware } from "../../common/middlewares/error.middleware";
import { NotFoundError } from "../../common/errors";
import { env } from "../../common/environment";
export function createTestApp() {
  const app = express();

  // Apply middleware
  app.use(
    cors({
      origin: env.CORS_ORIGIN,
      credentials: true,
    }),
  );
  app.use(express.json());

  // Mount routes
  app.use("/api", routes);

  // Handle 404s
  app.use((req, res, next) => {
    next(new NotFoundError("route"));
  });

  // Apply error middleware
  app.use(errorMiddleware);

  return app;
}
