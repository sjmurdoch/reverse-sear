// @ts-check
const { test, expect } = require('./fixtures');

// A cook is a measurement. When it is over the page writes down what it was,
// what it did and what the fit says about doing it again -- in plain text the
// phone can hand to the share sheet, so the next cook of the same steak starts
// from a number rather than from the prior.
test.describe('the cook report', () => {

  const DINNER = [
    { name: 'Ribeye', thickMm: 48, massKg: 1.1, targetC: 44, readings: [[0, 5], [16, 15], [28, 26], [44, 36]] },
    { name: 'Sirloin', thickMm: 28, massKg: 0.4, targetC: 52, readings: [[0, 12], [16, 28], [28, 38], [44, 47]] },
  ];

  /** Take every steak out, as the trip card's one press does. */
  const pullAll = async app => {
    await app.page.evaluate(() => { for (const st of state.steaks) finishSteak(st); });
    await app.settle();
  };

  const shown = app => app.page.evaluate(() =>
    !document.getElementById('reportCard').classList.contains('hidden'));
  const report = app => app.page.textContent('#reportText');

  test('there is no report until everything is out', async ({ app }) => {
    await app.seedMany(DINNER, { elapsed: 44 });
    expect(await shown(app), 'the cook is still running').toBe(false);

    await app.page.evaluate(() => finishSteak(state.steaks[0]));
    await app.settle();
    expect(await shown(app), 'one out of two is not the end of the cook').toBe(false);

    await app.page.evaluate(() => finishSteak(state.steaks[1]));
    await app.settle();
    expect(await shown(app)).toBe(true);
  });

  test('it carries the parameters, every reading and the fit', async ({ app }) => {
    await app.seedMany(DINNER, { elapsed: 44 });
    await pullAll(app);
    const text = await report(app);

    // the oven
    expect(text).toMatch(/125 °C, conventional/);
    expect(text).toMatch(/2 steaks, in together/);
    expect(text).toMatch(/door opened 3 times/);

    // each steak's parameters
    expect(text).toMatch(/RIBEYE/);
    expect(text).toMatch(/1\.10 kg · 48 mm thick · target 44\.0 °C/);
    expect(text).toMatch(/SIRLOIN/);
    expect(text).toMatch(/0\.40 kg · 28 mm thick · target 52\.0 °C/);

    // every reading, both steaks, with its residual against the fitted curve
    for (const t of ['5.0', '15.0', '26.0', '36.0', '12.0', '28.0', '38.0', '47.0']) {
      expect(text, `reading ${t} is in the report`).toContain(t);
    }
    expect((text.match(/^\s+(start|\d+\.\d)\s+\d+\.\d\s+[−+]\d/gm) || []).length,
      'eight readings, each with a residual').toBe(8);

    // the three fitted parameters, against the prior they started from
    expect(text).toMatch(/asymptote T∞\s+\d+\.\d °C\s+\(.+?\)\s+\d+\.\d °C/);
    expect(text).toMatch(/time constant τ\s+\d+ min\s+\(.+?\)\s+\d+ min/);
    expect(text).toMatch(/dead time\s+\d+ min\s+\(.+?\)\s+\d+ min/);

    // and what it means for the next one
    expect(text).toMatch(/NEXT TIME/);
    expect(text).toMatch(/Same steak, same oven, from 5\.0 °C: allow \d+ min to 44\.0 °C\./);
    expect(text).toMatch(/T = T∞ − \(T∞ − T₀\)·exp/);
  });

  test('the numbers in it are the cook’s, not the model’s live guess', async ({ app }) => {
    // Nothing in the report may tick: render() runs every second, and text that
    // is rewritten under the finger cannot be selected and copied by hand.
    await app.seedMany(DINNER, { elapsed: 44 });
    await pullAll(app);
    const before = await report(app);
    await app.page.evaluate(() => document.getElementById('reportText').dataset.marked = 'yes');
    await app.page.evaluate(() => new Promise(r => setTimeout(r, 2600)));
    await app.drift(20);
    await app.advance(20);

    expect(await report(app), 'the same cook, so the same report').toBe(before);
    expect(await app.page.getAttribute('#reportText', 'data-marked'),
      'and the element it is in survives the render tick').toBe('yes');
  });

  test('Copy puts it on the clipboard', async ({ app }) => {
    await app.seedMany(DINNER, { elapsed: 44 });
    await pullAll(app);
    await app.page.evaluate(() => {
      window.__copied = null;
      // Headless WebKit refuses the real clipboard, and what is being tested is
      // that the button hands over the whole report.
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: t => { window.__copied = t; return Promise.resolve(); } },
      });
    });
    await app.page.click('#copyBtn');
    await app.settle();
    const copied = await app.page.evaluate(() => window.__copied);
    expect(copied).toBe(await report(app));
    expect(await app.page.textContent('#reportNote')).toMatch(/copied/i);
  });

  test('Share hands the report to the phone’s share sheet', async ({ app }) => {
    await app.seedMany(DINNER, { elapsed: 44 });
    await pullAll(app);
    await app.page.evaluate(() => {
      window.__shared = null;
      navigator.share = d => { window.__shared = d; return Promise.resolve(); };
      render();
    });
    await app.settle();
    await expect(app.page.locator('#shareBtn'), 'offered once the platform has a share sheet')
      .toBeVisible();
    await app.page.click('#shareBtn');
    await app.settle();
    const shared = await app.page.evaluate(() => window.__shared);
    expect(shared.text).toBe(await report(app));
    expect(shared.title).toMatch(/steak/i);
  });

  test('dismissing the share sheet is not a failure', async ({ app }) => {
    await app.seedMany(DINNER, { elapsed: 44 });
    await pullAll(app);
    await app.page.evaluate(() => {
      window.__copied = null;
      navigator.share = () => Promise.reject(Object.assign(new Error('cancelled'), { name: 'AbortError' }));
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: t => { window.__copied = t; return Promise.resolve(); } },
      });
      render();
    });
    await app.page.click('#shareBtn');
    await app.settle();
    expect(await app.page.evaluate(() => window.__copied),
      'a cancelled share must not silently copy instead').toBe(null);
    expect(await app.page.textContent('#reportNote')).toBe('');
  });

  // A real cook (2026-08-31: two 50 mm steaks, 120 C conventional, in from cold)
  // showed the report asserting mechanisms it cannot identify. These hold the
  // line between what the fit measured and what it merely fitted.
  // The real cook's own numbers, which fit a dead time of about 10 min.
  const REAL = [
    { name: 'Steak 1', thickMm: 50, massKg: 1.0, targetC: 57,
      readings: [[0, 5], [31, 17.5], [56, 28.3], [86, 41.7], [99, 44.3],
                 [112, 46.9], [134, 51.0], [160, 55.2], [170, 56.6]] },
  ];

  test('it does not blame the dead time on one cause it cannot identify', async ({ app }) => {
    await app.seedMany(REAL, { elapsed: 170 });
    await app.page.evaluate(() => { state.ovenC = 120; recompute(); render(); });
    await pullAll(app);
    const text = await report(app);
    expect(text, 'the state under test: a dead time long enough to explain')
      .toMatch(/before the core moved at all/);
    expect(text, 'it may not name the wet surface as the cause')
      .not.toMatch(/that is the wet surface/);
    expect(text).toMatch(/the fit cannot separate them/);
    expect(text).toMatch(/the time heat takes to reach the centre of 50 mm/);
  });

  test('a cold start is recorded, and named as what the dead time may be', async ({ app }) => {
    await app.seedMany(DINNER, { elapsed: 44 });
    await app.page.evaluate(() => { state.preheated = false; save(); render(); });
    await pullAll(app);
    const text = await report(app);
    expect(text).toMatch(/STILL WARMING when they went in/);
    expect(text, "the oven's own advice belongs to the oven, said once")
      .toMatch(/A cold start delays everything by roughly the oven's own warm-up time/);
    expect((text.match(/A cold start delays everything/g) || []).length).toBe(1);

    // and the other way round
    await app.page.evaluate(() => { state.preheated = true; save(); render(); });
    await app.settle();
    const hot = await report(app);
    expect(hot).toMatch(/up to temperature when they went in/);
    expect(hot).not.toMatch(/A cold start delays everything/);
  });

  test('it withholds parameter advice from a fit that is not pinned down', async ({ app }) => {
    // A steak pulled before its curve bends leaves T-inf and tau trading along
    // a ridge. The residuals are tiny and the numbers are a guess; the report
    // used to quote them and say "expect that again".
    await app.seedMany([
      { name: 'Early', thickMm: 50, massKg: 1.0, targetC: 44,
        readings: [[0, 5], [31, 15.4], [57, 26.4], [86, 37.0], [100, 41.6]] },
    ], { elapsed: 100 });
    await pullAll(app);
    const text = await report(app);

    const band = await app.page.evaluate(() => {
      const f = fits.get(state.steaks[0].id);
      const q = pcts(f.samples.map(x => x[1]), [0.05, 0.95]);
      return q[1] - q[0];
    });
    expect(band, 'the state under test: the asymptote is barely narrowed from the prior')
      .toBeGreaterThan(25);

    expect(text).toMatch(/NOT pinned down by this cook/);
    expect(text).toMatch(/% of the way to its own fitted asymptote/);
    expect(text, 'and it must not tell the cook to expect these numbers again')
      .not.toMatch(/expect that again/);
    expect(text, 'nor read the tail rate off an unpinned posterior')
      .not.toMatch(/one degree of target is about/);
    // What is measured rather than fitted still stands.
    expect(text).toMatch(/allow \d+ min to 44\.0 °C/);
  });

  test('a pinned fit keeps everything it earned', async ({ app }) => {
    // The counterpart: readings that go far enough up the curve to bend it.
    await app.seedMany([
      { name: 'Full', thickMm: 50, massKg: 1.0, targetC: 57,
        readings: [[0, 5], [31, 17.5], [56, 28.3], [86, 41.7], [99, 44.3],
                   [112, 46.9], [134, 51.0], [160, 55.2], [170, 56.6]] },
    ], { elapsed: 170 });
    await pullAll(app);
    const text = await report(app);
    expect(text).not.toMatch(/NOT pinned down/);
    expect(text).toMatch(/one degree of target is about \d+\.\d min/);
  });

  test('the fitted numbers are shown with the band the fit actually has', async ({ app }) => {
    await app.seedMany(DINNER, { elapsed: 44 });
    await pullAll(app);
    const text = await report(app);
    expect(text).toMatch(/asymptote T∞\s+\d+\.\d °C\s+\(\d+\.\d–\d+\.\d\)/);
    expect(text).toMatch(/time constant τ\s+\d+ min\s+\(\d+–\d+\)/);
    expect(text).toMatch(/dead time\s+\d+ min\s+\(\d+–\d+\)/);
    expect(text, 'a tiny residual on a three-parameter fit is not a quality signal')
      .toMatch(/small is expected, not evidence/);
  });

  test('it survives closing the app, and goes when the next cook starts', async ({ app }) => {
    await app.seedMany(DINNER, { elapsed: 44 });
    await pullAll(app);
    const before = await report(app);

    await app.page.reload();
    await app.settle();
    expect(await shown(app), 'the record of the cook outlives the tab').toBe(true);
    expect(await report(app)).toBe(before);

    // "Start another cook" is the line the history is kept until.
    await app.page.click('#verdictActs button');
    await app.settle();
    expect(await shown(app)).toBe(false);
  });
});
