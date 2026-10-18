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
  const closeReceipt = async () => {
    await page.waitForTimeout(500);
    const d = page.getByRole('dialog', { name: '找數單' });
    if (await d.count()) await d.getByRole('button', { name: '好' }).click();
  };
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
      await page.getByRole('button', { name: 'Viola 出銃' }).click();
      await page.waitForTimeout(300);
      await page.getByRole('dialog', { name: '入數' }).getByRole('button', { name: '13', exact: true }).click();
      await page.waitForTimeout(700);
      await page.screenshot({ path: `${out}/sheet-fan.png` });
      try {
        await page.getByRole('dialog', { name: '入數' }).getByRole('button', { name: '番數表' }).click({ timeout: 4000 });
        await page.waitForTimeout(300);
        await page.screenshot({ path: `${out}/picker-open.png` });
        for (const re of [/^清一色/, /^對對糊/]) {
          await page.getByRole('dialog', { name: '番數表' }).getByRole('button', { name: re }).first().click({ timeout: 4000 });
        }
        await page.waitForTimeout(200);
        await page.screenshot({ path: `${out}/picker.png` });
        await page.getByRole('button', { name: /^用 \d+ 番$/ }).click({ timeout: 4000 });
        await page.waitForTimeout(200);
      } catch (e) {
        errors.push(`picker: ${e.message.split('\n')[0]}`);
        await page.screenshot({ path: `${out}/picker-fail.png` });
        const back = page.getByRole('button', { name: '返回' });
        if (await back.count()) await back.click();
      }
      await page.getByRole('button', { name: /^入數/ }).click();
      await page.waitForTimeout(700);
      await page.screenshot({ path: `${out}/after-win.png` });
      await closeReceipt();
    });
    await step('edit', async () => {
      await page.waitForTimeout(1000);
      await page.getByRole('button', { name: /Gavin 食 Ivan（15 番）/ }).click();
      await page.waitForTimeout(400);
      await page.getByRole('dialog').getByRole('button', { name: '加一番' }).click();
      await page.getByRole('dialog').getByRole('button', { name: '加一番' }).click();
      await page.waitForTimeout(700);
      await page.screenshot({ path: `${out}/edit.png` });
      await page.getByRole('button', { name: '儲存', exact: true }).click();
      await page.waitForTimeout(400);
    });
    await step('settle', async () => {
      // 上一鋪 Athena 食咗，Gavin 對 Ivan 嘅拉斷咗；連食三鋪先會問找數
      for (let k = 0; k < 3; k++) {
        await page.waitForTimeout(1200);
        await page.getByRole('button', { name: /^Gavin，/ }).click();
        await page.getByRole('button', { name: 'Ivan 出銃' }).click();
        await page.getByRole('dialog', { name: '入數' }).getByRole('button', { name: '10', exact: true }).click();
        await page.getByRole('button', { name: /^入數/ }).click();
        await closeReceipt();
      }
      await page.waitForTimeout(1400);
      await page.screenshot({ path: `${out}/locked.png` });
      await page.getByRole('button', { name: '找數', exact: true }).click();
      await page.waitForTimeout(180);
      await page.screenshot({ path: `${out}/settle-hit.png` });
      await page.waitForTimeout(700);
      await page.screenshot({ path: `${out}/receipt.png` });
      await closeReceipt();
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${out}/ledger.png`, fullPage: true });
    });
    await step('dice', async () => {
      await page.getByRole('button', { name: /^其他/ }).click();
      await page.getByRole('dialog').getByRole('button', { name: /^擲骰/ }).click();
      await page.waitForTimeout(250);
      await page.screenshot({ path: `${out}/dice-rolling.png` });
      await page.waitForTimeout(1050);
      await page.screenshot({ path: `${out}/dice.png` });
      await page.getByRole('button', { name: '好' }).click();
    });
    await step('special', async () => {
      await page.waitForTimeout(400);
      await page.getByRole('button', { name: /^特別事項/ }).click();
      await page.waitForTimeout(300);
      await page.getByRole('dialog').getByRole('button', { name: /一台花/ }).click();
      await page.waitForTimeout(250);
      await page.screenshot({ path: `${out}/special-flower.png` });
      await page.getByRole('dialog').getByRole('button', { name: /被追/ }).click();
      await page.getByRole('dialog').getByRole('button', { name: '即摸', exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: '+2' }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Ivan', exact: true }).click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${out}/special-chase.png` });
      await page.getByRole('button', { name: /^入數，付每家/ }).click();
      await page.waitForTimeout(350);
      await page.screenshot({ path: `${out}/chase-stamp.png` });
      await page.waitForTimeout(1600);
    });
    await step('swap', async () => {
      await page.getByRole('button', { name: /^其他/ }).click();
      await page.getByRole('dialog').getByRole('button', { name: /^換人/ }).click();
      await page.waitForTimeout(300);
      await page.getByRole('dialog').getByRole('button', { name: /Ivan/ }).click();
      await page.getByRole('dialog').getByRole('button', { name: /Kit/ }).click();
      await page.screenshot({ path: `${out}/swap.png` });
    });
    await step('reseat', async () => {
      await page.goto(`${base}/demo/t/3`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1000);
      await page.getByRole('button', { name: /^其他/ }).click();
      await page.getByRole('dialog').getByRole('button', { name: /^掉位/ }).click();
      await page.getByRole('button', { name: '抽風牌' }).click();
      await page.waitForTimeout(2200);
      await page.screenshot({ path: `${out}/reseat.png` });
    });
    await step('settle-page', async () => {
      await page.goto(`${base}/demo/settle`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${out}/settle.png`, fullPage: true });
      await page.getByRole('button', { name: /^6 番/ }).click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${out}/settle-config.png` });
      await page.goBack();
      await page.waitForTimeout(400);
      await page.getByRole('button', { name: '＋ 新增' }).first().click();
      await page.getByRole('dialog').getByRole('button', { name: '的士', exact: true }).click();
      await page.getByRole('dialog').getByLabel('金額').fill('36');
      await page.getByRole('dialog').getByRole('button', { name: 'Athena', exact: true }).first().click();
      await page.waitForTimeout(200);
      await page.screenshot({ path: `${out}/expense-sheet.png` });
      await page.getByRole('button', { name: /^新增 \$36/ }).click();
      await page.waitForTimeout(300);
    });
    await step('board', async () => {
      await page.goto(`${base}/demo/board`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${out}/board.png`, fullPage: true });
    });
    await step('trend', async () => {
      await page.goto(`${base}/demo/t/2`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1500);
      console.log('dice-class', await page.locator('.felt-dice').getAttribute('class'));
      await page.screenshot({ path: `${out}/felt-t2.png` });
      const plot = page.locator('.viz-plot rect').last();
      const box = await plot.boundingBox();
      if (box) await page.mouse.move(box.x + box.width * 0.55, box.y + box.height / 2);
      await page.waitForTimeout(200);
      await page.locator('.viz').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${out}/trend.png` });
      await page.getByRole('button', { name: /^其他/ }).click();
      await page.getByRole('dialog').getByRole('button', { name: /^設定/ }).click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${out}/settings.png` });
    });
    await step('rules', async () => {
      await page.goto(`${base}/demo/rules`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${out}/rules.png`, fullPage: true });
      await page.getByRole('tab', { name: '埋數・水' }).click();
      await page.waitForTimeout(200);
      await page.screenshot({ path: `${out}/rules-settle.png` });
      await page.getByRole('tab', { name: '番數表' }).click();
      await page.getByRole('button', { name: /^十三么/ }).click();
      await page.getByRole('button', { name: '編輯' }).click();
      await page.waitForTimeout(200);
      await page.screenshot({ path: `${out}/fan-edit.png` });
    });
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log(`${scheme}: overflow ${overflow}px, errors ${JSON.stringify(errors)}`);
  await ctx.close();
}
await browser.close();
