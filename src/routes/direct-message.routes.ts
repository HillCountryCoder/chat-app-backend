// src/routes/direct-message.routes.ts
import { Router } from 'express';
import { DirectMessageController } from '../controllers/direct-message.controller';
import { authMiddleware } from '../common/middlewares/auth.middleware';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// Get all direct messages for the current user
router.get('/', DirectMessageController.getDirectMessages);

// Get a specific direct message
router.get('/:id', DirectMessageController.getDirectMessageById);

// Get messages in a direct message conversation
router.get('/:id/messages', DirectMessageController.getMessages);

// Send a new message
router.post('/messages', DirectMessageController.sendMessage);

export default router;
