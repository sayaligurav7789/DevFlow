import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const BASE = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173';
const CHROME = process.env.CHROME_PATH;
if (!CHROME) throw new Error('Set CHROME_PATH to a Chrome/Chromium executable.');
export const results = [];
export const problems = [];
export function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? '  -> ' + detail : ''}`);
}
export async function launch() {
  return puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--font-render-hinting=none'] });
}
export async function newPage(browser, { width = 1280, height = 860, tag = 'page' } = {}) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width, height });
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`[${tag}] console: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`[${tag}] pageerror: ${e.message}`));
  page.on('response', (r) => {
    const s = r.status();
    if (r.url().includes('/api/') && s >= 400) problems.push(`[${tag}] ${s} ${r.request().method()} ${new URL(r.url()).pathname}${new URL(r.url()).search}`);
  });
  page.setDefaultTimeout(8000);
  return page;
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function goto(page, path) { await page.goto(BASE + path, { waitUntil: 'networkidle0' }); }
export async function textVisible(page, text, timeout = 6000) {
  try { await page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, text); return true; } catch { return false; }
}
export async function textGone(page, text, timeout = 6000) {
  try { await page.waitForFunction((t) => !document.body.innerText.includes(t), { timeout }, text); return true; } catch { return false; }
}
// Fill an input by its <label> text (uses htmlFor -> id), clearing existing value first.
export async function fill(page, label, value, scope = 'body') {
  const id = await page.evaluate((label, scope) => {
    const root = document.querySelector(scope) ?? document.body;
    const l = [...root.querySelectorAll('label')].find((x) => x.textContent.trim().startsWith(label));
    return l?.htmlFor ?? null;
  }, label, scope);
  if (!id) throw new Error(`No label "${label}"`);
  const sel = `[id="${id}"]`;
  await clearInput(page, sel);
  if (value !== '') await page.type(sel, value);
}
export async function select(page, label, value, scope = 'body') {
  const id = await page.evaluate((label, scope) => {
    const root = document.querySelector(scope) ?? document.body;
    const l = [...root.querySelectorAll('label')].find((x) => x.textContent.trim().startsWith(label));
    return l?.htmlFor ?? null;
  }, label, scope);
  if (!id) throw new Error(`No label "${label}"`);
  await page.select(`[id="${id}"]`, value);
}
export async function clickButton(page, text, scope = 'body') {
  const ok = await page.evaluate((text, scope) => {
    const root = scope.endsWith('|last') ? [...document.querySelectorAll(scope.slice(0, -5))].at(-1) : (document.querySelector(scope) ?? document.body);
    const b = [...root.querySelectorAll('button,a')].find((x) => x.textContent.trim() === text || x.getAttribute('aria-label') === text);
    if (!b) return false; b.click(); return true;
  }, text, scope);
  if (!ok) throw new Error(`No button "${text}"`);
}
export async function shot(page, name) { await sleep(700); fs.mkdirSync(path.join(HERE, 'shots'), { recursive: true });
  await page.screenshot({ path: path.join(HERE, 'shots', `${name}.png`) }); }
export function summary() {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  return failed.length;
}

export async function clearInput(page, sel) {
  await page.focus(sel);
  await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
}

export async function clickLinkContaining(page, text) {
  const ok = await page.evaluate((text) => {
    const a = [...document.querySelectorAll('a')].find((x) => x.textContent.includes(text));
    if (!a) return false; a.click(); return true;
  }, text);
  if (!ok) throw new Error(`No link containing "${text}"`);
}
