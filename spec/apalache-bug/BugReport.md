<!-- Thank you for filing a report! Please ensure you have filled out all -->
<!-- sections, as it help us to address the problem effectively. -->

<!-- NOTE: Please try to ensure the bug can be produced on the latest release of -->
<!-- Apalache. See https://github.com/apalache-mc/apalache/releases -->

## Impact

<!-- Whether this is blocking your work or whether you are able to proceed using -->
<!-- workarounds or alternative approaches. -->

## Input specification

```
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
````

## The command line parameters used to run the tool

```
--init=Init --next=Next --inv=Inv --length=2
```

## Expected behavior

<!-- What did you expect to see? -->

## Log files

<details>

```
2026-08-28T21:46:34,357 [main] INFO  a.f.a.t.Tool\$ - # APALACHE version: 0.56.1 | build: 70cdaf4
2026-08-28T21:46:34,392 [main] INFO  a.f.a.t.t.o.CheckCmd - Tuning: search.outputTraces=false
2026-08-28T21:46:34,700 [main] INFO  a.f.a.i.p.PassChainExecutor - PASS #0: SanyParser
2026-08-28T21:46:35,087 [main] DEBUG a.f.a.i.p.PassChainExecutor - PASS #0: SanyParser [OK]
2026-08-28T21:46:35,089 [main] INFO  a.f.a.i.p.PassChainExecutor - PASS #1: TypeCheckerSnowcat
2026-08-28T21:46:35,089 [main] INFO  a.f.a.t.p.t.EtcTypeCheckerPassImpl -  > Running Snowcat .::.
2026-08-28T21:46:35,396 [main] INFO  a.f.a.t.p.t.EtcTypeCheckerPassImpl -  > Your types are purrfect!
2026-08-28T21:46:35,396 [main] INFO  a.f.a.t.p.t.EtcTypeCheckerPassImpl -  > All expressions are typed
2026-08-28T21:46:35,397 [main] DEBUG a.f.a.i.p.PassChainExecutor - PASS #1: TypeCheckerSnowcat [OK]
2026-08-28T21:46:35,398 [main] INFO  a.f.a.i.p.PassChainExecutor - PASS #2: ConfigurationPass
2026-08-28T21:46:35,401 [main] INFO  a.f.a.t.p.p.ConfigurationPassImpl -   > Set the initialization predicate to Init
2026-08-28T21:46:35,401 [main] INFO  a.f.a.t.p.p.ConfigurationPassImpl -   > Set the transition predicate to Next
2026-08-28T21:46:35,402 [main] INFO  a.f.a.t.p.p.ConfigurationPassImpl -   > Set an invariant to Inv
2026-08-28T21:46:35,405 [main] DEBUG a.f.a.i.p.PassChainExecutor - PASS #2: ConfigurationPass [OK]
2026-08-28T21:46:35,406 [main] INFO  a.f.a.i.p.PassChainExecutor - PASS #3: DesugarerPass
2026-08-28T21:46:35,406 [main] INFO  a.f.a.t.p.p.DesugarerPassImpl -   > Desugaring...
2026-08-28T21:46:35,410 [main] DEBUG a.f.a.i.p.PassChainExecutor - PASS #3: DesugarerPass [OK]
2026-08-28T21:46:35,411 [main] INFO  a.f.a.i.p.PassChainExecutor - PASS #4: InlinePass
2026-08-28T21:46:35,412 [main] INFO  a.f.a.t.p.p.InlinePassImpl - Leaving only relevant operators: CInitPrimed, Init, InitPrimed, Inv, Next
2026-08-28T21:46:35,452 [main] DEBUG a.f.a.i.p.PassChainExecutor - PASS #4: InlinePass [OK]
2026-08-28T21:46:35,452 [main] INFO  a.f.a.i.p.PassChainExecutor - PASS #5: TemporalPass
2026-08-28T21:46:35,452 [main] INFO  a.f.a.t.p.p.TemporalPassImpl -   > Rewriting temporal operators...
2026-08-28T21:46:35,452 [main] INFO  a.f.a.t.p.p.TemporalPassImpl -   > No temporal property specified, nothing to encode
2026-08-28T21:46:35,452 [main] DEBUG a.f.a.i.p.PassChainExecutor - PASS #5: TemporalPass [OK]
2026-08-28T21:46:35,453 [main] INFO  a.f.a.i.p.PassChainExecutor - PASS #6: InlinePass
2026-08-28T21:46:35,453 [main] INFO  a.f.a.t.p.p.InlinePassImpl - Leaving only relevant operators: CInitPrimed, Init, InitPrimed, Inv, Next
2026-08-28T21:46:35,456 [main] DEBUG a.f.a.i.p.PassChainExecutor - PASS #6: InlinePass [OK]
2026-08-28T21:46:35,457 [main] INFO  a.f.a.i.p.PassChainExecutor - PASS #7: PrimingPass
2026-08-28T21:46:35,460 [main] INFO  a.f.a.t.p.a.PrimingPassImpl -   > Introducing InitPrimed for Init'
2026-08-28T21:46:35,719 [main] DEBUG a.f.a.i.p.PassChainExecutor - PASS #7: PrimingPass [OK]
2026-08-28T21:46:35,719 [main] INFO  a.f.a.i.p.PassChainExecutor - PASS #8: VCGen
2026-08-28T21:46:35,719 [main] INFO  a.f.a.t.b.p.VCGenPassImpl -   > Producing verification conditions from the invariant Inv
2026-08-28T21:46:35,725 [main] INFO  a.f.a.t.b.VCGenerator -   > VCGen produced 1 verification condition(s)
2026-08-28T21:46:35,731 [main] DEBUG a.f.a.i.p.PassChainExecutor - PASS #8: VCGen [OK]
2026-08-28T21:46:35,732 [main] INFO  a.f.a.i.p.PassChainExecutor - PASS #9: PreprocessingPass
2026-08-28T21:46:35,732 [main] INFO  a.f.a.t.p.p.PreproPassImpl -   > Before preprocessing: unique renaming
2026-08-28T21:46:35,740 [main] INFO  a.f.a.t.p.p.PreproPassImpl -  > Applying standard transformations:
2026-08-28T21:46:35,740 [main] INFO  a.f.a.t.p.p.PreproPassImpl -   > PrimePropagation
2026-08-28T21:46:35,742 [main] INFO  a.f.a.t.p.p.PreproPassImpl -   > Desugarer
2026-08-28T21:46:35,743 [main] INFO  a.f.a.t.p.p.PreproPassImpl -   > UniqueRenamer
2026-08-28T21:46:35,745 [main] INFO  a.f.a.t.p.p.PreproPassImpl -   > Normalizer
2026-08-28T21:46:35,748 [main] INFO  a.f.a.t.p.p.PreproPassImpl -   > Keramelizer
2026-08-28T21:46:35,752 [main] INFO  a.f.a.t.p.p.PreproPassImpl -   > After preprocessing: UniqueRenamer
2026-08-28T21:46:35,755 [main] DEBUG a.f.a.i.p.PassChainExecutor - PASS #9: PreprocessingPass [OK]
2026-08-28T21:46:35,756 [main] INFO  a.f.a.i.p.PassChainExecutor - PASS #10: TransitionFinderPass
2026-08-28T21:46:35,805 [main] INFO  a.f.a.t.p.a.TransitionPassImpl -   > Found 1 initializing transitions
2026-08-28T21:46:35,808 [main] INFO  a.f.a.t.p.a.TransitionPassImpl -   > Found 1 transitions
2026-08-28T21:46:35,809 [main] INFO  a.f.a.t.p.a.TransitionPassImpl -   > No constant initializer
2026-08-28T21:46:35,810 [main] INFO  a.f.a.t.p.a.TransitionPassImpl -   > Applying unique renaming
2026-08-28T21:46:35,816 [main] DEBUG a.f.a.i.p.PassChainExecutor - PASS #10: TransitionFinderPass [OK]
2026-08-28T21:46:35,817 [main] INFO  a.f.a.i.p.PassChainExecutor - PASS #11: OptimizationPass
2026-08-28T21:46:35,824 [main] INFO  a.f.a.t.p.p.OptPassImpl -  > Applying optimizations:
2026-08-28T21:46:35,825 [main] INFO  a.f.a.t.p.p.OptPassImpl -   > ConstSimplifier
2026-08-28T21:46:35,827 [main] INFO  a.f.a.t.p.p.OptPassImpl -   > ExprOptimizer
2026-08-28T21:46:35,828 [main] INFO  a.f.a.t.p.p.OptPassImpl -   > SetMembershipSimplifier
2026-08-28T21:46:35,828 [main] INFO  a.f.a.t.p.p.OptPassImpl -   > ConstSimplifier
2026-08-28T21:46:35,829 [main] DEBUG a.f.a.i.p.PassChainExecutor - PASS #11: OptimizationPass [OK]
2026-08-28T21:46:35,829 [main] INFO  a.f.a.i.p.PassChainExecutor - PASS #12: AnalysisPass
2026-08-28T21:46:35,832 [main] INFO  a.f.a.t.b.p.AnalysisPassImpl -  > Marking skolemizable existentials and sets to be expanded...
2026-08-28T21:46:35,833 [main] INFO  a.f.a.t.b.p.AnalysisPassImpl -   > Skolemization
2026-08-28T21:46:35,833 [main] INFO  a.f.a.t.b.p.AnalysisPassImpl -   > Expansion
2026-08-28T21:46:35,834 [main] INFO  a.f.a.t.b.p.AnalysisPassImpl -   > Remove unused let-in defs
2026-08-28T21:46:35,837 [main] INFO  a.f.a.t.b.p.AnalysisPassImpl -  > Running analyzers...
2026-08-28T21:46:35,839 [main] INFO  a.f.a.t.b.p.AnalysisPassImpl -   > Introduced expression grades
2026-08-28T21:46:35,839 [main] DEBUG a.f.a.i.p.PassChainExecutor - PASS #12: AnalysisPass [OK]
2026-08-28T21:46:35,839 [main] INFO  a.f.a.i.p.PassChainExecutor - PASS #13: BoundedChecker
2026-08-28T21:46:35,862 [main] DEBUG a.f.a.t.b.s.Z3SolverContext - Creating Z3 solver context 0
2026-08-28T21:46:36,361 [main] DEBUG a.f.a.t.b.t.TransitionExecutorImpl - Step #0, transition #0
2026-08-28T21:46:36,362 [main] DEBUG a.f.a.t.b.t.TransitionExecutorImpl - Translating to SMT
2026-08-28T21:46:36,433 [main] DEBUG a.f.a.t.b.SeqModelChecker - Step 0: Transition #0. Is it enabled?
2026-08-28T21:46:36,437 [main] DEBUG a.f.a.t.b.SeqModelChecker - Step 0: Transition #0 is enabled
2026-08-28T21:46:36,438 [main] INFO  a.f.a.t.b.SeqModelChecker - State 0: Checking 1 state invariants
2026-08-28T21:46:36,439 [main] DEBUG a.f.a.t.b.SeqModelChecker - State 0: Checking state invariant 0
2026-08-28T21:46:36,441 [main] INFO  a.f.a.t.b.SeqModelChecker - State 0: state invariant 0 holds.
2026-08-28T21:46:36,447 [main] INFO  a.f.a.t.b.t.TransitionExecutorImpl - Step 0: picking a transition out of 1 transition(s)
2026-08-28T21:46:36,459 [main] DEBUG a.f.a.t.b.t.TransitionExecutorImpl - Step #1, transition #0
2026-08-28T21:46:36,459 [main] DEBUG a.f.a.t.b.t.TransitionExecutorImpl - Translating to SMT
2026-08-28T21:46:36,484 [main] ERROR a.f.a.t.Tool\$ - Unhandled exception
java.util.NoSuchElementException: key not found: \$C\$8
	at scala.collection.immutable.BitmapIndexedMapNode.apply(HashMap.scala:674)
	at scala.collection.immutable.HashMap.apply(HashMap.scala:132)
	at at.forsyte.apalache.tla.bmcmt.Binding.apply(Binding.scala:11)
	at at.forsyte.apalache.tla.bmcmt.rules.SetInRule.apply(SetInRule.scala:40)
	at at.forsyte.apalache.tla.bmcmt.SymbStateRewriterImpl.rewriteOnce(SymbStateRewriterImpl.scala:357)
	at at.forsyte.apalache.tla.bmcmt.SymbStateRewriterImpl.doRecursive\$1(SymbStateRewriterImpl.scala:390)
	at at.forsyte.apalache.tla.bmcmt.SymbStateRewriterImpl.rewriteUntilDone(SymbStateRewriterImpl.scala:424)
	at at.forsyte.apalache.tla.bmcmt.rules.IfThenElseRule.apply(IfThenElseRule.scala:31)
	at at.forsyte.apalache.tla.bmcmt.SymbStateRewriterImpl.rewriteOnce(SymbStateRewriterImpl.scala:357)
	at at.forsyte.apalache.tla.bmcmt.SymbStateRewriterImpl.doRecursive\$1(SymbStateRewriterImpl.scala:390)
	at at.forsyte.apalache.tla.bmcmt.SymbStateRewriterImpl.rewriteUntilDone(SymbStateRewriterImpl.scala:424)
	at at.forsyte.apalache.tla.bmcmt.rules.FoldSetRule.\$anonfun\$apply\$1(FoldSetRule.scala:99)
	at scala.collection.ArrayOps\$.foldLeft\$extension(ArrayOps.scala:784)
	at at.forsyte.apalache.tla.bmcmt.rules.FoldSetRule.apply(FoldSetRule.scala:84)
	at at.forsyte.apalache.tla.bmcmt.SymbStateRewriterImpl.rewriteOnce(SymbStateRewriterImpl.scala:357)
	at at.forsyte.apalache.tla.bmcmt.SymbStateRewriterImpl.doRecursive\$1(SymbStateRewriterImpl.scala:390)
	at at.forsyte.apalache.tla.bmcmt.SymbStateRewriterImpl.rewriteUntilDone(SymbStateRewriterImpl.scala:424)
	at at.forsyte.apalache.tla.bmcmt.rules.AssignmentRule.apply(AssignmentRule.scala:37)
	at at.forsyte.apalache.tla.bmcmt.SymbStateRewriterImpl.rewriteOnce(SymbStateRewriterImpl.scala:357)
	at at.forsyte.apalache.tla.bmcmt.SymbStateRewriterImpl.doRecursive\$1(SymbStateRewriterImpl.scala:390)
	at at.forsyte.apalache.tla.bmcmt.SymbStateRewriterImpl.rewriteUntilDone(SymbStateRewriterImpl.scala:424)
	at at.forsyte.apalache.tla.bmcmt.trex.TransitionExecutorImpl.prepareTransition(TransitionExecutorImpl.scala:107)
	at at.forsyte.apalache.tla.bmcmt.trex.FilteredTransitionExecutor.prepareTransition(FilteredTransitionExecutor.scala:48)
	at at.forsyte.apalache.tla.bmcmt.trex.ConstrainedTransitionExecutor.prepareTransition(ConstrainedTransitionExecutor.scala:98)
	at at.forsyte.apalache.tla.bmcmt.SeqModelChecker.\$anonfun\$prepareTransitionsAndCheckInvariants\$5(SeqModelChecker.scala:219)
	at scala.runtime.java8.JFunction1\$mcVI\$sp.apply(JFunction1\$mcVI\$sp.scala:18)
	at scala.collection.immutable.Range.foreach(Range.scala:256)
	at at.forsyte.apalache.tla.bmcmt.SeqModelChecker.prepareTransitionsAndCheckInvariants(SeqModelChecker.scala:213)
	at at.forsyte.apalache.tla.bmcmt.SeqModelChecker.makeStep(SeqModelChecker.scala:125)
	at at.forsyte.apalache.tla.bmcmt.SeqModelChecker.run(SeqModelChecker.scala:67)
	at at.forsyte.apalache.tla.bmcmt.passes.BoundedCheckerPassImpl.runIncrementalChecker(BoundedCheckerPassImpl.scala:164)
	at at.forsyte.apalache.tla.bmcmt.passes.BoundedCheckerPassImpl.execute(BoundedCheckerPassImpl.scala:116)
	at at.forsyte.apalache.infra.passes.PassChainExecutor.exec(PassChainExecutor.scala:71)
	at at.forsyte.apalache.infra.passes.PassChainExecutor.\$anonfun\$runPassOnModule\$3(PassChainExecutor.scala:60)
	at scala.util.Either.flatMap(Either.scala:360)
	at at.forsyte.apalache.infra.passes.PassChainExecutor.\$anonfun\$runPassOnModule\$1(PassChainExecutor.scala:58)
	at scala.collection.LinearSeqOps.foldLeft(LinearSeq.scala:183)
	at scala.collection.LinearSeqOps.foldLeft\$(LinearSeq.scala:179)
	at scala.collection.immutable.List.foldLeft(List.scala:79)
	at at.forsyte.apalache.infra.passes.PassChainExecutor.runOnPasses(PassChainExecutor.scala:51)
	at at.forsyte.apalache.infra.passes.PassChainExecutor.run(PassChainExecutor.scala:42)
	at at.forsyte.apalache.tla.tooling.opt.CheckCmd.run(CheckCmd.scala:137)
	at at.forsyte.apalache.tla.Tool\$.runCommand(Tool.scala:139)
	at at.forsyte.apalache.tla.Tool\$.run(Tool.scala:119)
	at at.forsyte.apalache.tla.Tool\$.main(Tool.scala:40)
	at at.forsyte.apalache.tla.Tool.main(Tool.scala)
```
</details>

## System information

- Apalache version: `0.56.1 build 70cdaf4`
- OS: `Linux`
- JDK version: `21.0.10`

## Triage checklist (for maintainers)

<!-- This section is for maintainers -->

- [ ] Reproduce the bug on the main development branch.
- [ ] Add the issue to the apalache GitHub project.
- [ ] If the bug is high impact, ensure someone available is assigned to fix it.

