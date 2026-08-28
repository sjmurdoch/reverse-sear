<!--
Ready to submit at https://github.com/apalache-mc/apalache/issues/new?template=bug_report.md
Everything below the title line is the issue body. It follows the template
Apalache itself generates in BugReport.md, which is in this directory.

Nothing here has been submitted. Found while model-checking spec/steak.qnt;
see spec/README.md for how it surfaced and what it cost.
-->

# [BUG] Unhandled NoSuchElementException in SetInRule when a fold's lambda tests membership in a singleton set literal

## Impact

Not blocking: there is a one-line workaround (below). But the failure is an
unhandled Scala exception rather than a diagnostic, and the trigger is very hard
to see from the spec — the same specification runs fine under Quint's simulator,
and the crash names an arena cell (`$C$8`) that does not appear anywhere in the
input. In a Quint specification the offending set literal is usually at an
operator's *call site*, while the `fold` that makes it fatal is inside the
operator, so the two halves of the trigger can be in different files.

## Input specification

Thirteen lines, no Quint involved:

```tla
-------------------------- MODULE FoldSingletonIn --------------------------
EXTENDS Integers, Apalache

VARIABLE
  \* @type: Int;
  n

\* @type: (Int, Int) => Int;
Count(acc, i) == IF i \in {1} THEN acc + 1 ELSE acc

Init == n = 0
Next == n' = ApaFoldSet(Count, 0, {1, 2})
Inv  == n >= 0
=============================================================================
```

Changing `{1}` to `{1, 3}` — a single character — makes it check cleanly. That
is the whole difference between a crash and `The outcome is: NoError`.

## The command line parameters used to run the tool

```
apalache-mc check --init=Init --next=Next --inv=Inv --length=2 FoldSingletonIn.tla
```

## Expected behavior

The invariant holds, so I expected `The outcome is: NoError`, as I get from the
`{1, 3}` variant. Failing that, a diagnostic naming the unsupported construct.

## Actual behavior

```
java.util.NoSuchElementException: key not found: $C$8
  at at.forsyte.apalache.tla.bmcmt.Binding.apply(Binding.scala:11)
  at at.forsyte.apalache.tla.bmcmt.rules.SetInRule.apply(SetInRule.scala:40)
  at at.forsyte.apalache.tla.bmcmt.rules.IfThenElseRule.apply(IfThenElseRule.scala:31)
  at at.forsyte.apalache.tla.bmcmt.rules.FoldSetRule.$anonfun$apply$1(FoldSetRule.scala:99)
  at at.forsyte.apalache.tla.bmcmt.rules.FoldSetRule.apply(FoldSetRule.scala:84)
  ...
```

`EXITCODE: ERROR (255)`. The full log is under "Log files" below.

## Likely cause

I have not built Apalache, so this is read off the stack trace and the sources
on `main` rather than confirmed in a debugger.

`FoldSetRule` inlines the fold's operator by substituting its formal parameters
with **arena cell names**, then rewriting the result:

```scala
val appEx = tla.appOp(tla.name(opDecl.name, opT), oldResultCell.toBuilder, currentCell.toBuilder)
val seededScope: Inliner.Scope = SortedMap(opDecl.name -> opDecl)
val inlinedEx = inliner.transform(seededScope)(appEx)
```

So by the time the body is rewritten, `i` has become `NameEx("$C$8")` — a cell,
not a bound variable.

`SetInRule` has a fast path for membership in a **singleton** enumerated set,
which treats `x \in {y}` as `x = y` and resolves the left-hand side straight out
of the binding instead of rewriting it:

```scala
case OperEx(op, NameEx(name), OperEx(TlaSetOper.enumSet, rhs))
    if op == TlaSetOper.in || op == ApalacheInternalOper.selectInSet =>
  val nextState = rewriter.rewriteUntilDone(state.setRex(rhs))
  val rhsCell = nextState.arena.findCellByNameEx(nextState.ex)
  val lhsCell = state.binding(name)     // <- throws: "$C$8" is a cell, not a binding
```

A cell name is never in the binding, so the lookup throws. The general
membership case below it rewrites both operands and would handle a cell name
correctly, which matches what I observe: every non-singleton right-hand side
works.

A fix might be to have that branch resolve the left-hand side the way the
general branch does, or to fall through to it when `name` is a cell name.

## What does and does not trigger it

All of these were run against 0.56.1. The trigger needs three things at once: a
lambda parameter of a **fold** on the left, `\in` (or `contains`), and a
**singleton set literal** on the right.

| variation | result |
|---|---|
| `i \in {1}` inside `ApaFoldSet` | **crash** |
| `i \in {1}` inside `ApaFoldSeqLeft` (Quint `foldl`) | **crash** |
| `acc \in {0}` — the accumulator rather than the element | **crash** |
| `i \in {1, 3}` — two elements | ok |
| `i \in {1, 3, 5}` — three elements | ok |
| `i \in S` where `S` is a state variable | ok |
| `i \in {1}` under `map` / `filter` / `exists` instead of a fold | ok |
| `Cardinality({i, 9})`, `{i} \union {9}`, `{i} \subseteq {1, 2}` inside a fold | ok |
| `i \in {1}` where the singleton is bound by a `LET` outside the fold | ok |

The last row is the workaround: binding the set before the fold keeps the
right-hand side from being a syntactic `enumSet` at the point the rule matches.

## Workaround

Bind the singleton to a `LET` (in Quint, a `val` inside the action — a
module-level `pure val` does **not** work, because Quint inlines it and the
literal comes back):

```quint
// crashes
action step = n' = Set(1, 2).fold(0, (acc, i) => if (Set(1).contains(i)) acc + 1 else acc)

// checks
action step = {
  val s = Set(1)
  n' = Set(1, 2).fold(0, (acc, i) => if (s.contains(i)) acc + 1 else acc)
}
```

## How it turned up

In a Quint specification of a scheduling state machine, where a `fold` over a
map of records asks `scope.contains(i)` and callers passed `Set(theOneId)` at
the call site. Four actions crashed and three did not, which looked arbitrary
until it came down to whether the caller happened to bind the set to a `val`
first. `quint run` and `quint test` were unaffected throughout, so it only
showed up when moving from simulation to `quint verify`.

A Quint-level reproducer, if it is useful — modules `broken` and `works` differ
by one binding, and both typecheck and both simulate — is in
`spec/apalache-foldset-bug.qnt` of <https://github.com/sjmurdoch/reverse-sear>.

## System information

- Apalache version: `0.56.1`, build `70cdaf4` (as fetched by Quint 0.32.0)
- OS: Linux (x86-64, container)
- JDK: OpenJDK 21.0.10
- Reached both through `quint verify` and by running `apalache-mc` directly on
  the TLA+ above.

## Minor, while you are in here

The `BugReport.md` that Apalache generates is not quite valid Markdown:

- Dollar signs in the log are backslash-escaped, so the trace reads `\$C\$8` and
  class names read `a.f.a.t.Tool\$`. Thirty occurrences in a 187-line report.
- The "Input specification" block opens with ``` and closes with ````, so
  everything after it renders inside the code block.

Both are visible in the attached `BugReport.md`, which is committed verbatim.
