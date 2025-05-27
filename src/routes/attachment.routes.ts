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

router.post(
  "/upload-url",
  authMiddleware,
  AttachmentController.generateUploadUrl,
);
router.post("/complete", authMiddleware, AttachmentController.completeUpload);
router.get(
  "/:id/download",
  authMiddleware,
  AttachmentController.getDownloadUrl,
);
router.delete("/:id", authMiddleware, AttachmentController.deleteAttachment);
router.get("/", authMiddleware, AttachmentController.getUserAttachments);

export default router;
