#!/usr/bin/env sh
# Check spec/steak.qnt: every invariant on the app as it stands, then one
# deliberately broken module per invariant to show that it bites.
#
#   sh spec/check.sh            random simulation (~3 minutes)
#   sh spec/check.sh verify     Apalache, exhaustive but only to depth 1
#
# The verify mode is shallow on purpose: depth 1 takes about 40 s per invariant
# and depth 2 did not finish in 40 minutes.  It also depends on the `val`
# bindings in steak.qnt that work around an Apalache bug -- spec/README.md and
# spec/apalache-foldset-bug.qnt have the detail.
#
# Quint is not a repo dependency; see spec/README.md for the one-line install.
set -e

QUINT="${QUINT:-npx --yes @informalsystems/quint@0.32.0}"
SPEC="$(dirname "$0")/steak.qnt"
MODE="${1:-run}"
STEPS="${STEPS:-14}"
SAMPLES="${SAMPLES:-3000}"
VERIFY_STEPS="${VERIFY_STEPS:-1}"
# A "must hold" check only needs breadth; a "must be caught" check has to
# actually find its counterexample, and the blind pull needs pull, resume and
# pull again in one trace.
BITE_STEPS="${BITE_STEPS:-20}"
BITE_SAMPLES="${BITE_SAMPLES:-20000}"

# The invariants that must hold, and the module that must break each one.
# alarmIsArmedWhileCooking / alarmRingsAtTheTrip are deliberately absent: they
# do not hold of the app as it stands.  See spec/README.md.
HOLD="alwaysASteak atMostMaxSteaks scheduleIsSticky startSparesRunningSteaks \
      noPullOffAStaleEstimate appointmentsAreOwned tripIsNeverLate alarmIsNotLate \
      coastPromiseIsAnchored gapsAreRespected"

BITE="scheduleIsSticky:bug_refit_reschedules \
      startSparesRunningSteaks:bug_start_restarts_running \
      noPullOffAStaleEstimate:bug_pull_when_awaiting_probe \
      alarmIsNotLate:bug_alarm_follows_selection \
      appointmentsAreOwned:bug_reschedule_every_steak"

check() { # module invariant steps samples -> 0 if the invariant held
  if [ "$MODE" = "verify" ]; then
    $QUINT verify --main="$1" --invariant="$2" --max-steps="$VERIFY_STEPS" "$SPEC" >/dev/null 2>&1
  else
    $QUINT run --backend=typescript --main="$1" --invariant="$2" \
      --max-steps="$3" --max-samples="$4" --verbosity=0 "$SPEC" >/dev/null 2>&1
  fi
}

fail=0

echo "== reverse_sear: these must hold =="
for inv in $HOLD; do
  if check reverse_sear "$inv" "$STEPS" "$SAMPLES"; then
    printf '  ok        %s\n' "$inv"
  else
    printf '  VIOLATED  %s\n' "$inv"; fail=1
  fi
done

echo
if [ "$MODE" = "verify" ]; then
  echo
  echo "  (exhaustive to depth $VERIFY_STEPS; a defect needing a longer trace"
  echo "   will not be reached -- see spec/README.md)"
fi

echo
echo "== broken modules: these must be caught =="
for pair in $BITE; do
  inv=${pair%%:*}; mod=${pair#*:}
  if check "$mod" "$inv" "$BITE_STEPS" "$BITE_SAMPLES"; then
    printf '  NOT CAUGHT  %-26s in %s\n' "$inv" "$mod"; fail=1
  else
    printf '  caught      %-26s in %s\n' "$inv" "$mod"
  fi
done

echo
echo "== scenarios =="
if [ "$MODE" = "verify" ]; then
  echo "  (skipped: quint test is a simulation)"
elif $QUINT test --backend=typescript --main=reverse_sear --max-samples=200 "$SPEC"; then
  :
else
  fail=1
fi

exit $fail
