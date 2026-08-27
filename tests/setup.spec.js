// @ts-check
const { test, expect } = require('./fixtures');

test.describe('setting up a cook', () => {

  test('the form is reachable without scrolling past empty cards', async ({ app }) => {
    const r = await app.page.evaluate(() => {
      const setup = document.getElementById('setup').getBoundingClientRect();
      return {
        setupTop: setup.top,
        viewport: window.innerHeight,
        statsHidden: document.getElementById('statsRow').classList.contains('hidden'),
        chartHidden: document.getElementById('chartCard').classList.contains('hidden'),
        readingsHidden: document.getElementById('readingsCard').classList.contains('hidden'),
        setupOpen: document.getElementById('setup').open,
      };
    });
    expect(r.setupOpen).toBe(true);
    expect(r.setupTop).toBeLessThan(r.viewport);   // visible on first screen
    expect(r.statsHidden).toBe(true);              // empty cards deferred
    expect(r.chartHidden).toBe(true);
    expect(r.readingsHidden).toBe(true);
    expect((await app.read()).dockHidden).toBe(true);
  });

  // The same slip as a mistyped reading, at the one moment it anchors the whole
  // cook: t0 is where every fitted curve starts.
  test('a starting temperature hotter than the oven does not start a cook', async ({ app }) => {
    await app.page.fill('#startTemp', '433');
    await app.page.click('#startBtn');
    await app.settle();
    expect((await app.state()).startedAt, 'the cook must not start').toBeFalsy();
    expect((await app.read()).startWarn).toMatch(/at or above the oven \(125 °C\)/);
    await expect(app.page.locator('#startTemp')).toBeFocused();

    await app.start(4.3);
    expect((await app.state()).startedAt).toBeTruthy();
    expect((await app.read()).startWarn).toBe('');
  });

  test('the prompt names the action it wants', async ({ app }) => {
    const r = await app.read();
    expect(r.label).toMatch(/set up/i);
    expect(r.why).toMatch(/oven temperature/i);
    await expect(app.page.locator('#startBtn')).toHaveText(/start cook/i);
  });

  test('setup explains what target means and when zero is', async ({ app }) => {
    const notes = await app.page.$$eval('#setup .note', ns => ns.map(n => n.textContent));
    const all = notes.join(' ');
    expect(all).toMatch(/leaves the oven/i);          // target is the out-of-oven number
    expect(all).toMatch(/goes into the oven/i);       // when to press Start
  });

  test('the prior responds to the steak you describe', async ({ app }) => {
    const tauOf = () => app.page.evaluate(() =>
      parseFloat(document.getElementById('priorNote').textContent.match(/([\d.]+) min/)[1]));

    await app.setup({ thickMm: 40 });
    const thin40 = await tauOf();
    await app.setup({ thickMm: 55 });
    expect(await tauOf()).toBeGreaterThan(thin40);
    await app.setup({ thickMm: 40, fan: true });
    expect(await tauOf()).toBeLessThan(thin40);

    await app.setup({ fan: false, ovenC: 160 });
    const note = await app.page.textContent('#priorNote');
    expect(note).toMatch(/asymptote around \d+ °C/);
  });

  test('settings persist and are shown when the panel is closed', async ({ app }) => {
    await app.setup({ ovenC: 118, targetC: 47, thickMm: 33, fan: true });
    await app.start(7);
    const digest = await app.page.textContent('#setupDigest');
    expect(digest).toContain('118');
    expect(digest).toContain('47');
    expect(digest).toContain('33mm');
    expect(digest).toContain('fan');

    await app.page.reload();
    await app.settle();
    const s = await app.state();
    expect(s.ovenC).toBe(118);
    expect(s.targetC).toBe(47);
    expect(s.thickMm).toBe(33);
    expect(s.fan).toBe(true);
    expect(await app.page.inputValue('#ovenC')).toBe('118');
  });

  test('start refuses a blank temperature rather than inventing one', async ({ app }) => {
    await app.page.fill('#startTemp', '');
    await app.page.click('#startBtn');
    await app.settle();
    const s = await app.state();
    expect(s.startedAt).toBeNull();
    await expect(app.page.locator('#startTemp')).toBeFocused();
  });

  // Walkthrough 5. The steak goes into the oven when the oven is free; the phone
  // is found later. Readings could already be backdated -- this is the same
  // control for the one reading the whole cook is anchored to.
  test('a steak that went in before the phone was found', async ({ app }) => {
    await app.page.click('#startChips button[data-age="10"]');
    await app.settle();
    expect(await app.page.textContent('#startNote'),
      'the note must stop calling the press the zero').toMatch(/zero is 10 minutes ago/);

    await app.page.fill('#startTemp', '9');
    await app.page.click('#startBtn');
    await app.settle();

    const s = await app.state();
    expect(s.elapsedMin, 'the clock starts ten minutes in').toBeGreaterThan(9.5);
    expect(s.elapsedMin).toBeLessThan(11);
    expect(s.readings).toEqual([{ t: 0, temp: 9 }]);
    expect(s.dueAt, 'and it still has an appointment ahead of it').toBeGreaterThan(Date.now());

    // the chip resets, so the next cook is not silently backdated too
    expect(await app.page.getAttribute('#startChips button[data-age="0"]', 'aria-pressed')).toBe('true');
    await expect(app.page.locator('#startAgeRow'),
      'and there is nothing left to backdate once it is in').toBeHidden();
  });

  test('starting reveals the cook and brings the answer into view', async ({ app }) => {
    // Act from the bottom of the page, where the button actually is.
    await app.page.$eval('#startBtn', el => el.scrollIntoView({ block: 'center' }));
    await app.page.fill('#startTemp', '5');
    await app.page.click('#startBtn');
    await app.page.waitForTimeout(700);   // the scroll is smooth

    const r = await app.read();
    expect(r.setupOpen).toBe(false);
    expect(r.statsHidden).toBe(false);
    expect(r.dockHidden).toBe(false);
    expect(r.label).toMatch(/next check/i);

    await expect.poll(() => app.page.evaluate(() => {
      const b = document.getElementById('verdict').getBoundingClientRect();
      return b.top >= -8 && b.top < window.innerHeight;
    }), { message: 'the verdict card must be visible after acting' }).toBe(true);

    const s = await app.state();
    expect(s.readings).toEqual([{ t: 0, temp: 5 }]);
    expect(s.dueAt).not.toBeNull();
  });
});
