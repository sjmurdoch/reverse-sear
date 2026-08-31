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
    expect(text).toMatch(/asymptote T∞\s+\d+\.\d °C\s+\d+\.\d °C/);
    expect(text).toMatch(/time constant τ\s+\d+ min\s+\d+ min/);
    expect(text).toMatch(/dead time\s+\d+ min\s+\d+ min/);

    // and what it means for the next one
    expect(text).toMatch(/NEXT TIME/);
    expect(text).toMatch(/Same steak, same oven, from 5\.0 °C: allow \d+ min to 44\.0 °C\./);
    expect(text).toMatch(/one degree of target is about \d+\.\d min/);
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
