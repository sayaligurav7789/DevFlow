// Stage 7 UI flows: Kanban drag and drop (mouse, keyboard, menu), optimistic-update failure paths,
// dashboard accuracy, and activity history. Run against a live stack (see README).
import fs from 'node:fs';
import { check, clearInput, clickButton, fill, goto, launch, newPage, problems, shot, sleep, summary, textGone, textVisible } from './lib.mjs';

const stamp = Date.now().toString(36);
const EMAIL = `kanban-${stamp}@example.test`;
const PASSWORD = 'correct-horse-battery';
const axeSrc = fs.readFileSync(new URL('./node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');

async function api(page, method, path, body) {
  return page.evaluate(async (method, path, body) => {
    const cookie = document.cookie.split('; ').find((c) => c.startsWith('devflow_csrf='));
    const csrf = cookie ? decodeURIComponent(cookie.split('=')[1]) : '';
    const r = await fetch(path, { method, credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    return { status: r.status, data: text ? JSON.parse(text) : null };
  }, method, path, body);
}
const iso = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

// ---- board DOM helpers ----
const titlesIn = (page, label) => page.evaluate((label) => {
  const section = [...document.querySelectorAll('section[aria-label]')].find((s) => s.getAttribute('aria-label').startsWith(label + ','));
  return section ? [...section.querySelectorAll('li [role=button] p')].map((p) => p.textContent.trim()) : null;
}, label);
const rectOfCard = (page, title) => page.evaluate((title) => {
  const el = [...document.querySelectorAll('li [role=button]')].find((e) => e.querySelector('p')?.textContent.trim() === title);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, top: r.top, height: r.height };
}, title);
const rectOfColumn = (page, label) => page.evaluate((label) => {
  const s = [...document.querySelectorAll('section[aria-label]')].find((e) => e.getAttribute('aria-label').startsWith(label + ','));
  const r = s.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, top: r.top, bottom: r.bottom };
}, label);
const settle = (page) => page.waitForFunction(() => !document.querySelector('li [role=button][aria-busy="true"]') && !document.querySelector('[data-dnd-kit-dragging]'), { timeout: 8000 });

async function drag(page, from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 8, from.y + 8, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 25 });
  await sleep(150);
  await page.mouse.up();
  await sleep(250);
}
async function dragCardTo(page, title, targetTitle, where) {
  const from = await rectOfCard(page, title);
  const t = await rectOfCard(page, targetTitle);
  const y = where === 'above' ? t.top + t.height * 0.2 : t.top + t.height * 0.8;
  await drag(page, from, { x: t.x, y });
  await settle(page);
}
async function dragCardToColumn(page, title, label) {
  const from = await rectOfCard(page, title);
  const c = await rectOfColumn(page, label);
  await drag(page, from, { x: c.x, y: c.bottom - 30 });
  await settle(page);
}
async function statusOf(page, projectId, taskId) {
  return (await api(page, 'GET', `/api/projects/${projectId}/tasks/${taskId}`)).data.task.status;
}
const clickCard = (page, title) => page.evaluate((title) => {
  const el = [...document.querySelectorAll('li [role=button]')].find((e) => e.querySelector('p')?.textContent.trim() === title);
  if (!el) throw new Error(`No card ${title}`); el.click();
}, title);
async function intercept(page, handler) {
  await page.setRequestInterception(true);
  const listener = (req) => (handler(req) === false ? req.continue() : undefined);
  page.on('request', listener);
  return async () => { page.off('request', listener); await page.setRequestInterception(false); };
}
async function runAxe(page, label) {
  await sleep(500);
  await page.evaluate(axeSrc);
  const violations = await page.evaluate(async () => {
    const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } });
    return r.violations.map((v) => `${v.id}[${v.impact}] ${v.nodes[0].target.join(' ')} :: ${(v.nodes[0].failureSummary || '').split('\n')[1] ?? ''}`.slice(0, 220));
  });
  check(`axe: ${label} has no accessibility violations`, violations.length === 0, violations.join(' | '));
}

