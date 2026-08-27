// @ts-check
const { test, expect } = require('./fixtures');

test.describe('the appointment', () => {

  // Regression test for the defect the busy-cook walkthrough found.
  // advise() floors its next check at now + MIN_GAP_MIN, so re-running it on a
  // timer walked the appointment forward a few minutes at a time: the countdown
  // never reached zero, the cook was never asked for a second reading, and the
  // app coasted to the end on the two readings it already had.
  test('does not walk forward when the app refits on its timer', async ({ app }) => {
    await app.seed([[0, 5], [14, 12]], { elapsed: 20 });
    const promised = (await app.state()).dueAt;
    const promisedMin = (await app.state()).dueMin;
    expect(promisedMin).toBeGreaterThan(20);

    const seen = [];
    for (let i = 0; i < 5; i++) {
      await app.advance(4);                    // clock moves AND the app refits
      const s = await app.state();
      seen.push({ elapsed: Math.round(s.elapsedMin), dueAt: s.dueAt, planNext: s.planNext });
      expect(s.dueAt, 'the promised moment must not move on a refit').toBe(promised);
    }

    // plan.next does move -- that is the trap -- but the appointment does not.
    expect(seen.some(x => Math.abs(x.planNext - promisedMin) > 1)).toBe(true);

    // And because it holds, the countdown actually arrives.
    const r = await app.read();
    expect(r.clock).toBe('now');
    expect(r.label).toMatch(/check it now|take it out/i);
  });

  test('is reset by a reading, and by changing the steak', async ({ app }) => {
    await app.seed([[0, 5], [14, 12]], { elapsed: 20 });
    const first = (await app.state()).dueAt;

    await app.log(20);
    const afterReading = (await app.state()).dueAt;
    expect(afterReading).not.toBe(first);

    await app.setup({ targetC: 55 });
    const afterTarget = (await app.state()).dueAt;
    expect(afterTarget).not.toBe(afterReading);

    await app.setup({ fan: true });
    expect((await app.state()).dueAt).not.toBe(afterTarget);
  });

  test('is reset when a reading is deleted', async ({ app }) => {
    await app.seed([[0, 5], [14, 12], [26, 22]]);
    const before = (await app.state()).dueAt;
    await (await app.page.$$('#log button.del'))[1].click();
    await app.settle();
    expect((await app.state()).dueAt).not.toBe(before);
  });

  test('survives the page being closed and reopened', async ({ app }) => {
    await app.seed([[0, 5], [14, 12]], { elapsed: 20 });
    const before = await app.state();
    await app.page.reload();
    await app.settle();
    const after = await app.state();
    expect(after.dueAt).toBe(before.dueAt);
    expect(after.readings).toEqual(before.readings);
  });
});

test.describe('what the card says', () => {

  test('counts down in minutes, and in seconds only at the end', async ({ app }) => {
    await app.seed([[0, 5], [14, 12]], { elapsed: 20 });
    const far = await app.read();
    // "22:56" in a big display reads like a clock time; minutes do not.
    expect(far.clock).toMatch(/^\d+ min$/);

    const due = (await app.state()).dueMin;
    await app.drift(due - (await app.state()).elapsedMin - 1.2);
    expect((await app.read()).clock).toMatch(/^\d:\d\d$/);
  });

  test('names the wall-clock time of the next check', async ({ app }) => {
    await app.seed([[0, 5], [14, 12]], { elapsed: 20 });
    const r = await app.read();
    expect(r.at).toMatch(/at \d{1,2}:\d{2}/);
    expect(r.at).toMatch(/\d+ min in/);
  });

  test('a due check asks for a reading and offers no pull button', async ({ app }) => {
    await app.seed([[0, 5], [14, 12]], { elapsed: 20 });
    const due = (await app.state()).dueMin;
    await app.drift(due - 20 + 0.3);
    const r = await app.read();
    expect(r.label).toMatch(/check it now/i);
    expect(r.clock).toBe('now');
    expect(r.why).toMatch(/probe/i);
    expect(r.action, 'not time to take it out yet').toBeNull();
  });

  test('reports how late you are, measured against what it promised', async ({ app }) => {
    await app.seed([[0, 5], [14, 12]], { elapsed: 20 });
    const s = await app.state();
    await app.drift(s.dueMin - s.elapsedMin + 4);      // four minutes past the check
    const r = await app.read();
    expect(r.at).toMatch(/[34] min past the planned check/);
    expect(r.at).toMatch(/core about \d+\.\d °C/);
  });

  test('escalates to "take it out" once the estimate passes target', async ({ app }) => {
    await app.seed([[0, 5], [16, 20], [28, 32]]);
    expect((await app.read()).label).not.toMatch(/take it out/i);

    // Sail well past, without a refit -- the escalation must not wait for one.
    await app.drift(40);
    const r = await app.read();
    expect(r.label).toMatch(/take it out now/i);
    expect(r.action).toMatch(/out of the oven/i);
    expect(parseFloat(r.coreNow)).toBeGreaterThanOrEqual(44);
  });

  test('coasting tells you to stop opening the oven', async ({ app }) => {
    await app.seed([[0, 5], [18, 22], [30, 34], [38, 40]]);
    const r = await app.read();
    expect(r.label).toMatch(/coast/i);
    expect(r.at).toMatch(/out of the oven at/);
    expect(r.why).toMatch(/door shut|nothing left to learn/i);
    expect(r.action, 'nothing to press until it is time').toBeNull();
  });

  test('warns when the steak may never reach target', async ({ app }) => {
    await app.seed([[0, 5], [15, 26], [30, 35], [45, 38.5], [60, 40]]);
    const r = await app.read();
    expect(`${r.why} ${r.hit}`.toLowerCase()).toMatch(/stall/);
  });

  test('says whether it can actually wake you', async ({ app }) => {
    await app.start(5);
    const r = await app.read();
    // Either the wake lock is held, or it says to set a phone timer -- never
    // silence, because a countdown that cannot alarm is a false promise.
    expect(r.wake).toMatch(/screen kept awake|set a phone timer for \d{1,2}:\d{2}/i);
    if (/phone timer/i.test(r.wake)) expect(r.wake).toMatch(/\d{1,2}:\d{2}/);
  });
});
