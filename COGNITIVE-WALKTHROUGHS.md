# Cognitive walkthroughs

A record of structured walkthroughs of the Reverse Sear Pilot web app, the
problems each one found, and what changed as a result.

Each stage of the task is checked against the four cognitive-walkthrough
questions:

1. Will the user try to achieve the right result?
2. Will the user notice that the correct action is available?
3. Will the user associate the correct action with the result they want?
4. After the action, will the user see that progress has been made?

---

## Walkthrough 1 — the busy cook

**Persona.** Cooking a steak to 44 °C as it leaves the oven, expecting it to
warm a few degrees while it rests. Also making a sauce, watching potatoes, and
answering the door. Puts the phone face-down on the counter and walks away.
Comes back with wet hands and about four seconds of attention. Knows what
medium rare means to them; has no interest in the model.

**Task stages walked.** Set up → start the cook → leave the kitchen → come back
and log a reading → repeat → take the steak out.

Findings are listed worst-first. Everything below was found by walking the
stages, then confirmed against the running app in a headless iPhone context.

### 1. The next check walked forward forever — the cook is never asked for a reading

**Stage:** waiting. **Question failed:** 4 — and in the most damaging way, since
the app actively undid its own instruction.

`advise()` floors the next check at `now + MIN_GAP_MIN`. The app re-ran it on a
60-second timer, so every refit pushed the appointment a few minutes further
out. Observed, with no user action at all:

```
elapsed 20 min   "Next check in 9 min"    promised 29.5 min
elapsed 26 min   "Next check in 5 min"    promised 31.0 min
elapsed 32 min   "Next check in 5 min"    promised 37.0 min
elapsed 38 min   "Next check in 5 min"    promised 43.0 min
```

The countdown never reaches zero. A cook who does exactly as told — wait for the
countdown — is never asked for a second reading, and the app silently coasts to
the end on the two readings it already had, which is its least accurate mode.

**Change.** The schedule is now sticky. `state.dueAt` is set when the
*information* changes — a reading logged or deleted, the cook started, a setup
value edited — and nothing else moves it. Refits update the estimate and the
curve; they no longer reschedule the appointment. `dueAt` is persisted, so the
promised moment also survives closing Safari (verified byte-identical across a
reload).

### 2. The countdown and its beep die silently when the phone sleeps

**Stage:** leaving the kitchen. **Question failed:** 4, plus a false affordance
at 3 — a countdown *looks* like a kitchen timer, so it will be trusted like one.

A backgrounded tab is throttled and a locked phone runs nothing, so the alarm
this persona is relying on would simply never fire. Nothing in the interface
said so.

**Change.** The app holds a screen wake lock for the duration of a cook,
re-acquiring it whenever the page becomes visible again (a wake lock is dropped
on hide and never restored automatically). A status line in the card states
which world you are in, rather than leaving it to be discovered:

- held → "Screen kept awake — leave this page open and it will beep"
- not held → "Only beeps while this page is open — set a phone timer for 1:14 PM"

### 3. Acting produced no visible result

**Stage:** starting the cook, and every reading. **Question failed:** 4.

**Start cook** sits at the bottom of the Setup panel; **Log** sits in the fixed
dock. The thing they both change — the countdown — is at the top of the page,
off-screen. The cook pressed a button and saw nothing happen.

**Change.** Both actions scroll the verdict card into view if it is not already
visible.

### 4. An overdue check never escalated, and the estimate was frozen

**Stage:** coming back late. **Question failed:** 4.

The predicted core temperature was only recomputed on a 60-second timer, so the
"Core now" readout sat still — the one number that should visibly show progress.
Worse, a check that was due stayed "Check it now" even once the model's own
estimate had passed the target.

**Change.** The predicted core is recomputed from the stored posterior on every
one-second tick, so it climbs while you watch it. When the estimate reaches the
target the card escalates to "Take it out now" regardless of what the last fit
had planned. Lateness is measured against the promised appointment, which now
survives the refit, so the card can say **"4 min past the planned check · core
about 31.9 °C"** instead of blanking the line.

### 5. The setup form was below the fold, under three empty cards

**Stage:** first run. **Question failed:** 2.

