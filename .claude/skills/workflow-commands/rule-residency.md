# How much of a resident rule is resident — `SKILL.md` §3's body

**This is `SKILL.md` → §3's procedure, and it is read when a rule is being placed, moved or
retired — not at the entry** (joshuafolkken/kit#1797). §3 keeps the two questions that decide
*whether* a rule is resident; what follows decides *how much of it* is, and carries the enumeration
of every resident rule that has an on-demand counterpart, the retirement route and its three tests,
and the readings of `pnpm josh rule:value` that have refused every candidate so far.

**Nothing in a run reaches it.** The moment it binds is a turn spent editing `CLAUDE.md` or one of
these documents, which is why it costs a workflow entry nothing to leave it here — and why the two
questions themselves stay in §3, where a run that is about to move a sentence still reads them first.

### The second question: how much of a resident rule is resident

The criterion above decides **whether** a rule stays. It says nothing about **how much of it** stays,
and for a long time nothing did — so a rule that passed arrived with its whole procedure attached,
and `CLAUDE.md` grew back to within 585 bytes of its ceiling with the procedures already moved out
(joshuafolkken/kit#964).

**A resident rule is written as its trigger plus a pointer.** Two things and no third:

1. **The trigger** — the situation that fires it, and the one instruction that must be obeyed before
   anything else is read. Written so an agent that reads nothing further still does the safe thing:
   stops, files, refuses, asks.
2. **The pointer** — the topic file under `prompts/collaboration-workflow/` or the skill file that holds
   the procedure, named exactly enough to open without searching.

Everything else — the steps, the worked examples, the rationale, the failure it was written after —
belongs at the pointer. **The test is whether the resident text still produces correct behavior on a
turn where the pointer is never opened.** If dropping a sentence would let an agent proceed wrongly
rather than merely proceed less well informed, that sentence is part of the trigger. If dropping it
only costs context, it belongs at the pointer.

**Trimming is moving, and deleting is the exception that has to be earned.** Before a sentence leaves
`CLAUDE.md` it has to exist at the pointer, and the marker suite that pinned it has to be re-pointed
there rather than dropped. A canonical section that is thinner than the resident copy is the normal
case, not a reason to delete — the resident text is then the fuller version, and it is moved in
before it is cut out.

**A system that can only move eventually jams, so one route out exists — and it is narrow**
(joshuafolkken/kit#1525). A rule is *retired* rather than moved only where deleting it cannot change
what any agent does, and that has to be shown rather than argued:

1. **It is a clone of text that has a declared single source**, and the source is named in the same
   document. Where the two differ the copy is the wrong one, so nothing can correctly depend on it.
2. **It carries no sentence that exists nowhere else** — checked against the source it duplicates,
   not against a memory of it.
3. **No marker suite pins it**, so no assertion is being dropped along with it.

**"It looks redundant" satisfies none of the three, and a rule with a firing test, a marker, or a
measured effect is not a candidate at all.** Every rule in these documents was written after a
specific failure; one that changes nothing today may simply be one whose failure has not recurred
*because it is there*. When the three do not all hold, the finding is recorded as a candidate with
its evidence and left standing — a listed candidate costs nothing and can be taken up later, while a
wrongly deleted rule fails silently, months later, in a run nobody is watching.

**The scope of this list is every resident rule that has an on-demand counterpart** — a skill or an
on-demand prompt carrying the procedure the resident text routes to. Those are the rules the
criterion is *about*: each one could have moved, and stayed for a reason worth naming. Within that
scope the list is exhaustive, and a rule with a counterpart that is resident without appearing here
has not been checked.

Counting by skill would draw the line in the wrong place — `verify-ui` is routed to as readily as
this skill is, and one entry below routes to `prompts/review.md`, which is not a skill at all.

Outside the scope the documents carry a great deal more — the naming conventions, the quality
limits, the code-change rules, Package-First. **None of that belongs on this list**: there is no
on-demand copy for them to have moved to, so the question the criterion asks does not arise, and
their absence here is correct rather than an omission (joshuafolkken/kit#955).

Within that scope, every rule that passes the test is resident in full, and a marker suite asserts
each one present in `CLAUDE.md` — `scripts/workflow-skills.test.ts` for most of them,
`scripts/verify-ui-skill.test.ts` for the UI gate,
`scripts/review-followup-bundle-document-rule.test.ts` for the follow-up filing step, and
`scripts/inline-edit-rule.test.ts` for the file-editing prohibition. **A trigger-delivered rule
is pinned differently** — by what its refusal says and by the trigger firing, in
`scripts/turn-batching-rule.test.ts`, `scripts/backlog-manufacturing-rule.test.ts` and
`scripts/rules/delivered-rules.test.ts`, with only its one-line trigger asserted resident:

- **Explicit invocation required** — it decides whether a workflow starts at all, so it binds on the
  turn the user types the keyword, which is before anything here has been read.
- **The mid-workflow stop notification** — most pauses that need it (an upstream-Issue interrupt, a
  Tier C confirmation) happen on turns carrying no workflow keyword at all.
- **The `overrides` prohibition** and **the `devEngines` prohibition** — a dependency command can be
  run on any turn, including one that never loads `dependency-update`, and by the time the skill
  would be read the pin has already been rewritten.
- **The follow-up filing step after the review round cap** — filing the Issue and bundling it into an
  epic. A pre-commit self-review runs outside any workflow as readily as inside one, and the Issue it
  files is orphaned just the same; the step has to be readable on a turn that never typed a keyword.
  Its full form is in `prompts/review.md` → "Review round cap" (joshuafolkken/kit#946).
- **The rule-compliance measurement's trigger** — `pnpm josh eval:scope`, and `pnpm josh eval` when
  it answers `required`. A change to a distributed document is reported finished on turns that typed
  no workflow keyword at all — "fix this wording in `CLAUDE.md`" is the common one — so the trigger
  has to be readable there. The procedure it routes to is `eval-gate.md`.
- **The UI-verification gate** — a rendered change is not done until the screen has been looked at,
  and the procedure for capturing it is `verify-ui`. The gate binds whenever a UI change is reported
  finished, which is routinely a turn with no workflow keyword typed and no skill loaded.
- **The three `josh epic:*` rules that bind outside those commands** — recording a decision removes
  that child's `needs-decision` label, fixing what `epic:audit` finds is Tier A, and an epic in
  another repository is referenced as `owner/repo#N`. Each fires on a turn where no `epic:*` command
  was run: the moment an issue is filed, or a decision written. The commands' own procedures are in
  `.claude/skills/epic-commands/`, which is where everything else about them lives.
- **The prohibition on carrying a file's new text inside a shell command** — an edit happens on any
  turn at all, and there is no skill that a run loads *before* editing. Placed on demand, this one
  rule would never fire once, which reads exactly like having deleted it. The measured cost, the
  allowed/prohibited table and the reasoning are at
  `prompts/collaboration-workflow/file-edits.md`; what stays resident is the instruction and the
  criterion that decides it — whether the command carries the replacement wholesale, not which tool
  was used (joshuafolkken/kit#1150). **The same criterion binds the Edit itself**: rewriting a whole
  file to fix the three lines a review named carries the replacement wholesale exactly as a heredoc
  does, so the resident instruction covers it in one clause and the three cases that justify writing
  a file whole stay at the pointer (joshuafolkken/kit#1260).

**These left this list at the first question, and are delivered by a hook instead**
(joshuafolkken/kit#1524). None lost a sentence; each is pinned by the firing test named beside it
rather than by a residency marker, and `prompts/collaboration-workflow/rule-delivery.md` is the
enumeration and the single source of what a turn where the trigger does not fire means. **The four
described below are not the whole set** — the enumeration has grown to nine rows, of which
`scripts/rules/delivered-rules.ts` carries seven and two are their own binaries. The count that used to
open this paragraph said `Four` and had been wrong since the fifth row landed, which is what a
restated count does; it is gone rather than corrected, because a number kept in two places drifts
again (joshuafolkken/kit#1525).

- **The instruction to put independent calls in one turn** — `pnpm josh batch:guard` refuses the
  `Bash`, `Edit` or `Read` call that would make a third consecutive single-call turn, and states the criterion
  there. **`Edit` joined `Bash` in joshuafolkken/kit#1762, and `Read` in joshuafolkken/kit#1798**, because edits carry most of the recoverable
  round trips and the guard could not reach one of them, and because a cluster holding one `Read` was breaking the wiring rather than the count.
  It was resident through every run the topic file measures, and moved none of them, so what the
  relocation gave up is prose that was not being obeyed
  (`prompts/collaboration-workflow/turn-batching.md`, `scripts/turn-batching-rule.test.ts`).
- **The backlog WIP cap** — `pnpm josh rule:guard` refuses the `Bash` call that files an Issue
  (`gh issue create`, or a `title`-bearing POST to `…/issues`) and delivers the count, the refusal,
  both exemptions and the three tests that decide the interrupt one — the three kept whole, because a
  delivery saying only "an interrupt is exempt" hands the deciding back to judgement
  (joshuafolkken/kit#1518). A comment endpoint is not a filing and is left alone
  (`prompts/collaboration-workflow/wip-cap.md`, `scripts/backlog-manufacturing-rule.test.ts`).
- **The Issue's comments** — `pnpm josh rule:guard` refuses the `Bash` call that reads an Issue's
  body without them (`gh issue view <N>`, or a `GET` of a path ending `…/issues/<N>`) and hands over
  the reissue that carries them plus the rule for a comment that contradicts the body. It is the one
  row whose trigger `batch:guard` also considers, so it stands aside on that guard's turn and fires
  on the reissue. §2g is the procedure and stays here, because a session that runs no hooks still
  owes the read (`prompts/collaboration-workflow/rule-delivery.md`,
  `scripts/rules/delivered-rules.test.ts`).
- **The prohibition on putting a body inside shell double quotes** — `pnpm josh rule:guard` refuses
  the `Bash` call whose inline body value carries a backtick or a `$`, the two characters this
  harness's zsh was measured to evaluate there, and hands back the path-shaped spellings
  (`--body-file`, `--field body=@<path>`, `--notify-message-file`). **The trigger reads the body, not
  the flag**: every worked example in these documents passes a placeholder, which is inert, so keying
  on the flag would refuse the turns where the rule is already kept. It is also the one row whose
  trigger deliberately overlaps another — a filing whose body carries a backtick is `wip-cap`'s
  first, and this one's on the reissue. A one-line trigger stays resident because a hook reaches
  Claude Code alone (`prompts/collaboration-workflow/shell-body.md`,
  `scripts/shell-body-rule.test.ts`, joshuafolkken/kit#1198).

These do not pass it, and live in a skill instead: the split assessment (`split-assessment.md`), a
prerequisite discovered mid-run (§2d, with each entry's branch in
`fullrun.md` / `halfrun.md` / `epicrun.md`), `epicrun`'s acceptance
of an Issue that is not an epic and its park-and-continue behavior (`epicrun.md`), the whole
verification gate and merge chain (`chain-rule.md` / `followup.md`), and the post-update verification
procedure (`.claude/skills/dependency-update/`) that the two prohibitions above route to.

The `auto-ok` pickup and its "only a person applies the label" rule (`epicrun.md`) are the borderline
case worth naming, because a prohibition on writing usually *is* resident. It is not, and the reason
is that `auto-ok` exists nowhere but the documents that also forbid an agent applying it: a turn that
opens none of them is a turn on which the label is never reached, so residency would buy nothing.

**The criterion is not advisory.** `scripts/workflow-skills.test.ts` caps each document at
`RESIDENT_CEILING_BYTES` and requires headroom under it, so a procedure restated resident costs
budget that the next genuinely-resident rule then has to take back out of existing prose.

**What leaves when the budget binds is decided by measurement, not by which sentence a marker
happened to pin** (joshuafolkken/kit#1525). The old order was the reverse: a rule edited to keep a
byte count lost whichever neighboring sentence was not pinned by a marker, so the least-defended
text went rather than the least-useful one, and the bias grew with every rule added
(joshuafolkken/kit#951). `pnpm josh rule:value` replaces that with a reading — over this checkout's
recorded sessions it reports, per trigger-delivered rule, how often the run had already kept the rule
at the moment the trigger fired. **That window is the rule's absence**, because the hook has said
nothing yet and only the carried text is asking; the ratio is what the carried text earns unaided.

**The first reading refused the deletion it was built to justify, which is why the measurement runs
first.** Over 220 recorded runs the WIP cap — which keeps a resident copy — was kept unaided in 55% of
the runs that reached it, while the Issue-comments rule, which has **no** resident copy, managed
15%. The resident text was the obvious candidate on a reading of the prose, since the refusal repeats
it almost word for word; the number says it is doing a great deal of work and must stay.

**The second reading covers every rule, and it found no candidate either** (joshuafolkken/kit#1643).
The first reading could score only two rows, so nobody could tell whether the candidates were
exhausted or merely unmeasured. All six now declare a compliance test, and over 225 recorded runs they
read: `shell-body` 81%, `early-heartbeat` 67%, `wip-cap` 57%, `issue-comments` 15%,
`piped-verification` 13%, `run-tail` 4%. **The two rules that keep a resident copy are the two at the
top** — `shell-body` at 81% and `wip-cap` at 57% — and exactly one rule without a copy sits between
them: `early-heartbeat`, at 67% over **18 runs**, the smallest denominator in the table by a factor of
five. So the resident copies are earning their place, and **nothing is retired on this reading**. The
figures move as the corpus grows, so the next run of this question re-reads them rather than quoting
these.

**The third reading added the row the table had never carried, and it changed no verdict either**
(joshuafolkken/kit#1792). The batching guard is delivered by a binary of its own, so it sat outside
the registry `rule:value` reads and the most-cited resident rule in the repository had no continuous
reading at all. Over 297 recorded runs it reads **86% unaided over 276 runs, with 47 refusals** — the
top of the table, so it too is earning its place and nothing is retired on this reading. **The row is scored on its refusal rather than on a trigger**, because whether a call would
be refused depends on the turns behind it; `docs/josh-commands.md` → "`josh rule:value`" carries that
and the turn-is-a-message-id correction the first reading of the row exposed.

**Measuring the four needed a distinction the first reading did not have, and it is the half worth
carrying forward.** A rule's denominator is the situation it governs, and that is the trigger only
where the trigger is a *neutral* act — filing an Issue, reading one — which a run keeping the rule
performs anyway. The other four fire only on the violation: a run that backgrounded every push never
trips `run-tail`. Scored against the trigger they would all have read near zero, and near zero reads
as "the carried text earns nothing" — **a manufactured retirement candidate, which is the one outcome
this measurement exists to prevent**. Such a row declares `reaches` instead, the governed act in
either spelling; `docs/josh-commands.md` → "`josh rule:value`" carries the column meanings.

**The three tests then refused every remaining candidate, and that is the route working rather than
failing.** The four resident one-liners left behind by trigger delivery all fail test 2: the
paragraph above records why a line stays behind when the hook reaches one harness, so each carries a
sentence that exists nowhere else. The duplicate list of delivered rules in
`prompts/collaboration-workflow/residency.md` looked like a clean test-1 case — a stale summary
sitting directly beneath a pointer to its own single source — and fails test 3, because
`scripts/shell-body-rule.test.ts` and `scripts/turn-batching-rule.test.ts` each assert that a
delivered rule is listed there. **Being pinned is what test 3 is for**: that assertion is the design
requirement it looks like an accident of. Only the restated count above was retired. **A run that
finds nothing retirable records the candidates with their evidence and stops there**, rather than
lowering the bar until a deletion appears. A rule
scoring `-` has declared no compliance test and is **unmeasured, never zero** — it is not thereby a
candidate.
