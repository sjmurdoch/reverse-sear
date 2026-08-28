// The reverse-sear app as a state machine.
//
// This is the scheduling and lifecycle logic of `web/app.html` -- the part that
// decides *when the oven door opens* and *what may be ordered off an estimate*
// -- written out as a Quint spec, so the invariants CLAUDE.md states in prose
// can be checked exhaustively rather than only sampled by the browser tests.
//
// Modelled: steaks going in and coming out, appointments (`dueAt`), the shared
// trip to the oven, the alarm, the pull and its undo.
//
// Not modelled: the physics.  `fitPosterior` is an oracle here.  Everything the
// schedule actually reads out of the posterior is three times, in minutes from
// a steak's own zero:
//
//   guardMin  the 5% "it could already be within GUARD_C of target" time
//   hitMin    the median time to target
//   pullMin   the median time to (target - COAST_UNDERSHOOT_C)
//
// They are drawn nondeterministically when a reading arrives and are frozen
// otherwise -- which is precisely the property the app leans on when it lets
// `adoptCoastPull()` move an appointment on a refit but forbids
// `rescheduleCheck()` from doing the same.  `advise()` is then ported
// faithfully on top of them, so the "measure -> coast" flip that happens with
// no new reading -- the flip `adoptCoastPull` exists to absorb -- happens here
// too.
//
// Two structural facts about the app are modelled because the invariants turn
// on them:
//
//   * `plan` is *cached* per steak in `fits`.  `recompute()` refreshes it; it
//     runs on the 60 s timer and after every information event, never on the
//     1 s render tick.  So `driftTick` below leaves a stale plan in place,
//     exactly as the app does between timers.
//   * `render()` returns early when the *selected* steak has not started, and
//     the alarm is checked after that return.
//
// Times are whole minutes; the sub-degree epsilons in `advise()` (0.15, 0.25)
// are dropped with them.  Input validation (`readingProblem`) is out of scope:
// a refused reading changes no state.
//
// Defects are wired in as module constants so each invariant can be shown to
// bite: `reverse_sear` has them all off, and one module per historical defect
// turns exactly one on.  See spec/README.md.

module app {

  //--------------------------------------------------------------------------
  // Constants.  Shared with web/app.html and model/fit.py -- see the table in
  // CLAUDE.md.  A change here is a change there.
  //--------------------------------------------------------------------------
  pure val MAX_STEAKS       = 3
  pure val MIN_GAP_MIN      = 5     // never reopen sooner than this
  pure val MAX_GAP_MIN      = 30    // never go blind longer than this
  pure val BLIND_NUM        = 11    // MAX_BLIND_FRACTION = 0.55, kept rational
  pure val BLIND_DEN        = 20    //   so the whole spec stays in integers
  pure val BACK_WINDOW_MIN  = 30    // how long the pull stays undoable

  pure val NONE = -1                // JavaScript's null
  pure val INF  = 100000            // "on these readings it may never reach target"

  // How far the clock may run, so the state space is finite.
  pure val HORIZON = 60

  // The oracle's vocabulary: times from a steak's own zero.
  pure val TIMES = Set(0, 6, 18, 40, INF)

  //--------------------------------------------------------------------------
  // Defects, each off in `reverse_sear` and on in one regression module.
  //--------------------------------------------------------------------------

  // The schedule is re-made on a plain refit instead of only when information
  // arrives.  `advise()` floors the next check at now + MIN_GAP_MIN, so the
  // appointment walks forward and the countdown never reaches zero.
  const BUG_REFIT_RESCHEDULES: bool

  // The alarm rings at the selected steak's own appointment rather than at the
  // trip, leaving the phone silent while the card says "Open the oven now".
  const BUG_ALARM_FOLLOWS_SELECTION: bool

  // Start puts in every steak rather than only the pending ones, re-zeroing the
  // clock of a steak already in the oven and throwing away its readings.
  const BUG_START_RESTARTS_RUNNING: bool

  // One steak's reading re-makes every steak's appointment, pushing the others'
  // outstanding checks into the future and ending the sweep after the first.
  const BUG_RESCHEDULE_EVERY_STEAK: bool

  // The pull is ordered off the estimate of a steak that has been sitting on a
  // board while the model went on heating it.
  const BUG_PULL_WHEN_AWAITING_PROBE: bool

