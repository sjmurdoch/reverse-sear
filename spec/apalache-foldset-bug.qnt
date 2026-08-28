// A minimal reproducer for the Apalache bug that stopped `quint verify` from
// running on steak.qnt.  Kept because the workaround it justifies is spread
// across five actions there and looks arbitrary without it.
//
//   quint verify --main=broken --invariant=inv --max-steps=2 spec/apalache-foldset-bug.qnt
//     -> error: key not found: $C$8
//   quint verify --main=works  --invariant=inv --max-steps=2 spec/apalache-foldset-bug.qnt
//     -> [ok] No violation found
//
// Both modules typecheck, and both run fine under `quint run` and `quint test`
// -- it is only the symbolic backend that falls over.  Apalache 0.56.1, the
// version Quint 0.32 fetches; it prints "Please report an issue" and writes a
// BugReport.md, so it is a genuine internal error rather than a rejection.
//
// The trigger is narrow: a set *constructor* under `contains` (or `in`), inside
// the lambda of a `fold`.  Apalache's FoldSetRule substitutes the lambda's
// parameters with arena cell names and then SetInRule tries to resolve one of
// those cells as a bound name, which is not in the binding:
//
//   java.util.NoSuchElementException: key not found: $C$8
//     at ...bmcmt.Binding.apply(Binding.scala:11)
//     at ...bmcmt.rules.SetInRule.apply(SetInRule.scala:40)
//     at ...bmcmt.rules.FoldSetRule.$anonfun$apply$1(FoldSetRule.scala:99)
//     at ...bmcmt.rules.FoldSetRule.apply(FoldSetRule.scala:84)
//
// It needs all three parts.  Any of these is fine on its own: the same
// membership test under `map`, `filter` or `exists` instead of `fold`; `union`,
// `subseteq` or `size` on a constructor inside a fold; `contains` inside a fold
// against a set held in a *state variable* rather than built on the spot.
//
// The workaround is to bind the set to a `val` inside the action, which becomes
// a LET-IN that survives to the backend.  A module-level `pure val` does *not*
// work -- Quint inlines it, and the constructor is back.

module broken {
  var n: int
  action init = n' = 0
  action step = n' = Set(1, 2).fold(0, (acc, i) => if (Set(1).contains(i)) acc + 1 else acc)
  val inv = n >= 0
}

module works {
  var n: int
  action init = n' = 0
  action step = {
    val s = Set(1)
    n' = Set(1, 2).fold(0, (acc, i) => if (s.contains(i)) acc + 1 else acc)
  }
  val inv = n >= 0
}
