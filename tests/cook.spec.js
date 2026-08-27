// @ts-check
const { test, expect } = require('./fixtures');

test.describe('logging readings', () => {

  test.beforeEach(async ({ app }) => {
    await app.start(5);
  });

  test('a reading is recorded, the box clears, and the answer comes into view', async ({ app }) => {
    await app.advance(14);
    await app.page.$eval('#logBtn', el => el.scrollIntoView({ block: 'center' }));
    await app.log(12.4);
    await app.page.waitForTimeout(700);

    const rows = await app.rows();
    expect(rows.length).toBe(2);
    expect(rows[0][0]).toBe('start');
    expect(rows[1][1]).toBe('12.4 °C');
    expect(await app.page.inputValue('#readTemp')).toBe('');

    await expect.poll(() => app.page.evaluate(() => {
      const b = document.getElementById('verdict').getBoundingClientRect();
      return b.top >= -8 && b.top < window.innerHeight;
    }), { message: 'the verdict card must end up visible after acting' }).toBe(true);
  });

  test('a reading can be backdated to when it was actually taken', async ({ app }) => {
    await app.advance(20);
    await app.log(18.8, 2);
    const s = await app.state();
    expect(s.readings[1].t).toBeGreaterThan(17.8);
    expect(s.readings[1].t).toBeLessThan(18.2);
    // the chip resets, so the next reading is not silently backdated too
    const pressed = await app.page.getAttribute('#ageChips button[data-age="0"]', 'aria-pressed');
    expect(pressed).toBe('true');
  });

  test('backdating cannot push a reading before the one before it', async ({ app }) => {
    await app.advance(10);
    await app.log(9);
    await app.advance(0.5);          // barely any time has passed
    await app.log(9.4, 2);           // but claim it was two minutes ago
    const s = await app.state();
    expect(s.readings[2].t).toBeGreaterThan(s.readings[1].t);
  });

  test('a mistyped reading can be removed, but not the start', async ({ app }) => {
    await app.advance(12);
    await app.log(11);
    await app.advance(8);
    await app.log(99);               // wrong
    expect((await app.rows()).length).toBe(3);

    const buttons = await app.page.$$('#log button.del');
    expect(buttons.length, 'the starting reading has no delete button').toBe(2);
    await buttons[1].click();
    await app.settle();
    const rows = await app.rows();
    expect(rows.length).toBe(2);
    expect(rows.map(r => r[1])).not.toContain('99.0 °C');
  });

  // WebKit caught this: renderLog() rewrote the whole table on every one-second
  // tick, so a delete button was destroyed and recreated under the user's
  // finger and the tap was lost. Chromium happened to win the race.
  test('the readings table is not rebuilt under the user\'s finger', async ({ app }) => {
    await app.seed([[0, 5], [14, 12], [26, 22]]);
    const stable = await app.page.evaluate(async () => {
      const first = document.querySelectorAll('#log button.del')[0];
      first.dataset.marked = 'yes';
      await new Promise(r => setTimeout(r, 2600));   // several render ticks
      const now = document.querySelectorAll('#log button.del')[0];
      return { same: now === first, marked: now && now.dataset.marked === 'yes' };
    });
    expect(stable.same, 'the delete button must survive the render tick').toBe(true);
    expect(stable.marked).toBe(true);
  });

  test('but it does update when a reading is added', async ({ app }) => {
    await app.seed([[0, 5], [14, 12]]);
    expect((await app.rows()).length).toBe(2);
    await app.advance(6);
    await app.log(18.2);
    expect((await app.rows()).length).toBe(3);
  });

  test('non-numeric input is refused rather than logged', async ({ app }) => {
    await app.advance(10);
    await app.page.fill('#readTemp', '');
    await app.page.click('#logBtn');
    await app.settle();
    expect((await app.state()).readings.length).toBe(1);
    await expect(app.page.locator('#readTemp')).toBeFocused();
  });

  // Walkthrough 3. The fit has a Gaussian likelihood with sigma 0.8 C, so a
  // wildly inconsistent reading is not downweighted -- it takes over. "433" for
  // 43.3 moved the plan to "take it out now" three degrees early; "4.3" for 43
  // sent the cook away for 30 minutes with the steak four minutes from done.
  test('a reading hotter than the oven is refused, and can be fixed in the box', async ({ app }) => {
    await app.seed([[0, 5], [14, 12], [26, 22]]);
    const before = await app.state();

    await app.page.fill('#readTemp', '433');
    await app.page.click('#logBtn');
    await app.settle();

    const s = await app.state();
    expect(s.readings, 'nothing may be recorded').toEqual(before.readings);
    expect(s.dueAt, 'and the plan must not move').toBe(before.dueAt);
    const r = await app.read();
    expect(r.warn).toMatch(/at or above the oven \(125 °C\)/);
    expect(await app.page.inputValue('#readTemp'), 'the typed value stays, to be corrected').toBe('433');
    await expect(app.page.locator('#readTemp')).toBeFocused();

    await app.log(43.3);
    expect((await app.state()).readings.length).toBe(4);
    expect((await app.read()).warn, 'the refusal clears once a reading lands').toBe('');
  });

  test('a reading far below the last one is questioned, not refused', async ({ app }) => {
    await app.seed([[0, 5], [14, 12], [26, 22]]);
    await app.log(2.2);                       // "22" typed as "2.2"

    expect((await app.state()).readings.length, 'a surprising reading is still information').toBe(4);
    const r = await app.read();
    expect(r.warn).toMatch(/2\.2 °C is 19\.8 °C below your last reading of 22 °C/);
    expect(r.warn).toMatch(/cannot cool in the oven/);
    expect(r.warn).toMatch(/delete the row/);

    // The query is derived from the readings, so removing the row clears it.
    const dels = await app.page.$$('#log button.del');
    await dels[dels.length - 1].click();
    await app.settle();
    expect((await app.read()).warn).toBe('');
  });

  test('the query survives a reload, because it is not remembered but derived', async ({ app }) => {
    await app.seed([[0, 5], [14, 12], [26, 22]]);
    await app.log(2.2);
    await app.page.reload();
    await app.settle();
    expect((await app.read()).warn).toMatch(/below your last reading/);
  });

  test('each reading is scored against the fitted curve', async ({ app }) => {
    await app.seed([[0, 5], [14, 12], [26, 22]]);
    const rows = await app.rows();
    for (const r of rows) {
      expect(r[2], 'residual column').toMatch(/^[+−]\d+\.\d$/);
    }
  });

  test('the estimated core climbs between fits', async ({ app }) => {
    await app.seed([[0, 5], [14, 12], [26, 22]]);
    const first = await app.read();
    await app.drift(5);              // clock moves, no refit -- as between the 60 s refits
    const second = await app.read();
    const a = parseFloat(first.coreNow);
    const b = parseFloat(second.coreNow);
    expect(b).toBeGreaterThan(a);
    expect(b - a).toBeLessThan(15);  // and it climbs plausibly, not absurdly
  });

  test('the chart draws the fit, the readings and the target', async ({ app }) => {
    await app.seed([[0, 5], [14, 12], [26, 22]]);
    const r = await app.page.evaluate(() => {
      const cv = document.getElementById('chart');
      const g = cv.getContext('2d');
      const d = g.getImageData(0, 0, cv.width, cv.height).data;
      let painted = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 8) painted++;
      return { painted, total: d.length / 4, w: cv.width, h: cv.height };
    });
    expect(r.w).toBeGreaterThan(0);
    expect(r.painted / r.total).toBeGreaterThan(0.02);   // something real is drawn
    expect(r.painted / r.total).toBeLessThan(0.9);       // and it is not a solid block
  });

  test('the elapsed clock in the masthead tracks real time', async ({ app }) => {
    await app.advance(17);
    const m = await app.page.textContent('#mastheadState');
    expect(m).toMatch(/^17:0\d elapsed$/);
  });
});
