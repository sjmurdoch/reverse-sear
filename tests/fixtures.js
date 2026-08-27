// @ts-check
const base = require('@playwright/test');

/**
 * Every test gets an `app` fixture: a loaded page plus the handful of moves a
 * cook makes, and a controllable clock.
 *
 * Time is advanced by moving `Date.now()`, never by moving `state.startedAt`.
 * Shifting the start time also shifts every quantity derived from it, which
 * hides exactly the scheduling bugs these tests exist to catch.
 */
class App {
  constructor(page) {
    this.page = page;
  }

  async goto() {
    await this.page.goto('/index.html');
    await this.page.waitForFunction(() => typeof window.render === 'function');
    await this.settle();
  }

  /** Let the one-second render tick run at least once. */
  async settle() {
    await this.page.waitForTimeout(120);
  }

  /** Move the wall clock forward and let the app react as it would on its timer. */
  async advance(minutes) {
    await this.page.evaluate(m => {
      window.__setSkew(window.__skew + m * 60000);
      recompute();
      render();
    }, minutes);
    await this.settle();
  }

  /** Move the clock without letting the app refit, as happens between its 60 s refits. */
  async drift(minutes) {
    await this.page.evaluate(m => { window.__setSkew(window.__skew + m * 60000); render(); }, minutes);
    await this.settle();
  }

  async setup(cfg = {}) {
    for (const [id, value] of Object.entries(cfg)) {
      if (id === 'fan') {
        await this.page.click(`#fanToggle button[data-fan="${value ? 1 : 0}"]`);
      } else {
        await this.page.fill(`#${id}`, String(value));
      }
    }
    await this.settle();
  }

  async start(startTemp = 5) {
    await this.page.fill('#startTemp', String(startTemp));
    await this.page.click('#startBtn');
    await this.settle();
  }

  /** Log a reading. `age` picks the "1m ago" / "2m ago" chip. */
  async log(temp, age = 0) {
    if (age) await this.page.click(`#ageChips button[data-age="${age}"]`);
    await this.page.fill('#readTemp', String(temp));
    await this.page.click('#logBtn');
    await this.settle();
  }

  /**
   * Put the app straight into a mid-cook state without waiting in real time.
   * Readings are given as [minutesElapsed, °C]; the first is the start.
   */
  async seed(readings, { elapsed = null } = {}) {
    const spentMin = elapsed == null ? readings[readings.length - 1][0] : elapsed;
    await this.page.evaluate(({ readings, spentMin }) => {
      state.startedAt = Date.now() - spentMin * 60000;
      state.readings = readings.map(([t, temp]) => ({ t, temp }));
      state.finishedAt = null;
      state.finalTemp = null;
      recompute();
      rescheduleCheck();
      save();
      render();
    }, { readings, spentMin });
    await this.settle();
  }

  /**
   * Several steaks in one oven, all in at the same time. Each entry is
   * { readings: [[t, °C]], name, targetC, thickMm, massKg }.
   */
  async seedMany(list, { elapsed = null } = {}) {
    await this.page.evaluate(({ list, elapsed }) => {
      const spent = elapsed == null
        ? Math.max(...list.map(d => d.readings[d.readings.length - 1][0])) : elapsed;
      const at = Date.now() - spent * 60000;
      state.steaks = list.map((d, i) => Object.assign(newSteak(i + 1), {
        id: 'seed' + (i + 1),
        name: d.name || 'Steak ' + (i + 1),
        targetC: d.targetC == null ? 44 : d.targetC,
        thickMm: d.thickMm == null ? 40 : d.thickMm,
        massKg: d.massKg == null ? 1.0 : d.massKg,
        startedAt: at,
        readings: d.readings.map(([t, temp]) => ({ t, temp })),
      }));
      state.current = state.steaks[0].id;
      recompute(); rescheduleCheck(); save(); render();
    }, { list, elapsed });
    await this.settle();
  }

