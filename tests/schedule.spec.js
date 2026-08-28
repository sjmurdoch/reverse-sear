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

  // Regression test for a steak pulled at 40.8 C against a 44 C target.
  // The check the app asked for was still outstanding when the plan flipped to
  // coasting on a plain refit -- and a due appointment plus a coasting plan is
  // read as "take it out now".  The measurement it had promised was earlier
  // than the pull time, so the steak came out minutes, and degrees, early.
  test('a plan that flips to coast waits for the pull time, not the old check', async ({ app }) => {
    await app.seed([[0, 5], [10.8, 10], [19, 22], [28.4, 35]]);
    const seeded = await app.state();
    expect(seeded.planAction, 'this fit still wants a reading').toBe('measure');
    const oldCheck = seeded.dueMin;

    // Run the clock up to that check. The plan flips to coast on the way.
    await app.advance(oldCheck - seeded.elapsedMin);
    const s = await app.state();
    expect(s.planAction).toBe('coast');
    expect(s.dueMin, 'the promise moves to the pull time').toBeCloseTo(s.planPull, 1);
    expect(s.dueMin).toBeGreaterThan(oldCheck);

    const r = await app.read();
    expect(r.label).toMatch(/coast/i);
    expect(r.action, 'the pull is not offered before its time').not.toBe('Out of the oven');
    expect(r.action, 'only the cook\'s own way out').toMatch(/out of the oven early/i);

    // And when it does say to take it out, the core is at temperature.
    await app.advance(s.dueMin - s.elapsedMin);
    const done = await app.read();
    expect(done.label).toMatch(/take it out now/i);
    expect(parseFloat(done.coreNow)).toBeGreaterThan(43);
  });

  // The pull time comes from the posterior, so re-running the adoption on the
  // timer must land on the same moment rather than walking it along.
  test('the coast pull time does not drift once adopted', async ({ app }) => {
    await app.seed([[0, 5], [18, 22], [30, 34], [38, 40]]);
    expect((await app.state()).planAction).toBe('coast');
    const promised = (await app.state()).dueAt;
    for (let i = 0; i < 3; i++) {
      await app.advance(0.5);
      expect((await app.state()).dueAt).toBe(promised);
    }
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
    expect(r.action, 'not time to take it out yet').not.toBe('Out of the oven');
    expect(await app.page.getAttribute('#verdictActs button', 'class'),
      'what is there is the demoted early pull, not the recommendation').toBe('ghost');
  });

  // Walkthrough 3: at the first check the estimate is nearly all prior -- it was
  // 7 C out, on a 6-41 C interval -- and "core about 23.6 °C" reads as knowledge.
  test('the due card shows how little it knows, while it knows little', async ({ app }) => {
    await app.start(5);
    const due = (await app.state()).dueMin;
    await app.drift(due + 0.3);
    const wide = await app.read();
    expect(wide.at, 'a wide posterior must show its width').toMatch(/core \d+–\d+ °C, best guess \d+\.\d/);

    // Once it is pinned down, the range is noise: show the number.
    await app.seed([[0, 5], [14, 12], [26, 22], [38, 31]]);
    const s = await app.state();
    await app.drift(s.dueMin - s.elapsedMin + 0.3);
    expect((await app.read()).at).toMatch(/core about \d+\.\d °C/);
  });

  test('the first check of a cook is not called a mid-course check', async ({ app }) => {
    await app.start(5);
    const r = await app.read();
    expect(r.why).not.toMatch(/mid-course/i);
    expect(r.why).toMatch(/nothing is fitted yet/i);

    // And once there is something to fit, it stops saying so.
    await app.advance(14);
    await app.log(12);
    expect((await app.read()).why).not.toMatch(/nothing is fitted yet/i);
  });

  test('reports how late you are, measured against what it promised', async ({ app }) => {
    await app.seed([[0, 5], [14, 12]], { elapsed: 20 });
    const s = await app.state();
    await app.drift(s.dueMin - s.elapsedMin + 4);      // four minutes past the check
    const r = await app.read();
    expect(r.at).toMatch(/[34] min past the planned check/);
    // Either form of the estimate -- on two readings the posterior is still
    // wide enough that the card shows its range rather than a point value.
    expect(r.at).toMatch(/core (about \d+\.\d °C|\d+–\d+ °C, best guess \d+\.\d)/);
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

  // Walkthrough 5. The phone slept through the check; the cook comes back to an
  // estimate that is almost all extrapolation. The median crossing target is not
  // a reason to take the steak out -- a probe is recoverable and a pull is not.
  test('will not order the pull on an estimate too vague to state', async ({ app }) => {
    await app.seed([[0, 5], [14, 12]], { elapsed: 20 });
    const s = await app.state();
    await app.advance(s.dueMin - s.elapsedMin + 20);   // asleep through the check

    const r = await app.read();
    const [lo, hi] = (r.at.match(/core (\d+)–(\d+) °C/) || []).slice(1).map(Number);
    expect(lo, 'this state is the one worth testing: a wide interval').toBeDefined();
    expect(hi - lo, 'straddling the target').toBeGreaterThan(6);
    expect(lo).toBeLessThan(44);

    expect(r.label).toMatch(/check it now/i);
    expect(r.label).not.toMatch(/take it out/i);
    expect(r.why).toMatch(/too loose to pull on/i);
    // but the way out is demoted, never removed: losing it is walkthrough 1's
    // "there was no way to finish", coming back whenever the fit is loose.
    expect(r.action).toMatch(/out of the oven anyway/i);
    const cls = await app.page.getAttribute('#verdictActs button', 'class');
    expect(cls, 'and it is the secondary action').toBe('ghost');
    await app.page.click('#verdictActs button');
    await app.settle();
    expect((await app.state()).finishedAt, 'it still works').toBeTruthy();
  });

  test('but a wide interval that sits entirely above target is certain', async ({ app }) => {
    // Width alone does not disqualify an estimate: 58-67 °C is wide and says
    // the same thing everywhere in it.
    await app.seed([[0, 5], [16, 20], [28, 32]]);
    await app.advance(40);
    const r = await app.read();
    const [lo, hi] = (r.at.match(/core (\d+)–(\d+) °C/) || []).slice(1).map(Number);
    expect(hi - lo).toBeGreaterThan(6);
    expect(lo).toBeGreaterThan(44);
    expect(r.label).toMatch(/take it out now/i);
    expect(await app.page.getAttribute('#verdictActs button', 'class')).toBe('primary');
  });

  test('names what was missed: a check, or the pull itself', async ({ app }) => {
    // "45 min past the planned check" while the app is telling you to take the
    // steak out sends the cook looking for a probe they never owed: once the
    // plan coasts, the appointment *is* the pull.
    await app.seed([[0, 5], [18, 22], [30, 34], [38, 40]]);
    expect((await app.read()).label).toMatch(/coast/i);
    const s = await app.state();
    await app.advance(s.dueMin - s.elapsedMin + 6);
    expect((await app.read()).at).toMatch(/[56] min past the time to take it out/);
  });

  test('a long wait says an oven you open anyway is a free reading', async ({ app }) => {
    // The tool's whole argument is that the opening is what costs, not the
    // reading -- and this cook has potatoes in the same oven.
    await app.seed([[0, 5], [14, 12], [26, 22]], { elapsed: 27 });
    const r = await app.read();
    expect(parseInt(r.clock, 10), 'a wait long enough to be worth saying it in').toBeGreaterThan(10);
    expect(r.why).toMatch(/once the door is open a reading is free/i);

    // and not when the check is imminent, where it is just noise
    const s = await app.state();
    await app.advance(s.dueMin - s.elapsedMin - 3);
    expect((await app.read()).why).not.toMatch(/free/i);
  });

  test('coasting tells you to stop opening the oven', async ({ app }) => {
    await app.seed([[0, 5], [18, 22], [30, 34], [38, 40]]);
    const r = await app.read();
    expect(r.label).toMatch(/coast/i);
    expect(r.at).toMatch(/out of the oven at/);
    expect(r.why).toMatch(/door shut|nothing left to learn/i);
    expect(r.action, 'nothing to press until it is time, bar the cook\'s own way out')
      .toMatch(/out of the oven early/i);
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
