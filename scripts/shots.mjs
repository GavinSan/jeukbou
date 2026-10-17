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
  const step = async (label, fn) => { try { await fn(); } catch (e) { errors.push(`${label}: ${e.message.split('\n')[0]}`); } };

  await page.goto(`${base}/demo`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/session-${scheme}.png`, fullPage: true });

  await page.goto(`${base}/demo/t/0`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/table-${scheme}.png`, fullPage: true });

  if (scheme === 'light') {
    await step('who', async () => {
      await page.getByRole('button', { name: /^Athena，/ }).click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${out}/sheet-who.png` });
      await page.getByRole('dialog').getByRole('button', { name: /Viola/ }).first().click();
      await page.getByRole('button', { name: '下一步：番數' }).click();
      await page.waitForTimeout(300);
      await page.getByRole('dialog').getByRole('button', { name: '13', exact: true }).click();
      await page.waitForTimeout(700);
      await page.screenshot({ path: `${out}/sheet-fan.png` });
      await page.getByRole('button', { name: /^入數/ }).click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${out}/after-win.png` });
    });
    await step('edit', async () => {
      await page.waitForTimeout(1000);
      await page.getByRole('button', { name: /Gavin 食 Ivan（15 番）/ }).click();
      await page.waitForTimeout(400);
      await page.getByRole('dialog').getByRole('button', { name: '加一番' }).click();
      await page.getByRole('dialog').getByRole('button', { name: '加一番' }).click();
      await page.waitForTimeout(700);
      await page.screenshot({ path: `${out}/edit.png` });
      await page.getByRole('button', { name: '儲存修改' }).click();
      await page.waitForTimeout(400);
    });
    await step('dice', async () => {
      await page.waitForTimeout(1200);
      await page.getByRole('button', { name: '擲骰', exact: true }).click();
      await page.waitForTimeout(1300);
      await page.screenshot({ path: `${out}/dice.png` });
      await page.getByRole('button', { name: '好' }).click();
    });
    await step('swap', async () => {
      await page.getByRole('button', { name: '換人', exact: true }).click();
      await page.waitForTimeout(300);
      await page.getByRole('dialog').getByRole('button', { name: /Ivan/ }).click();
      await page.getByRole('dialog').getByRole('button', { name: /Kit/ }).click();
      await page.screenshot({ path: `${out}/swap.png` });
    });
    await step('reseat', async () => {
      await page.goto(`${base}/demo/t/3`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1000);
      await page.getByRole('button', { name: '掉位', exact: true }).click();
      await page.getByRole('button', { name: '抽風牌' }).click();
      await page.waitForTimeout(2200);
      await page.screenshot({ path: `${out}/reseat.png` });
    });
    await step('rules', async () => {
      await page.goto(`${base}/demo/rules`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${out}/rules.png`, fullPage: true });
    });
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log(`${scheme}: overflow ${overflow}px, errors ${JSON.stringify(errors)}`);
  await ctx.close();
}
await browser.close();
