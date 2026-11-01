
import { Router } from 'express';

import {
  getCsrfToken,
  getCurrentUser,
  getProfilePhoto,
  login,
  logout,
  register,
  updateCurrentUser,
  changePassword,
  signOutEverywhere,
  requestPasswordReset,
  resetPassword,
  resendEmailVerification,
  verifyEmail,
  requestEmailChange,
  updateProfilePhoto,
  removeProfilePhoto,
} from '../controllers/auth.controller.js';

import { requireAuth } from '../middleware/requireAuth.js';

import {
  loginLimiter,
  profileUpdateLimiter,
  registrationLimiter,
  passwordResetLimiter,
  accountActionLimiter,
} from '../middleware/rateLimit.js';

const router = Router();

// CSRF
router.get('/csrf', getCsrfToken);

// Registration and authentication
router.post('/register', registrationLimiter, register);
router.post('/login', loginLimiter, login);
router.post('/logout', logout);

// Password reset
router.post('/password/forgot', passwordResetLimiter, requestPasswordReset);
router.post('/password/reset', passwordResetLimiter, resetPassword);

// Email verification
router.post('/email/verify', passwordResetLimiter, verifyEmail);

// Current user profile
router.get('/me', requireAuth, getCurrentUser);
router.patch('/me', requireAuth, profileUpdateLimiter, updateCurrentUser);

// Profile photo
router.get('/me/photo', requireAuth, getProfilePhoto);
router.post('/me/photo', requireAuth, profileUpdateLimiter, updateProfilePhoto);
router.delete('/me/photo', requireAuth, profileUpdateLimiter, removeProfilePhoto);

// Account security
router.post('/password/change', requireAuth, accountActionLimiter, changePassword);
router.post('/sessions/revoke-all', requireAuth, accountActionLimiter, signOutEverywhere);
router.post('/email/verification/resend', requireAuth, accountActionLimiter, resendEmailVerification);
router.post('/email/change', requireAuth, accountActionLimiter, requestEmailChange);

export default router;
