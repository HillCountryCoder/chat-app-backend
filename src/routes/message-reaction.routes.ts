import { Router } from 'express';
import { MessageReactionController } from '../controllers/message-reaction.controller';
import { authMiddleware } from '../common/middlewares/auth.middleware';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// Add a reaction to a message
router.post('/:id/reactions', MessageReactionController.addReaction);

// Remove a reaction from a message
router.delete('/:id/reactions/:emoji', MessageReactionController.removeReaction);

// Get all reactions for a message
router.get('/:id/reactions', MessageReactionController.getReactions);

export default router;
