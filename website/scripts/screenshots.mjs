/**
 * Captures the website screenshots: one focused image per feature.
 *
 *   pnpm --filter @avinash-baraiya/pragma-website screenshots
 *
 * Starts the VitePress dev server with the screenshot stage enabled (a trimmed
 * playground on a plain background), drives it with Playwright and writes PNGs
 * to public/screenshots/. Requires `npx playwright install chromium` once.
 */
/* global document -- used inside callbacks that run in the browser page */
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'screenshots');
const port = 5179;
const url = `http://localhost:${port}/Pragma/screenshot-stage`;
const PAD = 24;

const server = spawn('pnpm', ['exec', 'vitepress', 'dev', '--port', String(port), '--strictPort'], {
  cwd: root,
  env: { ...process.env, PRAGMA_BASE: '/Pragma/', PRAGMA_SCREENSHOTS: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (chunk) => (serverLog += chunk));
server.stderr.on('data', (chunk) => (serverLog += chunk));

try {
  await waitForServer(url, 60_000);
  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1000, height: 1400 },
    deviceScaleFactor: 3,
    colorScheme: 'light',
    timezoneId: 'Asia/Kolkata',
  });
  await page.goto(url);
  await page.addStyleTag({
    content:
      '.VPNav, .VPLocalNav, .VPFooter { display: none !important; } .VPContent { padding-top: 0 !important; }',
  });
  await page.evaluate(() => document.fonts.ready);

  const input = page.getByRole('combobox');
  await input.waitFor({ timeout: 30_000 });
  const askbar = page.locator('[data-pragma-askbar]');
  const chips = page.locator('[data-pragma-chips]');
  const table = page.locator('.pg__table');

  /** Screenshot the area covering all `targets`, with even padding. */
  const shoot = async (name, targets) => {
    await page.mouse.move(0, 0);
    await page.waitForTimeout(300);
    // Hide everything in the playground that is not part of this shot.
    const handles = await Promise.all(targets.map((t) => t.elementHandle()));
    await page.evaluate((els) => {
      for (const node of document.querySelectorAll('.pg *')) {
        const keep = els.some((el) => el.contains(node) || node.contains(el));
        node.style.visibility = keep ? '' : 'hidden';
      }
    }, handles);
    const boxes = [];
    for (const target of targets) {
      const box = await target.boundingBox();
      if (!box) throw new Error(`${name}: an element to capture is not visible`);
      boxes.push(box);
    }
    const x = Math.min(...boxes.map((b) => b.x)) - PAD;
    const y = Math.min(...boxes.map((b) => b.y)) - PAD;
    const right = Math.max(...boxes.map((b) => b.x + b.width)) + PAD;
    const bottom = Math.max(...boxes.map((b) => b.y + b.height)) + PAD;
    await page.screenshot({
      path: join(outDir, `${name}.png`),
      clip: { x, y, width: right - x, height: bottom - y },
      animations: 'disabled',
    });
    await page.evaluate(() => {
      for (const node of document.querySelectorAll('.pg *')) node.style.visibility = '';
    });
    console.log(`✓ ${name}.png`);
  };
  const ask = async (instruction) => {
    await input.fill(instruction);
    await input.press('Escape');
    await input.press('Enter');
    await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
    await page.waitForTimeout(200);
  };

  // 1. @ autocomplete: the ask bar and its suggestions.
  await input.pressSequentially('customers with @re');
  const listbox = page.getByRole('listbox');
  await listbox.waitFor();
  await shoot('autocomplete', [askbar, listbox]);
  await input.press('Escape');

  // 2. Results: instruction, chips and the filtered table.
  await ask('active enterprise customers, country is India, newest first, 5 per page');
  await chips.getByRole('button').first().waitFor();
  // Show what was typed (the bar clears after a successful submit).
  await input.fill('active enterprise customers, country is India, newest first, 5 per page');
  await input.blur();
  await shoot('results', [askbar, chips, table]);
  await input.fill('');

  // 3. Explanation and payload.
  await page.locator('.pg__inspector summary').click();
  await shoot('explanation', [
    page.locator('[data-pragma-explanation]'),
    page.locator('.pg__inspector'),
  ]);
  await page.locator('.pg__inspector summary').click();

  // 4. Clarification.
  await ask('reset');
  await ask('recent customers');
  const clarification = page.locator('[data-pragma-clarification]');
  await clarification.waitFor();
  await shoot('clarification', [askbar, clarification]);

  // 5. Refusal with suggestions.
  await clarification.getByRole('button', { name: 'Dismiss' }).click();
  await ask('profitable customers');
  const feedback = page.locator('[data-pragma-feedback]');
  await feedback.waitFor();
  await shoot('unsupported', [askbar, feedback]);

  await browser.close();
} catch (error) {
  console.error(serverLog);
  throw error;
} finally {
  server.kill();
}

async function waitForServer(target, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(target);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Dev server did not start at ${target}`);
}
