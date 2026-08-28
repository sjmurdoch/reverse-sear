# The app's state machine, in Quint

`steak.qnt` is the scheduling and lifecycle logic of `web/app.html` written out
as a [Quint](https://quint-lang.org) specification: steaks going in and coming
out, appointments, the shared trip to the oven, the alarm, the pull and its undo.
It exists so the rules CLAUDE.md states in prose can be *checked* rather than
only reviewed, and so a change to the scheduling logic has somewhere to be
argued about that is smaller than the app.

It is a companion to the browser tests, not a replacement. Playwright checks
what the page does; this checks what the state machine cannot do. Neither
subsumes the other, and the browser tests remain the CI gate.

## Running it

Quint is not a dependency of this repo — nothing in CI needs it, and it pulls a
JVM-backed model checker on first use. Install it where you like:

```bash
npm install --no-save @informalsystems/quint@0.32.0
sh spec/check.sh                       # ~3 minutes, randomized simulation
```

`check.sh` finds `quint` via `npx` by default; set `QUINT=/path/to/quint` to
point it at an existing install.

```bash
sh spec/check.sh                       # every invariant, plus the broken modules
quint test --backend=typescript --main=reverse_sear spec/steak.qnt
quint run  --backend=typescript --main=reverse_sear \
      --invariant=scheduleIsSticky --max-steps=20 spec/steak.qnt
```

Pass `--backend=typescript` to `run` and `test`. Quint 0.32 defaults to a Rust
evaluator it downloads from GitHub releases on first use, which fails behind an
egress policy that blocks it; the TypeScript backend is built in and needs no
download.

## What is and is not modelled

The physics is **not** modelled. `fitPosterior` is an oracle. Everything the
schedule reads out of the posterior is three times, in minutes from a steak's
own zero — `guardMin`, `hitMin`, `pullMin` — and those are drawn
nondeterministically when a reading arrives and frozen otherwise. That freezing
is the point: it is exactly the property the app relies on when it lets
`adoptCoastPull()` move an appointment on a refit but forbids
`rescheduleCheck()` from doing the same. `advise()` is then ported faithfully on
top of them, so the `measure → coast` flip that happens with no new reading
happens here too.

Two structural facts about the app are modelled because the invariants turn on
them:

- **`plan` is cached.** `recompute()` refreshes it; it runs on the 60 s timer
  and after every information event, never on the 1 s render tick. `driftTick`
  therefore leaves a stale plan in place, as the app does between timers.
- **`render()` returns early** when the *selected* steak has not started, and
  the alarm is checked after that return.

Times are whole minutes, and the sub-degree epsilons in `advise()` (0.15, 0.25)
are dropped with them. Input validation (`readingProblem`) is out of scope: a
refused reading changes no state, so there is nothing to check. Steak identity
is `1..MAX_STEAKS` rather than insertion order, so `firstSteak` is the
lowest-numbered present steak rather than `state.steaks[0]`; nothing checked
here depends on the difference.

## The invariants

Each is one of the rules CLAUDE.md states in prose. `check.sh` runs all of them
against `reverse_sear` — the app as it stands — and then against one
deliberately broken module per invariant, so none of them holds vacuously.

| invariant | the rule |
|---|---|
| `alwaysASteak` | `ensureSteak()`: the per-steak accessors are never silent no-ops |
| `atMostMaxSteaks` | at most `MAX_STEAKS` |
| `scheduleIsSticky` | a plain refit moves an appointment only in `adoptCoastPull()`'s one way |
| `appointmentsAreOwned` | an appointment is reset only by its own steak's information |
| `startSparesRunningSteaks` | Start puts in `pendingSteaks()` and nothing else |
| `noPullOffAStaleEstimate` | nothing irreversible is ordered off a resumed steak's estimate |
| `tripIsNeverLate` | batching moves a check earlier than a steak asked for, never later |
| `alarmIsNotLate` | when the alarm is evaluated, it is set no later than any steak's appointment |
| `coastPromiseIsAnchored` | `adoptCoastPull()`'s post-condition, which is what makes it idempotent |
| `gapsAreRespected` | a measurement check sits `MIN_GAP_MIN`–`MAX_GAP_MIN` after it was made |

The broken modules turn on exactly one defect each. Four of them are the
historical bugs CLAUDE.md records; running `check.sh` shows each being caught:

| module | invariant it must break |
|---|---|
| `bug_refit_reschedules` | `scheduleIsSticky` — the walk-forward defect |
| `bug_reschedule_every_steak` | `appointmentsAreOwned` — the sweep that ended after one steak |
| `bug_start_restarts_running` | `startSparesRunningSteaks` |
| `bug_alarm_follows_selection` | `alarmIsNotLate` |
| `bug_pull_when_awaiting_probe` | `noPullOffAStaleEstimate` |

## One invariant that does not hold: the silent alarm

`alarmIsArmedWhileCooking` and `alarmRingsAtTheTrip` are **deliberately kept out
of `check.sh`**, because the app as it stands does not satisfy them. The spec
found this; `run silentAlarmTest` is the reproduction.

With one steak cooking, add a second and do not start it. `renderSteakList()`
draws a row for *every* steak, including the one that reads "not in the oven
yet", and the row handler accepts any steak that is not finished:

```js
const st = steakById(row.dataset.s);
if (!st || st.finishedAt) return;
state.current = st.id;
```

Tapping that row points `state.current` at a steak with no cook, and two things
follow. `render()` takes the not-started branch and returns at "Set up your
steak" — before the alarm is checked at all. And `alarmAt()` falls through to
`state.dueAt`, which is that steak's, which is `null`, because
`activeSteaks().length > 1` is false with only one steak actually in the oven.

Confirmed against the page (Playwright, `iphone-chromium` project — WebKit could
not be downloaded in that sandbox; the logic here is not browser-specific):

| step | `state.current` | `alarmAt()` | card | beeps |
|---|---|---|---|---|
| steak 1 cooking, check 21.9 min out | steak 1 | a real time | countdown | — |
| tap steak 2's "not in" row | steak 2 | `null` | "Set up your steak" | — |
| drift 5 min past steak 1's check | steak 2 | `null` | "Set up your steak" | **0** |
| tap back to steak 1 | steak 1 | — | "Check it now" | 1 |

This is the same class of defect as the one `alarmAt()` was written to fix — the
phone silent while a check is overdue — for the case that fix does not cover:
not two steaks in the oven, but one in and one merely on the list. It is left
unfixed here because this spec was asked for, not a change to the app.

## Apalache

`quint verify` (the symbolic model checker) fails on this spec with an internal
error, `key not found: $C$7`, raised while translating `deleteReading`,
`pullOut`, `pullEarly` and `editSteakField`. It is not a spec error — those four
typecheck and simulate — and it is not the module constants or the
nondeterministic draws; both were ruled out by bisection. To reproduce:

```bash
quint verify --main=reverse_sear --invariant=scheduleIsSticky --max-steps=4 spec/steak.qnt
```

So `check.sh` uses `quint run`'s randomized simulation, which samples traces
rather than exhausting them. Coverage is therefore good but not a proof: the
`noPullOffAStaleEstimate` counterexample needs pull → resume → pull in one
trace, and only turns up at `--max-steps=20 --max-samples=20000`, which is why
the broken-module checks search deeper than the ones that must hold.

The other ten actions (`driftTick`, `refitTick`, `startCook`, `logReading`,
`resumeCook`, `startAnother`, `addSteak`, `removeSteak`, `editOven`,
`selectSteak`) translate without the internal error — each was checked against
that base at `--max-steps=2` — but that is as far as this got: all ten together
at `--max-steps=4` had not finished after fifteen minutes. So there is no
exhaustive result here at any useful depth, only the bisection showing where the
translation breaks. Worth revisiting when Apalache or the Quint-to-Apalache
translation moves on.

## Keeping it in step

`steak.qnt` restates constants that live in `web/app.html` and `model/fit.py`:
`MIN_GAP_MIN`, `MAX_GAP_MIN`, `MAX_BLIND_FRACTION` (as `BLIND_NUM/BLIND_DEN`),
`BACK_WINDOW_MIN`, `MAX_STEAKS`. There is no `parity.spec.js` equivalent holding
them together — nothing enforces this but reading. If you change the scheduling
rule or the shared constants, change them here too, and re-run `check.sh`.
