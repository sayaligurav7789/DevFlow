export const STATUSES = [
  { value: 'backlog', label: 'Backlog', tone: 'neutral' },
  { value: 'todo', label: 'Todo', tone: 'neutral' },
  { value: 'in_progress', label: 'In Progress', tone: 'warning' },
  { value: 'in_review', label: 'In Review', tone: 'accent' },
  { value: 'done', label: 'Done', tone: 'success' },
];
export const PRIORITIES = [
  { value: 'urgent', label: 'Urgent', tone: 'danger' },
  { value: 'high', label: 'High', tone: 'warning' },
  { value: 'medium', label: 'Medium', tone: 'neutral' },
  { value: 'low', label: 'Low', tone: 'neutral' },
];
export const OPEN_STATUSES = ['backlog', 'todo', 'in_progress', 'in_review'];
export const statusMeta = (v) => STATUSES.find((s) => s.value === v) ?? { value: v, label: v, tone: 'neutral' };
export const priorityMeta = (v) => PRIORITIES.find((p) => p.value === v) ?? { value: v, label: v, tone: 'neutral' };

export const ROLE_LABELS = { owner: 'Owner', admin: 'Admin', member: 'Member' };
export const isManager = (role) => role === 'owner' || role === 'admin';

// Fill colors for charts (decorative: every chart also shows the numbers as text).
export const STATUS_COLORS = {
  backlog: 'var(--line-strong)',
  todo: 'var(--faint)',
  in_progress: 'var(--warning)',
  in_review: 'var(--accent)',
  done: 'var(--success)',
};