The card said "Set up your steak"; the form that does it sat below an empty
stats row, an empty chart and an empty readings table — roughly two screens
down on a phone.

**Change.** Those three are hidden until a cook has started. The form now sits
directly under the prompt that asks for it. Nothing was removed; it appears the
moment there is anything in it.

### 6. There was no way to finish

**Stage:** taking the steak out. **Question failed:** 2 and 4.

The card said "Take it out now" indefinitely. The only way out was **Reset
everything** buried in Setup — which reads as destructive, and which a cook
mid-service will not touch.

**Change.** When the recommendation is to pull, the card offers **Out of the
oven**. It records the estimated core at that moment and switches to a calm done
state showing the temperature, the elapsed time, a note about the rest and the
sear, and **Start another steak**. The stale-cook card offers the same recovery
action instead of pointing at Setup.

### 7. Readings were timestamped when typed, not when taken

**Stage:** logging. **Question failed:** none directly — an accuracy defect
caused by how this persona actually behaves.

You probe the steak, put it back, wipe your hands, then pick up the phone. That
is easily a minute. Attributing the temperature to the later time makes the
steak look slower than it is and pulls it late.

**Change.** Three chips beside the input — **now / 1m ago / 2m ago** — backdate
the reading. Default is "now", so nothing changes for anyone who does not care.
Backdated times are clamped to stay after the previous reading.

### 8. Smaller things

- **"22:56" in the big display reads like a clock time.** The countdown now
  shows whole minutes ("23 min") above two minutes and switches to `mm:ss` only
  inside the last two, where the seconds matter. It also stops the headline
  number flickering every second for the whole cook.
- **"Target °C" did not say which temperature it meant.** A note under the
  field states it is the core temperature *as it leaves the oven*, and that the
  rest and the sear add to it.
- **It was not clear when to press Start.** A note says to press it as the
  steak goes into the oven — that press is the clock's zero.
- **The action button was rebuilt every second** by the render tick, so a tap
  could land on an element that had just been replaced. It is now only rebuilt
  when it actually changes.
- **Stale readouts.** Starting another steak left the previous cook's numbers in
  the stats row; the finished card lost its temperature after a reload. Both
  fixed. An empty status line was also rendering an orphan bullet.

### Deliberately not changed

This persona is one of several, so some tempting changes were rejected:

- **No doneness presets** ("Rare / Medium rare / …" chips on the target field).
  The persona calls 44 °C medium rare; published charts disagree, often by ten
  degrees. Shipping a scale that contradicts the cook's own calibration would be
  worse than the plain number, which is already remembered between cooks.
- **No rest-carryover model.** The target is defined as the out-of-oven
  temperature, which is what this persona asked for. The rest is a note, not a
  calculation.
- **Nothing removed for the technical user.** The uncertainty band, the fitted
  time constant, the per-reading residuals and the "How it decides" section are
  all untouched. The decluttering at stage 5 defers empty cards; it does not
  delete anything.

### Verification

Driven end to end in a headless iPhone context with an advancing fake clock:
setup reachable without scrolling; start and log both bring the verdict into
view; backdated readings land at the right time and the chip resets; the core
readout climbs between fits; the appointment holds while time passes and
survives a reload byte-identical; a due check that is not yet at target still
says "check", not "pull"; the escalation to "Take it out now" fires when the
estimate passes target; pulling records the temperature and persists; starting
another clears every readout. No page errors in light or dark.

---

## Walkthrough 2 — the same cook, reporting from a real cook

**Persona.** As above. This time the walkthrough started from what actually
happened: the app said **Take it out now**, and the card it left behind read
**40.8 °C** against a 44 °C target. The cook did exactly as instructed.

**Task stage walked.** The last few minutes — the gap between the final reading
and the pull.

### 1. A check that had gone stale was read as an instruction to pull

**Stage:** the final gap. **Question failed:** 3 — the cook associates "Take it
out now" with "the steak is at temperature", and here it meant something else
entirely.

