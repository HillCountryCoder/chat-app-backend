import { Router } from "express";
import { authMiddleware } from "../common/middlewares/auth.middleware";
import { apiKeyMiddleware } from "../common/middlewares/api-key.middleware";
import { AttachmentController } from "../controllers/attachment.controller";

const router = Router();

// Public routes (API key protected)
router.post(
  "/status-update",
  apiKeyMiddleware,
  AttachmentController.updateStatus,
);

// Protected routes (authentication required)
router.use(authMiddleware);

router.post("/upload-url", AttachmentController.generateUploadUrl);
router.post("/complete", AttachmentController.completeUpload);
router.get("/:id/download", AttachmentController.getDownloadUrl);
router.delete("/:id", AttachmentController.deleteAttachment);
router.get("/user/attachments", AttachmentController.getUserAttachments);

export default router;
