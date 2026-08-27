// @ts-check
const { test, expect } = require('./fixtures');

test.describe('closing the app and coming back', () => {

  test('a cook resumes exactly where it was', async ({ app }) => {
    await app.setup({ ovenC: 130 });
    await app.start(6.5);
    await app.advance(14);
    await app.log(15.2);
    await app.advance(8);
    await app.log(23.8);

    const before = await app.state();
    const cardBefore = await app.read();

    await app.page.reload();
    await app.settle();

    const after = await app.state();
    expect(after.readings).toEqual(before.readings);
    expect(after.dueAt).toBe(before.dueAt);
    expect(after.ovenC).toBe(130);
    // Elapsed time keeps running across the reload -- it continues, it does not
    // reset and it does not jump.
    expect(after.elapsedMin).toBeGreaterThanOrEqual(before.elapsedMin);
    expect(after.elapsedMin - before.elapsedMin).toBeLessThan(1);
    expect((await app.read()).label).toBe(cardBefore.label);
    expect((await app.read()).setupOpen).toBe(false);
  });

  test('a cook left running for hours is flagged, not silently resumed', async ({ app }) => {
    await app.start(5);
    await app.advance(9 * 60);
    await app.page.reload();
    await app.settle();

    const r = await app.read();
    expect(r.label).toMatch(/earlier cook/i);
    expect(r.action).toMatch(/start another/i);
    expect(r.why).toMatch(/long finished/i);
    // No absurd countdown, and no alarm on arrival.
    expect(r.clock).not.toMatch(/^\d+ min$/);
  });

  test('taking it out records the temperature and ends the cook', async ({ app }) => {
    await app.seed([[0, 5], [16, 20], [28, 32]]);
    await app.advance(40);
    await app.page.click('#verdictActs button');
    await app.settle();

    const r = await app.read();
    const s = await app.state();
    expect(r.label).toMatch(/out of the oven/i);
    expect(r.clock).toMatch(/^\d+\.\d °C$/);
    expect(r.at).toMatch(/after \d+ min/);
    expect(r.at).toMatch(/out at \d{1,2}:\d{2}/);
    expect(r.why).toMatch(/rest/i);
    expect(r.dockHidden, 'no more readings once it is out').toBe(true);
    expect(s.finishedAt).toBeTruthy();
    expect(s.finalTemp).toBeGreaterThan(40);
    expect(await app.page.textContent('#mastheadState')).toBe('done');
  });

  test('the finished record survives a reload', async ({ app }) => {
    await app.seed([[0, 5], [16, 20], [28, 32]]);
    await app.advance(40);
    await app.page.click('#verdictActs button');
    await app.settle();
    const before = await app.read();

    await app.page.reload();
    await app.settle();
    const after = await app.read();
    // The rest clock is live, so compare what is meant to be fixed.
    const fixed = x => x.split('  ·  resting')[0];
    expect(after.clock).toBe(before.clock);
    expect(fixed(after.at)).toBe(fixed(before.at));
    expect(after.coreNow).toBe(before.coreNow);
  });

  // Walkthrough 5. The task does not end at the oven: this persona still has to
  // rest it and sear it, and a card frozen on the moment of the pull shows no
  // progress at the one stage where the only question is how long it has been
  // out.
  test('the finished card counts the rest', async ({ app }) => {
    await app.seed([[0, 5], [16, 20], [28, 32]]);
    await app.advance(40);
    await app.page.click('#verdictActs button');
    await app.settle();
    expect((await app.read()).at, 'nothing to say in the first minute').not.toMatch(/resting/);

    await app.advance(9);
    const r = await app.read();
    expect(r.at).toMatch(/resting 9 min/);
    expect(r.at, 'and what it says about the cook itself does not move').toMatch(/after \d+ min/);
    expect(r.clock, 'nor does the temperature it recorded').toMatch(/^\d+\.\d °C$/);

    await app.page.reload();
    await app.settle();
    expect((await app.read()).at, 'and it survives being closed and reopened').toMatch(/resting 9 min/);
  });

  test('a finished cook is never treated as stale', async ({ app }) => {
    await app.seed([[0, 5], [16, 20], [28, 32]]);
    await app.advance(40);
    await app.page.click('#verdictActs button');
    await app.advance(10 * 60);
    await app.page.reload();
    await app.settle();
    expect((await app.read()).label).toMatch(/out of the oven/i);
  });

  test('starting another clears every trace of the last one', async ({ app }) => {
    await app.seed([[0, 5], [16, 20], [28, 32]]);
    await app.advance(40);
    await app.page.click('#verdictActs button');       // out of the oven
    await app.settle();
    await app.page.click('#verdictActs button');       // start another
    await app.page.waitForTimeout(700);

    const r = await app.read();
    const s = await app.state();
    expect(s.startedAt).toBeNull();
    expect(s.dueAt).toBeNull();
    expect(s.finishedAt).toBeNull();
    expect(s.readings).toEqual([]);
    expect(r.label).toMatch(/set up/i);
    expect(r.coreNow).toMatch(/^—/);                   // no stale numbers left behind
    expect(r.hit).toBe('—');
    expect(r.tau).toBe('—');
    expect(r.setupOpen).toBe(true);
    expect(r.statsHidden).toBe(true);

    await app.page.reload();
    await app.settle();
    expect((await app.state()).startedAt).toBeNull();
  });

  test('reset in setup does the same thing', async ({ app }) => {
    await app.seed([[0, 5], [14, 12]]);
    await app.page.evaluate(() => { document.getElementById('setup').open = true; });
    await app.page.click('#resetBtn');
    await app.settle();
    expect((await app.state()).startedAt).toBeNull();
  });

  test('the app still works when storage is unavailable', async ({ page }) => {
    // Private browsing, or site data blocked: reads and writes throw.
    await page.addInitScript(() => {
      window.__skew = 0;
      const real = Date.now;
      Date.now = () => real() + window.__skew;
      const boom = () => { throw new DOMException('blocked', 'SecurityError'); };
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get() { return { getItem: boom, setItem: boom, removeItem: boom }; },
      });
    });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window.render === 'function');
    await page.fill('#startTemp', '5');
    await page.click('#startBtn');
    await page.waitForTimeout(300);
    expect(await page.textContent('#verdictLabel')).toMatch(/next check/i);
    expect(errors).toEqual([]);
  });
});