Readings at 0, 10.8, 19.0 and 28.4 min put the pull at 36.2 min. But the plan
made at 28.4 min was still `measure`, with a check promised at 33.4 min. As the
clock ran on, `advise()` — which floors its next check at `now + MIN_GAP_MIN` —
slid that floor past the predicted finish, and the plan flipped to `coast` on a
plain refit, with no new reading involved. The appointment did not move: that is
the stickiness fix from walkthrough 1, working as designed. But the card reads a
due appointment plus a coasting plan as "take it out now", so at 33.4 min it
told the cook to pull — 2.8 min, and 2.6 °C, before the moment it had itself
computed.

```
28.4 min   measure, check at 33.4    pull would be 36.2
33.4 min   coast                     "Take it out now" — core about 40.8 °C
36.2 min   (the moment it meant)     core about 43.4 °C
```

**Change.** When the plan flips to coasting, the promise becomes the pull time:
`adoptCoastPull()` moves `state.dueAt` to `plan.pull`. The cook now sees the
card change from a countdown to a check into "Coast — oven stays shut · out of
the oven at 7:03 PM", and the button appears at the pull time. This is the one
thing allowed to move the appointment on a refit, and it cannot walk forward
the way walkthrough 1's bug did: the pull time comes from the posterior, which
only moves when a reading arrives.

Two regression tests in `tests/schedule.spec.js` cover it — the flip itself,
replaying the readings above, and the adopted pull time holding still across
refits. Without the fix the first reproduces the reported cook exactly: promised
33.4 min against a pull time of 36.2 min.

### Deliberately not changed

- **`COAST_UNDERSHOOT_C` stays at 0.6 °C.** It aims deliberately low because a
  constant-asymptote fit arrives slightly early; it was not the cause here, and
  the 3 °C shortfall was a scheduling defect, not a calibration one.
- **The pull is still the *median* arrival at target − 0.6 °C**, not an earlier
  percentile. Pulling at, say, the 5th percentile would trade a symmetric error
  for a systematic undershoot — the opposite of the complaint.
- **A coasting plan still offers no button before its time.** Making "Out of the
  oven" always available would let this defect recur as a slip.

---

## Walkthrough 3 — the same cook, a wet steak in an oven that was not ready

**Persona.** As walkthrough 1: 44 °C on the probe as it leaves the oven, a sauce
and potatoes competing for attention, wet hands, four seconds of attention at a
time.

**Scenario.** A 1.1 kg, 40 mm steak taken straight from the bag — not patted dry
— into an oven switched on four minutes earlier. The dial says 125 °C; the air
is at 70 °C and climbing about 2.2 °C a minute. This is the regime the tool's
own explanation warns about: while the surface is genuinely wet the whole steak
is pinned near the oven's wet-bulb temperature, which is 38.5 °C for a dry
125 °C oven and lower still while it is preheating — below the 44 °C target.

**How it was walked.** Ground truth came from `model/steak.py` with those
settings; the page was driven in a headless iPhone context against a fake clock,
probing the simulated core at exactly the minute the app asked for a reading and
typing what the probe said, plus placement noise. So the cook did as told,
throughout, and the app got what a real probe would have given it.

**Task stages walked.** Set up and start → the first check, before anything is
fitted → three more checks as the fit catches up → coast → take it out. Then the
slips this persona actually makes, from the same mid-cook state.

**The cook itself came out right,** which is worth recording. The prior was badly
wrong at the start — it put 44 °C at 25–79 min when the truth was 64 — and the
schedule recovered: five checks, pull at 63.6 min, true core 44.0 °C. The
walkthrough-2 coast fix held in a regime nothing had tested it in.

### 1. A mistyped reading is accepted without question, and silently changes the plan

**Stage:** logging. **Question failed:** 1 — the cook is still trying to achieve
the right result, but the app has quietly changed what it is aiming at, and
nothing on the card says so.

A number pad, wet hands, one hand on a pan. The decimal point is the whole
message. From the state above (true core 40.2 °C, four good readings, five
minutes from the pull):

```
typed "433" for 43.3   ->  "Take it out now", card reads "core about 43.5 °C"
                           true core 40.2 °C: a steak pulled 3.5 C short
typed "4.3"  for 43     ->  "may never reach target", next look in 30 min
                           true core would be 57 C by then: a steak ruined
```