  //--------------------------------------------------------------------------
  // A steak.
  //--------------------------------------------------------------------------
  type Steak = {
    startedAt:  int,   // clock minute of this steak's zero, or NONE
    dueAt:      int,   // clock minute of its own appointment, or NONE
    dueSetAt:   int,   // ghost: when that appointment was made
    finishedAt: int,   // clock minute it came out, or NONE
    resumedAt:  int,   // clock minute it went back in, or NONE
    reads:      int,   // how many readings it has

    // The posterior, as far as the schedule is concerned.  Frozen between
    // readings -- which is what makes the pull time safe to re-adopt on a refit.
    guardMin: int,
    hitMin:   int,
    pullMin:  int,

    // The cached plan: `fits.get(id).plan`.  Refreshed by recompute(), read by
    // render() every second in between.  "none" is no entry in `fits` at all.
    cAdvice: str,      // "none" | "measure" | "coast" | "pull"
    cNext:   int,
    cPull:   int
  }

  pure val freshSteak: Steak = {
    startedAt: NONE, dueAt: NONE, dueSetAt: NONE, finishedAt: NONE,
    resumedAt: NONE, reads: 0, guardMin: INF, hitMin: INF, pullMin: INF,
    cAdvice: "none", cNext: NONE, cPull: NONE
  }

  pure def imin(a: int, b: int): int = if (a < b) a else b
  pure def imax(a: int, b: int): int = if (a > b) a else b

  //--------------------------------------------------------------------------
  // advise(), web/app.html lines 655-694.  `n` is minutes from this steak's
  // zero.  The check is aimed at the guard time, capped so it is never more
  // than MAX_GAP_MIN or 55% of the remaining time away, then floored at
  // MIN_GAP_MIN -- and it is that floor that walks forward if it is re-run.
  //--------------------------------------------------------------------------
  pure def localOf(s: Steak, now: int): int =
    if (s.startedAt == NONE) 0 else now - s.startedAt

  // recomputeAll() skips a steak with no readings, and `fits` then holds no
  // entry for it: no fit, no plan, no appointment.
  pure def fittedS(s: Steak): bool = s.startedAt != NONE and s.reads > 0

  pure def cappedNextS(s: Steak, n: int): int = {
    val latestUseful =
      if (s.hitMin >= INF) n + MAX_GAP_MIN
      else n + (BLIND_NUM * imax(s.hitMin - n, 0)) / BLIND_DEN
    val capped = imin(imin(s.guardMin, latestUseful), n + MAX_GAP_MIN)
    imax(capped, n + MIN_GAP_MIN)
  }

  // Note that this is a function of `n`: with the posterior held still, the
  // plan flips from measure to coast as the cook runs on.
  pure def adviceS(s: Steak, n: int): str =
    if (n >= s.hitMin) "pull"
    else if (cappedNextS(s, n) >= s.hitMin) "coast"
    else "measure"

  // plan.next.  For a coast the JS puts the pull time here -- the one
  // deliberate asymmetry with model/fit.py, see CLAUDE.md.
  pure def nextS(s: Steak, n: int): int = {
    val a = adviceS(s, n)
    if (a == "pull") n else if (a == "coast") s.pullMin else cappedNextS(s, n)
  }

  // plan.pull, as steakTimes() reads it.
  pure def pullS(s: Steak, n: int): int =
    if (adviceS(s, n) == "pull") n else s.pullMin

  //--------------------------------------------------------------------------
  // recompute(): refit every steak, then adoptCoastPull().
  //--------------------------------------------------------------------------

  // recomputeAll(): refresh the cached plan, or drop the fit entirely.
  pure def refit1(s: Steak, now: int): Steak =
    if (not(fittedS(s)))
      s.with("cAdvice", "none").with("cNext", NONE).with("cPull", NONE)
    else {
      val n = localOf(s, now)
      s.with("cAdvice", adviceS(s, n)).with("cNext", nextS(s, n)).with("cPull", pullS(s, n))
    }

  // adoptCoastPull(): when the plan flips to coasting, the promise becomes the
  // pull time -- which is anchored to the posterior, so re-running this on the
  // timer lands on the same moment.  The one move a refit is allowed to make.
  pure def adoptCoast(s: Steak, now: int): Steak =
    if (s.cAdvice == "coast" and s.startedAt != NONE and s.finishedAt == NONE
        and s.pullMin < INF and s.dueAt != s.startedAt + s.pullMin)
      s.with("dueAt", s.startedAt + s.pullMin).with("dueSetAt", now)
    else s

  pure def recompute1(s: Steak, now: int): Steak = adoptCoast(refit1(s, now), now)

