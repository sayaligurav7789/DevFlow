import { Router } from 'express';
import { acceptInvitation } from '../controllers/invitations.controller.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { invitationAcceptLimiter } from '../middleware/rateLimit.js';

const router = Router();

router.use(requireAuth);
router.post('/accept', invitationAcceptLimiter, acceptInvitation);

export default router;