Neither is caught by the fit, and that is not an accident: the likelihood is
Gaussian with `sigma_obs` 0.8 °C, so a reading 36 °C out is a 45-sigma event and
the posterior does not downweight it — it contorts to accommodate it. The only
trace is the residual column in the readings table, two cards down, which showed
`+389.5`.

The `4.3` direction is the dangerous one, and it is dangerous in the way this
tool is supposed to prevent: it does not merely mislead, it sends the cook away
for half an hour at the exact moment the steak needs watching.

**Change.** Refuse what is physically impossible; question — without refusing —
what is merely improbable.

- A reading at or above the oven temperature is refused at the input: the core
  cannot reach the oven air, let alone pass it. The message names the oven
  setting, and the typed value stays in the box, because it is one digit away
  from being right and clearing it would cost a second probe. The same check
  guards the starting temperature, which anchors every fitted curve.
- A reading 3 °C or more below the one before it is **accepted** and queried:
  "4.3 °C is 35.9 °C below your last reading of 40.2 °C, and the core cannot cool
  in the oven. If that was a mistype, delete the row in Readings; if the earlier
  reading was off-centre, carry on." The query is derived from the readings
  rather than remembered at the keystroke, so it survives a reload and clears
  itself the moment the row is deleted.

The asymmetry is deliberate. A probe placed off the thermal centre reads *high*,
so a lower reading than the last one can be perfectly honest — and a reading
that disagrees with the model is the most valuable one there is. Refusing it
would be worse than the disease.

### 2. The headline estimate hid its own uncertainty at the moment it was worst

**Stage:** arriving at the first check. **Question failed:** 1, and 3 — a number
this confident-looking argues against the very probe the card is asking for.

At the first check the card said **"Check it now · core about 23.6 °C"**. The
true core was 16.2 °C, and the app's own 5–95% interval was 6.4–41.3 °C: before
the second reading, that number is almost entirely prior. A cook who glances,
reads "about 24", and thinks "nearly there, I'll leave it" has been misled by a
card that knew better — the spread was on the stats card, one down, in 11 px
type.

**Change.** When the 5–95% interval is wider than 6 °C the verdict line shows it:
**"core 6–41 °C, best guess 23.6"**. Once the readings pin it down — 2.4 °C wide
at the last check of this cook — it goes back to "core about 43.4 °C". Nothing
was added to the stats card; this is the same number, told honestly in the place
that gets read.

### 3. The first check of a cook was called a "mid-course check"

**Stage:** the first screen after Start. **Question failed:** 3.

Pressing **Start cook** produced: *"Mid-course check: the prediction is still
loose enough that a reading now pays for the heat it costs."* There is no course
yet — it is the first thing the tool ever says, and it describes a situation the
cook is not in. (It comes from the `MAX_BLIND_FRACTION` branch, which caps the
first check at 55% of the predicted time; the cap is right, the words are not.)

**Change.** While there is only the starting reading the card says what is
actually true: *"Nothing is fitted yet — this is the prior for a steak this size
in an oven this hot. The first check is the one that turns it into a
prediction."* `advise()` is untouched, so the parity fixture is untouched: this
is `render()` choosing better words for a state it can see.

### Deliberately not changed

- **No robust likelihood.** The principled fix for finding 1 is an observation
  model with tails — a Student-t, or a Gaussian mixture with a small outlier
  weight — so that an impossible reading is downweighted instead of dominating.
  It is the right answer and it is not a walkthrough-sized change: it moves every
  posterior, so `COAST_UNDERSHOOT_C`, the parity fixture and the closed-loop
  calibration in `validate.py` would all have to be re-derived. Recorded here as
  a proposal rather than slipped in behind a usability fix.
- **No confirmation dialog on a surprising reading.** The persona has four
  seconds and wet hands, and the surprising reading is usually the true one. The
  query is a line of text, not a gate.
- **Nothing auto-deleted.** The app never removes a reading the cook typed; it
  says what it doubts and points at the delete button.
- **The first blind gap stays long.** 23.6 minutes before the first check looks
  bold when the prior is this wrong, but it was right here — the check landed
  with 40 minutes still to run and the fit caught up in one reading. The
  `MAX_BLIND_FRACTION` cap is doing its job.