  pure def mapRecompute(m: int -> Steak, ids: Set[int], now: int): int -> Steak =
    ids.fold(m, (acc, i) => acc.set(i, recompute1(acc.get(i), now)))

  // rescheduleCheck(), per steak.  A steak outside the scope keeps the
  // appointment it has; one that somehow has none gets a fresh one either way.
  pure def reschedule1(s: Steak, now: int, inScope: bool): Steak = {
    val fresh =
      if (fittedS(s) and s.finishedAt == NONE) s.startedAt + s.cNext else NONE
    if (not(inScope) and s.dueAt != NONE) s
    else s.with("dueAt", fresh).with("dueSetAt", now)
  }

  pure def mapReschedule(m: int -> Steak, ids: Set[int], scope: Set[int], now: int): int -> Steak =
    ids.fold(m, (acc, i) => acc.set(i, reschedule1(acc.get(i), now, scope.contains(i))))

  // A refit may move an appointment only in adoptCoastPull's one sanctioned way.
  pure def unsanctionedMove(before: Steak, after: Steak): bool =
    before.dueAt != after.dueAt and
    not(after.cAdvice == "coast" and after.dueAt == after.startedAt + after.pullMin)

  // Did an event about *these* steaks disturb an appointment belonging to some
  // other steak?  A steak that had no appointment is exempt: rescheduleCheck()
  // gives one to any steak that somehow lacks it, in or out of scope.
  pure def disturbedOutside(before: int -> Steak, after: int -> Steak,
                            ids: Set[int], scope: Set[int]): bool =
    ids.exists(j => not(scope.contains(j))
                    and before.get(j).dueAt != NONE
                    and unsanctionedMove(before.get(j), after.get(j)))

  //--------------------------------------------------------------------------
  // State.
  //--------------------------------------------------------------------------
  var clock:   int
  var present: Set[int]          // which of 1..MAX_STEAKS exist
  var steaks:  int -> Steak      // total over 1..MAX_STEAKS; only `present` count
  var current: int               // the steak the readouts point at
  var ovenC:   int
  var fan:     bool
  var alarmFired: bool

  // Ghosts.  Each latches: once a defect has been observed it stays observed,
  // so the invariants below are plain safety properties.
  var seen: { walkedForward: bool, restartedRunning: bool, blindPull: bool,
              disturbedNeighbour: bool }

  pure val noDefect = { walkedForward: false, restartedRunning: false, blindPull: false,
                        disturbedNeighbour: false }

  //--------------------------------------------------------------------------
  // Derived state.
  //--------------------------------------------------------------------------
  val allIds: Set[int] = 1.to(MAX_STEAKS)

  val running: Set[int] =
    present.filter(i => steaks.get(i).startedAt != NONE and steaks.get(i).finishedAt == NONE)

  // Not in the oven right now: never started, or already out.  Only these are
  // what the Start button puts in.
  val pending: Set[int] =
    present.filter(i => steaks.get(i).startedAt == NONE or steaks.get(i).finishedAt != NONE)

  // The setup fields at the top of the panel belong to this steak.
  val firstSteak: int = present.fold(MAX_STEAKS + 1, (acc, i) => imin(acc, i))

  def localMin(i: int): int = localOf(steaks.get(i), clock)
  def advice(i: int): str = steaks.get(i).cAdvice

  // steakTimes(): when a steak wants the door open, and when it should come out.
  def dueAtOf(i: int): int = {
    val s = steaks.get(i)
    if (s.dueAt != NONE) s.dueAt else s.startedAt + s.cNext
  }

  // awaitingProbe(): out of the oven and back in, with the model still
  // believing it spent those minutes heating.
  def awaitingProbe(i: int): bool = {
    val s = steaks.get(i)
    s.resumedAt != NONE and s.startedAt != NONE and s.finishedAt == NONE
  }

  // The steaks nextOpening() considers: running, and with an entry in `fits`.
  val planned: Set[int] = running.filter(i => steaks.get(i).cAdvice != "none")

  // nextOpening(): the trip is the earliest appointment any steak still holds.
  val openAt: int = planned.fold(INF, (acc, i) => imin(acc, dueAtOf(i)))

  // alarmAt().  With several steaks in, the card counts down to the trip, so
  // the alarm must ring at the same moment the card is counting down to.
  val alarmAt: int =
    if (BUG_ALARM_FOLLOWS_SELECTION) steaks.get(current).dueAt
    else if (running.size() > 1 and planned.size() > 0) openAt
    else steaks.get(current).dueAt

