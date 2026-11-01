import { apiDelete, apiGet, apiPatch, apiPost, apiPut, qs } from './api.js';

export const authApi = {
  me: () => apiGet('/api/auth/me', { skipUnauthorized: true }),
  login: (body) => apiPost('/api/auth/login', body, { skipUnauthorized: true }),
  register: (body) => apiPost('/api/auth/register', body, { skipUnauthorized: true }),
  logout: () => apiPost('/api/auth/logout', {}, { skipUnauthorized: true }),
  updateProfile: (body) => apiPatch('/api/auth/me', body),
  uploadProfilePhoto: (body) => apiPost('/api/auth/me/photo', body),
  removeProfilePhoto: () => apiDelete('/api/auth/me/photo'),
  changePassword: (body) => apiPost('/api/auth/password/change', body),
  signOutEverywhere: () => apiPost('/api/auth/sessions/revoke-all'),
  forgotPassword: (body) => apiPost('/api/auth/password/forgot', body, { skipUnauthorized: true }),
  resetPassword: (body) => apiPost('/api/auth/password/reset', body, { skipUnauthorized: true }),
  resendVerification: () => apiPost('/api/auth/email/verification/resend'),
  verifyEmail: (body) => apiPost('/api/auth/email/verify', body, { skipUnauthorized: true }),
  requestEmailChange: (body) => apiPost('/api/auth/email/change', body),
};

export const workspaceApi = {
  list: (opts) => apiGet('/api/workspaces', opts),
  get: (id, opts) => apiGet(`/api/workspaces/${id}`, opts),
  create: (body) => apiPost('/api/workspaces', body),
  update: (id, body) => apiPatch(`/api/workspaces/${id}`, body),
  remove: (id) => apiDelete(`/api/workspaces/${id}`),
  members: (id, opts) => apiGet(`/api/workspaces/${id}/members`, opts),
  updateMemberRole: (id, userId, role) => apiPatch(`/api/workspaces/${id}/members/${userId}`, { role }),
  removeMember: (id, userId) => apiDelete(`/api/workspaces/${id}/members/${userId}`),
  invitations: (id, opts) => apiGet(`/api/workspaces/${id}/invitations`, opts),
  invite: (id, body) => apiPost(`/api/workspaces/${id}/invitations`, body),
  revokeInvitation: (id, invitationId) => apiDelete(`/api/workspaces/${id}/invitations/${invitationId}`),
  tasks: (id, params, opts) => apiGet(`/api/workspaces/${id}/tasks${qs(params)}`, opts),
  dashboard: (id, opts) => apiGet(`/api/workspaces/${id}/dashboard`, opts),
  activity: (id, params, opts) => apiGet(`/api/workspaces/${id}/activity${qs(params)}`, opts),
};

export const projectApi = {
  list: (wid, params, opts) => apiGet(`/api/workspaces/${wid}/projects${qs(params)}`, opts),
  get: (wid, pid, opts) => apiGet(`/api/workspaces/${wid}/projects/${pid}`, opts),
  create: (wid, body) => apiPost(`/api/workspaces/${wid}/projects`, body),
  update: (wid, pid, body) => apiPatch(`/api/workspaces/${wid}/projects/${pid}`, body),
  archive: (wid, pid) => apiPost(`/api/workspaces/${wid}/projects/${pid}/archive`),
  restore: (wid, pid) => apiPost(`/api/workspaces/${wid}/projects/${pid}/restore`),
  remove: (wid, pid) => apiDelete(`/api/workspaces/${wid}/projects/${pid}`),
  board: (pid, params, opts) => apiGet(`/api/projects/${pid}/board${qs(params)}`, opts),
  activity: (pid, params, opts) => apiGet(`/api/projects/${pid}/activity${qs(params)}`, opts),
};

