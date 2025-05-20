import { Router } from "express";
import { apiKeyMiddleware } from "../common/middlewares/api-key.middleware";
import { AttachmentController } from "../controllers/attachment.controller";

const router = Router();

// Status update endpoint for Lambda communication
router.post('/status-update', apiKeyMiddleware, AttachmentController.updateStatus);

export default router;
