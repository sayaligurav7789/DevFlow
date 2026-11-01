import fs from 'node:fs';
import { clickLinkContaining, clickButton, fill, goto, launch, newPage, sleep, textVisible } from './lib.mjs';
const axeSrc = fs.readFileSync(new URL('./node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
const stamp = Date.now().toString(36);
const D = '[role=dialog]';
const b = await launch(); const a = await newPage(b, { tag: 'axe' });
const all = [];
async function audit(label) {
  await sleep(600);
  await a.evaluate(axeSrc);
  const res = await a.evaluate(async () => {
    const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ') + ' :: ' + (n.failureSummary || '').split('\n').slice(1, 2).join('')) }));
  });
  console.log(`${res.length === 0 ? 'CLEAN' : 'ISSUES'}  ${label}`);
  for (const v of res) { console.log(`   [${v.impact}] ${v.id}: ${v.help}`); for (const n of v.nodes) console.log('       ', n.slice(0, 190)); }
  all.push(...res.map((v) => ({ label, ...v })));
}
await goto(a, '/login'); await audit('login (light)');
await goto(a, '/register');
await fill(a, 'Full name', 'Axe User'); await fill(a, 'Email', `axe-${stamp}@example.test`); await fill(a, 'Password', 'correct-horse-battery');
await clickButton(a, 'Create account'); await textVisible(a, 'Create your first workspace');
await audit('workspaces empty');
await clickButton(a, 'Create workspace'); await a.waitForSelector(D); await audit('create-workspace dialog');
await fill(a, 'Name', 'Axe ' + stamp, D); await clickButton(a, 'Create workspace', D);
await a.waitForFunction(() => /^\/workspaces\/\d+$/.test(location.pathname)); await textVisible(a, 'Hi, Axe'); await audit('overview');
const wsId = new URL(a.url()).pathname.split('/')[2];
await clickButton(a, 'Projects'); await textVisible(a, 'No projects yet'); await audit('projects empty');
await clickButton(a, 'New project'); await a.waitForSelector(D); await fill(a, 'Name', 'Axe Project', D); await clickButton(a, 'Create project', D);
await a.waitForFunction(() => /\/projects\/\d+$/.test(location.pathname)); await textVisible(a, 'No tasks yet'); await audit('project detail empty');
await clickButton(a, 'New task'); await a.waitForSelector(D); await audit('new-task dialog');
await fill(a, 'Title', 'Audit me', D); await clickButton(a, 'Create task', D); await textVisible(a, 'Audit me'); await sleep(500);
await audit('project detail with tasks');
await clickButton(a, 'Audit me'); await a.waitForSelector(D); await textVisible(a, 'created this task'); await audit('edit-task dialog');
await a.keyboard.press('Escape');
await clickButton(a, 'Status: Todo. Change status'); await a.waitForSelector('[role=menu]'); await audit('status menu open'); await a.keyboard.press('Escape');
await goto(a, `/workspaces/${wsId}/tasks?status=all`); await textVisible(a, 'Audit me'); await audit('my tasks');
await goto(a, `/workspaces/${wsId}/team`); await textVisible(a, 'Axe User'); await audit('team');
await clickButton(a, 'Invite people'); await a.waitForSelector(D); await audit('invite dialog'); await a.keyboard.press('Escape');
await goto(a, `/workspaces/${wsId}/settings`); await textVisible(a, 'General'); await audit('workspace settings');
await goto(a, '/settings'); await textVisible(a, 'Appearance'); await audit('profile settings (light)');
await clickButton(a, 'Dark'); await audit('profile settings (dark)');
await goto(a, `/workspaces/${wsId}/projects`); await audit('projects list (dark)');
await goto(a, `/workspaces/${wsId}/tasks?status=all`); await sleep(800); await audit('my tasks (dark)');
await goto(a, `/workspaces/${wsId}/projects`); await clickLinkContaining(a, 'Axe Project'); await textVisible(a, 'Audit me'); await audit('project detail (dark)');
await clickButton(a, 'Audit me'); await a.waitForSelector(D); await textVisible(a, 'created this task'); await audit('edit-task dialog (dark)');
await b.close();
const byRule = {}; for (const v of all) byRule[v.id] = (byRule[v.id] ?? 0) + 1;
console.log('\nSUMMARY', JSON.stringify(byRule));