### Verification

The cook above, replayed against `model/steak.py` in a headless iPhone context:
five checks, pull at 63.6 min, true core 44.0 °C, no page errors. Regression
tests for all three findings: an impossible reading refused and correctable in
place, an improbable one accepted-and-queried and the query clearing when the row
goes and surviving a reload, the same guard on the starting temperature, the wide
and narrow forms of the headline estimate, and the first-check wording appearing
and then going away.


---

## Walkthrough 4 — three steaks, one oven

**Persona.** The same cook as walkthrough 1, now feeding four people. Three
steaks go in together on separate shelves: a 1.1 kg ribeye at 48 mm for the
table, a 0.4 kg sirloin at 28 mm for someone who wants it at 52 °C, and a
0.6 kg fillet at 38 mm. Still a sauce, still potatoes, still wet hands and four
seconds of attention. The phone goes face-down on the counter and the cook walks
away, trusting it to shout.

**Scenario.** All three in at once, three checks apart, one trip to the oven per
check. The dinner runs from setup to the last steak out, and then straight into
the next one, because a cook who does this once does it again the same evening.

**How it was walked.** The three-steak state was seeded into the running page in
a headless iPhone context against a controllable clock, then driven the way the
cook would drive it: wait for the countdown, open the door once, sweep through
all three, and act on whatever the card said next. Every stage was checked
against the four questions, and every claim below was reproduced in the browser
before it was fixed.

**Task stages walked.** Set up three → all in together → wait → the trip: probe
all three → correct a number that was wrong at setup → one comes out while the
rest carry on → the last one out → start another dinner. Then the two things
this cook does that the single-steak app never had to survive: tapping a steak
to look at it, and adding another one to a cook already running.

**What held.** The batching itself. One countdown, the door opening at the
earliest appointment any steak held, everything probed while it was open, the
guided sweep landing each number on the steak it came from, and the running
order in the list — all behaved as walkthrough-era single-steak rules say they
should. Every defect below is the same shape instead: the per-steak fields are
accessors onto the *selected* steak, and six things that belong to the whole
oven — the alarm, the end of a cook, the start of one, the implausible-reading
query, the appointments and the Setup form — were quietly reading or writing
through them.

### 1. The card said "Open the oven now" and the phone stayed silent

**Stage:** waiting, having walked away. **Question failed:** 4 — and it breaks
the one promise the tool makes to a cook who is not looking at it.

The countdown on the card is the *trip*: the earliest appointment any steak
holds. The beep was fired from `state.dueAt`, which is the appointment of
whichever steak the readouts happen to be showing. Those are not the same
moment, and the gap is as large as the spread of the three appointments:

```
28.0 min elapsed   trip opens in 9.6 min  (the sirloin is driving)
                   the selected ribeye's own check is 13.3 min away
37.6 min           card: "Open the oven now"      phone: silent
41.3 min           card: "Open the oven now"      phone: beeps — 3.7 min late
```

Nothing on screen suggested a problem, because the card was correct. Only the
alarm was wrong, and only for the cook who is not in the room to see it.

**Change.** `alarmAt()` returns what the card is counting down to: the trip when
several steaks are in, and the steak's own appointment when only one is.
`render()` rings from that. The single-steak path is unchanged — with one steak
in the oven, the trip *is* its appointment.

### 2. "Start another steak" left two steaks stranded, and the next dinner could not be started

**Stage:** after the last one comes out. **Question failed:** 4, then 2 — the
action reported success and left the app in a state with no way forward.

`startAnother()` cleared `state.startedAt`, `state.readings` and the rest, all of
which are accessors onto the current steak. So it cleared one steak of the three.
The other two kept `finishedAt`, stayed in the list marked **out** with the last
dinner's temperatures, and — because a steak that has started shows no
starting-temperature box — offered nowhere to type the number needed to start
them again. Pressing the start button then refused with *"Sirloin: type the core
temperature the probe is showing"*, naming a box that was not on the screen.

That is a dead end reached by pressing the only button the app offers, at the
end of every multi-steak cook.