export const taskApi = {
  list: (pid, params, opts) => apiGet(`/api/projects/${pid}/tasks${qs(params)}`, opts),
  get: (pid, tid, opts) => apiGet(`/api/projects/${pid}/tasks/${tid}`, opts),
  create: (pid, body) => apiPost(`/api/projects/${pid}/tasks`, body),
  update: (pid, tid, body) => apiPatch(`/api/projects/${pid}/tasks/${tid}`, body),
  remove: (pid, tid) => apiDelete(`/api/projects/${pid}/tasks/${tid}`),
  move: (pid, tid, body) => apiPost(`/api/projects/${pid}/tasks/${tid}/move`, body),
  activity: (pid, tid, params, opts) => apiGet(`/api/projects/${pid}/tasks/${tid}/activity${qs(params)}`, opts),
};

export const notificationApi = {
  list: (params = {}, opts) => apiGet(`/api/notifications${qs(params)}`, opts),
  unreadCount: (params = {}, opts) => apiGet(`/api/notifications/unread-count${qs(params)}`, opts),
  markRead: (notificationId) => apiPost(`/api/notifications/${notificationId}/read`),
  markAllRead: (body = {}) => apiPost('/api/notifications/read-all', body),
};

export const invitationApi = {
  accept: (token) => apiPost('/api/invitations/accept', { token }),
};


export const collaborationApi = {
  documents: (wid, params = {}, opts) => apiGet(`/api/collaboration/${wid}/documents${qs(params)}`, opts),
  uploadDocument: (wid, body) => apiPost(`/api/collaboration/${wid}/documents`, body),
  downloadDocument: (wid, id) => `/api/collaboration/${wid}/documents/${id}/download`,
  deleteDocument: (wid, id) => apiDelete(`/api/collaboration/${wid}/documents/${id}`),
  discussions: (wid, params = {}, opts) => apiGet(`/api/collaboration/${wid}/discussions${qs(params)}`, opts),
  createDiscussion: (wid, body) => apiPost(`/api/collaboration/${wid}/discussions`, body),
  replies: (wid, id, opts) => apiGet(`/api/collaboration/${wid}/discussions/${id}/replies`, opts),
  createReply: (wid, id, body) => apiPost(`/api/collaboration/${wid}/discussions/${id}/replies`, body),
  toggleReaction: (wid, id) => apiPost(`/api/collaboration/${wid}/discussions/${id}/reactions`, {}),
  deleteDiscussion: (wid, id) => apiDelete(`/api/collaboration/${wid}/discussions/${id}`),
};


export const integrationsApi = {
  status: (workspaceId, opts) => apiGet(`/api/integrations/workspaces/${workspaceId}`, opts),
  connectUrl: (workspaceId, provider) => `/api/integrations/workspaces/${workspaceId}/connect/${provider}`,
  disconnect: (workspaceId, provider) => apiDelete(`/api/integrations/workspaces/${workspaceId}/${provider}`),
  repositories: (workspaceId, opts) => apiGet(`/api/integrations/workspaces/${workspaceId}/github/repositories`, opts),
  linkRepository: (workspaceId, body) => apiPost(`/api/integrations/workspaces/${workspaceId}/github/repositories`, body),
  githubActivity: (workspaceId, projectId, opts) => apiGet(`/api/integrations/workspaces/${workspaceId}/github/activity${qs({ projectId })}`, opts),
  workflows: (workspaceId, projectId, opts) => apiGet(`/api/integrations/workspaces/${workspaceId}/github/workflows${qs({ projectId })}`, opts),
  slackChannels: (workspaceId, opts) => apiGet(`/api/integrations/workspaces/${workspaceId}/slack/channels`, opts),
  saveSlackSettings: (workspaceId, body) => apiPut(`/api/integrations/workspaces/${workspaceId}/slack/settings`, body),
  sendSlackTest: (workspaceId) => apiPost(`/api/integrations/workspaces/${workspaceId}/slack/test`, {}),
};


export const aiApi = {
  chat: (wid, body) => apiPost(`/api/ai/workspaces/${wid}/chat`, body),
  documents: (wid, opts) => apiGet(`/api/ai/workspaces/${wid}/documents`, opts),
  indexDocument: (wid, documentId) => apiPost(`/api/ai/workspaces/${wid}/documents/${documentId}/index`, {}),
};