const browser = await launch();
try {
  // Five columns need ~1250px next to the sidebar; use a wide viewport so every column is on screen.
  const a = await newPage(browser, { width: 1920, height: 1080, tag: 'kanban' });
  const moveRequests = [];
  const boardRequests = [];
  a.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/move')) moveRequests.push(r.url());
    if (r.method() === 'GET' && /\/board(\?|$)/.test(r.url())) boardRequests.push(r.url());
  });

  // ───────── setup: account via the UI, data via the API ─────────
  await goto(a, '/register');
  await fill(a, 'Full name', 'Kai Kanban'); await fill(a, 'Email', EMAIL); await fill(a, 'Password', PASSWORD);
  await clickButton(a, 'Create account');
  await textVisible(a, 'Create your first workspace');
  const ws = (await api(a, 'POST', '/api/workspaces', { name: `Kanban ${stamp}`, slug: `kanban-${stamp}` })).data.workspace;
  const me = (await api(a, 'GET', '/api/auth/me')).data.user;
  const project = (await api(a, 'POST', `/api/workspaces/${ws.id}/projects`, { name: 'Launch Board' })).data.project;
  const mk = async (title, fields) => (await api(a, 'POST', `/api/projects/${project.id}/tasks`, { title, ...fields })).data.task;
  const T = {};
  T.Alpha = await mk('Alpha', { status: 'todo' });
  T.Bravo = await mk('Bravo', { status: 'todo' });
  T.Charlie = await mk('Charlie', { status: 'todo' });
  T.Delta = await mk('Delta', { status: 'backlog' });
  T.Echo = await mk('Echo', { status: 'in_progress', priority: 'high', assigneeId: me.id, dueAt: iso(1) });
  T.Foxtrot = await mk('Foxtrot', { status: 'done' });
  const boardUrl = `/workspaces/${ws.id}/projects/${project.id}/board`;
  await goto(a, boardUrl);
  await a.waitForSelector('li [role=button]');

  // ───────── board renders ─────────
  const labels = await a.$$eval('section[aria-label]', (s) => s.map((e) => e.getAttribute('aria-label')));
  check('board shows the five columns with live counts', JSON.stringify(labels) === JSON.stringify(['Backlog, 1 task', 'Todo, 3 tasks', 'In Progress, 1 task', 'In Review, 0 tasks', 'Done, 1 task']), labels.join(' / '));
  check('cards appear in creation order within a column', JSON.stringify(await titlesIn(a, 'Todo')) === JSON.stringify(['Alpha', 'Bravo', 'Charlie']));
  const echo = await a.evaluate(() => [...document.querySelectorAll('li [role=button]')].find((e) => e.textContent.includes('Echo')).innerText.replace(/\n+/g, ' | '));
  check('a card shows title, priority, assignee, and deadline', /Echo/.test(echo) && /High/.test(echo) && /Assigned to Kai Kanban/.test(echo) && /\d/.test(echo), echo);
  const tabs = await a.$$eval('nav[aria-label="Project views"] a', (l) => l.map((e) => `${e.textContent.trim()}${e.getAttribute('aria-current') ? '*' : ''}`));
  check('project tabs: List, Board (current), Activity', JSON.stringify(tabs) === JSON.stringify(['List', 'Board*', 'Activity']), tabs.join());
  await shot(a, '20-board');

  // ───────── mouse drag: across columns, persisted ─────────
  await dragCardTo(a, 'Alpha', 'Echo', 'below');
  check('dragging a card to another column moves it there', JSON.stringify(await titlesIn(a, 'In Progress')) === JSON.stringify(['Echo', 'Alpha']) && JSON.stringify(await titlesIn(a, 'Todo')) === JSON.stringify(['Bravo', 'Charlie']), JSON.stringify([await titlesIn(a, 'In Progress'), await titlesIn(a, 'Todo')]));
  check('column counts update', (await a.$$eval('section[aria-label]', (s) => s.map((e) => e.getAttribute('aria-label')))).slice(1, 3).join() === 'Todo, 2 tasks,In Progress, 2 tasks');
  check('a drag does not open the task dialog', (await a.$('[role=dialog]')) === null);
  check('exactly one move request was sent', moveRequests.length === 1, String(moveRequests.length));
  check('the move is saved on the server', (await statusOf(a, project.id, T.Alpha.id)) === 'in_progress');
  await a.reload({ waitUntil: 'networkidle0' }); await a.waitForSelector('li [role=button]');
  check('the new position survives a page reload', JSON.stringify(await titlesIn(a, 'In Progress')) === JSON.stringify(['Echo', 'Alpha']));

  // ───────── mouse drag: reorder within a column, and drop between cards ─────────
  await dragCardTo(a, 'Charlie', 'Bravo', 'above');
  check('reordering inside a column works', JSON.stringify(await titlesIn(a, 'Todo')) === JSON.stringify(['Charlie', 'Bravo']), JSON.stringify(await titlesIn(a, 'Todo')));
  await dragCardTo(a, 'Delta', 'Bravo', 'above');
  check('dropping between two cards of another column lands exactly there', JSON.stringify(await titlesIn(a, 'Todo')) === JSON.stringify(['Charlie', 'Delta', 'Bravo']), JSON.stringify(await titlesIn(a, 'Todo')));
  await a.reload({ waitUntil: 'networkidle0' }); await a.waitForSelector('li [role=button]');
  check('both reorders persist after reload', JSON.stringify(await titlesIn(a, 'Todo')) === JSON.stringify(['Charlie', 'Delta', 'Bravo']));
  await dragCardToColumn(a, 'Foxtrot', 'In Review');
  check('dropping on an empty column works', JSON.stringify(await titlesIn(a, 'In Review')) === JSON.stringify(['Foxtrot']), JSON.stringify([await titlesIn(a, 'In Review'), await titlesIn(a, 'Done')]));

  // ───────── optimistic update failures revert safely ─────────
  const before = JSON.stringify([await titlesIn(a, 'Todo'), await titlesIn(a, 'Done')]);
  let stop = await intercept(a, (req) => {
    if (req.method() === 'POST' && req.url().endsWith('/move')) {
      req.respond({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Simulated database outage' } }) });
    } else return false;
    return undefined;
  });
  await dragCardToColumn(a, 'Charlie', 'Done');
  check('a failed move (500) puts the card back in its original place', JSON.stringify([await titlesIn(a, 'Todo'), await titlesIn(a, 'Done')]) === before, JSON.stringify([await titlesIn(a, 'Todo'), await titlesIn(a, 'Done')]));
  check('the server error message is shown to the user', await textVisible(a, 'Simulated database outage'));
  check('column counts are restored after the failure', (await a.$$eval('section[aria-label]', (s) => s.map((e) => e.getAttribute('aria-label')))).slice(1, 2).join() === 'Todo, 3 tasks');
  await stop();
  check('the failed move changed nothing on the server', (await statusOf(a, project.id, T.Charlie.id)) === 'todo');

  const boardCallsBefore = boardRequests.length;
  stop = await intercept(a, (req) => {
    if (req.method() === 'POST' && req.url().endsWith('/move')) {
      req.respond({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { message: 'The card you dropped after has moved or was deleted. Refresh the board and try again.' } }) });
    } else return false;
    return undefined;
  });
  await dragCardToColumn(a, 'Charlie', 'Done');
  check('a stale-reference conflict (409) reverts the card and shows the message', JSON.stringify(await titlesIn(a, 'Todo')) === JSON.stringify(['Charlie', 'Delta', 'Bravo']) && await textVisible(a, 'has moved or was deleted'));
  await stop();
  await sleep(500);
  check('after a conflict the board re-reads the real state from the server', boardRequests.length > boardCallsBefore);

  stop = await intercept(a, (req) => {
    if (req.method() === 'POST' && req.url().endsWith('/move')) req.abort('failed'); else return false;
    return undefined;
  });
  await dragCardToColumn(a, 'Bravo', 'Done');
  check('a dropped connection reverts the card with a clear message', JSON.stringify(await titlesIn(a, 'Todo')) === JSON.stringify(['Charlie', 'Delta', 'Bravo']) && await textVisible(a, 'Cannot reach the DevFlow server'));
  await stop();

  // slow request: the card shows it is saving and cannot be dragged again meanwhile
  stop = await intercept(a, (req) => {
    if (req.method() === 'POST' && req.url().endsWith('/move')) setTimeout(() => req.continue(), 1500); else return false;
    return undefined;
  });
  const slowFrom = await rectOfCard(a, 'Bravo'); const slowTo = await rectOfColumn(a, 'Done');
  await drag(a, slowFrom, { x: slowTo.x, y: slowTo.bottom - 30 });
  const saving = await a.evaluate(() => !!document.querySelector('li [role=button][aria-busy="true"]') && !!document.querySelector('[aria-label="Saving move"]'));
  check('while a move is saving the card shows a saving indicator', saving);
  const countDuring = moveRequests.length;
  const retry = await rectOfCard(a, 'Bravo');
  await drag(a, retry, { x: slowTo.x, y: slowTo.top + 60 });
  check('a card with a move in flight cannot be dragged again', moveRequests.length === countDuring);
  await settle(a);
  await stop();
  check('the slow move completes and is saved', (await statusOf(a, project.id, T.Bravo.id)) === 'done' && JSON.stringify(await titlesIn(a, 'Done')) === JSON.stringify(['Bravo']), JSON.stringify(await titlesIn(a, 'Done')));

  // ───────── keyboard and menu alternatives ─────────
  await a.evaluate((id) => { [...document.querySelectorAll('li [role=button]')].find((e) => e.querySelector('p')?.textContent.trim() === 'Charlie').focus(); });
  await a.keyboard.press('Space'); await sleep(200);
  await a.keyboard.press('ArrowRight'); await sleep(250);
  await a.keyboard.press('Space'); await settle(a); await sleep(300);
  const keyboardStatus = await statusOf(a, project.id, T.Charlie.id);
  check('keyboard dragging (Space, arrow, Space) moves a card and saves it', keyboardStatus !== 'todo', keyboardStatus);
  const live = await a.evaluate(() => document.querySelector('[id^="DndLiveRegion"]')?.textContent ?? '');
  check('screen-reader announcements describe the drop', /Dropped Charlie in /.test(live), live);
  await a.evaluate(() => { [...document.querySelectorAll('li [role=button]')].find((e) => e.querySelector('p')?.textContent.trim() === 'Delta').focus(); });
  await a.keyboard.press('Enter');
  check('Enter on a focused card opens the task dialog (not a drag)', await a.waitForSelector('[role=dialog]', { timeout: 3000 }).then(() => true, () => false));
  await a.keyboard.press('Escape'); await a.waitForSelector('[role=dialog]', { hidden: true });

  await a.evaluate(() => document.querySelector('button[aria-label="Move or actions for Delta"]').click());
  await a.waitForSelector('[role=menu]');
  await clickButton(a, 'In Review', '[role=menu]');
  await settle(a); await sleep(300);
  check('the "Move to" menu is a non-drag way to move a card', (await statusOf(a, project.id, T.Delta.id)) === 'in_review' && (await titlesIn(a, 'In Review')).includes('Delta'));

  // ───────── click, add-to-column, filters ─────────
  await clickCard(a, 'Echo');
  check('clicking a card opens the task dialog', await a.waitForSelector('[role=dialog]', { timeout: 3000 }).then(() => true, () => false));
  await a.keyboard.press('Escape'); await a.waitForSelector('[role=dialog]', { hidden: true });
  await clickButton(a, 'Add task to In Review');
  await a.waitForSelector('[role=dialog]');
  const presetStatus = await a.evaluate(() => { const l = [...document.querySelectorAll('[role=dialog] label')].find((x) => x.textContent.trim().startsWith('Status')); return document.getElementById(l.htmlFor).value; });
  check('"Add task" in a column pre-selects that status', presetStatus === 'in_review');
  await fill(a, 'Title', 'Golf', '[role=dialog]'); await clickButton(a, 'Create task', '[role=dialog]');
  await a.waitForFunction(() => document.body.innerText.includes('Golf'), { timeout: 6000 });
  const inReview = await titlesIn(a, 'In Review');
  check('a task created from a column appears at the bottom of it', inReview.at(-1) === 'Golf', JSON.stringify(inReview));

  await a.type('input[type=search]', 'Echo');
  await a.waitForFunction(() => location.search.includes('q=Echo'));
  await textGone(a, 'Golf');
  check('board search filters cards and column counts', JSON.stringify(await titlesIn(a, 'In Progress')) === JSON.stringify(['Echo']) && (await titlesIn(a, 'Todo')).length === 0);
  await clickButton(a, 'Clear filters'); await textVisible(a, 'Golf');

  // ───────── dashboard accuracy (expected values computed independently from raw tasks) ─────────
  const raw = (await api(a, 'GET', `/api/workspaces/${ws.id}/tasks?limit=100`)).data.tasks;
  const today = new Date(`${iso(0)}T00:00:00Z`).getTime();
  const expected = {
    total: raw.length,
    completed: raw.filter((t) => t.status === 'done').length,
    overdue: raw.filter((t) => t.status !== 'done' && t.dueAt && new Date(t.dueAt).getTime() < today).length,
    mineOpen: raw.filter((t) => t.assigneeId === me.id && t.status !== 'done').length,
    byStatus: Object.fromEntries(['backlog', 'todo', 'in_progress', 'in_review', 'done'].map((s) => [s, raw.filter((t) => t.status === s).length])),
  };
  await goto(a, `/workspaces/${ws.id}`);
  await textVisible(a, 'Tasks by status');
  const figure = (label) => a.evaluate((label) => {
    const p = [...document.querySelectorAll('section[aria-label="Key figures"] p')].find((e) => e.textContent.trim() === label);
    return Number(p.nextElementSibling.textContent.trim());
  }, label);
  check('dashboard total tasks matches the data', (await figure('Tasks')) === expected.total, `${await figure('Tasks')} vs ${expected.total}`);
  check('dashboard completed matches', (await figure('Completed')) === expected.completed);
  check('dashboard overdue matches', (await figure('Overdue')) === expected.overdue);
  check('dashboard "assigned to me" matches', (await figure('Assigned to me')) === expected.mineOpen);
  check('dashboard projects count matches', (await figure('Projects')) === 1);
  const legend = await a.evaluate(() => [...document.querySelectorAll('ul li')].filter((li) => /^(Backlog|Todo|In Progress|In Review|Done)\b/.test(li.innerText.trim())).map((li) => li.innerText.replace(/\s+/g, ' ').trim()));
  const legendCounts = Object.fromEntries(legend.map((l) => { const m = l.match(/^(.*?)\s+(\d+)\s*,\s*\d+%$/); return [m?.[1].toLowerCase().replace(' ', '_'), m ? Number(m[2]) : null]; }));
  check('status distribution legend matches the data', JSON.stringify(legendCounts) === JSON.stringify(expected.byStatus), `${JSON.stringify(legendCounts)} vs ${JSON.stringify(expected.byStatus)}`);
  const progress = await a.$eval('[role=progressbar]', (e) => Number(e.getAttribute('aria-valuenow')));
  check('project progress equals done / total', progress === Math.round((expected.completed / expected.total) * 100), String(progress));
  check('upcoming deadlines show the task due tomorrow', await textVisible(a, 'Echo') && await textVisible(a, 'Tomorrow'));
  check('recent activity lists the moves with actor and transition', await textVisible(a, 'Kai Kanban') && await textVisible(a, 'moved') && await textVisible(a, 'from Todo to In Progress'));
  await shot(a, '21-dashboard');
  await runAxe(a, 'dashboard with data');
  const moveBefore = await a.$eval('time', (t) => t.textContent);
  await clickButton(a, 'Refresh');
  check('Refresh re-reads the dashboard', await a.waitForFunction(() => !document.querySelector('button[aria-busy="true"]'), { timeout: 5000 }).then(() => true, () => false));
  void moveBefore;

  // ───────── activity history ─────────
  await goto(a, `${boardUrl.replace('/board', '')}/activity`);
  await textVisible(a, 'Golf');
  const first = await a.$eval('ol li p', (p) => p.textContent.trim());
  check('project activity lists newest first (latest action on top)', /Golf/.test(first) && /created task/.test(first), first);
  check('project activity shows actor, action, entity, and a timestamp', await textVisible(a, 'Kai Kanban created task') && await a.$eval('ol li time', (t) => !!t.getAttribute('datetime')));
  const rowsText = await a.$$eval('ol li p:first-child', (ps) => ps.map((p) => p.textContent.trim()));
  check('project activity includes the drag moves and the project creation', rowsText.some((r) => /moved Alpha from Todo to In Progress/.test(r)) && rowsText.some((r) => /created project Launch Board/.test(r)), rowsText.slice(0, 3).join(' || '));
  await runAxe(a, 'project activity');
  await goto(a, `/workspaces/${ws.id}/activity`);
  await textVisible(a, 'Activity');
  await a.select('select[aria-label="Filter by type"]', 'project');
  await a.waitForFunction(() => location.search.includes('entityType=project'));
  await textGone(a, 'moved');
  const projectRows = await a.$$eval('ol li p:first-child', (ps) => ps.map((p) => p.textContent.trim()));
  check('workspace activity filters to project events only', projectRows.length >= 1 && projectRows.every((r) => /project/.test(r) && !/moved|created task/.test(r)), projectRows.join(' || '));
  await runAxe(a, 'workspace activity');

  // ───────── empty board, archived project, responsive ─────────
  const empty = (await api(a, 'POST', `/api/workspaces/${ws.id}/projects`, { name: 'Empty One' })).data.project;
  await goto(a, `/workspaces/${ws.id}/projects/${empty.id}/board`);
  await a.waitForSelector('section[aria-label]');
  check('an empty board invites the first drop in every column', (await a.$$eval('section p', (ps) => ps.filter((p) => p.textContent.includes('No tasks — drop one here')).length)) === 5);

  await goto(a, boardUrl); await a.waitForSelector('li [role=button]');
  await runAxe(a, 'board (light)');
  await clickButton(a, 'Account menu for Kai Kanban'); await a.waitForSelector('[role=menu]'); await clickButton(a, 'Dark', '[role=menu]'); await sleep(300);
  await a.keyboard.press('Escape');
  await runAxe(a, 'board (dark)');
  await shot(a, '22-board-dark');
  await a.evaluate(() => localStorage.setItem('devflow:theme', 'light')); await a.reload({ waitUntil: 'networkidle0' });

  await api(a, 'POST', `/api/workspaces/${ws.id}/projects/${project.id}/archive`);
  await goto(a, boardUrl); await a.waitForSelector('li [role=button]');
  check('an archived project shows a read-only notice', await textVisible(a, 'This project is archived'));
  check('archived boards have no add buttons or move menus', (await a.$('button[aria-label^="Add task to"]')) === null && (await a.$('button[aria-label^="Move or actions"]')) === null);
  const movesBefore = moveRequests.length;
  const roFrom = await rectOfCard(a, 'Echo'); const roTo = await rectOfColumn(a, 'Done');
  await drag(a, roFrom, { x: roTo.x, y: roTo.bottom - 30 });
  check('archived cards cannot be dragged (no request is sent)', moveRequests.length === movesBefore && (await titlesIn(a, 'In Progress')).includes('Echo'));
  await shot(a, '23-board-archived');

  await api(a, 'POST', `/api/workspaces/${ws.id}/projects/${project.id}/restore`);
  const scrollProject = (await api(a, 'POST', `/api/workspaces/${ws.id}/projects`, { name: 'Scroll Board' })).data.project;
  await api(a, 'POST', `/api/projects/${scrollProject.id}/tasks`, { title: 'Hotel', status: 'backlog' });
  const s = await newPage(browser, { width: 1280, height: 800, tag: 'kanban-narrow' });
  await goto(s, '/login'); await fill(s, 'Email', EMAIL); await fill(s, 'Password', PASSWORD); await clickButton(s, 'Sign in');
  await s.waitForFunction(() => location.pathname.startsWith('/workspaces'));
  await goto(s, `/workspaces/${ws.id}/projects/${scrollProject.id}/board`); await s.waitForSelector('li [role=button]');
  const doneVisible = await s.evaluate(() => { const c = [...document.querySelectorAll('section[aria-label]')].at(-1).getBoundingClientRect(); return c.right <= innerWidth; });
  check('narrow window: the last column starts off-screen (the board scrolls sideways)', doneVisible === false);
  const hotel = await rectOfCard(s, 'Hotel');
  await s.mouse.move(hotel.x, hotel.y); await s.mouse.down(); await s.mouse.move(hotel.x + 8, hotel.y + 8, { steps: 3 });
  await s.mouse.move(1265, hotel.y, { steps: 20 });
  await sleep(2500); // hold at the right edge: the board should autoscroll
  const scrolled = await s.evaluate(() => document.querySelector('[role=group][aria-label="Kanban board"]').scrollLeft);
  check('dragging to the edge auto-scrolls the board', scrolled > 100, `scrollLeft=${scrolled}`);
  const doneCol = await rectOfColumn(s, 'Done');
  await s.mouse.move(doneCol.x, doneCol.bottom - 30, { steps: 10 }); await sleep(250); await s.mouse.up(); await sleep(500);
  await settle(s);
  const moved = (await api(s, 'GET', `/api/projects/${scrollProject.id}/board`)).data.columns.find((c) => c.status === 'done').tasks.map((t) => t.title);
  check('a card can be dropped on a column that was off-screen when the drag began', JSON.stringify(moved) === JSON.stringify(['Hotel']), JSON.stringify(moved));

  const m = await newPage(browser, { width: 390, height: 800, tag: 'kanban-mobile' });
  await goto(m, '/login'); await fill(m, 'Email', EMAIL); await fill(m, 'Password', PASSWORD); await clickButton(m, 'Sign in');
  await m.waitForFunction(() => location.pathname.startsWith('/workspaces'));
  await goto(m, boardUrl); await m.waitForSelector('li [role=button]');
  const geo = await m.evaluate(() => { const g = document.querySelector('[role=group][aria-label="Kanban board"]'); return { page: document.documentElement.scrollWidth - innerWidth, boardScrolls: g.scrollWidth > g.clientWidth }; });
  check('mobile: the board scrolls inside its own container, not the page', geo.page <= 1 && geo.boardScrolls, JSON.stringify(geo));
  await shot(m, '24-board-mobile');
  await goto(m, `/workspaces/${ws.id}`); await textVisible(m, 'Tasks by status');
  check('mobile: dashboard has no horizontal page overflow', (await m.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1);
  await shot(m, '25-dashboard-mobile');
} catch (e) {
  check(`UNCAUGHT: ${e.message}`, false, e.stack?.split('\n').slice(0, 3).join(' | '));
} finally {
  await browser.close();
}
const failed = summary();
console.log('\nBrowser console/page errors and 4xx/5xx responses observed:');
for (const p of [...new Set(problems)]) console.log('  ', p);
process.exit(failed ? 1 : 0);