  // render() reaches the alarm only if it has not already returned at
  // "Set up your steak" or the finished card -- both of which are decided by
  // the *selected* steak.
  val alarmChecked: bool =
    steaks.get(current).startedAt != NONE and steaks.get(current).finishedAt == NONE

  // The card's primary "Out of the oven": the recommendation, which a steak
  // that has been sitting on a board may not bear.  (The always-available
  // "Out of the oven early" is `pullEarly` below, and is a different thing.)
  def recommendsPull(i: int): bool = and {
    running.contains(i),
    steaks.get(i).cAdvice == "pull"
      or (steaks.get(i).cAdvice == "coast" and clock >= dueAtOf(i)),
    BUG_PULL_WHEN_AWAITING_PROBE or not(awaitingProbe(i))
  }

  //--------------------------------------------------------------------------
  // Init.
  //--------------------------------------------------------------------------
  action init = all {
    clock' = 0,
    present' = Set(1),                      // ensureSteak(): there is always one
    steaks' = allIds.mapBy(_ => freshSteak),
    current' = 1,
    ovenC' = 125,
    fan' = false,
    alarmFired' = false,
    seen' = noDefect
  }

  //--------------------------------------------------------------------------
  // The alarm, as render() evaluates it every second against alarmAt().
  //--------------------------------------------------------------------------
  def ringingIn(m: int -> Steak, now: int): bool = {
    val run2 = present.filter(i =>
      m.get(i).startedAt != NONE and m.get(i).finishedAt == NONE)
    val plan2 = run2.filter(i => m.get(i).cAdvice != "none")
    val open2 = plan2.fold(INF, (acc, i) => {
      val s = m.get(i)
      imin(acc, if (s.dueAt != NONE) s.dueAt else s.startedAt + s.cNext)
    })
    val at =
      if (BUG_ALARM_FOLLOWS_SELECTION) m.get(current).dueAt
      else if (run2.size() > 1 and plan2.size() > 0) open2
      else m.get(current).dueAt
    and {
      m.get(current).startedAt != NONE,
      m.get(current).finishedAt == NONE,
      at != NONE,
      now >= at
    }
  }

  //--------------------------------------------------------------------------
  // Transitions.
  //--------------------------------------------------------------------------

  // The 1 s render tick: the countdown moves, nothing refits.
  action driftTick = all {
    clock < HORIZON,
    clock' = clock + 1,
    alarmFired' = ringingIn(steaks, clock + 1),
    steaks' = steaks, present' = present, current' = current,
    ovenC' = ovenC, fan' = fan, seen' = seen
  }

