import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireWorkspaceAccess } from '../middleware/requireWorkspaceAccess.js';
import { createRateLimiter, byUser } from '../middleware/rateLimit.js';
import { chat, indexDocument, listIndexedDocuments } from '../controllers/ai.controller.js';

const router = Router();
const aiLimiter = createRateLimiter({ name: 'ai-chat', windowMs: 60_000, limit: 20, key: byUser, message: 'AI request limit reached. Please wait a minute.' });
const indexLimiter = createRateLimiter({ name: 'ai-index', windowMs: 60_000, limit: 5, key: byUser, message: 'Document indexing limit reached. Please wait a minute.' });
router.use(requireAuth);
router.use('/:workspaceId', requireWorkspaceAccess);
router.post('/:workspaceId/chat', aiLimiter, chat);
router.get('/:workspaceId/documents', listIndexedDocuments);
router.post('/:workspaceId/documents/:documentId/index', indexLimiter, indexDocument);
export default router;
