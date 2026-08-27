// @ts-check
const { test, expect } = require('./fixtures');

// These drive the page's own model functions directly.  They are the JS half of
// a model implemented twice (model/fit.py is the reference); model/test_model.py
// asserts the same properties on the Python side and tests/parity.spec.js checks
// the two agree.
test.describe('heat model', () => {

  test('lambda1 solves lambda*tan(lambda) = Bi', async ({ app }) => {
    const rows = await app.page.evaluate(() =>
      [0.01, 0.1, 0.9, 5, 50].map(bi => [bi, lambda1(bi)]));
    for (const [bi, lam] of rows) {
      expect(lam * Math.tan(lam)).toBeCloseTo(bi, 4);
      expect(lam).toBeGreaterThan(0);
      expect(lam).toBeLessThan(Math.PI / 2);
    }
  });

  test('time constant follows the geometry it is derived from', async ({ app }) => {
    const r = await app.page.evaluate(() => ({
      base: tauPriorMinutes(planDims(1.0, 0.040), 20),
      thicker: tauPriorMinutes(planDims(1.0, 0.055), 20),
      thinner: tauPriorMinutes(planDims(1.0, 0.025), 20),
      fan: tauPriorMinutes(planDims(1.0, 0.040), 26),
      slab: tauPriorMinutes([0.040], 20),
    }));
    // A 1 kg, 40 mm steak in a still oven: the number quoted in the README.
    expect(r.base).toBeGreaterThan(55);
    expect(r.base).toBeLessThan(67);
    expect(r.thicker).toBeGreaterThan(r.base);      // thicker heats slower
    expect(r.thinner).toBeLessThan(r.base);
    expect(r.fan).toBeLessThan(r.base);             // more convection, faster
    // Edges help: a finite body beats an infinite slab of the same thickness.
    expect(r.base).toBeLessThan(r.slab);
  });

  test('priors track the oven and the steak', async ({ app }) => {
    const r = await app.page.evaluate(() => ({
      hot: buildPriors({ ovenC: 160, targetC: 44, massKg: 1, thickMm: 40, fan: false }),
      cool: buildPriors({ ovenC: 100, targetC: 44, massKg: 1, thickMm: 40, fan: false }),
    }));
    // The effective asymptote sits below the oven because of evaporation, and
    // can never exceed it.
    expect(r.hot.tInfMean).toBeLessThan(160);
    expect(r.hot.tInfMax).toBe(160);
    expect(r.cool.tInfMean).toBeLessThan(r.hot.tInfMean);
  });

  test('the curve has the shape the model claims', async ({ app }) => {
    const r = await app.page.evaluate(() => {
      const th = [Math.log(60), 105, 6, 5];       // tau 60 min, T8 105, lag 6, T0 5
      return {
        atZero: modelTemp(th, 0),
        inLag: modelTemp(th, 5.9),
        series: [0, 10, 20, 40, 80, 160, 600].map(t => modelTemp(th, t)),
        oneTau: modelTemp(th, 6 + 60),
      };
    });
    expect(r.atZero).toBeCloseTo(5, 6);
    expect(r.inLag).toBeCloseTo(5, 6);                       // flat through the dead time
    for (let i = 1; i < r.series.length; i++) {
      expect(r.series[i]).toBeGreaterThan(r.series[i - 1]);  // monotone
      expect(r.series[i]).toBeLessThan(105);                 // never passes the asymptote
    }
    expect(r.series[6]).toBeCloseTo(105, 0);                 // and reaches it eventually
    // One time constant after the lag: 63.2% of the way up.
    expect(r.oneTau).toBeCloseTo(5 + (105 - 5) * (1 - Math.exp(-1)), 3);
  });

  test('time-to-target handles the cases that have no answer', async ({ app }) => {
    const r = await app.page.evaluate(() => {
      const reach = [[Math.log(60), 105, 6, 5]];
      const stall = [[Math.log(60), 42, 6, 5]];       // asymptote below target
      const already = [[Math.log(60), 105, 6, 50]];   // started above target
      return {
        reach: timeTo(reach, 44)[0],
        stall: timeTo(stall, 44)[0],
        already: timeTo(already, 44)[0],
      };
    });
    expect(r.reach).toBeGreaterThan(6);
    expect(Number.isFinite(r.reach)).toBe(true);
    expect(r.stall).toBe(Infinity);      // a steak pinned below target never gets there
    expect(r.already).toBe(0);
  });

  test('the sampler recovers parameters it was given, and is reproducible', async ({ app }) => {
    const r = await app.page.evaluate(() => {
      const truth = [Math.log(55), 100, 7, 5];
      const obs = [0, 10, 20, 30, 40, 50].map(t => ({ t, temp: modelTemp(truth, t) }));
      const pr = buildPriors({ ovenC: 125, targetC: 44, massKg: 1, thickMm: 40, fan: false });
      const a = fitPosterior(obs, pr, 4242);
      const b = fitPosterior(obs, pr, 4242);
      const med = j => pcts(a.map(s => s[j]), [0.5])[0];
      return {
        identical: JSON.stringify(a[0]) === JSON.stringify(b[0]) && a.length === b.length,
        n: a.length,
        tau: Math.exp(med(0)), tInf: med(1), lag: med(2),
        hit: pcts(timeTo(a, 44), [0.05, 0.5, 0.95]),
        trueHit: 7 + 55 * Math.log((100 - 5) / (100 - 44)),
      };
    });
    expect(r.identical).toBe(true);                  // same seed, same posterior
    expect(r.n).toBeGreaterThan(1000);
    expect(r.tau).toBeGreaterThan(40);
    expect(r.tau).toBeLessThan(75);
    expect(r.tInf).toBeGreaterThan(85);
    expect(r.tInf).toBeLessThan(118);
    // What actually matters is the finish time, which is far better determined
    // than any individual parameter.
    expect(Math.abs(r.hit[1] - r.trueHit)).toBeLessThan(3);
    expect(r.hit[0]).toBeLessThan(r.trueHit);
    expect(r.hit[2]).toBeGreaterThan(r.trueHit);
  });

  test('readings narrow the prediction', async ({ app }) => {
    const spreads = await app.page.evaluate(() => {
      const truth = [Math.log(55), 100, 7, 5];
      const pr = buildPriors({ ovenC: 125, targetC: 44, massKg: 1, thickMm: 40, fan: false });
      const all = [0, 12, 24, 36].map(t => ({ t, temp: modelTemp(truth, t) }));
      return [1, 2, 3, 4].map(n => {
        const s = fitPosterior(all.slice(0, n), pr, 99);
        const q = pcts(timeTo(s, 44), [0.05, 0.95]);
        return q[1] - q[0];
      });
    });
    expect(spreads[3]).toBeLessThan(spreads[0]);
    expect(spreads[3]).toBeLessThan(spreads[1]);
    // and the well-informed fit should be genuinely tight
    expect(spreads[3]).toBeLessThan(12);
  });

  test('a stalling steak is recognised rather than extrapolated', async ({ app }) => {
    const r = await app.page.evaluate(() => {
      // Readings flattening out well short of 44: a wet surface pinning the
      // steak near the oven's wet-bulb temperature.
      const obs = [[0, 5], [15, 26], [30, 35], [45, 38.5], [60, 40]].map(([t, temp]) => ({ t, temp }));
      const pr = buildPriors({ ovenC: 125, targetC: 44, massKg: 1, thickMm: 40, fan: false });
      const s = fitPosterior(obs, pr, 7);
      return advise(s, 60, 44);
    });
    expect(r.stall).toBeGreaterThan(0.25);
    expect(r.why.toLowerCase()).toContain('stall');
  });
});