**Change.** "Another" means another dinner, not another steak: `startAnother()`
clears the cook on every steak in the oven and keeps their names and sizes, so
the same three are ready to go in again. The button says **Start another cook**
when there is more than one steak, which is what it now does.

### 3. A steak added to a running cook could never be put in

**Stage:** the trip, when someone else turns up. **Question failed:** 2 and 3 —
and the action the cook would reach for was destructive.

**Add another steak** is offered while a cook is running, and adding one worked:
a new block appeared with its own starting-temperature box. There was then no
action that put it in the oven. The start button starts *every* steak, so
pressing it re-zeroed the clock of the steaks already cooking and threw away
their readings. Added to a running single-steak cook, observed:

```
before   Ribeye  started 28.0 min ago,  readings [0, 16, 28 min]
press "All in the oven"
after    Ribeye  started 0.0 min ago,   readings [{t: 0, temp: 5}]
         no warning, no confirmation — the 5 °C is the stale value left in the box
```

A whole dinner's worth of information, from a button whose label was "All in the
oven". With three in it did not even do that: it refused, naming a box that had
been hidden because that steak was already cooking.

**Change.** The button puts in what is not already in the oven, and says so:
**"Steak 3 into the oven"** when a cook is running, **"All in the oven"** when
none is, and it is disabled with "Everything is in the oven" when there is
nothing to put in. A steak going in late gets its own clock zero — the per-steak
`startedAt` the app already carries everywhere else, including the chart — and
the steaks already cooking keep their readings, their zero and their
appointments. The card stays with the cook in progress rather than jumping to
the newcomer.

### 4. The mistype query disappeared as the sweep moved on

**Stage:** logging, during the sweep. **Question failed:** 1 — walkthrough 3
added this protection, and the sweep took it away again.

A trip is one sweep: log the ribeye and the dock immediately moves to the
sirloin, which is exactly what a chef with wet hands needs. But the query
raised by an implausible reading was computed from `state.readings` — the
*selected* steak — so it existed for the tick between the reading landing and
the selection moving on, and was never seen. Typing `4.3` for `43` on the ribeye,
the defect walkthrough 3 exists to catch, produced no query at all.

**Change.** The query is asked of every steak in the oven, and names the one it
doubts, since the readings table below shows only the selected steak:
**"Ribeye: 4.3 °C is 21.7 °C below its last reading of 26 °C … tap Ribeye in the
list and delete the row in Readings."** With one steak in, the wording is
unchanged.

### 5. Correcting one steak walked every other steak's check forward

**Stage:** correcting a setup number mid-cook. **Question failed:** 4, and it is
walkthrough 1's defect arriving through a door that did not exist then.

`rescheduleCheck()` re-makes an appointment from `advise()`, which floors its
next check at `now + MIN_GAP_MIN`. Every per-steak edit called it for *all*
steaks, so correcting the fillet's thickness a minute before the trip — 38 mm
typed at setup where 35 mm was meant — moved the other two:

```
before   ribeye 4.7 min   sirloin 1.0 min   fillet 1.0 min
after    ribeye 8.0 min   sirloin 5.0 min   fillet 5.0 min
```

The sirloin was a minute from the check it had promised; the correction pushed it
to five, and each further keystroke pushed it again. The same unscoped call sat
in three more places: removing a steak from the list, adding one, and taking one
*out* of the oven — so pulling the sirloin pushed the ribeye's outstanding check
out to `now + 5` as well.

**Change.** `rescheduleCheck(only)` now takes the steak, or the several steaks
that just went in together, and every caller says which. A steak's own fields
re-plan that steak; adding, removing or pulling a steak re-plans nothing, because
the others learned nothing from it. The unscoped call is kept for exactly the
two things that really are shared — the oven's temperature and its fan — where
every steak's fit does change.

### 6. The Setup fields silently followed whichever steak was tapped

**Stage:** looking at one steak, then correcting another. **Question failed:** 3
— the action does something other than what its position says.

Tapping a row in the list points the readouts at that steak, which is the point
of the list. It also pointed **Target °C**, **Mass kg** and **Thickness mm** at
it, because those write through the same accessors — while still showing the
first steak's numbers, and while that steak's own block, further down, showed
its numbers too. Correcting the ribeye's thickness after glancing at the sirloin
put 52 mm on the sirloin, in a field that had just displayed 48.

