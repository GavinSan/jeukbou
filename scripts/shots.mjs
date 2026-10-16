// 示範頁截圖（CI 用）：淺色同深色，手機闊度
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const base = process.env.BASE_URL ?? 'http://localhost:4173';
const out = process.env.OUT_DIR ?? 'shots';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
for (const scheme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(`${base}/demo`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/session-${scheme}.png`, fullPage: true });

  await page.goto(`${base}/demo/t/0`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/table-${scheme}.png`, fullPage: true });

  if (scheme === 'light') {
    await page.getByRole('button', { name: /Athena/ }).first().click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${out}/sheet-who.png` });
    await page.getByRole('dialog').getByRole('button', { name: /Viola/ }).first().click();
    await page.getByRole('button', { name: '下一步：番數' }).click();
    await page.getByRole('dialog').getByRole('button', { name: '13', exact: true }).click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/sheet-fan.png` });
    await page.getByRole('button', { name: /^入數/ }).click();
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${out}/after-win.png` });
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log(`${scheme}: overflow ${overflow}px, errors ${JSON.stringify(errors)}`);
  await ctx.close();
}
await browser.close();
