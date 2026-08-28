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
