// 示範頁截圖（CI 用）：淺色同深色，手機闊度
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const base = process.env.BASE_URL ?? 'http://localhost:4173';
const out = process.env.OUT_DIR ?? 'shots';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
for (const scheme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const closeReceipt = async () => {
    // 食糊動畫（同慶祝）播完先出找數單
    await page.waitForSelector('.party', { state: 'detached', timeout: 8000 }).catch(() => undefined);
    await page.waitForTimeout(1500);
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
      await page.getByRole('dialog', { name: '入數' }).getByRole('button', { name: '20', exact: true }).click();
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
        await page.waitForTimeout(1500);
        await page.getByRole('button', { name: /^Gavin，/ }).click();
        await page.getByRole('button', { name: 'Ivan 出銃' }).click();
        await page.getByRole('dialog', { name: '入數' }).getByRole('button', { name: '10', exact: true }).click();
        if (k === 0) {
          await page.waitForTimeout(500);
          const one = page.getByRole('radio', { name: '當 1 番' });
          console.log('dealer choice shown =', await one.count());
          if (await one.count()) await one.click();
          await page.waitForTimeout(150);
          await page.screenshot({ path: `${out}/dock-dealer.png` });
        }
        await page.getByRole('button', { name: /^入數/ }).click();
        if (k === 2) {
          await page.waitForTimeout(350);
          console.log('hold: ask banners during win anim =', await page.locator('.settle-ask').count());
          await page.screenshot({ path: `${out}/win-hold.png` });
        }
        await page.waitForTimeout(1300);
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
      for (let k = 0; k < 3; k++) { await page.locator('.instant-btn').click(); await page.waitForTimeout(120); }
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
      await page.getByRole('tab', { name: '自己揀' }).click();
      await page.locator('.pick-seat').nth(0).click();
      await page.locator('.pick-seat').nth(2).click();
      await page.locator('.pick-seat').nth(1).click();
      await page.waitForTimeout(200);
      await page.screenshot({ path: `${out}/reseat-pick.png` });
    });
    await step('settle-page', async () => {
      await page.goto(`${base}/demo/settle`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${out}/settle.png`, fullPage: true });
      await page.getByRole('button', { name: /^埋數（完場並鎖定）/ }).click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${out}/close-ask.png` });
      await page.getByRole('button', { name: '確認埋數' }).click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${out}/closed.png` });
      await page.getByRole('button', { name: /^6 番/ }).click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${out}/settle-config.png` });
      await page.goBack();
      await page.waitForTimeout(400);
      await page.getByRole('button', { name: '新增開支' }).click();
      await page.getByRole('dialog').getByRole('button', { name: '的士', exact: true }).click();
      await page.getByRole('dialog').getByLabel('金額').fill('36');
      await page.getByRole('dialog').getByRole('button', { name: 'Athena', exact: true }).first().click();
      await page.waitForTimeout(200);
      await page.screenshot({ path: `${out}/expense-sheet.png` });
      await page.getByLabel('備註').fill('譚仔，Kit 都有食');
      await page.getByRole('button', { name: /^＋ 加今日有份/ }).click();
      await page.getByLabel('訪客名').fill('阿明');
      await page.getByRole('dialog').getByRole('button', { name: '加', exact: true }).click();
      await page.waitForTimeout(200);
      await page.screenshot({ path: `${out}/expense-guest.png` });
      await page.getByRole('button', { name: /^新增 \$36/ }).click();
      await page.waitForTimeout(300);
      await page.getByRole('button', { name: '修改 晚餐' }).click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${out}/expense-edit.png` });
      await page.getByRole('dialog').getByLabel('金額').fill('200');
      await page.getByRole('button', { name: /^儲存 \$200/ }).click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${out}/settle-after.png`, fullPage: true });
      await page.getByRole('button', { name: /^Gavin 明細|Gavin \+ Athena 明細/ }).first().click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${out}/settle-person.png`, fullPage: true });
      await page.getByRole('button', { name: '完成' }).click();
      await page.getByRole('button', { name: '修改 飲品' }).click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${out}/expense-all.png`, fullPage: true });
    });
    await step('party', async () => {
      await page.goto(`${base}/demo/t/1`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1200);
      await page.getByRole('button', { name: /^Janice，/ }).click();
      await page.getByRole('button', { name: 'Sang 出銃' }).click();
      const chip = page.getByRole('dialog', { name: '入數' }).getByRole('button', { name: '100', exact: true });
      await chip.scrollIntoViewIfNeeded();
      await chip.click();
      await page.waitForTimeout(250);
      await page.screenshot({ path: `${out}/dock-hot.png` });
      await page.getByRole('button', { name: /^入數/ }).click();
      await page.waitForTimeout(1300);
      await page.screenshot({ path: `${out}/party.png` });
      await page.waitForTimeout(3500);
    });
    await step('board', async () => {
      await page.goto(`${base}/demo/board`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${out}/board.png`, fullPage: true });
      await page.getByRole('tab', { name: '月' }).click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${out}/board-month.png`, fullPage: true });
      await page.getByRole('tab', { name: '全部' }).click();
      await page.waitForTimeout(200);
      await page.getByRole('button', { name: /^Gavin 統計/ }).click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${out}/player.png` });
    });
    await step('legacy', async () => {
      await page.goto(`${base}/demo/legacy`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${out}/legacy.png` });
    });
    await step('gag', async () => {
      await page.goto(`${base}/demo/t/2`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1200);
      await page.getByRole('button', { name: /^特別事項/ }).click();
      await page.getByRole('dialog').getByRole('button', { name: /詐糊/ }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Tat', exact: true }).click();
      await page.getByRole('button', { name: /^入數，付每家/ }).click();
      await page.waitForTimeout(1400);
      await page.screenshot({ path: `${out}/gag.png` });
      await page.waitForTimeout(2500);
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
      await page.waitForTimeout(200);
      await page.screenshot({ path: `${out}/fan-collapsed.png` });
      await page.getByRole('button', { name: '全部展開' }).click();
      await page.getByRole('button', { name: /^十三么/ }).first().click();
      await page.waitForTimeout(200);
      await page.screenshot({ path: `${out}/fan-open.png`, fullPage: true });
      await page.getByRole('button', { name: '編輯' }).click();
      await page.waitForTimeout(200);
      await page.getByLabel('番數').first().fill('2');
      await page.waitForTimeout(200);
      await page.screenshot({ path: `${out}/fan-edit.png` });
    });
    await step('home', async () => {
      await page.goto(`${base}/demo/home`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1500);
      await page.getByRole('button', { name: '關閉' }).click();
      await page.screenshot({ path: `${out}/home.png`, fullPage: true });
      await page.goto(`${base}/demo/rank`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1300);
      await page.screenshot({ path: `${out}/rank.png`, fullPage: true });
      await page.goto(`${base}/demo/groups`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${out}/groups.png` });
      await page.getByRole('button', { name: '新增' }).click();
      await page.waitForTimeout(300);
      await page.getByRole('dialog').getByLabel('加入碼', { exact: true }).fill('k7pq2m');
      await page.screenshot({ path: `${out}/groups-add.png` });
      await page.goto(`${base}/demo/group`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${out}/group-members.png`, fullPage: true });
      await page.getByRole('button', { name: /^加入碼 K7PQ2M/ }).click();
      await page.waitForTimeout(150);
      await page.screenshot({ path: `${out}/group-code-copied.png` });
      await page.getByRole('button', { name: '管理' }).click();
      await page.waitForTimeout(150);
      await page.screenshot({ path: `${out}/group-manage.png` });
      await page.getByRole('button', { name: '完成' }).click();
      await page.getByRole('button', { name: 'Athena 統計' }).click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${out}/group-player.png` });
    });
    await step('heaven', async () => {
      await page.goto(`${base}/demo/t/1`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1200);
      await page.getByRole('button', { name: /^特別事項/ }).click();
      await page.waitForTimeout(300);
      await page.getByRole('dialog').getByRole('button', { name: /天槓/ }).click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${out}/heaven-card.png` });
      await page.getByRole('dialog').getByRole('button', { name: 'Janice', exact: true }).click();
      await page.getByRole('button', { name: /^入數，收每家/ }).click();
      await page.waitForTimeout(1100);
      await page.screenshot({ path: `${out}/heaven.png` });
      await page.waitForTimeout(2500);
    });
    await step('rounds', async () => {
      await page.goto(`${base}/demo/t/4`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `${out}/rounds-done.png` });
      await page.getByRole('button', { name: '換位', exact: true }).click();
      await page.getByRole('tab', { name: '自己揀' }).click();
      const a = await page.locator('.pick-seat').nth(0).boundingBox();
      const b = await page.locator('.pick-seat').nth(3).boundingBox();
      if (a && b) {
        await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
        await page.mouse.down();
        await page.mouse.move(a.x + a.width / 2 + 20, a.y + a.height / 2 + 20, { steps: 4 });
        await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
        await page.screenshot({ path: `${out}/reseat-drag.png` });
        await page.mouse.up();
      }
      await page.waitForTimeout(200);
      await page.screenshot({ path: `${out}/reseat-dropped.png` });
      await page.getByRole('button', { name: '確認座位' }).click();
      await page.waitForTimeout(400);
      await page.getByRole('button', { name: /^打快/ }).click();
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${out}/rounds-extended.png` });
      await page.getByRole('button', { name: /^特別事項/ }).click();
      await page.waitForTimeout(300);
      await page.getByRole('dialog').getByRole('button', { name: /詐糊/ }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Lok', exact: true }).click();
      await page.getByRole('button', { name: /^入數，付每家/ }).click();
      await page.waitForTimeout(1400);
      await page.screenshot({ path: `${out}/gag-ink.png` });
      await page.waitForTimeout(2400);
    });
    await step('forgot', async () => {
      await page.goto(`${base}/demo/t/1`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1200);
      await page.getByRole('button', { name: /^Sang，/ }).click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${out}/tap-player.png` });
      await page.locator('.sp-chip-kong').click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${out}/kong-open.png` });
      await page.locator('.sp-card.sp-kong').click();
      await page.waitForTimeout(700);
      await page.screenshot({ path: `${out}/kong-forgot.png` });
      await page.getByRole('button', { name: /^入數，付每家 10/ }).click();
      await page.waitForTimeout(700);
      await page.screenshot({ path: `${out}/kong-forgot-burst.png` });
      await page.waitForTimeout(2200);
      await page.goto(`${base}/demo`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(800);
      await page.locator('h2', { hasText: '全場數據' }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${out}/session-stats.png` });
    });
    await step('dealer', async () => {
      await page.goto(`${base}/demo/t/2`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1200);
      await page.getByRole('button', { name: /^TS，/ }).click();
      await page.getByRole('button', { name: /^自摸/ }).click();
      await page.waitForTimeout(300);
      await page.getByRole('radio', { name: '當 1 番' }).click();
      await page.waitForTimeout(150);
      await page.screenshot({ path: `${out}/dock-dealer.png` });
      await page.getByRole('button', { name: '取消入數' }).click();
    });
    await step('pay', async () => {
      await page.goto(`${base}/demo/pay`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${out}/mypay.png`, fullPage: true });
      await page.locator('.person-net button, .person-net .listrow').first().click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${out}/pay-person.png` });
      await page.goto(`${base}/demo/settle`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(500);
      await page.locator('.exp-matrix').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${out}/expense-matrix.png` });
      await page.getByRole('heading', { name: '每人總結' }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${out}/settle-summary.png` });
      await page.goto(`${base}/demo/t/0`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(900);
      await page.locator('.ledger, .lg').first().scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${out}/ledger-col.png` });
    });
    await step('admin', async () => {
      await page.goto(`${base}/demo/admin`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${out}/admin.png`, fullPage: true });
      await page.getByRole('button', { name: '牌友圈', exact: true }).click();
      await page.getByRole('button', { name: /^不打不相識/ }).click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${out}/admin-group.png`, fullPage: true });
      await page.getByRole('button', { name: '用家', exact: true }).click();
      await page.getByRole('button', { name: /^Tony Tsui/ }).click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${out}/admin-user.png`, fullPage: true });
      await page.setViewportSize({ width: 1280, height: 860 });
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${out}/admin-desktop.png` });
      await page.setViewportSize({ width: 390, height: 844 });
    });
    await step('teams', async () => {
      await page.goto(`${base}/demo/settle`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(500);
      await page.getByRole('heading', { name: 'Group 一齊計' }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${out}/settle-groups.png` });
      await page.goto(`${base}/demo/rules#settle`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${out}/rules-teams.png`, fullPage: true });
    });
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log(`${scheme}: overflow ${overflow}px, errors ${JSON.stringify(errors)}`);
  await ctx.close();
}
await browser.close();