  // The 60 s timer: recompute() -- a refit and adoptCoastPull(), and nothing
  // else.  rescheduleCheck() is deliberately not called here.
  action refitTick = {
    val now = clock + 1
    val refitted = mapRecompute(steaks, present, now)
    val after =
      if (BUG_REFIT_RESCHEDULES) mapReschedule(refitted, present, present, now) else refitted
    all {
      clock < HORIZON,
      clock' = now,
      steaks' = after,
      alarmFired' = ringingIn(after, now),
      seen' = seen.with("walkedForward",
        seen.walkedForward or
        present.exists(i => unsanctionedMove(steaks.get(i), after.get(i)))),
      present' = present, current' = current, ovenC' = ovenC, fan' = fan
    }
  }

  // The Start button.  One press puts in every steak that is not already in
  // there, on one shared zero, each with its start temperature as reading zero.
  // `back` is the "they went in ten minutes ago" chip.
  action startCook = {
    nondet back = Set(0, 10).oneOf()
    nondet h = TIMES.oneOf()
    val going = if (BUG_START_RESTARTS_RUNNING) present else pending
    val zero = clock - back
    val started = going.fold(steaks, (acc, i) => acc.set(i, {
      ...freshSteak,
      startedAt: zero, reads: 1,
      guardMin: h, hitMin: h, pullMin: if (h >= INF) INF else imax(h - 1, 0)
    }))
    val after = mapReschedule(mapRecompute(started, present, clock), present, going, clock)
    all {
      going.size() > 0,
      clock' = clock,
      steaks' = after,
      // Keep the readouts on the steak they were on if it is still cooking: a
      // steak put into a running cook must not steal the card.
      current' =
        if (steaks.get(current).startedAt != NONE and steaks.get(current).finishedAt == NONE)
          current
        else going.fold(MAX_STEAKS + 1, (acc, i) => imin(acc, i)),
      alarmFired' = ringingIn(after, clock),
      seen' = seen.with("restartedRunning",
        seen.restartedRunning or going.exists(i => running.contains(i))),
      present' = present, ovenC' = ovenC, fan' = fan
    }
  }

  // A reading lands.  New information about this steak alone: its posterior is
  // redrawn, its own appointment is re-made, and no other steak's is touched.
  action logReading(i: int): bool = {
    nondet h = TIMES.oneOf()
    nondet g = TIMES.filter(x => x <= h).oneOf()
    val probed = steaks.get(i)
      .with("reads", steaks.get(i).reads + 1)
      .with("resumedAt", NONE)                 // the probe the resumed card asked for
      .with("hitMin", h).with("guardMin", g)
      .with("pullMin", if (h >= INF) INF else imax(h - 1, 0))
    val scope = if (BUG_RESCHEDULE_EVERY_STEAK) present else Set(i)
    val after = mapReschedule(
      mapRecompute(steaks.set(i, probed), present, clock), present, scope, clock)
    all {
      running.contains(i),
      clock' = clock,
      steaks' = after,
      alarmFired' = ringingIn(after, clock),
      // One trip is one sweep: the reading goes on the steak in hand.
      current' = i,
      seen' = seen.with("disturbedNeighbour", seen.disturbedNeighbour
        or disturbedOutside(steaks, after, present, Set(i))),
      present' = present, ovenC' = ovenC, fan' = fan
    }
  }

  // The delete button on a row of the readings table.  That table is
  // `state.readings` -- the *selected* steak's -- so a delete can only ever
  // touch `cur()`, which is why rescheduleCheck() is passed cur() here.
  action deleteReading(i: int): bool = {
    nondet h = TIMES.oneOf()
    nondet g = TIMES.filter(x => x <= h).oneOf()
    val cut = steaks.get(i)
      .with("reads", steaks.get(i).reads - 1)
      .with("hitMin", h).with("guardMin", g)
      .with("pullMin", if (h >= INF) INF else imax(h - 1, 0))
    val after = mapReschedule(
      mapRecompute(steaks.set(i, cut), present, clock), present, Set(current), clock)
    all {
      i == current,
      running.contains(i),
      steaks.get(i).reads > 0,
      clock' = clock,
      steaks' = after,
      alarmFired' = ringingIn(after, clock),
      seen' = seen.with("disturbedNeighbour", seen.disturbedNeighbour
        or disturbedOutside(steaks, after, present, Set(current))),
      present' = present, current' = current, ovenC' = ovenC, fan' = fan
    }
  }

  // finishSteak(): the pull the app recommended.  Only this steak's appointment
  // is over -- the ones still in the oven learned nothing from a neighbour
  // leaving, so their promised checks stand.
  action pullOut(i: int): bool = {
    val out = steaks.get(i).with("finishedAt", clock).with("resumedAt", NONE)
    val m = steaks.set(i, out)
    val after = mapReschedule(mapRecompute(m, present, clock), present, Set(i), clock)
    val stillIn = present.filter(j =>
      m.get(j).startedAt != NONE and m.get(j).finishedAt == NONE)
    all {
      recommendsPull(i),
      clock' = clock,
      steaks' = after,
      current' =
        if (stillIn.size() > 0) stillIn.fold(MAX_STEAKS + 1, (a, j) => imin(a, j)) else current,
      alarmFired' = ringingIn(after, clock),
      seen' = seen
        .with("blindPull", seen.blindPull or awaitingProbe(i))
        .with("disturbedNeighbour", seen.disturbedNeighbour
          or disturbedOutside(steaks, after, present, Set(i))),
      present' = present, ovenC' = ovenC, fan' = fan
    }
  }

  // "Out of the oven early": not a recommendation at all, but the cook
  // overruling the plan because dinner is now.  Always available during a cook,
  // and safe because it is reversible.
  action pullEarly(i: int): bool = {
    val out = steaks.get(i).with("finishedAt", clock).with("resumedAt", NONE)
    val m = steaks.set(i, out)
    val after = mapReschedule(mapRecompute(m, present, clock), present, Set(i), clock)
    val stillIn = present.filter(j =>
      m.get(j).startedAt != NONE and m.get(j).finishedAt == NONE)
    all {
      running.contains(i),
      clock' = clock,
      steaks' = after,
      current' =
        if (stillIn.size() > 0) stillIn.fold(MAX_STEAKS + 1, (a, j) => imin(a, j)) else current,
      alarmFired' = ringingIn(after, clock),
      seen' = seen.with("disturbedNeighbour", seen.disturbedNeighbour
        or disturbedOutside(steaks, after, present, Set(i))),
      present' = present, ovenC' = ovenC, fan' = fan
    }
  }

  // resumeCook(): the pull undone.  The same zero, the same readings, the same
  // posterior -- and everything that came out in the same action goes back in
  // with it.  The appointment becomes now, and until a reading lands nothing
  // irreversible may be ordered off the estimate.
  action resumeCook(i: int): bool = {
    val ref = steaks.get(i).finishedAt
    val back = present.filter(j => {
      val s = steaks.get(j)
      s.startedAt != NONE and s.finishedAt != NONE and s.finishedAt == ref
    })
    val m = back.fold(steaks, (acc, j) =>
      acc.set(j, acc.get(j).with("finishedAt", NONE).with("resumedAt", clock)))
    // The appointment is set *after* the refit: a coasting steak's plan would
    // otherwise put the promise back on its pull time and the trip would count
    // down instead of opening.
    val refitted = mapRecompute(m, present, clock)
    val after = back.fold(refitted, (acc, j) =>
      acc.set(j, acc.get(j).with("dueAt", clock).with("dueSetAt", clock)))
    all {
      steaks.get(i).startedAt != NONE,
      steaks.get(i).finishedAt != NONE,
      clock - steaks.get(i).finishedAt < BACK_WINDOW_MIN,
      clock' = clock,
      steaks' = after,
      current' = i,
      // Beeping at someone who has just pressed the button is noise, not an
      // alarm.
      alarmFired' = true,
      present' = present, ovenC' = ovenC, fan' = fan, seen' = seen
    }
  }

  // startAnother(): another dinner, not another steak.  Every steak is cleared,
  // not just the selected one.
  action startAnother = all {
    present.exists(i => steaks.get(i).startedAt != NONE),
    clock' = clock,
    steaks' = present.fold(steaks, (acc, i) => acc.set(i, freshSteak)),
    current' = firstSteak,
    alarmFired' = false,
    present' = present, ovenC' = ovenC, fan' = fan, seen' = seen
  }

  // Adding a steak to the list tells the steaks already cooking nothing, so
  // their appointments stand: nothing is re-planned here.
  action addSteak = {
    val free = allIds.exclude(present)
    val id = free.fold(MAX_STEAKS + 1, (acc, i) => imin(acc, i))
    all {
      present.size() < MAX_STEAKS,
      present' = present.union(Set(id)),
      steaks' = steaks.set(id, freshSteak),
      clock' = clock, current' = current, ovenC' = ovenC, fan' = fan,
      alarmFired' = alarmFired, seen' = seen
    }
  }

  // Likewise taking one out of the list.
  action removeSteak(i: int): bool = {
    val left = present.exclude(Set(i))
    all {
      present.contains(i),
      present.size() > 1,                    // ensureSteak(): never none
      present' = left,
      steaks' = steaks.set(i, freshSteak),
      current' =
        if (i == current) left.fold(MAX_STEAKS + 1, (a, j) => imin(a, j)) else current,
      clock' = clock, ovenC' = ovenC, fan' = fan, alarmFired' = alarmFired, seen' = seen
    }
  }

  // A steak's own fields are new information about that steak alone.
  action editSteakField = {
    val after =
      mapReschedule(mapRecompute(steaks, present, clock), present, Set(firstSteak), clock)
    all {
      clock' = clock,
      steaks' = after,
      alarmFired' = ringingIn(after, clock),
      seen' = seen.with("disturbedNeighbour", seen.disturbedNeighbour
        or disturbedOutside(steaks, after, present, Set(firstSteak))),
      present' = present, current' = current, ovenC' = ovenC, fan' = fan
    }
  }

  // The oven is shared, so a change to it really is new information about every
  // steak inside, and every appointment is re-made.
  action editOven = {
    nondet t = Set(120, 130).oneOf()
    val after = mapReschedule(mapRecompute(steaks, present, clock), present, present, clock)
    all {
      t != ovenC,
      ovenC' = t,
      clock' = clock,
      steaks' = after,
      alarmFired' = ringingIn(after, clock),
      present' = present, current' = current, fan' = fan, seen' = seen
    }
  }

  // Tapping a row points the readouts, the chart band and the dock at that
  // steak.  The handler refuses only a steak that is already out.
  action selectSteak(i: int): bool = all {
    present.contains(i),
    steaks.get(i).finishedAt == NONE,
    current' = i,
    alarmFired' = ringingIn(steaks, clock),
    clock' = clock, steaks' = steaks, present' = present, ovenC' = ovenC,
    fan' = fan, seen' = seen
  }

  action step = {
    nondet i = allIds.oneOf()
    any {
      driftTick,
      refitTick,
      startCook,
      logReading(i),
      deleteReading(i),
      pullOut(i),
      pullEarly(i),
      resumeCook(i),
      startAnother,
      addSteak,
      removeSteak(i),
      editSteakField,
      editOven,
      selectSteak(i)
    }
  }

  //--------------------------------------------------------------------------
  // Invariants.  Each is one of the rules CLAUDE.md states in prose.
  //--------------------------------------------------------------------------

  // "There is always at least one steak (ensureSteak()) -- with an empty list
  // the accessors become silent no-ops and the single-steak paths quietly stop
  // working."
  val alwaysASteak = present.size() > 0 and present.contains(current)

  val atMostMaxSteaks = present.size() <= MAX_STEAKS

  // "The schedule must be sticky, and only a browser test can catch it if it
  // isn't."  A plain refit moves an appointment only in adoptCoastPull's way.
  val scheduleIsSticky = not(seen.walkedForward)

  // "The Start button puts in pendingSteaks() and nothing else."
  val startSparesRunningSteaks = not(seen.restartedRunning)

  // "Nothing irreversible may be ordered off that estimate."
  val noPullOffAStaleEstimate = not(seen.blindPull)

  // "rescheduleCheck(only) must not reschedule every steak.  An appointment
  // belongs to one steak and is reset only by that steak's own reading."
  val appointmentsAreOwned = not(seen.disturbedNeighbour)

  // "Batching can only move a check earlier than a steak asked for, never
  // later, so each keeps its own 5% overshoot guarantee."
  val tripIsNeverLate = planned.forall(i => openAt <= dueAtOf(i))

  // "The alarm rings at alarmAt(), never at state.dueAt directly": whenever it
  // is evaluated at all, it is set no later than any steak's own appointment.
  // Ringing from the selected steak's `dueAt` left the phone silent for minutes
  // while the card said "Open the oven now".
  val alarmIsNotLate =
    (alarmChecked and planned.size() > 0 and alarmAt != NONE)
      implies planned.forall(i => alarmAt <= dueAtOf(i))

  // adoptCoastPull()'s post-condition, which is what makes it idempotent and so
  // safe to run on the timer where rescheduleCheck() is not.  A steak awaiting
  // a probe is excluded: resumeCook() deliberately overwrites the promise with
  // "now" after the refit.
  val coastPromiseIsAnchored =
    planned.filter(i => advice(i) == "coast" and steaks.get(i).pullMin < INF
                        and not(awaitingProbe(i)))
      .forall(i => steaks.get(i).dueAt == steaks.get(i).startedAt + steaks.get(i).pullMin)

  // "never reopen sooner than MIN_GAP_MIN, never go blind longer than
  // MAX_GAP_MIN": the guarantee advise() makes about a measurement check,
  // measured from the moment the appointment was made.
  val gapsAreRespected =
    planned.filter(i => advice(i) == "measure"
                        and not(awaitingProbe(i))
                        and steaks.get(i).dueAt != NONE
                        and steaks.get(i).dueSetAt != NONE)
      .forall(i => {
        val s = steaks.get(i)
        s.dueAt >= s.dueSetAt + MIN_GAP_MIN and s.dueAt <= s.dueSetAt + MAX_GAP_MIN
      })

  // The suite that must hold.
  val allInvariants = and {
    alwaysASteak, atMostMaxSteaks, scheduleIsSticky, startSparesRunningSteaks,
    noPullOffAStaleEstimate, appointmentsAreOwned, tripIsNeverLate,
    alarmIsNotLate, coastPromiseIsAnchored, gapsAreRespected
  }

  //--------------------------------------------------------------------------
  // "The alarm rings at alarmAt(), never at state.dueAt directly."
  //
  // The phone may not be silent while the card says the door should be open.
  // This one does NOT hold of the app as it stands -- see spec/README.md and
  // the `silentAlarm` run below.  It is kept out of `allInvariants` so the
  // suite reports the defects it is meant to guard, and no more.
  //--------------------------------------------------------------------------
  // The weaker half, and the one that fails deterministically: while any steak
  // is cooking, the alarm must at least be *evaluated*.  Selecting a steak that
  // has not started sends render() out at "Set up your steak", which is before
  // the alarm is looked at.
  val alarmIsArmedWhileCooking = (planned.size() > 0) implies alarmChecked

  // The consequence: the trip comes due and the phone stays silent.
  val alarmRingsAtTheTrip =
    (planned.size() > 0 and clock >= openAt) implies alarmFired

  //--------------------------------------------------------------------------
  // Scenarios.  These read as the browser tests do.
  //--------------------------------------------------------------------------

  // The appointment a reading bought is still the appointment ten refits later.
  run stickyScheduleTest =
    init
      .then(startCook)
      .then(logReading(1))
      .then(all { refitTick, assert(scheduleIsSticky) })
      .then(all { refitTick, assert(scheduleIsSticky) })
      .then(all { refitTick, assert(scheduleIsSticky) })
      .then(all { refitTick, assert(scheduleIsSticky) })
      .then(all { refitTick, assert(scheduleIsSticky) })
      .expect(scheduleIsSticky and coastPromiseIsAnchored)

  // A steak added to a running cook does not restart the one already in there,
  // and the trip stays the earliest appointment of the two.
  run addToRunningCookTest =
    init
      .then(startCook)
      .then(logReading(1))
      .then(addSteak)
      .then(startCook)
      .expect(startSparesRunningSteaks and tripIsNeverLate
              and steaks.get(1).reads == 2)

  // The silent alarm: one steak cooking, a second added but not yet started.
  // Tapping the second one's row -- which `renderSteakList` draws for every
  // steak, and the handler accepts because it is not finished -- points
  // `state.current` at a steak with no cook, so `render()` returns at
  // "Set up your steak" and never reaches the alarm.  The trip comes due and
  // the phone stays silent.
  run silentAlarmTest =
    init
      .then(startCook)
      .then(logReading(1))
      .then(addSteak)
      .then(selectSteak(2))
      .expect(planned.size() > 0 and not(alarmChecked)
              and not(alarmIsArmedWhileCooking))
}