  /** What each steak's glance row says. */
  rows2() {
    return this.page.$$eval('#steakList .srow', els => els.map(el => ({
      name: el.querySelector('.nm').textContent.trim(),
      temp: el.querySelector('.t').textContent.trim(),
      pill: el.querySelector('.spill').textContent.trim(),
      when: el.querySelector('.when').textContent.trim(),
    })));
  }

  dockLabel() { return this.page.textContent('#readLabel'); }

  /** The shared trip: when the door opens, and what each steak wants then. */
  trip() {
    return this.page.evaluate(() => {
      const o = nextOpening();
      if (!o) return null;
      return {
        openInMin: (o.openAt - Date.now()) / 60000,
        kinds: o.orders.map(x => x.kind),
        dueAts: state.steaks.map(s => s.dueAt),
        pullOrder: o.orders.slice().sort((a, b) => a.pullAt - b.pullAt)
          .map(x => (state.steaks.find(s => s.id === x.id) || {}).name),
      };
    });
  }

  /** Everything the card is currently telling the cook. */
  read() {
    return this.page.evaluate(() => ({
      label: document.getElementById('verdictLabel').textContent,
      clock: document.getElementById('verdictClock').textContent,
      at: document.getElementById('verdictAt').textContent.trim(),
      why: document.getElementById('verdictWhy').textContent.trim(),
      wake: document.getElementById('wakeNote').textContent.trim(),
      warn: document.getElementById('dockWarn').textContent.trim(),
      startWarn: document.getElementById('startWarn').textContent.trim(),
      action: (document.getElementById('verdictActs').querySelector('button') || {}).textContent || null,
      coreNow: document.getElementById('statNow').textContent.trim(),
      hit: document.getElementById('statHit').textContent.trim(),
      tau: document.getElementById('statTau').textContent.trim(),
      dockHidden: document.getElementById('dock').classList.contains('hidden'),
      statsHidden: document.getElementById('statsRow').classList.contains('hidden'),
      setupOpen: document.getElementById('setup').open,
    }));
  }

  /** The app's internal state, for assertions the UI does not surface. */
  state() {
    return this.page.evaluate(() => ({
      ...JSON.parse(JSON.stringify(state)),
      elapsedMin: nowMin(),
      dueMin: typeof dueMin === 'function' && state.startedAt ? dueMin() : null,
      // `plan` is a top-level `let`, so it is a global lexical binding and not a
      // property of `window` -- reading it off `window` silently yields null.
      planNext: plan ? plan.next : null,
      planPull: plan ? plan.pull : null,
      planAction: plan ? plan.action : null,
    }));
  }

  rows() {
    return this.page.$$eval('#log tr', trs => trs
      .filter(tr => tr.cells.length === 4)
      .map(tr => [...tr.cells].map(c => c.textContent.trim())));
  }
}

exports.test = base.test.extend({
  app: async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', e => errors.push(`${e.name}: ${e.message}`));
    page.on('console', m => {
      // The favicon 404 from the bare static server is not the app's problem.
      if (m.type() === 'error' && !/favicon|ERR_CONNECTION|Failed to load resource/i.test(m.text())) {
        errors.push(`console: ${m.text()}`);
      }
    });

    // The skew is kept in sessionStorage because addInitScript re-runs on every
    // navigation: without it, a reload would silently rewind the clock and hide
    // the very resume behaviour these tests check.
    await page.addInitScript(() => {
      const real = Date.now;
      let stored = 0;
      try { stored = Number(sessionStorage.getItem('__pwSkew') || 0); } catch (e) { /* blocked */ }
      window.__skew = stored;
      window.__setSkew = v => {
        window.__skew = v;
        try { sessionStorage.setItem('__pwSkew', String(v)); } catch (e) { /* blocked */ }
      };
      Date.now = () => real() + window.__skew;
    });

    const app = new App(page);
    await app.goto();
    await use(app);

    // No test may leave JavaScript errors behind.
    base.expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
  },
});

exports.expect = base.expect;
