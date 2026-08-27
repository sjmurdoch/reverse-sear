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

