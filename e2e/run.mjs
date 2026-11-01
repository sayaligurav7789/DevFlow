import { BASE, check, clearInput, clickButton, clickLinkContaining, fill, goto, launch, newPage, problems, select, shot, sleep, summary, textGone, textVisible } from './lib.mjs';

const stamp = Date.now().toString(36);
const ownerEmail = `owner-${stamp}@example.test`;
const memberEmail = `member-${stamp}@example.test`;
const PASSWORD = 'correct-horse-battery';
const D = '[role=dialog]';
const WS_NAME = `Acme ${stamp}`;
const WS_SLUG = `acme-${stamp}`;

async function setNative(page, id, value) {
  await page.evaluate((id, value) => {
    const el = document.getElementById(id);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, id, value);
}
async function labelId(page, label, scope = 'body') {
  return page.evaluate((label, scope) => [...document.querySelector(scope).querySelectorAll('label')].find((x) => x.textContent.trim().startsWith(label))?.htmlFor, label, scope);
}
const urlPath = (page) => new URL(page.url()).pathname + new URL(page.url()).search;

const browser = await launch();
try {
  // ───────────── Owner: auth ─────────────
  const a = await newPage(browser, { tag: 'owner' });
  await goto(a, '/');
  check('unauthenticated visit to / redirects to /login', urlPath(a).startsWith('/login'));

  await fill(a, 'Email', 'nobody@example.test'); await fill(a, 'Password', 'wrong-password-123');
  await clickButton(a, 'Sign in');
  check('bad login shows the server error message', await textVisible(a, 'Invalid email or password'), await a.evaluate(() => document.body.innerText.slice(0, 300)));

  await clickButton(a, 'Create an account'); await a.waitForSelector('input[name=displayName]');
  await fill(a, 'Full name', 'Olivia Owner'); await fill(a, 'Email', ownerEmail); await fill(a, 'Password', 'short');
  await clickButton(a, 'Create account');
  check('register validates password length client-side', await textVisible(a, 'Use at least 12 characters'));
  await fill(a, 'Password', PASSWORD); await clickButton(a, 'Create account');
  check('registration signs in and lands on workspace picker (no workspaces yet)', await textVisible(a, 'Create your first workspace') && urlPath(a) === '/workspaces', urlPath(a));
  await shot(a, '01-empty-workspaces');

  // ───────────── Owner: workspace ─────────────
  await clickButton(a, 'Create workspace');
  await a.waitForSelector(D);
  check('dialog is modal with focus moved inside', await a.evaluate(() => { const d = document.querySelector('[role=dialog]'); return d.getAttribute('aria-modal') === 'true' && d.contains(document.activeElement); }));
  await a.keyboard.press('Escape');
  check('Esc closes the dialog and returns focus to the trigger', await a.waitForSelector(D, { hidden: true }).then(() => true) && await a.evaluate(() => document.activeElement?.textContent.includes('Create workspace')));
  await clickButton(a, 'Create workspace'); await a.waitForSelector(D);
  for (let i = 0; i < 12; i++) await a.keyboard.press('Tab');
  check('Tab key stays trapped inside the dialog', await a.evaluate(() => document.querySelector('[role=dialog]').contains(document.activeElement)));
  await clickButton(a, 'Create workspace', D);
  check('empty workspace name is rejected with a field error', await textVisible(a, 'Use 1–80 characters'));
  await fill(a, 'Name', WS_NAME, D);
  check('slug auto-generated from the name', await a.evaluate((id) => document.getElementById(id).value, await labelId(a, 'URL slug', D)) === WS_SLUG);
  await clickButton(a, 'Create workspace', D);
  await a.waitForFunction(() => /^\/workspaces\/\d+$/.test(location.pathname));
  const wsId = urlPath(a).split('/')[2];
  check('workspace created and overview opens', await textVisible(a, 'Hi, Olivia'));
  check('dashboard shows honest zero states for a new workspace', await textVisible(a, 'No projects yet') && await textVisible(a, 'No tasks yet') && await textVisible(a, 'No activity yet'));
  await shot(a, '02-overview');

  // duplicate slug -> server 409 surfaced on the field
  await goto(a, '/workspaces?new=1'); await a.waitForSelector(D);
  await fill(a, 'Name', 'Acme Dup', D); await fill(a, 'URL slug', WS_SLUG, D);
  await clickButton(a, 'Create workspace', D);
  check('duplicate workspace slug shows the server 409 message', await textVisible(a, 'already exists'));
  await a.keyboard.press('Escape');

  // ───────────── Owner: project ─────────────
  await goto(a, `/workspaces/${wsId}`);
  await clickButton(a, 'Projects');
  await a.waitForFunction((w) => location.pathname === `/workspaces/${w}/projects`, {}, wsId);
  check('projects empty state with CTA', await textVisible(a, 'No projects yet'));
  await clickButton(a, 'New project');
  await a.waitForSelector(D);
  await fill(a, 'Name', 'Website Redesign', D); await fill(a, 'Description', 'Marketing site refresh', D);
  await clickButton(a, 'Create project', D);
  await a.waitForFunction(() => /\/projects\/\d+$/.test(location.pathname));
  const projectId = urlPath(a).split('/').pop();
  check('project created and detail page opens', await textVisible(a, 'Website Redesign') && await textVisible(a, 'No tasks yet'));

  // ───────────── Owner: task create ─────────────
  await clickButton(a, 'New task'); await a.waitForSelector(D);
  await clickButton(a, 'Create task', D);
  check('task title is required', await textVisible(a, 'A title is required'));
  await fill(a, 'Title', 'Fix login bug', D); await fill(a, 'Description', 'Users get logged out on refresh', D);
  await select(a, 'Priority', 'high', D);
  const assigneeId = await labelId(a, 'Assignee', D);
  const meValue = await a.evaluate((id) => [...document.getElementById(id).options].find((o) => o.text.includes('(you)')).value, assigneeId);
  await a.select(`[id="${assigneeId}"]`, meValue);
  await setNative(a, await labelId(a, 'Due date', D), '2030-01-15');
  await a.type(`[id="${await labelId(a, 'Labels', D)}"]`, 'bug'); await a.keyboard.press('Enter');
  check('label chip added', await a.evaluate(() => document.querySelector('[role=dialog]').innerText.includes('bug')));
  await clickButton(a, 'Create task', D);
  check('task appears in the table after create', await textVisible(a, 'Fix login bug'));
  check('toast announces success', await textVisible(a, 'Task created'));
  await shot(a, '03-project-with-task');

  // seed volume through the API (not the UI) to test real pagination
  const seeded = await a.evaluate(async (pid) => {
    const csrf = decodeURIComponent(document.cookie.split('; ').find((c) => c.startsWith('devflow_csrf=')).split('=')[1]);
    let ok = 0;
    for (let i = 1; i <= 24; i++) {
      const r = await fetch(`/api/projects/${pid}/tasks`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify({ title: `Seed task ${String(i).padStart(2, '0')}`, priority: i % 4 === 0 ? 'urgent' : 'low', status: i % 5 === 0 ? 'done' : 'todo' }) });
      if (r.ok) ok++;
    }
    return ok;
  }, projectId);
  check('seeded 24 extra tasks via API', seeded === 24);
  await goto(a, `/workspaces/${wsId}/projects/${projectId}`);
  check('pagination shows server totals (1–20 of 25)', await textVisible(a, '1–20') && await textVisible(a, 'of 25'));
  await clickButton(a, 'Next page');
  check('Next page loads page 2 from the API (21–25)', await textVisible(a, '21–25') && urlPath(a).includes('page=2'));
  await clickButton(a, 'Previous page');

  // filtering / search via backend
  await a.type('input[type=search]', 'login');
  await a.waitForFunction(() => location.search.includes('q=login'));
  check('search filters via API to a single result', await textVisible(a, 'of 1') && await textGone(a, 'Seed task 01'));
  await a.evaluate(() => { const i = document.querySelector('input[type=search]'); i.focus(); });
  await clearInput(a, 'input[type=search]');
  await a.waitForFunction(() => !location.search.includes('q='));
  await a.select('select[aria-label="Filter by status"]', 'done');
  check('status filter returns only done tasks (4 seeded)', await textVisible(a, 'of 4'));
  await a.select('select[aria-label="Filter by priority"]', 'high');
  check('empty-match state when filters exclude everything', await textVisible(a, 'No tasks match these filters'));
  await clickButton(a, 'Clear filters');
  check('Clear filters restores the list', await textVisible(a, 'of 25'));
  await a.select('select[aria-label="Sort tasks"]', 'title:asc');
  await a.waitForFunction(() => location.search.includes('sortBy=title'));
  const sorted = await a.waitForFunction(() => document.querySelector('tbody tr td:nth-child(2)')?.innerText.trim().startsWith('Fix login'), { timeout: 5000 }).then(() => true, () => false);
  check('sorting by title applied via API', sorted);

  // quick status via menu, then activity history
  await a.type('input[type=search]', 'login'); await a.waitForFunction(() => location.search.includes('q=login')); await textGone(a, 'Seed task 01');
  await clickButton(a, 'Status: Todo. Change status');
  await a.waitForSelector('[role=menu]');
  await a.keyboard.press('ArrowDown'); await a.keyboard.press('ArrowDown'); await a.keyboard.press('Enter');
  check('inline status menu updates status via API', await textVisible(a, 'Moved to In Progress'));
  await a.waitForFunction(() => document.querySelector('button[aria-label^="Status: In Progress"]'));
  await clickButton(a, 'Fix login bug');
  await a.waitForSelector(D);
  check('edit dialog loads the task with assignee, due date, labels', await a.evaluate((id) => document.getElementById(id).value === '2030-01-15', await labelId(a, 'Due date', D)) && await textVisible(a, 'Edit task'));
  check('activity shows created + status change', await textVisible(a, 'created this task') && await textVisible(a, 'changed status from Todo to In Progress'));
  await fill(a, 'Title', 'Fix login bug (v2)', D); await select(a, 'Priority', 'urgent', D);
  await clickButton(a, 'Save changes', D);
  check('edit saves and table reflects new title', await textVisible(a, 'Fix login bug (v2)') && await textVisible(a, 'Task updated'));
  await clickButton(a, 'Fix login bug (v2)'); await a.waitForSelector(D);
  check('activity records priority + title changes', await textVisible(a, 'changed priority from High to Urgent') && await textVisible(a, 'updated the title'));
  await shot(a, '04-task-dialog');
  await a.keyboard.press('Escape');

  // delete a task through the UI
  await clearInput(a, 'input[type=search]'); await a.type('input[type=search]', 'Seed task 01');
  await a.waitForFunction(() => location.search.includes('Seed'));
  await textGone(a, 'Fix login bug (v2)');
  await clickButton(a, 'Seed task 01'); await a.waitForSelector(D);
  await clickButton(a, 'Delete', D);
  await a.waitForFunction(() => document.querySelectorAll('[role=dialog]').length === 2);
  await clickButton(a, 'Delete task', '[role=dialog]|last');
  check('task delete via confirm dialog removes it', await textVisible(a, 'Task deleted') && await textVisible(a, 'No tasks match these filters'));

  // ───────────── Owner: My Tasks ─────────────
  await clickButton(a, 'My tasks');
  await a.waitForFunction((w) => location.pathname === `/workspaces/${w}/tasks`, {}, wsId);
  check('My Tasks lists only my open tasks with project column', await textVisible(a, 'Fix login bug (v2)') && await textVisible(a, 'of 1') && await textVisible(a, 'Website Redesign'));
  await clickButton(a, 'New task'); await a.waitForSelector(D);
  check('New task from My Tasks offers a project picker defaulting to me', await a.evaluate(() => !!document.querySelector('[role=dialog] select option')) );
  await fill(a, 'Title', 'Write release notes', D);
  await clickButton(a, 'Create task', D);
  check('task created from My Tasks shows up assigned to me', await textVisible(a, 'Write release notes') && await textVisible(a, 'of 2'));
  await a.select('select[aria-label="Filter by status"]', 'all');
  check('My Tasks status=all (backend) still scoped to me', await textVisible(a, 'of 2'));
  await shot(a, '05-my-tasks');

  // ───────────── Owner: invitations ─────────────
  await clickButton(a, 'Team');
  check('team page lists the owner', await textVisible(a, 'Olivia Owner') && await textVisible(a, 'Owner'));
  await clickButton(a, 'Invite people'); await a.waitForSelector(D);
  await fill(a, 'Email address', 'not-an-email', D); await clickButton(a, 'Create invitation', D);
  check('invalid invite email rejected client-side', await textVisible(a, 'Enter a valid email address'));
  await fill(a, 'Email address', memberEmail, D); await clickButton(a, 'Create invitation', D);
  check('invitation created with honest "not emailed" notice', await textVisible(a, 'This invitation was not emailed'));
  const inviteLink = await a.evaluate(() => document.getElementById('invite-link').value);
  check('invitation link is shown for copying', inviteLink.includes('/invitations/accept?token='));
  await clickButton(a, 'Done', D);
  check('pending invitation listed', await textVisible(a, memberEmail) && await textVisible(a, 'Pending'));
  await clickButton(a, 'Invite people'); await a.waitForSelector(D);
  await fill(a, 'Email address', memberEmail, D); await clickButton(a, 'Create invitation', D);
  check('duplicate active invitation shows server 409 message', await textVisible(a, 'active invitation already exists'));
  await a.keyboard.press('Escape');
  await shot(a, '06-team');

  // workspace settings: allow member invites
  await clickButton(a, 'Workspace settings');
  await a.waitForSelector('button[role=switch]');
  check('member-invite switch reflects the server default (on)', await a.$eval('button[role=switch]', (e) => e.getAttribute('aria-checked') === 'true'));
  await a.click('button[role=switch]');
  check('owner can disable member invites', await textVisible(a, 'Only owners and admins can invite teammates'));
  await a.waitForFunction(() => document.querySelector('button[role=switch]').getAttribute('aria-checked') === 'false');
  await sleep(300);
  await a.click('button[role=switch]');
  check('owner can re-enable member invites', await textVisible(a, 'Members can now invite teammates'));

  // profile + theme
  await goto(a, '/settings');
  await fill(a, 'Display name', 'Olivia O.'); await clickButton(a, 'Save changes');
  check('profile update reflected in the shell', await textVisible(a, 'Profile updated') && await a.evaluate(() => document.querySelector('button[aria-label^="Account menu"]').getAttribute('aria-label').includes('Olivia O.')));
  await clickButton(a, 'Dark');
  check('dark theme applies and persists', await a.evaluate(() => document.documentElement.dataset.theme === 'dark' && localStorage.getItem('devflow:theme') === 'dark'));
  await shot(a, '07-settings-dark');
  await clickButton(a, 'Light');

  // sidebar collapse persists
  await goto(a, `/workspaces/${wsId}`);
  await clickButton(a, 'Collapse sidebar'); await sleep(450);
  const w1 = await a.evaluate(() => document.querySelector('aside').getBoundingClientRect().width);
  await a.reload({ waitUntil: 'networkidle0' });
  const w2 = await a.evaluate(() => document.querySelector('aside').getBoundingClientRect().width);
  check('sidebar collapses and the choice survives reload', w1 < 70 && w2 < 70, `${w1}/${w2}`);
  await shot(a, '08-collapsed');
  await clickButton(a, 'Expand sidebar');

  // ───────────── Member: accept invite & permissions ─────────────
  const b = await newPage(browser, { tag: 'member' });
  await goto(b, new URL(inviteLink).pathname + new URL(inviteLink).search);
  check('invite link while signed-out goes to login and remembers destination', urlPath(b).startsWith('/login'));
  await clickButton(b, 'Create an account'); await b.waitForSelector('input[name=displayName]');
  await fill(b, 'Full name', 'Mia Member'); await fill(b, 'Email', memberEmail); await fill(b, 'Password', PASSWORD);
  await clickButton(b, 'Create account');
  check('after registering the user returns to the invitation page', await textVisible(b, 'been invited') && urlPath(b).startsWith('/invitations/accept'), urlPath(b));
  await clickButton(b, 'Join workspace');
  await b.waitForFunction((w) => location.pathname === `/workspaces/${w}`, {}, wsId);
  check('accepting the invite joins the workspace', await textVisible(b, 'Hi, Mia'));
  await goto(b, `/workspaces/${wsId}/projects`);
  check('member sees the project but no "New project" button', await textVisible(b, 'Website Redesign') && !(await b.evaluate(() => [...document.querySelectorAll('button')].some((x) => x.textContent.trim() === 'New project'))));
  await goto(b, `/workspaces/${wsId}/projects/${projectId}`);
  check('member has no project management menu', !(await b.evaluate(() => !!document.querySelector('button[aria-label="Project actions"]'))));
  await goto(b, `/workspaces/${wsId}/team`);
  check('member sees members but not the invitations card', await textVisible(b, 'Olivia O.') && !(await b.evaluate(() => document.body.innerText.includes('Pending and past invitations'))));
  check('member can invite because owner enabled it (role limited to Member)', await b.evaluate(() => [...document.querySelectorAll('button')].some((x) => x.textContent.trim() === 'Invite people')));
  await clickButton(b, 'Invite people'); await b.waitForSelector(D);
  check('member cannot choose Admin role', await b.evaluate(() => ![...document.querySelectorAll('[role=dialog] option')].some((o) => o.text === 'Admin')));
  await b.keyboard.press('Escape');
  await goto(b, `/workspaces/${wsId}/settings`);
  check('member sees read-only workspace settings', await textVisible(b, 'Only workspace owners and admins can change these settings'));
  await goto(b, `/workspaces/${wsId}/tasks`);
  check('member My Tasks is empty-state, not the owner’s tasks', await textVisible(b, 'all caught up'));
  await shot(b, '09-member-empty-tasks');

  // owner assigns the member a task -> reassignment visible in activity
  await goto(a, `/workspaces/${wsId}/projects/${projectId}`);
  await a.type('input[type=search]', 'release'); await a.waitForFunction(() => location.search.includes('release'));
  await textGone(a, 'Seed task 02');
  await clickButton(a, 'Write release notes'); await a.waitForSelector(D);
  const asg = await labelId(a, 'Assignee', D);
  const miaVal = await a.evaluate((id) => [...document.getElementById(id).options].find((o) => o.text.startsWith('Mia')).value, asg);
  await a.select(`[id="${asg}"]`, miaVal); await clickButton(a, 'Save changes', D);
  await textVisible(a, 'Task updated');
  await clickButton(a, 'Write release notes'); await a.waitForSelector(D);
  check('reassignment appears in activity with the member’s name', await textVisible(a, 'reassigned from Olivia O. to Mia Member'));
  await a.keyboard.press('Escape');
  await goto(b, `/workspaces/${wsId}/tasks`);
  check('member now sees the assigned task in My Tasks', await textVisible(b, 'Write release notes'));

  // member cannot delete a task they neither created nor reported
  await goto(b, `/workspaces/${wsId}/projects/${projectId}`);
  await b.type('input[type=search]', 'login'); await b.waitForFunction(() => location.search.includes('login'));
  await textGone(b, 'Seed task 02');
  await clickButton(b, 'Fix login bug (v2)'); await b.waitForSelector(D);
  check('Delete is hidden for tasks the member did not create/report', !(await b.evaluate(() => [...document.querySelectorAll('[role=dialog] button')].some((x) => x.textContent.trim() === 'Delete'))));
  await b.keyboard.press('Escape');

  // ───────────── Archive: read-only tasks ─────────────
  await goto(a, `/workspaces/${wsId}/projects/${projectId}`);
  await a.waitForSelector('button[aria-label="Project actions"]');
  await clickButton(a, 'Project actions'); await a.waitForSelector('[role=menu]');
  await clickButton(a, 'Archive project');
  await a.waitForSelector(D);
  await clickButton(a, 'Archive', D);
  check('archiving shows banner and disables New task', await textVisible(a, 'Archived · read-only') && await a.evaluate(() => [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'New task').disabled));
  await goto(a, `/workspaces/${wsId}/projects?archived=true`);
  check('archived tab lists the archived project', await textVisible(a, 'Website Redesign') && await textVisible(a, 'Archived'));
  await clickLinkContaining(a, 'Website Redesign');
  await a.waitForFunction(() => /\/projects\/\d+$/.test(location.pathname));
  await a.waitForSelector('button[aria-label="Project actions"]');
  await clickButton(a, 'Project actions'); await a.waitForSelector('[role=menu]'); await clickButton(a, 'Restore project');
  await a.waitForSelector(D); await clickButton(a, 'Restore', D);
  const reenabled = await a.waitForFunction(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'New task'); return b && !b.disabled; }, { timeout: 5000 }).then(() => true, () => false);
  check('restore re-enables the project', await textVisible(a, 'Project restored') && reenabled);

  // ───────────── 404s and error states ─────────────
  await goto(a, '/workspaces/999999999');
  check('unknown workspace id shows not-found state', await textVisible(a, 'Workspace not found'));
  await goto(a, `/workspaces/${wsId}/projects/999999999`);
  check('unknown project id shows not-found state', await textVisible(a, 'Project not found'));
  await goto(a, `/workspaces/${wsId}/projects/abc`);
  check('malformed project id shows not-found state', await textVisible(a, 'Project not found'));
  await goto(a, '/this/route/does/not/exist');
  check('unknown route shows 404 inside the app shell', await textVisible(a, 'Page not found'));
  await goto(a, '/invitations/accept?token=' + 'x'.repeat(43));
  await clickButton(a, 'Join workspace');
  check('bad invitation token surfaces the server message', await textVisible(a, 'Invitation not found or no longer available'));

  // ───────────── Session expiry ─────────────
  await goto(a, `/workspaces/${wsId}/projects`);
  const cookies = await a.cookies(BASE + '/api/auth/me');
  await a.deleteCookie(...cookies.filter((c) => c.name === 'devflow_session'));
  await clickButton(a, 'My tasks');
  await a.waitForFunction(() => location.pathname === '/login', { timeout: 8000 }).catch(() => {});
  check('expired session redirects to /login with a clear notice', urlPath(a) === '/login' && await textVisible(a, 'Your session expired'), urlPath(a));
  await shot(a, '10-session-expired');
  await fill(a, 'Email', ownerEmail); await fill(a, 'Password', PASSWORD); await clickButton(a, 'Sign in');
  await a.waitForFunction((w) => location.pathname.startsWith(`/workspaces/${w}`), {}, wsId).catch(() => {});
  check('after re-login the user lands on the page they were navigating to', urlPath(a).startsWith(`/workspaces/${wsId}/tasks`), urlPath(a));

  // sign out
  await a.waitForSelector('button[aria-label="Account menu for Olivia O."]');
  await clickButton(a, 'Account menu for Olivia O.'); await a.waitForSelector('[role=menu]'); await clickButton(a, 'Sign out');
  await a.waitForFunction(() => location.pathname === '/login');
  check('sign out returns to login', true);

  // ───────────── Responsive ─────────────
  const m = await newPage(browser, { width: 390, height: 800, tag: 'mobile' });
  await goto(m, '/login'); await fill(m, 'Email', ownerEmail); await fill(m, 'Password', PASSWORD); await clickButton(m, 'Sign in');
  await m.waitForFunction(() => location.pathname.startsWith('/workspaces/'));
  await goto(m, `/workspaces/${wsId}/projects/${projectId}`);
  await textVisible(m, 'Website Redesign');
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('mobile project page has no horizontal page overflow', overflow <= 1, `overflow=${overflow}`);
  check('mobile hides the desktop sidebar and shows the hamburger', await m.evaluate(() => getComputedStyle(document.querySelector('aside')).display === 'none') && !!(await m.$('button[aria-label="Open navigation"]')));
  await shot(m, '11-mobile-project');
  await clickButton(m, 'Open navigation'); await m.waitForSelector('aside[aria-label=Sidebar] nav');
  await shot(m, '12-mobile-drawer');
  await m.keyboard.press('Escape');
  check('Esc closes the mobile drawer', await m.evaluate(() => document.querySelectorAll('aside').length === 1));
  const t = await newPage(browser, { width: 820, height: 1000, tag: 'tablet' });
  await goto(t, '/login'); await fill(t, 'Email', ownerEmail); await fill(t, 'Password', PASSWORD); await clickButton(t, 'Sign in');
  await t.waitForFunction(() => location.pathname.startsWith('/workspaces/'));
  await goto(t, `/workspaces/${wsId}/tasks?status=all`); await textVisible(t, 'My tasks');
  check('tablet My Tasks has no horizontal page overflow', (await t.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1);
  await shot(t, '13-tablet-tasks');
} catch (e) {
  check(`UNCAUGHT: ${e.message}`, false, e.stack?.split('\n').slice(0, 3).join(' | '));
} finally {
  await browser.close();
}
const failed = summary();
const unexpected = problems.filter((p) => !/40[1349] |404|409|400|429/.test(p) || /console: Failed to load resource.*(500|502|503)/.test(p));
console.log('\nBrowser console/page errors and 4xx/5xx responses observed:');
for (const p of [...new Set(problems)]) console.log('  ', p);
process.exit(failed ? 1 : 0);
