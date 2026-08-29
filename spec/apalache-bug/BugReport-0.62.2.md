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
2026-08-29T04:11:10,697 [main] INFO  a.f.a.t.Tool\$ - # APALACHE version: 0.62.2 | build: f0dec98
2026-08-29T04:11:10,705 [main] INFO  a.f.a.t.t.o.CheckCmd - Tuning: 
2026-08-29T04:11:10,904 [main] INFO  a.f.a.i.p.PassChainExecutor - PASS #0: SanyParser
2026-08-29T04:11:11,109 [main] DEBUG a.f.a.i.p.PassChainExecutor - PASS #0: SanyParser [OK]
2026-08-29T04:11:11,109 [main] INFO  a.f.a.i.p.PassChainExecutor - PASS #1: TypeCheckerSnowcat
2026-08-29T04:11:11,109 [main] INFO  a.f.a.t.p.t.EtcTypeCheckerPassImpl -  > Running Snowcat .::.
2026-08-29T04:11:11,282 [main] INFO  a.f.a.t.p.t.EtcTypeCheckerPassImpl -  > Your types are purrfect!
2026-08-29T04:11:11,283 [main] INFO  a.f.a.t.p.t.EtcTypeCheckerPassImpl -  > All expressions are typed
2026-08-29T04:11:11,283 [main] DEBUG a.f.a.i.p.PassChainExecutor - PASS #1: TypeCheckerSnowcat [OK]
2026-08-29T04:11:11,283 [main] INFO  a.f.a.i.p.PassChainExecutor - PASS #2: ConfigurationPass
2026-08-29T04:11:11,286 [main] INFO  a.f.a.t.p.p.ConfigurationPassImpl -   > Set the initialization predicate to Init
2026-08-29T04:11:11,287 [main] INFO  a.f.a.t.p.p.ConfigurationPassImpl -   > Set the transition predicate to Next
2026-08-29T04:11:11,287 [main] INFO  a.f.a.t.p.p.ConfigurationPassImpl -   > Set an invariant to Inv
2026-08-29T04:11:11,290 [main] DEBUG a.f.a.i.p.PassChainExecutor - PASS #2: ConfigurationPass [OK]
2026-08-29T04:11:11,290 [main] INFO  a.f.a.i.p.PassChainExecutor - PASS #3: DesugarerPass
2026-08-29T04:11:11,290 [main] INFO  a.f.a.t.p.p.DesugarerPassImpl -   > Desugaring...
2026-08-29T04:11:11,294 [main] DEBUG a.f.a.i.p.PassChainExecutor - PASS #3: DesugarerPass [OK]
2026-08-29T04:11:11,295 [main] INFO  a.f.a.i.p.PassChainExecutor - PASS #4: InlinePass
2026-08-29T04:11:11,295 [main] INFO  a.f.a.t.p.p.InlinePassImpl - Leaving only relevant operators: CInitPrimed, Init, InitPrimed, Inv, Next
2026-08-29T04:11:11,325 [main] DEBUG a.f.a.i.p.PassChainExecutor - PASS #4: InlinePass [OK]
2026-08-29T04:11:11,326 [main] INFO  a.f.a.i.p.PassChainExecutor - PASS #5: TemporalPass
2026-08-29T04:11:11,326 [main] INFO  a.f.a.t.p.p.TemporalPassImpl -   > Rewriting temporal operators...
2026-08-29T04:11:11,326 [main] INFO  a.f.a.t.p.p.TemporalPassImpl -   > No temporal property specified, nothing to encode
2026-08-29T04:11:11,326 [main] DEBUG a.f.a.i.p.PassChainExecutor - PASS #5: TemporalPass [OK]
2026-08-29T04:11:11,326 [main] INFO  a.f.a.i.p.PassChainExecutor - PASS #6: InlinePass
2026-08-29T04:11:11,326 [main] INFO  a.f.a.t.p.p.InlinePassImpl - Leaving only relevant operators: CInitPrimed, Init, InitPrimed, Inv, Next
2026-08-29T04:11:11,329 [main] DEBUG a.f.a.i.p.PassChainExecutor - PASS #6: InlinePass [OK]
2026-08-29T04:11:11,330 [main] INFO  a.f.a.i.p.PassChainExecutor - PASS #7: PrimingPass
2026-08-29T04:11:11,332 [main] INFO  a.f.a.t.p.a.PrimingPassImpl -   > Introducing InitPrimed for Init'
2026-08-29T04:11:11,505 [main] DEBUG a.f.a.i.p.PassChainExecutor - PASS #7: PrimingPass [OK]
2026-08-29T04:11:11,505 [main] INFO  a.f.a.i.p.PassChainExecutor - PASS #8: VCGen
2026-08-29T04:11:11,506 [main] INFO  a.f.a.t.b.p.VCGenPassImpl -   > Producing verification conditions from the invariant Inv
2026-08-29T04:11:11,517 [main] INFO  a.f.a.t.b.VCGenerator -   > VCGen produced 1 verification condition(s)
2026-08-29T04:11:11,525 [main] DEBUG a.f.a.i.p.PassChainExecutor - PASS #8: VCGen [OK]
2026-08-29T04:11:11,525 [main] INFO  a.f.a.i.p.PassChainExecutor - PASS #9: PreprocessingPass
2026-08-29T04:11:11,525 [main] INFO  a.f.a.t.p.p.PreproPassImpl -   > Before preprocessing: unique renaming
2026-08-29T04:11:11,532 [main] INFO  a.f.a.t.p.p.PreproPassImpl -  > Applying standard transformations:
2026-08-29T04:11:11,532 [main] INFO  a.f.a.t.p.p.PreproPassImpl -   > PrimePropagation
2026-08-29T04:11:11,533 [main] INFO  a.f.a.t.p.p.PreproPassImpl -   > Desugarer
2026-08-29T04:11:11,534 [main] INFO  a.f.a.t.p.p.PreproPassImpl -   > UniqueRenamer
2026-08-29T04:11:11,535 [main] INFO  a.f.a.t.p.p.PreproPassImpl -   > Normalizer
2026-08-29T04:11:11,538 [main] INFO  a.f.a.t.p.p.PreproPassImpl -   > SetMembershipSimplifier
2026-08-29T04:11:11,540 [main] INFO  a.f.a.t.p.p.PreproPassImpl -   > Keramelizer
2026-08-29T04:11:11,541 [main] INFO  a.f.a.t.p.p.PreproPassImpl -   > After preprocessing: UniqueRenamer
2026-08-29T04:11:11,543 [main] DEBUG a.f.a.i.p.PassChainExecutor - PASS #9: PreprocessingPass [OK]
2026-08-29T04:11:11,543 [main] INFO  a.f.a.i.p.PassChainExecutor - PASS #10: TransitionFinderPass
2026-08-29T04:11:11,558 [main] INFO  a.f.a.t.p.a.TransitionPassImpl -   > Found 1 initializing transitions
2026-08-29T04:11:11,558 [main] INFO  a.f.a.t.p.a.TransitionPassImpl -   > Found 1 transitions
2026-08-29T04:11:11,559 [main] INFO  a.f.a.t.p.a.TransitionPassImpl -   > No constant initializer
2026-08-29T04:11:11,559 [main] INFO  a.f.a.t.p.a.TransitionPassImpl -   > Applying unique renaming
2026-08-29T04:11:11,561 [main] DEBUG a.f.a.i.p.PassChainExecutor - PASS #10: TransitionFinderPass [OK]
2026-08-29T04:11:11,561 [main] INFO  a.f.a.i.p.PassChainExecutor - PASS #11: OptimizationPass
2026-08-29T04:11:11,565 [main] INFO  a.f.a.t.p.p.OptPassImpl -  > Applying optimizations:
2026-08-29T04:11:11,565 [main] INFO  a.f.a.t.p.p.OptPassImpl -   > ConstSimplifier
2026-08-29T04:11:11,566 [main] INFO  a.f.a.t.p.p.OptPassImpl -   > ExprOptimizer
2026-08-29T04:11:11,567 [main] INFO  a.f.a.t.p.p.OptPassImpl -   > SetMembershipSimplifier
2026-08-29T04:11:11,568 [main] INFO  a.f.a.t.p.p.OptPassImpl -   > ConstSimplifier
2026-08-29T04:11:11,568 [main] DEBUG a.f.a.i.p.PassChainExecutor - PASS #11: OptimizationPass [OK]
2026-08-29T04:11:11,569 [main] INFO  a.f.a.i.p.PassChainExecutor - PASS #12: AnalysisPass
2026-08-29T04:11:11,570 [main] INFO  a.f.a.t.b.p.AnalysisPassImpl -  > Marking skolemizable existentials and sets to be expanded...
2026-08-29T04:11:11,571 [main] INFO  a.f.a.t.b.p.AnalysisPassImpl -   > Skolemization
2026-08-29T04:11:11,571 [main] INFO  a.f.a.t.b.p.AnalysisPassImpl -   > Expansion
2026-08-29T04:11:11,572 [main] INFO  a.f.a.t.b.p.AnalysisPassImpl -   > Remove unused let-in defs
2026-08-29T04:11:11,574 [main] INFO  a.f.a.t.b.p.AnalysisPassImpl -  > Running analyzers...
2026-08-29T04:11:11,575 [main] INFO  a.f.a.t.b.p.AnalysisPassImpl -   > Introduced expression grades
2026-08-29T04:11:11,575 [main] DEBUG a.f.a.i.p.PassChainExecutor - PASS #12: AnalysisPass [OK]
2026-08-29T04:11:11,575 [main] INFO  a.f.a.i.p.PassChainExecutor - PASS #13: BoundedChecker
2026-08-29T04:11:11,588 [main] DEBUG a.f.a.t.b.s.Z3SolverContext - Creating Z3 solver context 0
2026-08-29T04:11:12,055 [main] DEBUG a.f.a.t.b.t.TransitionExecutorImpl - Step #0, transition #0
2026-08-29T04:11:12,055 [main] DEBUG a.f.a.t.b.t.TransitionExecutorImpl - Translating to SMT
2026-08-29T04:11:12,094 [main] DEBUG a.f.a.t.b.SeqModelChecker - Step 0: Transition #0. Is it enabled?
2026-08-29T04:11:12,096 [main] DEBUG a.f.a.t.b.SeqModelChecker - Step 0: Transition #0 is enabled
2026-08-29T04:11:12,096 [main] INFO  a.f.a.t.b.SeqModelChecker - State 0: Checking 1 state invariants
2026-08-29T04:11:12,098 [main] DEBUG a.f.a.t.b.SeqModelChecker - State 0: Checking state invariant 0
2026-08-29T04:11:12,102 [main] INFO  a.f.a.t.b.SeqModelChecker - State 0: state invariant 0 holds.
2026-08-29T04:11:12,105 [main] INFO  a.f.a.t.b.t.TransitionExecutorImpl - Step 0: picking a transition out of 1 transition(s)
2026-08-29T04:11:12,113 [main] DEBUG a.f.a.t.b.t.TransitionExecutorImpl - Step #1, transition #0
2026-08-29T04:11:12,114 [main] DEBUG a.f.a.t.b.t.TransitionExecutorImpl - Translating to SMT
2026-08-29T04:11:12,128 [main] ERROR a.f.a.t.Tool\$ - Unhandled exception
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
	at at.forsyte.apalache.tla.bmcmt.rules.FoldSetRule.\$anonfun\$apply\$1(FoldSetRule.scala:111)
	at scala.collection.ArrayOps\$.foldLeft\$extension(ArrayOps.scala:784)
	at at.forsyte.apalache.tla.bmcmt.rules.FoldSetRule.apply(FoldSetRule.scala:96)
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
	at at.forsyte.apalache.tla.bmcmt.passes.BoundedCheckerPassImpl.runIncrementalChecker(BoundedCheckerPassImpl.scala:177)
	at at.forsyte.apalache.tla.bmcmt.passes.BoundedCheckerPassImpl.execute(BoundedCheckerPassImpl.scala:129)
	at at.forsyte.apalache.infra.passes.PassChainExecutor.exec(PassChainExecutor.scala:70)
	at at.forsyte.apalache.infra.passes.PassChainExecutor.\$anonfun\$runPassOnModule\$3(PassChainExecutor.scala:59)
	at scala.util.Either.flatMap(Either.scala:360)
	at at.forsyte.apalache.infra.passes.PassChainExecutor.\$anonfun\$runPassOnModule\$1(PassChainExecutor.scala:57)
	at scala.collection.LinearSeqOps.foldLeft(LinearSeq.scala:183)
	at scala.collection.LinearSeqOps.foldLeft\$(LinearSeq.scala:179)
	at scala.collection.immutable.List.foldLeft(List.scala:79)
	at at.forsyte.apalache.infra.passes.PassChainExecutor.runOnPasses(PassChainExecutor.scala:50)
	at at.forsyte.apalache.infra.passes.PassChainExecutor.run(PassChainExecutor.scala:41)
	at at.forsyte.apalache.tla.tooling.opt.CheckCmd.\$anonfun\$run\$1(CheckCmd.scala:195)
	at at.forsyte.apalache.tla.tooling.opt.ApalacheCommand.runWithOptions(ApalacheCommand.scala:190)
	at at.forsyte.apalache.tla.tooling.opt.CheckCmd.run(CheckCmd.scala:191)
	at at.forsyte.apalache.tla.Tool\$.runCommand(Tool.scala:169)
	at at.forsyte.apalache.tla.Tool\$.runInScope(Tool.scala:148)
	at at.forsyte.apalache.tla.Tool\$.\$anonfun\$run\$1(Tool.scala:102)
	at scala.runtime.java8.JFunction0\$mcI\$sp.apply(JFunction0\$mcI\$sp.scala:17)
	at at.forsyte.apalache.io.OutputManager\$.\$anonfun\$withState\$1(OutputManager.scala:280)
	at java.base/jdk.internal.vm.ScopedValueContainer.runWithoutScope(ScopedValueContainer.java:112)
	at java.base/jdk.internal.vm.ScopedValueContainer.run(ScopedValueContainer.java:98)
	at java.base/java.lang.ScopedValue\$Carrier.run(ScopedValue.java:510)
	at at.forsyte.apalache.io.OutputManager\$.at\$forsyte\$apalache\$io\$OutputManager\$\$withState(OutputManager.scala:280)
	at at.forsyte.apalache.io.OutputManager\$Scope.run(OutputManager.scala:253)
	at at.forsyte.apalache.io.OutputManager\$.withScope(OutputManager.scala:259)
	at at.forsyte.apalache.tla.Tool\$.run(Tool.scala:102)
	at at.forsyte.apalache.tla.Tool\$.main(Tool.scala:38)
	at at.forsyte.apalache.tla.Tool.main(Tool.scala)
```
</details>

## System information

- Apalache version: `0.62.2 build f0dec98`
- OS: `Linux`
- JDK version: `21.0.10`

## Triage checklist (for maintainers)

<!-- This section is for maintainers -->

- [ ] Reproduce the bug on the main development branch.
- [ ] Add the issue to the apalache GitHub project.
- [ ] If the bug is high impact, ensure someone available is assigned to fix it.