**Change.** The panel now reads as *the oven, then one block per steak*. Oven
temperature and fan sit together at the top; the first steak's target, thickness,
mass and starting temperature sit in its own block, built like the blocks for
steaks 2 and 3 — with a colour dot and an editable name once there is more than
one. Those fields are written to the first steak explicitly, never through the
selection.

### 7. Smaller things

- **The finished card put one steak's temperature under an unattributed
  heading.** "Out of the oven · 50.0 °C" after a three-steak dinner reads as the
  verdict on the dinner. It now names the steak whose number it is showing.
- **"Probe all 3 while the door is open" was ordered even when one was
  coasting**, contradicting that steak's own row in the list a few pixels below.
  The line now counts only the steaks whose plan is still `measure`, and says
  the others are coasting and go straight back.
- **The collapsed Setup summary described one steak** as though it were the
  cook: "125°C · target 44°C · 40mm" with three different steaks inside. With
  several in, it says how many.
- **The prior note said "Before any reading…"** with no clue which steak it was
  the prior *for*. It names the steak when there is more than one.
- **The instruction under the button named a button that was not there.**
  "…press **Start cook** as the steak goes into the oven" sat under a button
  reading "All in the oven". It now quotes whatever the button actually says,
  and the note explaining what Target means sits below every steak's block
  rather than between the first and the second.

### Deliberately not changed

- **Editing the oven temperature still re-makes every appointment.** It walks
  each check forward to `now + MIN_GAP_MIN`, exactly as finding 5 complains
  about — but the oven is genuinely shared, so every steak's fit really has
  changed and every old appointment really is stale. This is walkthrough 1's
  documented "a setup value edited" rule, applied to the one value that belongs
  to all of them.
- **No per-steak alarm.** One trip is one alarm. Ringing again for each steak in
  the sweep would turn the guided sweep into a queue of interruptions, and the
  door is already open by then.
- **No fourth steak.** Three still fit on a phone screen at a glance; a fourth
  row would push the countdown off it, which is the number this persona reads
  first.
- **A steak added mid-cook is still not batched into a shared prior.** It gets
  its own clock and its own fit. The oven is hotter for a moment when the door
  opens to put it in, and the model does not know that — but neither does it know
  about the door opening for a probe, which is the same size of error and has
  been acceptable since walkthrough 1.
- **Tapping a steak still changes the readouts, the chart band and the dock.**
  Finding 6 is not an argument against the selection; it is an argument that the
  Setup fields were never part of it.

### Verification

Eight regression tests in `tests/multisteak.spec.js`, under
`the oven as a whole, not the steak on screen`: the alarm ringing at the trip
rather than at the selected steak's appointment; the query surviving the sweep
and naming its steak; a per-steak correction leaving the other appointments
alone; the oven temperature still re-making all of them; a pull leaving the rest
alone; the Setup fields staying the first steak's across a selection change; a
steak added mid-cook going in on its own clock with the running cook untouched;
and starting another cook clearing the whole oven and being able to start the
next dinner. Seven of the eight fail on the code as it was, each at the
assertion that names the defect; the eighth is the counterpart that says what
must *not* change — the oven temperature still re-planning every steak — and
passes either way. The single-steak wording of the query and of the finished
card is held by the existing tests in `cook.spec.js` and `lifecycle.spec.js`,
which still pass unchanged.

**Which browser.** The walkthrough itself was driven under the
`iphone-chromium` fallback project only: WebKit is the primary target, but the
Playwright CDN is blocked from the sandbox it was done in, so the three defects
in this family that WebKit has historically caught and Chromium has not —
elements rebuilt under a finger — could not be re-examined while the fixes were
being made. CI then ran the whole suite under WebKit on the commit that carries
them: 100 passed, `iphone-webkit`, [run 15][wk]. So the coverage claim above
holds on Safari's engine; it just was not what caught anything here.

[wk]: https://github.com/sjmurdoch/reverse-sear/actions/runs/33123992895
