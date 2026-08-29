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
quint verify --main=reverse_sear --invariant=scheduleIsSticky --max-steps=1 spec/steak.qnt
```

The last one is exhaustive rather than sampled, but only to depth 1 in about
40 seconds -- see Apalache below for why, and for the `val` bindings in
`steak.qnt` that exist solely to keep it working.

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
| `tripIsAttained` | the trip is *some* steak's own appointment, not an invented time |
| `finishedHoldNoAppointment` | a steak on the board stops dragging the trip earlier |
| `blindFractionRespected` | `MAX_BLIND_FRACTION`: never blind for more than 55% of the way to the finish |
| `resumeKeepsTheCook` | `resumeCook()` gives back the same steak — same zero, readings, posterior |

`tripIsNeverLate` and `tripIsAttained` are worth reading together: the first
says the trip is no later than any steak's appointment, the second that it is
exactly one of them. Either alone is satisfiable by something silly — opening
the oven immediately and forever satisfies the first — and together they pin
`openAt` to `min(dueAt)`, which is the whole batching rule.

The broken modules turn on exactly one defect each. Four of them are the
historical bugs CLAUDE.md records; the rest are defects the rules forbid but
which have not actually happened. Running `check.sh` shows each being caught:

| module | invariant it must break |
|---|---|
| `bug_refit_reschedules` | `scheduleIsSticky` — the walk-forward defect |
| `bug_reschedule_every_steak` | `appointmentsAreOwned` — the sweep that ended after one steak |
| `bug_start_restarts_running` | `startSparesRunningSteaks` |
| `bug_alarm_follows_selection` | `alarmIsNotLate` |
| `bug_pull_when_awaiting_probe` | `noPullOffAStaleEstimate` |
| `bug_trip_opens_early` | `tripIsAttained` |
| `bug_keep_appointment_after_pull` | `finishedHoldNoAppointment` |
| `bug_ignore_blind_cap` | `blindFractionRespected` |
| `bug_resume_restarts` | `resumeKeepsTheCook` |

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

## Apalache, and the one thing the spec is written around

`quint verify` — the symbolic model checker — used to fail on this spec with an
internal error, `key not found: $C$7`, and `check.sh` therefore uses `quint run`
instead. That error is now understood and worked around, and
`spec/apalache-foldset-bug.qnt` is a five-line reproducer:

```bash
quint verify --main=broken --invariant=inv --max-steps=2 spec/apalache-foldset-bug.qnt
# error: key not found: $C$8
quint verify --main=works  --invariant=inv --max-steps=2 spec/apalache-foldset-bug.qnt
# [ok] No violation found
```

The two modules differ by one `val` binding. It is an Apalache bug, not a Quint
one and not a spec error: both modules typecheck and both simulate, and Apalache
prints "Please report an issue" and writes a `BugReport.md`. Running Apalache
directly on the compiled TLA+ gives the stack:

```
java.util.NoSuchElementException: key not found: $C$8
  at ...bmcmt.Binding.apply(Binding.scala:11)
  at ...bmcmt.rules.SetInRule.apply(SetInRule.scala:40)
  at ...bmcmt.rules.FoldSetRule.$anonfun$apply$1(FoldSetRule.scala:99)
  at ...bmcmt.rules.FoldSetRule.apply(FoldSetRule.scala:84)
```

`FoldSetRule` inlines the fold's lambda by substituting its parameters with
arena cell names. `SetInRule` then has a fast path for membership in a
*singleton* set literal, which treats `x \in {y}` as `x = y` and resolves the
left-hand side straight out of the binding rather than rewriting it — and a cell
name is never in the binding, so it throws.

The trigger therefore needs three things at once: a fold's lambda parameter on
the left, `contains` (or `in`), and a **singleton** set literal on the right.
Changing `Set(1)` to `Set(1, 3)` is enough to make it check cleanly. So is the
same membership test under `map`, `filter` or `exists`; `union`, `subseteq` or
`size` on a literal inside a fold; or `contains` against a set held in a state
variable. It bites `foldl` as well as `fold`, and the accumulator as well as the
element.

`spec/apalache-bug/` has a thirteen-line TLA+ reproducer with no Quint in it, the
`BugReport.md` Apalache generated, and `ISSUE.md` — the whole thing written up
ready to submit upstream, which has **not** been submitted.

This spec walks straight into it, because `mapReschedule` folds over the steaks
and asks `scope.contains(i)` inside the fold. It bit exactly the actions that
passed a set literal at the call site — `deleteReading`, `pullOut`, `pullEarly`,
`editSteakField` — and spared `logReading` and `startCook`, which happened to
bind their scope to a `val` first, and `editOven`, which passes the state
variable `present`.

**So every call site now binds the scope to a `val` first**, which becomes a
LET-IN and survives to the backend. That is the only reason those bindings
exist; without this note they look like pointless indirection. A module-level
`pure val` does *not* work — Quint inlines it and the constructor is back. In
`logReading` there are two bindings rather than one: `owned` is the scope the
rule allows, and is what the ghost is measured against, while `scope` is what is
actually passed and may be widened by `BUG_RESCHEDULE_EVERY_STEAK`. Collapsing
them blinds the detector, which is what the "must be caught" half of `check.sh`
is for — it caught exactly that mistake.

With the workaround in place `verify` runs. `--max-steps=1` completes in about
40 seconds:

```bash
quint verify --main=reverse_sear --invariant=scheduleIsSticky --max-steps=1 spec/steak.qnt
# [ok] No violation found (36160ms)
```

Depth 2 is another matter: it ran for forty minutes without finishing and was
killed at that. So `check.sh` defaults `verify` to depth 1 and otherwise uses
`quint run`.
Its randomized simulation samples traces rather than exhausting them: the
`noPullOffAStaleEstimate` counterexample needs pull → resume → pull in one trace
and only turns up at `--max-steps=20 --max-samples=20000`, which is why the
broken-module checks search deeper than the ones that must hold.

The `--backend=tlc` route is worse, not better: TLC dodges the Apalache bug, but
explicit-state exploration of this spec passed 1.4 million distinct states at
depth 10 and was still growing. `clock` alone ranges over `HORIZON`.

## Keeping it in step

`steak.qnt` restates constants that live in `web/app.html` and `model/fit.py`:
`MIN_GAP_MIN`, `MAX_GAP_MIN`, `MAX_BLIND_FRACTION` (as `BLIND_NUM/BLIND_DEN`),
`BACK_WINDOW_MIN`, `MAX_STEAKS`. There is no `parity.spec.js` equivalent holding
them together — nothing enforces this but reading. If you change the scheduling
rule or the shared constants, change them here too, and re-run `check.sh`.
