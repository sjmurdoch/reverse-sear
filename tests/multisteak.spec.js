// @ts-check
const { test, expect } = require('./fixtures');

// Three steaks, in together on separate shelves, different sizes, different
// starting temperatures, different targets. Opening the door costs heat for all
// of them, so the unit of interaction is the trip to the oven, not the check.
test.describe('three steaks, one oven', () => {

  const DINNER = [
    { name: 'Ribeye', thickMm: 48, massKg: 1.1, targetC: 44, readings: [[0, 5], [16, 15], [28, 26]] },
    { name: 'Sirloin', thickMm: 28, massKg: 0.4, targetC: 52, readings: [[0, 12], [16, 28], [28, 38]] },
    { name: 'Fillet', thickMm: 38, massKg: 0.6, targetC: 44, readings: [[0, 7], [16, 19], [28, 30]] },
  ];

  test('the card carries one countdown, not three', async ({ app }) => {
    await app.seedMany(DINNER);
    const r = await app.read();
    expect(r.clock).toMatch(/^(\d+ min|\d:\d\d|now)$/);
    expect(r.label).toMatch(/open the oven|take out|take them all|coast/i);
    // and it names when the first and last come out, which is the thing a chef
    // juggling other pans is actually planning around
    if (!/now/.test(r.clock)) expect(r.at).toMatch(/first out \d{1,2}:\d{2}.*last \d{1,2}:\d{2}/);
  });

  test('the door opens when the most urgent steak needs it', async ({ app }) => {
    await app.seedMany(DINNER);
    const t = await app.trip();
    const soonest = Math.min(...t.dueAts.filter(x => x != null));
    const openAt = await app.page.evaluate(() => nextOpening().openAt);
    expect(openAt).toBe(soonest);
  });

  test('no steak is ever checked later than it asked for', async ({ app }) => {
    // The safety property that lets batching be free: sharing a trip can only
    // move a check earlier, so each steak keeps its own overshoot guarantee.
    await app.seedMany(DINNER);
    const t = await app.trip();
    const openAt = await app.page.evaluate(() => nextOpening().openAt);
    for (const d of t.dueAts.filter(x => x != null)) expect(openAt).toBeLessThanOrEqual(d);
  });

  test('everything gets probed while the door is open', async ({ app }) => {
    await app.seedMany(DINNER);
    const t = await app.trip();
    await app.drift(t.openInMin + 0.2);
    const r = await app.read();
    expect(r.why).toMatch(/probe all 3/i);
    expect((await app.rows2()).map(x => x.pill)).toEqual(['probe', 'probe', 'probe']);
  });

  test('one trip is one sweep through all three', async ({ app }) => {
    await app.seedMany(DINNER);
    const t = await app.trip();
    await app.drift(t.openInMin + 0.2);

    expect(await app.dockLabel()).toMatch(/Ribeye — 1 of 3/);
    await app.log(31.0);
    expect(await app.dockLabel()).toMatch(/Sirloin — 2 of 3/);
    await app.log(42.5);
    expect(await app.dockLabel()).toMatch(/Fillet — 3 of 3/);
    await app.log(34.2);

    // Each number landed on the steak it was taken from.
    const s = await app.state();
    const last = s.steaks.map(x => x.readings[x.readings.length - 1].temp);
    expect(last).toEqual([31.0, 42.5, 34.2]);
    expect(await app.dockLabel()).not.toMatch(/of 3/);
  });

  test('probing one steak does not cancel the others’ appointments', async ({ app }) => {
    // Rescheduling all of them on one reading ended the sweep after the first
    // number, and the other two never got logged.
    await app.seedMany(DINNER);
    const t = await app.trip();
    await app.drift(t.openInMin + 0.2);
    const before = (await app.trip()).dueAts;
    await app.log(31.0);
    const after = (await app.trip()).dueAts;
    expect(after[0]).not.toBe(before[0]);          // the one just probed moves
    expect(after[1]).toBe(before[1]);              // the others keep their promise
    expect(after[2]).toBe(before[2]);
  });

  test('the list names the running order, so three reads as a sequence', async ({ app }) => {
    await app.seedMany(DINNER);
    const rows = await app.rows2();
    expect(rows.map(r => r.name)).toEqual(['Ribeye', 'Sirloin', 'Fillet']);
    for (const r of rows) expect(r.when.length, 'the row must stay on one line').toBeLessThan(26);
    const ordinals = rows.map(r => (r.when.match(/(1st|2nd|3rd) out/) || [])[1]);
    expect(new Set(ordinals.filter(Boolean)).size).toBe(3);
    for (const r of rows) expect(r.when).toMatch(/out \d{1,2}:\d{2}/);
    const t = await app.trip();
    expect(t.pullOrder.filter(Boolean).length).toBe(3);
  });

  test('one comes out while the rest carry on', async ({ app }) => {
    await app.seedMany([
      { name: 'Ribeye', thickMm: 48, targetC: 44, readings: [[0, 5], [16, 20], [28, 32]] },
      { name: 'Sirloin', thickMm: 28, targetC: 44, readings: [[0, 12], [16, 34], [28, 43]] },
    ]);
    await app.drift(6);
    const r = await app.read();
    expect(r.label).toMatch(/take out sirloin/i);
    expect(r.why).toMatch(/the rest go straight back in/i);

    await app.page.click('#verdictActs button');
    await app.settle();
    const s = await app.state();
    expect(s.steaks[1].finishedAt).toBeTruthy();
    expect(s.steaks[1].finalTemp).toBeGreaterThan(42);
    expect(s.steaks[0].finishedAt).toBeNull();
    expect((await app.read()).label).not.toMatch(/take out sirloin/i);
  });

  test('the pull button is not rebuilt under the chef\'s finger', async ({ app }) => {
    // WebKit caught this: with two steaks in, the single-steak path and the
    // trip card both called setAction() each tick with different kinds, so the
    // button churned once a second and the tap landed on a detached element.
    await app.seedMany([
      { name: 'Ribeye', thickMm: 48, targetC: 44, readings: [[0, 5], [16, 20], [28, 32]] },
      { name: 'Sirloin', thickMm: 28, targetC: 44, readings: [[0, 12], [16, 34], [28, 43]] },
    ]);
    await app.drift(6);
    const stable = await app.page.evaluate(async () => {
      const first = document.querySelector('#verdictActs button');
      if (!first) return { present: false };
      first.dataset.marked = 'yes';
      await new Promise(r => setTimeout(r, 2600));   // several render ticks
      const now = document.querySelector('#verdictActs button');
      return { present: true, same: now === first, marked: !!now && now.dataset.marked === 'yes' };
    });
    expect(stable.present).toBe(true);
    expect(stable.same, 'the action button must survive the render tick').toBe(true);
    expect(stable.marked).toBe(true);
  });

  test('the glance rows are not rebuilt under the chef\'s finger', async ({ app }) => {
    // WebKit caught this too: each row carries a temperature that ticks every
    // second, so rewriting the list from a string destroyed and recreated every
    // row once a second -- and tapping a row is how a steak gets selected.
    await app.seedMany(DINNER);
    const before = await app.page.evaluate(() => {
      const row = document.querySelector('#steakList .srow');
      row.dataset.marked = 'yes';
      return row.querySelector('.t').textContent;
    });
    await app.page.evaluate(() => new Promise(r => setTimeout(r, 2600)));  // several ticks
    await app.drift(5);   // far enough for the reading to actually move

    const after = await app.page.evaluate(() => {
      const row = document.querySelector('#steakList .srow');
      return { marked: row.dataset.marked === 'yes', temp: row.querySelector('.t').textContent };
    });
    expect(after.marked, 'the row element must survive the render tick').toBe(true);
    expect(after.temp, 'while its temperature still updates in place').not.toBe(before);
  });

  test('per-steak targets order the pulls', async ({ app }) => {
    await app.seedMany([
      { name: 'Rare', targetC: 44, readings: [[0, 5], [20, 26]] },
      { name: 'Medium', targetC: 56, readings: [[0, 5], [20, 26]] },
    ]);
    const t = await app.trip();
    expect(t.pullOrder).toEqual(['Rare', 'Medium']);
  });

  test('it tracks three and says so at the limit', async ({ app }) => {
    // Clicking a disabled button just waits, so stop when it goes disabled.
    for (let i = 0; i < 5; i++) {
      if (await app.page.locator('#addBtn').isDisabled()) break;
      await app.page.click('#addBtn');
      await app.settle();
    }
    expect((await app.state()).steaks.length).toBe(3);
    await expect(app.page.locator('#addBtn')).toBeDisabled();
    await expect(app.page.locator('#addBtn')).toHaveText(/three is the most/i);
  });

  test('the readouts say which steak they are about', async ({ app }) => {
    // Unlabelled numbers next to three steaks are worse than no numbers.
    await app.seedMany(DINNER);
    expect(await app.page.textContent('#readingsTitle')).toMatch(/Readings — Ribeye/);
    expect(await app.page.textContent('#statsRow .stat dt')).toMatch(/Ribeye now/);
    await app.page.click('#steakList .srow:nth-child(2)');
    await app.settle();
    expect(await app.page.textContent('#readingsTitle')).toMatch(/Readings — Sirloin/);
    expect(await app.page.textContent('#statsRow .stat dt')).toMatch(/Sirloin now/);
  });

  test('one press puts all three in at once', async ({ app }) => {
    await app.page.click('#addBtn');
    await app.page.click('#addBtn');
    await app.settle();
    const ids = (await app.state()).steaks.map(s => s.id);
    await app.page.fill('#startTemp', '5');
    await app.page.fill(`input[data-f="startTemp"][data-s="${ids[1]}"]`, '12');
    await app.page.fill(`input[data-f="startTemp"][data-s="${ids[2]}"]`, '7');
    await expect(app.page.locator('#startBtn')).toHaveText(/all in the oven/i);
    await app.page.click('#startBtn');
    await app.settle();
    const s = await app.state();
    expect(s.steaks.every(x => x.startedAt)).toBe(true);
    expect(new Set(s.steaks.map(x => x.startedAt)).size, 'one clock zero for all').toBe(1);
    expect(s.steaks.map(x => x.readings[0].temp)).toEqual([5, 12, 7]);
  });

  test('a bad starting temperature names which steak', async ({ app }) => {
    await app.page.click('#addBtn');
    await app.settle();
    const ids = (await app.state()).steaks.map(s => s.id);
    await app.page.fill('#startTemp', '5');
    await app.page.fill(`input[data-f="startTemp"][data-s="${ids[1]}"]`, '400');
    await app.page.click('#startBtn');
    await app.settle();
    expect(await app.page.textContent('#startWarn')).toMatch(/steak 2/i);
    expect((await app.state()).steaks.every(x => !x.startedAt)).toBe(true);
  });
});
