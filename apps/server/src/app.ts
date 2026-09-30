import path from "node:path";
import { fileURLToPath } from "node:url";
import compression from "compression";
import cookieParser from "cookie-parser";
import express from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { env } from "./env";
import { logger } from "./lib/logger";
import { errorHandler } from "./middleware/errorHandler";
import { requestId } from "./middleware/requestId";
import { accessRouter } from "./modules/access/routes";
import { authRouter } from "./modules/auth/routes";
import { usersRouter } from "./modules/users/routes";
import { healthRouter } from "./routes/health";
import { apiNotFound } from "./routes/notFound";

const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web/dist");

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(requestId);
  app.use(helmet());
  app.use(compression());
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).requestId,
    }),
  );

  app.use("/api/health", healthRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/access", accessRouter);

  if (env.NODE_ENV === "production") {
    app.use(express.static(webDist, { index: false }));
    app.use((req, res, next) => {
      if (req.path.startsWith("/api")) {
        next();
        return;
      }
      res.sendFile(path.join(webDist, "index.html"), (error) => {
        if (error) next(error);
      });
    });
  }

  app.use("/api", apiNotFound);
  app.use(errorHandler);
  return app;
}
