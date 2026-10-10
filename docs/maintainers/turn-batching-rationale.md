# Independent calls go in the same turn — rationale

This is maintainer-only rationale behind `prompts/collaboration-workflow/turn-batching.md`: the
measurements, history and argument that justify the procedure's boundaries, the guard's scope and the
measurement. It is never read during a run. Every trigger, action, criterion, threshold and guard
blind spot an agent obeys stays in the procedure document, so a change to this file changes no rule.
The measurements, the rejected mechanisms and the history moved here from the procedure in
joshuafolkken/kit#3177, and the text already here was brought to English at the same time.

## Why the number of turns is the cost

**The cost is in the round trips, not in the amount of work.** Measured on the joshuafolkken/kit#1295
run (1,471 seconds / 153 turns):

| Kind                                                                 | Count | Total tool time |
| -------------------------------------------------------------------- | ----: | --------------: |
| `Edit`                                                               |    34 |            48 s |
| Small read-only `Bash` (`grep` 12 / `sed` 11 / `cat` 4 and the rest) |    32 |             6 s |

**The tools themselves ran for about 54 seconds in total.** The same 66 round trips cost
66 × 9–13 seconds ≈ 600–850 seconds of wall clock, an order of magnitude more. The wall clock per turn
sits in a narrow 9–13 second band, so **the number of turns sets the floor of a run.**

That is why the children of epic #1262 (#1256–#1260) cut the gate from 133 seconds to a 5-second
median and the whole run shrank by only 5%: what they cut was not what set the wall clock.

The largest single item measured was the 34 `Edit` calls because that was where the rule was kept
least — which is why the procedure says `Edit` is covered exactly as reads are.

## Rejected mechanisms

