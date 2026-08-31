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

  test('the readings table scores each steak against its own model', async ({ app }) => {
    // The sweep hands the card to the next unprobed steak with a bare render(),
    // no refit -- and `samples` is the *selected* steak's posterior. Left
    // pointing at the steak before it, the "vs model" column scored a 28 mm
    // sirloin's readings against a 48 mm ribeye's model and printed double
    // figures. These are in-sample residuals of a three-parameter fit to three
    // readings: they cannot be large unless the wrong model is being used.
    await app.seedMany(DINNER);
    const t = await app.trip();
    await app.drift(t.openInMin + 0.2);

    expect(await app.dockLabel()).toMatch(/Ribeye — 1 of 3/);
    await app.log(31.0);
    expect(await app.dockLabel(), 'the card has moved on to the sirloin').toMatch(/Sirloin/);

    const rows = await app.rows();
    expect(rows.map(r => r[1]), 'and the table is the sirloin\u2019s')
      .toEqual(['12.0 °C', '28.0 °C', '38.0 °C']);
    for (const r of rows) {
      const d = Math.abs(parseFloat(r[2].replace('\u2212', '-')));
      expect(d, `vs model ${r[2]} at ${r[0]}`).toBeLessThan(2);
    }
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

// A second walkthrough of the same dinner found defects that only exist because
// there is more than one steak: the app has per-steak fields that are accessors
// onto whichever steak is selected, and several things that belong to the whole
// oven were reading or writing through them. These hold the boundary.
test.describe('the oven as a whole, not the steak on screen', () => {

  const DINNER = [
    { name: 'Ribeye', thickMm: 48, massKg: 1.1, targetC: 44, readings: [[0, 5], [16, 15], [28, 26]] },
    { name: 'Sirloin', thickMm: 28, massKg: 0.4, targetC: 52, readings: [[0, 12], [16, 28], [28, 38]] },
    { name: 'Fillet', thickMm: 38, massKg: 0.6, targetC: 44, readings: [[0, 7], [16, 19], [28, 30]] },
  ];

  const spyBeep = app => app.page.evaluate(() => {
    window.__beeps = [];
    window.beep = () => window.__beeps.push(Date.now());
  });
  const beeps = app => app.page.evaluate(() => window.__beeps.length);
  const dueAts = app => app.page.evaluate(() => state.steaks.map(s => s.dueAt));

  test('the alarm rings for the trip, not for the steak on screen', async ({ app }) => {
    // The card counts down to the trip -- the earliest appointment any steak
    // holds -- but the beep was fired from the selected steak's own appointment.
    // So the card said "Open the oven now" and the phone stayed silent for
    // another three minutes, which is the one promise the tool makes to a cook
    // who has put the phone down.
    await app.seedMany(DINNER);
    await spyBeep(app);
    const t = await app.trip();
    const own = await app.page.evaluate(() => (state.dueAt - Date.now()) / 60000);
    expect(own, 'the selected steak must not be the one driving this trip')
      .toBeGreaterThan(t.openInMin + 1);

    await app.drift(t.openInMin + 0.2);
    expect((await app.read()).clock).toBe('now');
    expect(await beeps(app), 'it must ring when the door should open').toBeGreaterThan(0);
  });

  test('a mistyped reading is still questioned after the sweep moves on', async ({ app }) => {
    // The query is raised from the readings, but it was only ever asked of the
    // selected steak -- and logging a number moves the selection straight on to
    // the next steak of the sweep, so the query vanished in the same tick.
    await app.seedMany(DINNER);
    const t = await app.trip();
    await app.drift(t.openInMin + 0.2);
    await app.log(4.3);                       // "43" typed as "4.3" on the Ribeye

    expect(await app.dockLabel(), 'the sweep has moved on').toMatch(/Sirloin — 2 of 3/);
    const r = await app.read();
    expect(r.warn).toMatch(/^Ribeye:/);       // and it says which steak it doubts
    expect(r.warn).toMatch(/4\.3 °C is 21\.7 °C below its last reading of 26 °C/);
    expect(r.warn).toMatch(/tap Ribeye in the list and delete the row/);

    await app.log(42.5);                      // finishing the sweep must not bury it
    expect((await app.read()).warn).toMatch(/^Ribeye:/);
  });

  test('correcting one steak does not move the others’ checks', async ({ app }) => {
    // Every setup field re-made every appointment, and one made just now is
    // floored at now + MIN_GAP_MIN: correcting the Fillet's thickness pushed the
    // Sirloin's check from one minute away to five. That is walkthrough 1's
    // walk-forward defect, arriving through a per-steak door.
    await app.seedMany(DINNER);
    const t = await app.trip();
    await app.drift(t.openInMin - 1);
    const before = await dueAts(app);
    const ids = (await app.state()).steaks.map(s => s.id);

    await app.page.fill(`input[data-f="thickMm"][data-s="${ids[2]}"]`, '35');
    await app.settle();
    const after = await dueAts(app);
    expect(after[0], 'the Ribeye was told nothing').toBe(before[0]);
    expect(after[1], 'nor was the Sirloin').toBe(before[1]);
    expect(after[2], 'the steak that changed is re-planned').not.toBe(before[2]);
  });

  test('the oven temperature is shared, so it does re-plan everything', async ({ app }) => {
    // The counterpart: a change to the oven really is new information about
    // every steak inside it, and each one gets a new appointment.
    await app.seedMany(DINNER);
    const before = await dueAts(app);
    await app.page.fill('#ovenC', '135');
    await app.settle();
    const after = await dueAts(app);
    for (let i = 0; i < 3; i++) expect(after[i]).not.toBe(before[i]);
  });

  test('taking one steak out leaves the others’ appointments alone', async ({ app }) => {
    await app.seedMany([
      { name: 'Ribeye', thickMm: 48, targetC: 44, readings: [[0, 5], [16, 20], [28, 32]] },
      { name: 'Sirloin', thickMm: 28, targetC: 44, readings: [[0, 12], [16, 34], [28, 43]] },
    ]);
    await app.drift(6);
    const before = await dueAts(app);
    await app.page.click('#verdictActs button');       // the Sirloin comes out
    await app.settle();
    const after = await dueAts(app);
    expect(after[0], 'the Ribeye learned nothing from its neighbour leaving').toBe(before[0]);
  });

  test('the fields at the top of Setup stay the first steak’s', async ({ app }) => {
    // They were written through the per-steak accessors, which follow the
    // selection: tapping a row to read its numbers silently re-aimed the form,
    // so a correction to the Ribeye's thickness landed on the Sirloin.
    await app.seedMany(DINNER);
    await app.page.click('#steakList .srow:nth-child(2)');
    await app.settle();
    expect(await app.page.textContent('#readingsTitle')).toMatch(/Sirloin/);

    await app.page.fill('#thickMm', '52');
    await app.settle();
    expect((await app.state()).steaks.map(s => s.thickMm)).toEqual([52, 28, 38]);

    // and the block names the steak it belongs to, so this is visible up front
    await expect(app.page.locator('#firstHead')).toBeVisible();
    expect(await app.page.inputValue('#firstName')).toBe('Ribeye');
    expect(await app.page.textContent('#priorNote')).toMatch(/^Ribeye before any reading/);
  });

  test('a steak added to a running cook goes in without disturbing it', async ({ app }) => {
    // "Add another steak" is offered mid-cook, and the only button that looked
    // like it would put the new one in re-zeroed every steak already in the
    // oven -- or, with a steak whose starting box was hidden, refused and left
    // no way forward at all.
    await app.seedMany(DINNER.slice(0, 2));
    const before = await app.state();
    await app.page.evaluate(() => { document.getElementById('setup').open = true; render(); });
    await app.page.click('#addBtn');
    await app.settle();

    await expect(app.page.locator('#startTempField'),
      'steak 1 is cooking, so it has no starting temperature left to give').toBeHidden();
    await expect(app.page.locator('#startBtn')).toHaveText(/steak 3 into the oven/i);

    const ids = (await app.state()).steaks.map(s => s.id);
    await app.page.fill(`input[data-f="startTemp"][data-s="${ids[2]}"]`, '6');
    await app.page.click('#startBtn');
    await app.settle();

    expect((await app.read()).startWarn).toBe('');
    const s = await app.state();
    expect(s.steaks[0].startedAt, 'the running cook keeps its zero').toBe(before.steaks[0].startedAt);
    expect(s.steaks[0].readings.length).toBe(3);
    expect(s.steaks[1].readings.length).toBe(3);
    expect(s.steaks[2].startedAt, 'the new one starts now').toBeGreaterThan(before.steaks[0].startedAt);
    expect(s.steaks[2].readings).toEqual([{ t: 0, temp: 6 }]);
    expect(s.current, 'and the card stays with the cook in progress').toBe(ids[0]);
  });

  // Walkthrough 5, per steak: an estimate too loose to state is too loose to
  // take a steak out on, and with three in the oven that decision is made once
  // per steak rather than once per card.
  test('a steak whose estimate straddles the target is probed, not called out', async ({ app }) => {
    await app.seedMany([
      { name: 'Ribeye', thickMm: 48, targetC: 44, readings: [[0, 5], [14, 12]] },
      { name: 'Sirloin', thickMm: 28, targetC: 44, readings: [[0, 12], [16, 34], [28, 43]] },
    ], { elapsed: 28 });
    await app.advance(30);

    const spread = await app.page.evaluate(() => state.steaks.map(s => {
      const f = fits.get(s.id);
      const p = pcts(f.samples.map(th => modelTemp(th, localMin(s))), [0.05, 0.5, 0.95]);
      return { lo: p[0], mid: p[1], hi: p[2] };
    }));
    const [ribeye, sirloin] = spread;
    expect(ribeye.mid, 'the state under test: the median has passed target').toBeGreaterThan(44);
    expect(ribeye.lo, 'while the interval still straddles it').toBeLessThan(44);
    expect(ribeye.hi - ribeye.lo).toBeGreaterThan(6);
    expect(sirloin.lo, 'and the other one is certain').toBeGreaterThan(44);

    const pills = (await app.rows2()).map(x => x.pill);
    expect(pills[0], 'the vague one wants the probe, not the pull').toBe('probe');
    expect(pills[1]).toBe('take out');
    const r = await app.read();
    expect(r.label).toMatch(/take out sirloin/i);
    expect(r.label).not.toMatch(/ribeye/i);
  });

  // Walkthrough 6. Dinner is served when the guests are at the table, not when
  // the model is happy, and with three steaks in that is one decision.
  test('the whole oven can come out early, and go back in', async ({ app }) => {
    await app.seedMany(DINNER);
    const r = await app.read();
    expect(r.label, 'the state under test: nothing is ready').toMatch(/open the oven in/i);
    expect(r.action).toMatch(/all out of the oven early/i);
    expect(await app.page.getAttribute('#verdictActs button', 'class')).toBe('ghost');

    const before = await app.state();
    await app.page.click('#verdictActs button');
    await app.settle();
    const s = await app.state();
    expect(s.steaks.every(x => x.finishedAt), 'every steak is out').toBe(true);
    expect(s.steaks.every(x => x.finalTemp != null), 'each with its own number').toBe(true);

    // ...and one press puts back everything that came out in the same action.
    await app.page.click('#verdictActs button');
    await app.settle();
    const back = await app.state();
    expect(back.steaks.every(x => !x.finishedAt)).toBe(true);
    expect(back.steaks.map(x => x.startedAt)).toEqual(before.steaks.map(x => x.startedAt));
    expect(back.steaks.map(x => x.readings.length)).toEqual(before.steaks.map(x => x.readings.length));
    // Each is waiting on a probe now, so none of them is offered up for the pull.
    expect((await app.rows2()).map(x => x.pill)).toEqual(['probe', 'probe', 'probe']);
  });

  // The alarm belongs to the oven, and the model checker found the case the
  // first fix did not cover: not two steaks in, but one in and one merely on
  // the list. `alarmIsArmedWhileCooking` and `alarmRingsAtTheTrip` in
  // spec/steak.qnt are these two tests.
  test('a steak selected but never started does not silence the oven', async ({ app }) => {
    // Tapping the glance row of a steak that is not in the oven points the
    // readouts at a steak with no cook. render() then returned at "Set up your
    // steak" -- before the alarm was checked at all -- and alarmAt() read that
    // steak's null dueAt. The phone stayed silent through a real check.
    await app.seedMany([DINNER[0]]);
    await spyBeep(app);
    await app.page.click('#addBtn');
    await app.settle();
    await app.page.click('#steakList .srow:nth-child(2)');
    await app.settle();

    const s = await app.state();
    expect(s.current, 'the state under test: a steak with no cook is selected')
      .toBe(s.steaks[1].id);
    expect((await app.read()).label).toBe('Set up your steak');

    const dueIn = await app.page.evaluate(() => (state.steaks[0].dueAt - Date.now()) / 60000);
    expect(dueIn, 'and the one in the oven has a real appointment ahead of it').toBeGreaterThan(1);

    await app.drift(dueIn + 5);
    expect(await app.page.evaluate(() => alarmAt()),
      'the alarm is the oven\'s, not the selection\'s').not.toBeNull();
    expect(await beeps(app), 'it must ring even with the readouts elsewhere').toBeGreaterThan(0);
  });

  test('a steak taken out does not silence the ones still in', async ({ app }) => {
    // The same defect through the other door: the finished card returns early
    // too, and the selection lands on a steak whose appointment is over.
    await app.seedMany(DINNER.slice(0, 2));
    await spyBeep(app);
    await app.page.evaluate(() => {
      const st = state.steaks[1];
      st.finishedAt = Date.now(); st.finalTemp = 44; st.dueAt = null;
      state.current = st.id;
      recompute(); save(); render();
    });
    await app.settle();
    expect((await app.read()).label).toMatch(/Out of the oven/);

    const dueIn = await app.page.evaluate(() => (state.steaks[0].dueAt - Date.now()) / 60000);
    await app.drift(dueIn + 5);
    expect(await beeps(app), 'the Ribeye is still in there and still overdue').toBeGreaterThan(0);
  });

  test('a cook left open overnight does not ring', async ({ app }) => {
    // The one state that is exempt. Checking the alarm before render()'s early
    // returns must not start beeping at a cook the app has already given up on.
    await app.seedMany(DINNER.slice(0, 1));
    await spyBeep(app);
    await app.drift(24 * 60);
    expect((await app.read()).label).toBe('Earlier cook still open');
    expect(await beeps(app), 'nothing in that oven is being cooked now').toBe(0);
  });

  test('starting another cook clears the whole oven', async ({ app }) => {
    // It cleared the selected steak only. The other two stayed marked "out" for
    // ever, and a steak that has started shows no starting-temperature box, so
    // the next dinner could not be started at all.
    await app.seedMany(DINNER);
    await app.page.evaluate(() => {
      for (const st of state.steaks) { st.finishedAt = Date.now(); st.finalTemp = 44; }
      recompute(); save(); render();
    });
    await app.settle();

    const done = await app.read();
    expect(done.label, 'the temperature on the card is one steak’s').toMatch(/Out of the oven — Ribeye/);
    expect(done.action).toMatch(/start another cook/i);

    await app.page.click('#verdictActs button');
    await app.settle();
    const s = await app.state();
    expect(s.steaks.map(x => x.startedAt)).toEqual([null, null, null]);
    expect(s.steaks.map(x => x.finishedAt)).toEqual([null, null, null]);
    expect(s.steaks.every(x => x.readings.length === 0)).toBe(true);

    // and the next dinner really can be started
    const ids = s.steaks.map(x => x.id);
    await app.page.fill('#startTemp', '5');
    await app.page.fill(`input[data-f="startTemp"][data-s="${ids[1]}"]`, '6');
    await app.page.fill(`input[data-f="startTemp"][data-s="${ids[2]}"]`, '7');
    await app.page.click('#startBtn');
    await app.settle();
    const s2 = await app.state();
    expect(s2.steaks.every(x => x.startedAt)).toBe(true);
    expect(s2.steaks.map(x => x.readings[0].temp)).toEqual([5, 6, 7]);
  });
});
