// @ts-check
const { test, expect } = require('./fixtures');
const golden = require('./fixtures/parity.json');

// The model is implemented twice: model/fit.py is the reference, and the
// JavaScript in web/app.html is a hand-port so the page needs no dependencies.
// This is what stops the two drifting apart.
//
// Regenerate the fixture after changing the Python side:
//     python3 tools/parity.py --write
test.describe('the JS port agrees with the Python reference', () => {

  test('time-constant prior: exactly', async ({ app }) => {
    const js = await app.page.evaluate(cases => cases.map(c => ({
      jsWidth: planDims(c.mass, c.thickMm / 1000)[1],
      jsLength: planDims(c.mass, c.thickMm / 1000)[2],
      jsTau: tauPriorMinutes(planDims(c.mass, c.thickMm / 1000), c.fan ? 26 : 20),
    })), golden.tau_prior);

    golden.tau_prior.forEach((py, i) => {
      expect(js[i].jsWidth, `width, ${py.thickMm}mm`).toBeCloseTo(py.width, 9);
      expect(js[i].jsLength).toBeCloseTo(py.length, 9);
      // Same closed form, same constants: this must agree to many places.
      expect(js[i].jsTau, `tau, ${py.thickMm}mm fan=${py.fan}`).toBeCloseTo(py.tau, 6);
    });
  });

  test('the curve: exactly', async ({ app }) => {
    const c = golden.curve;
    const js = await app.page.evaluate(({ th, ts }) =>
      ts.map(t => modelTemp(th, t)),
      { th: [c.log_tau, c.t_inf, c.lag, c.t0], ts: Object.keys(c.at).map(Number) });
    Object.values(c.at).forEach((py, i) => expect(js[i]).toBeCloseTo(py, 9));
  });

  test('time to target, including the cases with no answer: exactly', async ({ app }) => {
    const c = golden.curve;
    const entries = Object.entries(golden.time_to);
    const js = await app.page.evaluate(({ th, targets }) =>
      targets.map(t => { const v = timeTo([th], t)[0]; return Number.isFinite(v) ? v : null; }),
      { th: [c.log_tau, c.t_inf, c.lag, c.t0], targets: entries.map(([k]) => Number(k)) });

    entries.forEach(([target, py], i) => {
      if (py === null) expect(js[i], `target ${target} is unreachable`).toBeNull();
      else expect(js[i], `target ${target}`).toBeCloseTo(py, 8);
    });
  });

  test('posterior summaries: within sampling noise', async ({ app }) => {
    // Different samplers and different PRNGs, so these agree in distribution,
    // not exactly. The bands are what two honest runs of the same model differ
    // by; anything wider means the ports have actually diverged.
    const js = await app.page.evaluate(cases => cases.map(c => {
      const pr = buildPriors({ ovenC: 125, targetC: 44, massKg: 1, thickMm: 40, fan: false });
      const obs = c.ts.map((t, i) => ({ t, temp: c.temps[i] }));
      const s = fitPosterior(obs, pr, 20240501);
      const a = advise(s, c.now, 44);
      const hits = timeTo(s, 44).filter(Number.isFinite);
      const q = pcts(hits, [0.05, 0.5, 0.95]);
      return {
        name: c.name,
        tau_median: pcts(s.map(x => Math.exp(x[0])), [0.5])[0],
        t_inf_median: pcts(s.map(x => x[1]), [0.5])[0],
        temp_now_median: pcts(s.map(x => modelTemp(x, c.now)), [0.5])[0],
        hit_p05: q[0], hit_median: q[1], hit_p95: q[2],
        stall: a.stall, action: a.action, next: a.next, pull: a.pull,
      };
    }), golden.cases);

    golden.cases.forEach((py, i) => {
      const j = js[i];
      const where = py.name;

      expect(j.action, `action, ${where}`).toBe(py.action);
      expect(j.temp_now_median, `core now, ${where}`).toBeCloseTo(py.temp_now_median, 0);
      expect(Math.abs(j.tau_median - py.tau_median) / py.tau_median, `tau, ${where}`).toBeLessThan(0.15);
      expect(Math.abs(j.t_inf_median - py.t_inf_median), `asymptote, ${where}`).toBeLessThan(8);
      expect(Math.abs(j.stall - py.stall), `stall risk, ${where}`).toBeLessThan(0.15);

      if (py.hit_median !== null) {
        expect(Math.abs(j.hit_median - py.hit_median), `predicted finish, ${where}`).toBeLessThan(2.5);
        expect(Math.abs(j.hit_p05 - py.hit_p05), `finish p05, ${where}`).toBeLessThan(3);
        expect(Math.abs(j.hit_p95 - py.hit_p95), `finish p95, ${where}`).toBeLessThan(6);
      }

      // The two name things differently for a coast: the JS puts the pull time
      // in `next` because the card counts down to it, while Python keeps the
      // unused safe-check time in next_check_min. Compare like with like.
      if (py.action === 'coast') {
        expect(Math.abs(j.pull - py.pull), `pull time, ${where}`).toBeLessThan(2.5);
        expect(Math.abs(j.next - py.pull), `JS coast counts down to the pull, ${where}`).toBeLessThan(2.5);
      } else if (py.action === 'measure') {
        expect(Math.abs(j.next - py.next_check), `next check, ${where}`).toBeLessThan(2.5);
      }
    });
  });

  test('the shared constants have not drifted apart', async ({ app }) => {
    const js = await app.page.evaluate(() => {
      const src = [...document.querySelectorAll('script')].map(s => s.textContent).join('\n');
      const grab = n => {
        const m = src.match(new RegExp(`const ${n}\\s*=\\s*([\\d.]+)`));
        return m ? parseFloat(m[1]) : null;
      };
      const pr = buildPriors({ ovenC: 125, targetC: 44, massKg: 1, thickMm: 40, fan: false });
      return {
        GUARD_C: grab('GUARD_C'), MIN_GAP_MIN: grab('MIN_GAP_MIN'),
        MAX_GAP_MIN: grab('MAX_GAP_MIN'), MAX_BLIND_FRACTION: grab('MAX_BLIND_FRACTION'),
        COAST_UNDERSHOOT_C: grab('COAST_UNDERSHOOT_C'),
        sigmaObs: pr.sigmaObs, tauLogSd: pr.tauLogSd, lagMedian: pr.lagMedian,
        tInfSd: pr.tInfSd, sigmaModel: pr.sigmaModel, t0Sd: pr.t0Sd, lagLogSd: pr.lagLogSd,
      };
    });
    // Mirrors model/fit.py: advise() defaults and the Priors dataclass.
    expect(js).toEqual({
      GUARD_C: 2.0, MIN_GAP_MIN: 5, MAX_GAP_MIN: 30, MAX_BLIND_FRACTION: 0.55,
      COAST_UNDERSHOOT_C: 0.6,
      sigmaObs: 0.8, tauLogSd: 0.35, lagMedian: 6, tInfSd: 15,
      sigmaModel: 0.02, t0Sd: 1.0, lagLogSd: 0.6,
    });
  });
});
