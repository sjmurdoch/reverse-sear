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

  // ---------------------------------------------------------------------
  // Walkthrough 6: the guests arrive early, and the steak comes back.
  //
  // Two stages the app had no answer for. Dinner does not wait for the model,
  // and the one irreversible action in the app was a one-way door: the only
  // button on the finished card threw the cook away.
  // ---------------------------------------------------------------------

  test('the cook can take it out on their own say-so', async ({ app }) => {
    await app.seed([[0, 5], [23.4, 22.6], [34.9, 33.9]], { elapsed: 38 });
    const mid = await app.read();
    expect(mid.label, 'the state under test: the app is not asking for it').toMatch(/next check/i);

    expect(mid.action, 'there has to be a way to say "it is coming out now"').toMatch(/out of the oven early/i);
    const cls = await app.page.getAttribute('#verdictActs button', 'class');
    expect(cls, 'demoted: this is the cook overruling the plan, not the plan').toBe('ghost');

    await app.page.click('#verdictActs button');
    await app.settle();
    const r = await app.read();
    const s = await app.state();
    // Recorded, not reset: "Reset everything" in Setup was the only way out and
    // it kept nothing -- no temperature, no elapsed time, no rest clock.
    expect(s.finishedAt, 'the pull is recorded').toBeTruthy();
    expect(s.finalTemp).toBeGreaterThan(30);
    expect(s.readings.length, 'and the cook is kept').toBe(3);
    expect(r.at).toMatch(/after 38 min/);
    expect(r.why, 'and it says how far short it is').toMatch(/short of your 44 °C target/i);
  });

  test('the pull can be undone, and the cook picks up where it left off', async ({ app }) => {
    await app.seed([[0, 5], [23.4, 22.6], [34.9, 33.9]], { elapsed: 38 });
    expect((await app.read()).action, 'the cook ends the cook themselves')
      .toMatch(/out of the oven early/i);
    await app.page.click('#verdictActs button');            // out of the oven early
    await app.settle();
    const before = await app.state();

    const done = await app.read();
    expect(done.action, 'the way back is the first thing offered on a short pull')
      .toMatch(/back in the oven/i);
    await app.page.click('#verdictActs button');
    await app.settle();

    const s = await app.state();
    expect(s.finishedAt, 'the cook is running again').toBeNull();
    expect(s.startedAt, 'on the same clock zero').toBe(before.startedAt);
    expect(s.readings, 'with every reading it had').toEqual(before.readings);
    expect((await app.read()).dockHidden, 'and somewhere to put the next one').toBe(false);

    // The model went on heating the steak while it sat on a board, so its
    // estimate is the least trustworthy it has been: ask, do not order.
    const r = await app.read();
    expect(r.label).toMatch(/check it now/i);
    expect(r.why).toMatch(/out of the oven and back in/i);
    expect(r.action, 'no pull ordered on a number nobody has checked').not.toMatch(/^Out of the oven$/);

    // And the probe reading the cook took on the board answers it.
    await app.log(34.9, 1);
    const after = await app.read();
    expect(after.label).toMatch(/next check/i);
    expect((await app.state()).readings.length).toBe(4);
  });

  test('the way back is not on offer once the steak is long out', async ({ app }) => {
    await app.seed([[0, 5], [16, 20], [28, 32]]);
    await app.advance(40);
    await app.page.click('#verdictActs button');            // out of the oven, at temperature
    await app.settle();
    const at_target = await app.read();
    expect(at_target.action, 'a steak at temperature is resting: the next dinner comes first')
      .toMatch(/start another/i);
    expect(await app.page.$$eval('#verdictActs button', b => b.length)).toBe(2);

    await app.advance(45);
    expect(await app.page.$$eval('#verdictActs button', b => b.map(x => x.textContent)),
      'half an hour on, the steak is on a plate, not on a board')
      .toEqual(['Start another steak']);
    expect((await app.read()).at, 'though it is still, just about, a rest').toMatch(/resting 45 min/);

    // ...and by the next morning the card is a record, not a timer.
    await app.advance(10 * 60);
    expect((await app.read()).at).not.toMatch(/resting/);
    expect((await app.read()).at, 'it still says when the steak came out').toMatch(/out at \d{1,2}:\d{2}/);
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