test.describe('scheduling rule', () => {

  const seedPosterior = () => ({
    obs: [[0, 5], [14, 12], [26, 22]],
  });

  test('the promised check respects both bounds', async ({ app }) => {
    const r = await app.page.evaluate(() => {
      const pr = buildPriors({ ovenC: 125, targetC: 44, massKg: 1, thickMm: 40, fan: false });
      const out = [];
      for (const obs of [
        [[0, 5]],                                  // nothing known yet
        [[0, 5], [14, 12]],
        [[0, 5], [14, 12], [26, 22]],
        [[0, 5], [20, 26], [34, 38]],              // nearly there
      ]) {
        const now = obs[obs.length - 1][0];
        const s = fitPosterior(obs.map(([t, temp]) => ({ t, temp })), pr, 11);
        const a = advise(s, now, 44);
        out.push({ now, next: a.next, action: a.action, pull: a.pull, hit: a.hit });
      }
      return out;
    });
    for (const a of r) {
      expect(a.next).toBeGreaterThanOrEqual(a.now + 5 - 1e-6);   // MIN_GAP_MIN
      expect(a.next).toBeLessThanOrEqual(a.now + 30 + 1e-6);     // MAX_GAP_MIN
      expect(['measure', 'coast', 'pull']).toContain(a.action);
    }
  });

  test('the check lands before the steak can plausibly be at target', async ({ app }) => {
    // The rule's whole claim: at most a 5% chance of sailing past unnoticed.
    const risk = await app.page.evaluate(() => {
      const pr = buildPriors({ ovenC: 125, targetC: 44, massKg: 1, thickMm: 40, fan: false });
      const out = [];
      for (const obs of [[[0, 5], [14, 12]], [[0, 5], [14, 12], [26, 22]], [[0, 4], [18, 20]]]) {
        const now = obs[obs.length - 1][0];
        const s = fitPosterior(obs.map(([t, temp]) => ({ t, temp })), pr, 3);
        const a = advise(s, now, 44);
        if (a.action !== 'measure') continue;
        const past = s.filter(th => modelTemp(th, a.next) >= 44).length / s.length;
        out.push(past);
      }
      return out;
    });
    expect(risk.length).toBeGreaterThan(0);
    for (const p of risk) expect(p).toBeLessThanOrEqual(0.05);
  });

  test('coasting aims a little low, and only once nothing is left to learn', async ({ app }) => {
    const r = await app.page.evaluate(() => {
      const pr = buildPriors({ ovenC: 125, targetC: 44, massKg: 1, thickMm: 40, fan: false });
      const obs = [[0, 5], [18, 22], [30, 34], [38, 40]].map(([t, temp]) => ({ t, temp }));
      const s = fitPosterior(obs, pr, 5);
      const a = advise(s, 38, 44);
      const medianAt = t => pcts(s.map(th => modelTemp(th, t)), [0.5])[0];
      return { action: a.action, pull: a.pull, hit: a.hit[1], atPull: medianAt(a.pull) };
    });
    expect(r.action).toBe('coast');
    // COAST_UNDERSHOOT_C: pull a touch before the median crossing, because the
    // real asymptote creeps up as the crust dries.
    expect(r.pull).toBeLessThan(r.hit);
    expect(r.atPull).toBeGreaterThan(42.5);
    expect(r.atPull).toBeLessThan(44);
  });
});
