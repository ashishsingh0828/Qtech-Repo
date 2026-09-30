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
import { permissionsFor } from "./lib/account";
import { attachSse } from "./lib/sse";
import { currentUser, requireAuth } from "./middleware/auth";
import { accessRouter } from "./modules/access/routes";
import { authRouter } from "./modules/auth/routes";
import { datasetsRouter } from "./modules/datasets/routes";
import { trashRouter } from "./modules/trash/routes";
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
  app.use(
    compression({
      filter(req, res) {
        const url = req.url ?? "";
        if (url === "/api/events" || url.startsWith("/api/events?")) return false;
        return compression.filter(req, res);
      },
    }),
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).requestId,
    }),
  );

  app.get("/api/events", requireAuth, (req, res, next) => {
    const user = currentUser(req);
    permissionsFor(user.role).then(
      (permissions) => attachSse(req, res, user.id, user.role, permissions),
      (error: unknown) => next(error),
    );
  });
  app.use("/api/health", healthRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/datasets", datasetsRouter);
  app.use("/api/trash", trashRouter);
  app.use("/api/access", accessRouter);

  if (env.NODE_ENV === "production") {
    app.use(express.static(webDist, { index: false, maxAge: "1h" }));
    app.use((req, res, next) => {
      if (req.path.startsWith("/api")) {
        next();
        return;
      }
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(path.join(webDist, "index.html"), (error) => {
        if (error) next(error);
      });
    });
  }

  app.use("/api", apiNotFound);
  app.use(errorHandler);
  return app;
}