//----------------------------------------------------------------------------
// The app as it stands.
//----------------------------------------------------------------------------
module reverse_sear {
  import app(
    BUG_REFIT_RESCHEDULES = false,
    BUG_ALARM_FOLLOWS_SELECTION = false,
    BUG_START_RESTARTS_RUNNING = false,
    BUG_RESCHEDULE_EVERY_STEAK = false,
    BUG_PULL_WHEN_AWAITING_PROBE = false
  ).*
}

//----------------------------------------------------------------------------
// One module per defect, each turning on exactly one, so every invariant above
// is shown to bite rather than to hold vacuously.  spec/check.sh runs them.
//----------------------------------------------------------------------------
module bug_refit_reschedules {
  import app(
    BUG_REFIT_RESCHEDULES = true,
    BUG_ALARM_FOLLOWS_SELECTION = false,
    BUG_START_RESTARTS_RUNNING = false,
    BUG_RESCHEDULE_EVERY_STEAK = false,
    BUG_PULL_WHEN_AWAITING_PROBE = false
  ).*
}

module bug_alarm_follows_selection {
  import app(
    BUG_REFIT_RESCHEDULES = false,
    BUG_ALARM_FOLLOWS_SELECTION = true,
    BUG_START_RESTARTS_RUNNING = false,
    BUG_RESCHEDULE_EVERY_STEAK = false,
    BUG_PULL_WHEN_AWAITING_PROBE = false
  ).*
}

module bug_start_restarts_running {
  import app(
    BUG_REFIT_RESCHEDULES = false,
    BUG_ALARM_FOLLOWS_SELECTION = false,
    BUG_START_RESTARTS_RUNNING = true,
    BUG_RESCHEDULE_EVERY_STEAK = false,
    BUG_PULL_WHEN_AWAITING_PROBE = false
  ).*
}

module bug_reschedule_every_steak {
  import app(
    BUG_REFIT_RESCHEDULES = false,
    BUG_ALARM_FOLLOWS_SELECTION = false,
    BUG_START_RESTARTS_RUNNING = false,
    BUG_RESCHEDULE_EVERY_STEAK = true,
    BUG_PULL_WHEN_AWAITING_PROBE = false
  ).*
}

module bug_pull_when_awaiting_probe {
  import app(
    BUG_REFIT_RESCHEDULES = false,
    BUG_ALARM_FOLLOWS_SELECTION = false,
    BUG_START_RESTARTS_RUNNING = false,
    BUG_RESCHEDULE_EVERY_STEAK = false,
    BUG_PULL_WHEN_AWAITING_PROBE = true
  ).*
}
