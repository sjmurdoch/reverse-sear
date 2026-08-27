# Tests

```bash
pip install numpy && npm ci
npx playwright install --with-deps webkit    # the browser that matters

npm test                 # the page, under WebKit + an iPhone 14 Pro viewport
npm run test:model       # the physics, the fitter and the scheduling rule (Python)
npm run test:all         # both browser projects
npx playwright test tests/schedule.spec.js          # one file
npx playwright test -g "does not walk forward"      # one test
python3 -m unittest model.test_model.TestAdvise -v  # one Python class
```

The Playwright config builds `web/index.html` from `web/app.html` and serves it
before the run, so tests never execute against a stale build.

## Browsers

The app ships to iPhone Safari, so **WebKit is the primary target** and is what
`npm test` and the CI gate use. `iphone-chromium` exists as a fallback for
sandboxes that cannot download WebKit — the Playwright CDN is blocked by egress
policy in some environments — and is pinned to a pre-installed binary when one
is present at `/opt/pw-browsers/chromium`. CI runs both, so an engine-specific
regression shows up as one project failing and not the other.

## What is covered

| file | what it holds the app to |
|---|---|
| `model.spec.js` | the model itself, driven in-page: the root solver, the geometry prior, curve shape, unreachable targets, that the sampler recovers a curve it generated and is reproducible, that readings narrow the prediction, and that a stall is recognised rather than extrapolated. Plus the scheduling rule's two bounds and its 5% claim. |
| `setup.spec.js` | first run: the form is reachable without scrolling past empty cards, the copy names its action, the prior responds to the steak described, settings persist, a blank start temperature is refused, and starting brings the answer into view. |
| `cook.spec.js` | logging: readings recorded and scored, backdating (including that it cannot precede the previous reading), deletion, refusal of junk, the estimate climbing between fits, and the chart actually drawing. |
| `schedule.spec.js` | the appointment. Chiefly the regression test below, plus what resets it, that it survives a reload, and every message the card gives: countdown format, due, late, escalation, coast, stall, and whether the app can actually wake you. |
| `lifecycle.spec.js` | closing and reopening: resume, the six-hour stale guard, finishing and its record, starting another, and that the app still works when `localStorage` throws. |
| `presentation.spec.js` | the phone: no sideways overflow in any state, the dock not covering content, touch-target sizes, the iOS number pad, both themes resolving correctly including the un-stamped "system" case, and that no colour token is defined only inside a media query. |
| `parity.spec.js` | that the JavaScript port has not drifted from `model/fit.py`. |
| `model/test_model.py` | the Python side: psychrometrics, the ground-truth simulator's physics, the time-constant prior, the fitter, the scheduling rule, and a small end-to-end accuracy check. |

## The regression test that matters most

`schedule.spec.js` → *"does not walk forward when the app refits on its timer"*.

`advise()` floors its next check at `now + MIN_GAP_MIN`, so re-running it on a
timer used to walk the appointment forward a few minutes at a time. The
countdown never reached zero, the cook was never asked for a second reading, and
the app coasted to the end on the two readings it already had — its least
accurate mode. The test advances the clock with no user action and asserts
`state.dueAt` never moves while `plan.next` does.

`model/validate.py` cannot catch this class of bug: it calls `advise` exactly
once per measurement and jumps straight to `next_check_min`, so it is sticky by
construction. Schedule behaviour has to be tested in the browser.

## Parity

The model is implemented twice — `model/fit.py` is the reference, and the
JavaScript in `web/app.html` is a hand-port so the page needs no dependencies.
`parity.spec.js` runs the JS half on fixed inputs recorded in
`tests/fixtures/parity.json` and checks it agrees: deterministic quantities (the
time-constant prior, the curve, time-to-target) exactly, posterior summaries
within a band, since the two use different samplers and different PRNGs. It also
asserts the shared constants have not drifted.

After changing the Python side, regenerate the fixture:

```bash
npm run parity:update      # python3 tools/parity.py --write
```

One deliberate asymmetry the fixture records: for a `coast`, the JavaScript puts
the pull time in `next` because the card counts down to it, while Python keeps
the unused safe-check time in `next_check_min` and the pull in `pull_min`. The
parity test compares like with like.

## Time in tests

Never simulate the passage of time by moving `state.startedAt` — that shifts
every quantity derived from it and hides the bugs these tests exist to catch.
The `app` fixture installs a controllable `Date.now()` instead, persisted in
`sessionStorage` so it survives a reload:

- `app.advance(min)` — clock moves and the app refits, as on its 60-second timer
- `app.drift(min)` — clock moves with no refit, as between those timers

`app.seed([[0, 5], [14, 12]])` drops the app straight into a mid-cook state.

Every test also fails if the page logged an uncaught error or a console error.