- **A PreToolUse hook that "looks at one call and decides whether it is independent".** Not
  adoptable. **The independence of a call cannot be observed from that one call.** The hook sees only
  the call about to run; whether it depends on the previous result is not in its input. It would stop
  legitimate dependent sequences (`grep` → `sed -n`, the read before an `Edit`), and the side it stops
  could not explain why. It is the same shape `output-bounds.md` rejected as "telling by shape misses
  on real data".

  **What was rejected is that way of judging, not the `PreToolUse` mechanism itself.**
  joshuafolkken/kit#1390 implemented `pnpm josh batch:guard` **as exactly a `PreToolUse` hook**, shipped
  in `.claude/settings.json`. It judges from **closed history** — the sequence of turns whose results
  have come back — rather than from the one call in hand. Two single-call turns in a row are invisible
  from one call and visible from the history. Each concern above is avoided by design: dependence is
  read through **shared targets**, so `grep` → `sed -n` is not stopped; **writes are refused on exactly
  the same criterion as reads** (joshuafolkken/kit#1762); and **the refusal is withdrawn when the call in
  hand shares a target with the preceding run** (write-to-write included). The limitation that
  remained open at the time is joshuafolkken/kit#1509, described under "How the guard's scope grew".

- **Assume a tool that bundles several edits into one call.** Not adoptable: the harnesses this
  repository targets do not always have one, and on the side without it the rule never fires.
  `pnpm josh` exists on every harness, so writes are folded by the composite `pnpm josh edit:files`
  ("The composite commands" below).
- **Impose a minimum number of calls per turn.** Rejected. Through a run of dependent calls one per turn
  is the right answer, and a minimum punishes correct behavior. Neither a maximum nor a minimum is
  right; **a measurement after the fact stands in its place.**

The harness's general instruction ("issue calls with no dependency in the same block") **already
existed and did not fire in measurement** — 1.13 / 1.04 / 1.03 / 1.00 calls per round trip over four
runs. A general statement alone moves nothing, so the procedure replaced it with three things: **one
fixed question as the criterion, naming the concrete shapes that were not being kept, and making the
result visible as a number** — the same three that moved output tokens in `file-edits.md`.

## How the guard's scope grew

**The refusal window.** A refusal fires **once** per run of single-call turns. A run that continues past
the window the hook reads gets one per window, since its start leaves the window — details in
`docs/josh-commands-automation.md` → "`josh batch:guard`".

**Delivery to forks (joshuafolkken/kit#1424).** Since joshuafolkken/kit#1424 the judgement and the
"once only" record key on **the fork's own transcript**, not the parent's.
`time_hook_transcript.transcript_of` (`scripts/time-runtime/time-hook-transcript.ts`), resolving from
the hook input's `agent_id`, is the single source, and the guard reaches it through
`scripts/josh/hook-decision.ts`. A delegated child or review agent does not share the parent's record.

**Writes joined the scope (joshuafolkken/kit#1762).** There had been two limits, both with the same
result — the guard never reached a write. joshuafolkken/kit#1509 found that across consecutive edits to
the same file the shared-target judgement discarded and recounted the sequence every time, so it never
reached the two calls a refusal needs (fixed as the write→write exception in `time-bundles.ts`); and
**the wiring was `Bash` only, so a run of `Edit`s never called the hook at all**. Over 19 measured runs,
of 261 recoverable round trips **184 (70.5%) were writes**, 158 (60.5%) `Edit` alone — the largest
contributor had always been structurally out of reach. **What had been rejected was "widen only the
matcher", not "make writes refusable".** Widening the matcher while the predicate always returned
`false` for writes would add one process per edit that can only ever answer "allow" — that cost
argument was right and still holds. joshuafolkken/kit#1762 **widened the predicate first** and then
wired `Bash|Edit`, so the matcher reaches a question with an answer. **The safety concern "a refused
edit lets its siblings apply and is itself lost" is closed by narrowing the dependence check, not by an
exclusion**: the harm comes only from an edit naming a file being rewritten right now, so a shared
target withdraws the refusal; what remains is an edit to a file the sequence never touched, whose
reissue meets exactly the text it was written against.

**The interrupted turn and the `Write` exclusion.** Every refusable write positions itself by its text,
so a reissued edit never lands in the wrong place. The cost is normally one round trip — here, one
edit redone — the same size as the false-positive cost the read side already accepts. Not refusing
`Write` is what makes that bound hold: a turn that `Write`s a file and then `Edit`s it is a real shape,
so `Write` is excluded by tool name rather than as an exception. A shell overwrite with `>` has the same
nature, but colliding needs two writes to one path in one turn, and that shape does not occur.

**Reads joined the scope (joshuafolkken/kit#1798).** The predicate (`is_guarded_call`) had treated
`Read` as a candidate from the start — the wiring stayed `Bash|Edit`, so the hook was simply never
called. On `fullrun #1783`, of 76 main-line requests **46 were single** and there were **7** runs of three
or more, yet the refusal fired only **twice**; four of the seven contained `Read` / `Write` / `Agent`, all
outside the wiring. **The counting was right** — `is_bundleable` decides whether a single-call turn
extends a run, and `Read` / `Glob` / `Grep` / `Write` all extend it. So only the wiring changed, to
`Bash|Edit|Read`.

**Administrative commands joined the scope (joshuafolkken/kit#1875).** `is_bundleable` judges by a
leading-word allow-list (`READ_COMMANDS`) and a mutation deny-list, so **every `pnpm josh …` starting
with `pnpm` was non-bundleable** — the `pnpm` that kept out writing josh commands (`gate` / `followup` /
`git`) also dropped read-only ones such as `issue:state` / `release:scope`. Administrative round trips
never appeared in `Bundling:`'s recoverable count or in `batch:guard`'s judgement, and the largest
administrative category, in the most expensive late part of a run, was always out of reach. **The
judgement was fixed, not the rule** (that Issue's acceptance condition). What stays off the allow-list
follows the module's consistent asymmetry: a miss costs a floor, a wrong inclusion a claim. **It
strengthens the guard by reaching calls it could not see, rather than weakening it.**

## Reading the round-trip measurement

`Round trips:` in the timing report counts a round trip as one batch of calls a turn issued, so
batching lowers round trips without lowering calls — the number shows directly whether cost fell
without the work falling. The 1.50 calls-per-round-trip floor detects **not batching** rather than
grading how much. A report reads, for example:

```
Round trips:
  tool calls                    104   over 153 turn(s)
  round trips                   104   1.00 calls per round trip
  ⚠ independent calls are going out one per turn (floor 1.50 calls per round trip)
```

The `tool-less turns` line (`turn_count − round_trips`, joshuafolkken/kit#1875) exists because
`batch:guard` cannot refuse a speech-only turn — with no tool call, `PreToolUse` never fires — and
`Bundling:` structurally cannot see one. Measured: run #1864 had 149 turns with calls out of 177, and
**28 with no tool at all**.

## The composite commands

**`read:files` (joshuafolkken/kit#2202).** `pnpm josh batch:guard` (the refusal) moved density on the
main line, but in a lane child (headless `claude -p`) a refusal ends the turn and kills the child, so
it could not fire (#2138); the notice that replaced it did not move the numbers (#2164), so #2178 set
the guard to `off` in children. What remained was the 9-turn sequence of alternating `Read` → `Edit`
across separate files (#2178's measurement); the edit set was not a fixed shape known in advance, so no
existing composite command could fold it. Only composite commands had a record of moving density —
#2165 / #2162 — while advice, presentation and notices moved nothing, so placing `read:files` at the
Step 0 seam is not "saying it again". **What #2164 / #2178 achieved does not regress** — neither the
batching guard nor the lane guard policy is touched, so a child is not killed by a refusal and does not
pay every turn for advice that does not work. De-interleaving is the lever: #2178's `Read A` /
`Edit A` / `Read B` / `Edit B` … **9 turns** become `read:files A B C D` → four `Edit`s, **2 turns**.

**`edit:files` (joshuafolkken/kit#2366).** #2202 placed no command to fold the edits themselves,
preferring native multi-edit (the first rejected mechanism above). joshuafolkken/kit#2366 refuted that
preference by measurement — 230 of 230 turns across the latest six lanes were single (density 1.000);
native multi-edit never happened once. What was rejected was assuming a _harness_ tool; `pnpm josh`
exists on every harness, so writes are folded by a composite command for the same reason only
composite commands moved density. #2493 made it accept `-` (stdin) and refuse a dependent edit as
`dependent`.

**Handing the composite command out when the guard fires (joshuafolkken/kit#2311).** **#2276 had the
notice name the concrete calls just issued one at a time, and density did not move (1.084 measured,
below the 1.147 baseline).** Naming them still asked the model to "reissue them together in one turn",
which is a request for parallel `tool_use` blocks — the very thing the model is structurally weak at.
Composite commands were the only lever with a record (#2165 / #2162), so the notice carries a ready-to-paste
one. It is implemented in `scripts/time-runtime/time-batch-guard.ts`'s `recent_candidates`
(`read_fold_directive`, and `write_fold_directive` for edits since #2366), the single point every
notice passes through; density is measured in lane children (`notice` mode), so this is where the
measurement surface is. It widens #2202's fold at the Step 0 seam to the point mid-implementation where
the guard fires — not another "say it again".

## Why it left residency (joshuafolkken/kit#1524)

**The prose lost on the move was not working in the first place.** Measured with the resident general
instruction in place, runs issued 1.13 / 1.04 / 1.03 / 1.00 calls per round trip — the rule was not kept
throughout its residency. What moved the numbers was joshuafolkken/kit#1390's hook. So **leaving
residency loses only sentences that were being skipped**, and the path that actually worked remains.

**It does not contradict the first rejected mechanism.** That rejected judging independence from one
call; joshuafolkken/kit#1390 judges from **closed history**. Three single-call turns in a row are
invisible from one call and visible from the history.

The delivered text (`scripts/time-runtime/time-batch-guard.ts`'s `REASON`, and `time-density.ts`'s
runtime line) carries the same two points the resident copy carried, uncut: a call that does not depend
on another call's result goes in the same turn; and the criterion is dependence, not the kind of call
(reads and edits alike), while fewer round trips never means less work. **On a turn where the trigger
does not fire nothing happens, and that is correct** — not firing means calls per round trip are above
the 1.50 floor, which is the state of the rule being kept.

## Where the guard cannot see

`prompts/collaboration-workflow/turn-batching.md` → "ガードが見えないところ". The guard judges from the
closed history (the sequence of turns whose results have returned) and treats calls sharing a target as
dependent, so it does not stop them. The mechanism is `docs/josh-commands-automation.md` →
"`josh batch:guard`".

- **The turn in progress is invisible.** Only the head of the same turn's edits may be refused; it
  fails rather than breaks — a reissue either matches the body or reports the mismatch
- **A whole-file `Write` is never refused**, because a reissue could overwrite a sibling edit
- **Only the read-only `pnpm josh …` allow-list (`READ_JOSH_SUBCOMMANDS`) is bundleable** — a writing
  or sending subcommand and a chained line (`&&` / `|` / `>`) fall to the ordinary judgement
- **A tool-less turn, and a lane child whose guard is `off`** — the round-trip measurement and the
  composite commands cover them. In a lane child nothing stops an alternating `Read` → `Edit` sequence,
  which is why the composite commands were added (joshuafolkken/kit#2202, `edit:files`
  joshuafolkken/kit#2366); since joshuafolkken/kit#2311 the guard's notice hands over the
  `read:files` / `edit:files` call that folds the singles it fired on (the plan body is still the
  model's to write)

## What the marker test pins

`scripts/rules/turn-batching-rule.test.ts` pins:

- that the delivered text carries the rule's trigger sentence and its criterion
- that the delivered text points at the procedure document, not `CLAUDE.md` (with the rule no longer
  resident, a reference to `CLAUDE.md` points at nothing)
- that the procedure document carries the criterion, the condition never to weaken a gate, and how the
  measurement is read; and that this file carries the rejected mechanisms and the measurements
- that the measurements (`600–850`, `1.13`) have not been pasted back into the resident documents or
  the residency list
- that the delivered-rule enumeration (`rule-delivery.md`) and the residency list
  (`docs/maintainers/residency-rationale.md` → "The resident-rule list") name this rule
