// @ts-check
const { test, expect } = require('./fixtures');

// The tool is operated one-handed, on a phone, in a kitchen, in whatever theme
// the phone is in.  These check the qualities that makes possible.

const STATES = {
  'before starting': async app => {},
  'mid cook': async app => app.seed([[0, 5], [14, 12], [26, 22]]),
  'check due': async app => {
    await app.seed([[0, 5], [14, 12]], { elapsed: 20 });
    const s = await app.state();
    await app.drift(s.dueMin - s.elapsedMin + 1);
  },
  'coasting': async app => app.seed([[0, 5], [18, 22], [30, 34], [38, 40]]),
  'finished': async app => {
    await app.seed([[0, 5], [16, 20], [28, 32]]);
    await app.advance(40);
    await app.page.click('#verdictActs button');
    await app.settle();
  },
};

test.describe('layout', () => {
  for (const [name, arrange] of Object.entries(STATES)) {
    test(`nothing overflows sideways: ${name}`, async ({ app }) => {
      await arrange(app);
      const r = await app.page.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
        wide: [...document.querySelectorAll('body *')]
          .filter(el => el.getBoundingClientRect().right > window.innerWidth + 1)
          .map(el => el.id || el.className || el.tagName)
          .slice(0, 5),
      }));
      expect(r.wide).toEqual([]);
      expect(r.scrollW).toBeLessThanOrEqual(r.clientW + 1);
    });
  }

  test('the dock never covers the last of the content', async ({ app }) => {
    await app.seed([[0, 5], [14, 12], [26, 22]]);
    await app.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await app.settle();
    const r = await app.page.evaluate(() => {
      const dock = document.getElementById('dock').getBoundingClientRect();
      const foot = document.querySelector('.stamp').getBoundingClientRect();
      return { dockTop: dock.top, footBottom: foot.bottom };
    });
    expect(r.footBottom).toBeLessThanOrEqual(r.dockTop + 1);
  });

  test('the things you tap are big enough to tap', async ({ app }) => {
    await app.start(5);
    const small = await app.page.evaluate(() => {
      const ids = ['logBtn', 'readTemp'];
      const out = [];
      for (const id of ids) {
        const r = document.getElementById(id).getBoundingClientRect();
        if (r.height < 44) out.push([id, Math.round(r.height)]);
      }
      for (const b of document.querySelectorAll('#ageChips button, #fanToggle button')) {
        const r = b.getBoundingClientRect();
        if (r.height < 24 || r.width < 34) out.push([b.textContent.trim(), Math.round(r.width), Math.round(r.height)]);
      }
      return out;
    });
    expect(small).toEqual([]);
  });

  test('number fields ask iOS for the number pad', async ({ app }) => {
    await app.start(5);
    const modes = await app.page.$$eval('input[type=number]', els =>
      els.map(e => [e.id, e.getAttribute('inputmode')]));
    for (const [id, mode] of modes) expect(mode, id).toBe('decimal');
  });

  test('the page is named', async ({ app }) => {
    await expect(app.page).toHaveTitle(/reverse sear pilot/i);
  });

  test('the build is stamped and links to its commit', async ({ app }) => {
    const t = await app.page.textContent('.stamp');
    expect(t.trim().length).toBeGreaterThan(0);
    const href = await app.page.getAttribute('.stamp a', 'href');
    if (href) expect(href).toMatch(/github\.com\/.+\/commit\/[0-9a-f]{7,40}$/);
  });

  test('keyboard focus is visible', async ({ app }) => {
    await app.start(5);
    await app.page.focus('#logBtn');
    const outline = await app.page.evaluate(() => {
      const cs = getComputedStyle(document.getElementById('logBtn'), ':focus-visible');
      return cs.outlineStyle + ' ' + cs.outlineWidth;
    });
    expect(outline).not.toMatch(/^none/);
  });
});

test.describe('themes', () => {
  for (const scheme of ['light', 'dark']) {
    test(`${scheme}: the page paints its own background and readable text`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.addInitScript(() => { window.__skew = 0; });
      await page.goto('/index.html');
      await page.waitForFunction(() => typeof window.render === 'function');

      const parse = c => (c.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
      const lum = c => { const [r, g, b] = parse(c); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };

      const r = await page.evaluate(() => {
        const cs = getComputedStyle(document.body);
        const label = getComputedStyle(document.getElementById('verdictLabel'));
        const why = getComputedStyle(document.getElementById('verdictWhy'));
        const card = getComputedStyle(document.querySelector('.card'));
        return { bg: cs.backgroundColor, ink: cs.color, label: label.color,
                 why: why.color, card: card.backgroundColor };
      });

      // A transparent body borrows the host's ground and inverts on the wrong theme.
      expect(r.bg).not.toBe('rgba(0, 0, 0, 0)');
      expect(r.bg).not.toBe('transparent');

      const bg = lum(r.bg);
      if (scheme === 'dark') expect(bg).toBeLessThan(90);
      else expect(bg).toBeGreaterThan(160);

      // Body text and secondary text must both stand off the card.
      expect(Math.abs(lum(r.ink) - lum(r.card))).toBeGreaterThan(90);
      expect(Math.abs(lum(r.why) - lum(r.card))).toBeGreaterThan(45);
    });
  }

  test('an explicit theme choice beats the system setting', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window.render === 'function');
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const l = (bg.match(/\d+/g) || []).slice(0, 3).map(Number).reduce((a, b) => a + b, 0) / 3;
    expect(l, 'data-theme=light must win over a dark OS').toBeGreaterThan(160);
  });

  test('every colour token is defined without a media query', async ({ page }) => {
    // A colour whose only definition sits behind a media or [data-theme] block
    // never applies in the default "system" state.
    await page.goto('/index.html');
    const missing = await page.evaluate(() => {
      const names = ['--bg', '--surface', '--surface-2', '--line', '--line-soft',
                     '--ink', '--ink-2', '--ink-3', '--ember', '--cold', '--good', '--warn', '--band'];
      const cs = getComputedStyle(document.documentElement);
      return names.filter(n => !cs.getPropertyValue(n).trim());
    });
    expect(missing).toEqual([]);
  });
});
