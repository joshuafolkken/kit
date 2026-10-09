# Rule residency — rationale

This is maintainer-only history behind `prompts/collaboration-workflow/residency.md`, the single
source of where a rule is written and how much of it stays resident. It is never read during a run.
**Three sections are the exception, because `residency.md` points here for their conditions** — "Trigger
and pointer, and the narrow retirement route", "A pointer-only topic file is never cited" and "When the
ceiling may be raised" are binding, so a change to them changes a rule; a change anywhere else here
changes none. It used to close `.claude/skills/workflow-commands/rule-residency.md`,
which said of it that it was "retained as history, not as a live constraint"; that file was merged
into `residency.md` and this text moved here unchanged (joshuafolkken/kit#2891). joshuafolkken/kit#3177
cut `residency.md` down to its four questions and moved the rest here: the argument for the resident
line, the trigger-and-pointer shape and the retirement route, the resident-rule list, the pointer
citation convention, and the budget and its raise conditions.

## Why a delivered rule leaves no resident line

**Question 1 comes first because the means of delivery grew.** The list used to be decided by
question 2 alone, which was the right criterion while residency was the only way to deliver a rule.
With `PreToolUse` / `PostToolUse` / `UserPromptSubmit` running that premise no longer holds, and
joshuafolkken/kit#1344 and joshuafolkken/kit#1460 measured that **rules which were resident had never
once fired**. A delivered rule is cheaper than resident prose (no other turn pays for it), and **a
refusal cannot be skimmed past. Moving is not deleting** — the rule body does not vanish, it moves to
a stronger channel.

**A delivery channel reaches one harness, so the rules still need a route on every other one.** A hook
reaches Claude Code only. `CLAUDE.md` is written without assuming a particular agent (`AGENTS.md` /
`GEMINI.md` / `.cursorrules` all point to it), and a Codex, Gemini CLI or Cursor session runs none of
the hooks in `.claude/settings.json`; neither does a Claude Code session with the stop switch set.
Until joshuafolkken/kit#3395 each delivered rule kept its own resident trigger line for those sessions.
**Now `CLAUDE.md` keeps one route line to the enumeration in `rule-delivery.md`, and a session that runs
no hook applies that enumeration as a self-check list**
(`principles.md` → "Claude Code 以外のエージェントでの読み替え"). The rule still exists in those sessions — it is reached through one shared line
instead of one line per rule, so no delivered rule leaves a trigger line resident.

## Trigger and pointer, and the narrow retirement route

The questions decide **whether** a rule stays resident, not **how much** of it. For a long time nothing
decided that, and a rule that passed brought its whole procedure in with it; even after the procedures
had been moved out, `CLAUDE.md` grew back to within 585 bytes of its ceiling (joshuafolkken/kit#964).

**A resident rule is written as two things — a trigger and a pointer.** There is no third.

1. **Trigger** — the situation the rule applies in, and the one instruction to follow before reading
   anything else. Written so an agent that reads nothing further still behaves safely: it stops, files,
   refuses or asks.
2. **Pointer** — the topic file under `prompts/collaboration-workflow/` or the skill file that holds the
   procedure, named precisely enough to open without searching.

Everything else — procedure, worked examples, rationale, the failure that prompted the rule — sits at
the pointer. **The test is whether a turn that never opens the pointer behaves correctly from the
resident text alone.** If dropping a sentence could let an agent proceed wrongly, that sentence is part
of the trigger; if dropping it only loses information, it belongs at the pointer.

**Trimming is moving; deletion is an exception allowed only with a stated reason.** Before a sentence
leaves `CLAUDE.md` it must already exist at the pointer, and the marker test that pinned it is
re-pointed there rather than discarded. A canonical section thinner than the resident copy is normal
and is no reason to delete — the resident copy is then the detailed version, so it moves to the
canonical place first and is cut from residency afterwards.

**A mechanism that can only move eventually jams, so there is one exit — and it is narrow**
(joshuafolkken/kit#1525). A rule may be **retired** rather than moved only when removing it cannot
change any agent's behavior, shown by three conditions rather than asserted:

1. **It is a copy of a sentence whose single source is declared** in the same document. If the two
   disagree the copy is the wrong one, so nothing can correctly depend on the copy.
2. **It carries no sentence found nowhere else**, checked against the single source rather than from
   memory.
3. **No marker test pins it** — no assertion falls with the retirement.

**"Looks duplicated" satisfies none of the three. A rule with a firing test, a marker or a measured
effect is not a candidate at all.** Every rule in these documents was written after a specific failure;
a rule that changes nothing today may be why the failure has not recurred. Without all three, record
the finding as a candidate with its evidence and keep the rule — a recorded candidate costs nothing
and can be picked up later, while a wrongly deleted rule fails silently months later in a run nobody
watches. **A pass that finds nothing retirable records its candidates and evidence and stops there** —
the bar is never lowered until a deletion turns up.

**`rule:value` is a measurement, not a gatekeeper on reduction** (joshuafolkken/kit#1931 →
`## Decisions`). A low unaided-keep ratio is evidence a resident copy is working, but a reading that
retires nothing does not freeze the document. A resident copy whose body is duplicated at its single
source's pointer is trimmed to its trigger under "trimming is moving" without waiting for a reading to
license it. A rule shown as `-` declares no compliance test: it is **unmeasured**, not zero, and that
alone does not make it a candidate.

## The resident-rule list

**This list covers the resident rules that have a procedure on the on-demand side** — a skill or an
on-demand prompt that the resident text points to. Those are exactly the rules the criterion asks
about: each could have been moved and stayed for a reason worth naming. **Within that scope the list
is exhaustive**; a rule with such a counterpart that entered residency without appearing here was
never checked against the criterion.

**Drawing the line by counting skills is wrong** — `verify-ui` is pointed to from three documents as
well, and one entry below points to `prompts/review.md`, which is not a skill at all.

**A resident rule outside that scope is correctly absent from this list.** The quality limits, the
Code Change Rules and Package-First have nowhere to move to (the naming conventions did: lint enforces
them, and their text is `prompts/coding-standards.md` → "Conventions" — joshuafolkken/kit#3395), so the question "must
it bind on a turn with no skill loaded" does not arise for them. **Absence from the list is not an
omission** (joshuafolkken/kit#955).

Every rule in scope that stays resident is below, and a marker test asserts each one is still in
`CLAUDE.md` (most in `scripts/claude/workflow-skills.test.ts`; **the UI verification gate in
`scripts/claude/verify-ui-skill.test.ts`**; the follow-up filing in
`scripts/document/document-markers.test.ts`). **A rule moved to triggered delivery is pinned by firing,
not by residency** — turn batching by `scripts/rules/turn-batching-rule.test.ts`, the mechanism itself by
`scripts/rules/delivered-rules.test.ts`. The WIP cap left delivery: `pnpm josh issue:file` holds it
itself, and `scripts/backlog/backlog-manufacturing-rule.test.ts` pins that no resident copy returns
(joshuafolkken/kit#3423). **No trigger line stays resident**: `CLAUDE.md` keeps one route
to the enumeration, which a session that runs no hook applies as a self-check list (`principles.md` →
"Claude Code 以外のエージェントでの読み替え", joshuafolkken/kit#3079, #3395).

- **Explicit invocation required** ("take no action you were not told to") — it decides whether a
  workflow may start at all, so it must bind the moment the user types the keyword, before any skill
  is read.
- **The `confirmation` notification on a stop** — most of the stops that need it (an upstream interrupt
  caused by another package, a Tier C confirmation) happen on turns where no workflow keyword was
  ever typed.
- **`overrides` protection** and **`devEngines` protection** — a dependency-update command can run on any
  turn, including one that never loads the `dependency-update` skill, and by the time the skill is read
  the pins are already rewritten. Both are one Tier C entry in "Decision autonomy", beside the trigger
  that loads the skill (joshuafolkken/kit#3395).
- **The UI verification gate** — a change that reaches the screen is not done until the rendered result
  has been looked at; the capture procedure is in `verify-ui`. The gate binds at the moment a UI change
  is reported done, often on a turn with no keyword typed and no skill loaded.
- **The follow-up filing after the review cap** — filing and re-attaching to the epic with
  `epic:bundle`. The pre-commit self-review runs outside workflows too, so an Issue it files would be
  orphaned the same way. The full procedure is `prompts/review.md` → "Review round cap"
  (joshuafolkken/kit#946).

**Moved off residency by joshuafolkken/kit#3395.** The three `josh epic:*` rules that bind outside the
commands (clearing `needs-decision`, fixing what `epic:audit` finds as Tier A, `owner/repo#N` for an
epic in another repository) are in `.claude/skills/epic-commands/`, whose resident trigger names the
moment a filed issue is placed and the moment a decision is recorded on a `needs-decision` child. The file-edit prohibition joined the delivered rules below.

**Rules that answered "yes" to question 1 and moved to triggered delivery** (joshuafolkken/kit#1524).
None of their bodies is gone; the hook presents them the moment the rule applies. Listed are only the
rows that needed a reason for that call, not every delivered rule. **The
single source of the enumeration, and of what a turn on which the trigger does not fire means, is
`prompts/collaboration-workflow/rule-delivery.md`; no count is copied here** — a number kept in two
places always drifts (joshuafolkken/kit#1525).

- **Independent calls go in the same turn** — the trigger is `pnpm josh batch:guard` (the `Bash` /
  `Edit` / `Read` after three single-call turns in a row). What the resident period measured was that
  **residency was not working** (figures at the pointer). Measurements, rejected mechanisms and the
  condition never to weaken a gate are in `prompts/collaboration-workflow/turn-batching.md` and
  `docs/maintainers/turn-batching-rationale.md`; `scripts/rules/turn-batching-rule.test.ts` pins it
  (joshuafolkken/kit#1304, #1390, #1524; `Edit` joined in #1762, `Read` in #1798).
- **The backlog WIP cap** — delivered by `pnpm josh rule:guard` from joshuafolkken/kit#1524 until
  joshuafolkken/kit#3423, which retired the row: `pnpm josh issue:file` counts the cap and holds the
  filing itself, so the pre-refusal was a pure round trip. Its hold message still carries how to count,
  the decision not to file, the two exemptions and **the three interrupt tests**; dropping the three
  would put "is it serious" back into judgement (joshuafolkken/kit#1518). Posting a comment is not
  filing and is out of scope. The procedure and the conditions for moving the numbers are in
  `prompts/collaboration-workflow/wip-cap.md` (joshuafolkken/kit#1469).
- **Reading Issue comments** — the trigger is `pnpm josh rule:guard` (a `Bash` that reads only an Issue
  body). The refusal hands over the re-read with comments and how to treat a comment that contradicts
  the body. It refuses every time until the precondition is met, so it refuses even on a turn where
  `batch:guard`'s trigger overlaps. The procedure stays in `issue-comments.md`, because a session that
  runs no hooks still has the duty to read.
- **Never put a body in shell double quotes** — the trigger is `pnpm josh rule:guard` (a `Bash` whose body
  value contains a backtick or `$`). **The trigger reads the body, not the flag** — every worked example
  passes a harmless placeholder, so keying on the flag would refuse turns already keeping the rule.
  Measurements, safe spellings and the trigger's blind spots — the spellings the regex does not know
  included — are in `prompts/collaboration-workflow/shell-body.md` (joshuafolkken/kit#1198).
- **Never carry a file's new text inside a command** — the trigger is `pnpm josh rule:guard` (a `Bash`
  that carries a file body). The criterion is "does it carry the whole body", not the tool name, and
  **widening an `Edit` to the whole file is part of the same rule** (joshuafolkken/kit#1150, #1260).
  The table is `prompts/collaboration-workflow/file-edits.md`, the measurements
  `docs/maintainers/file-edits-rationale.md`.

Examples that answer "no" and keep their body on the skill side:

- The split assessment (`.claude/skills/workflow-commands/split-assessment.md`)
- The per-entry procedure when a prerequisite Issue turns up mid-run (`fullrun.md` / `halfrun.md` /
  `.claude/skills/workflow-commands/backlogrun.md`)
- `backlogrun`'s single-Issue acceptance and park-and-continue (`.claude/skills/workflow-commands/backlogrun.md`)
- The verification gate and the merge chain (`.claude/skills/workflow-commands/chain-rule.md` / `followup.md`)
- The post-dependency-update verification (`.claude/skills/dependency-update/`) — where the two
  protections above point
- Picking up `auto-ok` and "only a person applies the label" (`.claude/skills/workflow-commands/backlogrun.md`).
  A write prohibition would normally be resident, but `auto-ok` exists nowhere except the documents
  that forbid writing it, so a turn that never opens them never reaches it.

## A pointer-only topic file is never cited

**A citation names where the body is, not the file's role.** Once a topic file's body is
single-sourced into a skill and the topic file shrinks to a pointer, a citation of that topic **points
at the skill file directly** — from `CLAUDE.md`, `docs/` and other topic files alike; the pointer
topic is never named as "the canonical reference" (joshuafolkken/kit#1178). The heading this convention
was argued under in `residency.md` was "指し先になった話題ファイルは引用しない".

The decision is one question, never left to the writer: **which file holds the topic's body?** While the body is still in the topic
file, cite the topic file; once it is in a skill, cite the skill. Mid-rollout (joshuafolkken/kit#1176)
topics in both states coexist, so the answer has to come from where the body is, not from the file's
role.

**Naming a pointer as "the canonical reference" brings the double read back.** It is the same defect
as citing an index and then a section name, now routed through a file with no body at all: the reader
opens the pointer, reads the skill's name there and opens again. **A citation that names a section is
worse still** — the pointer has no body, so the section is no longer there.

**A topic file reduced to a pointer is not kept.** Once its body has moved to a skill and it holds only
a one-paragraph redirect, it is deleted along with its row in the index
(`prompts/collaboration-workflow.md`) (joshuafolkken/kit#1925, joshuafolkken/kit#2996). A pointer that
survives until then is a record of where the body went, reached from the index, not from other
documents' citations. The exception is the skill that is the single source itself: naming its own
pointer is a reverse reference and causes no double read.

`scripts/rules/pointer-citation-document-rule.test.ts` pins this. **A shrunken topic file that survives
until deletion opens with the declaration `この規則の単一ソースは …`** — the check finds the pointer
by that declaration, confirms the skill it names exists, and confirms no other document cites the
topic file. The declaration is the entry point, so a topic newly shrunk during a rollout falls under
the rule automatically.

## The resident budget

**This criterion is not aspirational.** `scripts/claude/workflow-skills.test.ts` requires each resident
document to stay under `RESIDENT_CEILING_BYTES` with headroom below it, using the constants in
`scripts/document/resident-budget.ts`. Writing a procedure back into residency makes the next rule
that genuinely needs residency take the bytes back from existing text. Cutting one sentence to fit
another at the ceiling means **the cut falls on whatever no marker pinned** — which sentence survives is
decided by test coverage, not by importance (joshuafolkken/kit#951). What leaves when the budget binds
is decided by measurement (`rule:value`, "Trigger and pointer, and the narrow retirement route" above),
not by whether a marker exists. Raising the ceiling itself would ratify the state it prevents, so it is
not the remedy.

## When the ceiling may be raised

**"Do not raise" is a falsifiable default, not an absolute prohibition.** Written only as a prohibition,
there would be no procedure for moving the ceiling on the day recovery genuinely runs out, and the move
left would be cutting a sentence no marker pinned — exactly what this criterion prevents
(joshuafolkken/kit#1275). So the conditions that justify a raise are written down.

**A raise of `RESIDENT_CEILING_BYTES` may be proposed only when all three hold at once.** If any one is
missing, recover first.

1. **The cheaper option is exhausted.** Everything still resident passes the criterion ("must it bind
   on a turn with no skill loaded" plus "is it only trigger and pointer"), and no procedure, rationale
   or worked example is left to move back to a pointer. **Exhaustion is shown by measurement, not
   asserted** — list the recovery candidates, give each a one-line reason it passes, and show the total
   recoverable is below the amount needed. At joshuafolkken/kit#1275 this did not hold (the Step 0 label
   rules alone in the Code Change Rules had about 3 KB to recover, and it was recovered).
2. **The demand comes from structure, not one rule.** "The next sentence does not fit" is solved by
   recovery. A raise is needed when the **number** of rules that must be resident grows until they do not
   fit, and then the added rules can be listed.
3. **The amount is measured.** Add only the difference between the recoverable amount counted in 1 and
   the demand counted in 2. Do not round — rounded headroom is spent on the next write-back.

**The risk is asymmetric, so when in doubt, recover.** Recovering and falling short costs "think again";
raising wrongly costs a permanent charge on a surface read in full every turn, and a raised ceiling
becomes the baseline for the next decision, so the error does not self-correct.

**A raise is Tier C.** **Loosening** any constant in `scripts/document/resident-budget.ts` that sets
the resident budget — `RESIDENT_CEILING_BYTES`, `RESIDENT_HEADROOM_BYTES`, and the write-back floor
`RE_INLINE_GUARD_HEADROOM_BYTES` — needs the three conditions shown and then an explicit user
instruction. That the conditions hold is not itself an instruction to change it. **Naming only one
of them leaves whichever limit is actually binding unguarded** — with room under the ceiling but the
floor reached, the floor is what someone will want to loosen, and if that is open the prohibition is
only a form. Tightening (lowering the ceiling, raising the floor) is outside this prohibition.

## The issue-citation ratchet

The main cause of agent-document growth was issue-number citations and the "why / measured /
rejected" prose that travels with them, piling up in documents read at run time even where a
`*-rationale.md` already held the topic. At joshuafolkken/kit#3185 the agent-read set
(`agent_read_documents()` — `CLAUDE.md`, `prompts/`, the distributed skills and the two command
references) cited 328 issue numbers. Cutting them alone does not last: nothing stopped the next PR
adding them back, the same pattern the byte budget answered for size.

**The rule is computable, so a check answers it (question 0).** `scripts/document/issue-citation-budget.ts`
records each document's count, and its suite fails `pnpm josh gate` on growth and on a reduction left
unrecorded. `residency.md` carries one line pointing at it, beside the other budget rules.

- **Exact, not block-quantized.** The byte budget quantizes to keep parallel lanes from bumping the
  same line; here one added citation is precisely the growth to refuse, so there is no headroom to
  quantize. Two lanes that change the same document's count meet on one line, a conflict resolved by
  recounting.
- **Counted as `#` plus three or more digits.** That matches `#3185` and `owner/repo#3185` and skips
  placeholders (`#N`, `#<N>`) and short ordinals; a five-digit number keeps counting.
- **The rationale files are outside the set**, so moving history there lowers the count.

## The reduction freeze and its retraction

**The freeze on reducing resident text was lifted on 2026-09-13** (joshuafolkken/kit#1931 →
`## Decisions`, carried out in joshuafolkken/kit#1924). Until then `rule:value` was read as a
gate on reduction: three successive readings each retired nothing, and `CLAUDE.md` stayed at ~56 KB
while its duplicated procedure bodies — the completion gate, the pre-commit self-review, the Step 0
report format, the upstream-interrupt procedure — sat resident beside pointers that already held them.
**That gating is retracted.** `rule:value` remains a _measurement_ — a low unaided-keep ratio is still
evidence a resident copy earns its place — but a reading that retires nothing no longer freezes the
document, and a resident copy whose body is duplicated at a declared pointer is trimmed to its trigger
under **Trimming is moving**, without waiting for a reading to license it. **The readings below
are retained as history of how the gate was applied, not as a live constraint.**

## Measurement decides what leaves

**What leaves when the budget binds is decided by measurement, not by which sentence a marker
happened to pin** (joshuafolkken/kit#1525). The old order was the reverse: a rule edited to keep a
byte count lost whichever neighboring sentence was not pinned by a marker, so the least-defended
text went rather than the least-useful one, and the bias grew with every rule added
(joshuafolkken/kit#951). `rule:value` replaces that with a reading — over this checkout's
recorded sessions it reports, per trigger-delivered rule, how often the run had already kept the rule
at the moment the trigger fired. **That window is the rule's absence**, because the hook has said
nothing yet and only the carried text is asking; the ratio is what the carried text earns unaided.

## The `rule:value` readings

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
the registry `rule:value` read and the most-cited resident rule in the repository had no continuous
reading at all. Over 297 recorded runs it reads **86% unaided over 276 runs, with 47 refusals** — the
top of the table, so it too is earning its place and nothing is retired on this reading. **The row is
scored on its refusal rather than on a trigger**, because whether a call would be refused depends on
the turns behind it, which is also where the turn-is-a-message-id correction the first reading of the
row exposed came from.

**Measuring the four needed a distinction the first reading did not have, and it is the half worth
carrying forward.** A rule's denominator is the situation it governs, and that is the trigger only
where the trigger is a _neutral_ act — filing an Issue, reading one — which a run keeping the rule
performs anyway. The other four fire only on the violation: a run that backgrounded every push never
trips `run-tail`. Scored against the trigger they would all have read near zero, and near zero reads
as "the carried text earns nothing" — **a manufactured retirement candidate, which is the one outcome
this measurement exists to prevent**. Such a row declares `reaches` instead, the governed act in
either spelling.

**The three tests then refused every remaining candidate, and that is the route working rather than
failing.** The four resident one-liners left behind by trigger delivery all fail test 2: the
residency criterion records why a line stays behind when the hook reaches one harness, so each carries
a sentence that exists nowhere else. Only the restated count of delivered rules was retired.

**The fourth reading swept the eight mechanization PRs of the reduction epic (joshuafolkken/kit#2117–#2124) and retired nothing, which is again the route working** (joshuafolkken/kit#2125). Each PR that moved a judgement into a command trimmed its own resident prose to trigger-plus-pointer as it landed, so the sweep found no procedure restated in full: the mechanized triggers — the computable-answer question 0 (`oracle:list`), `test:declared`, `issue:scout` and the filing cap, the shell-body guard, `repo:party`, and the fixed-shape linters (`issue:lint` / `report:lint`) — each already resolve to their declared single source (`prompts/collaboration-workflow/residency.md`, `rule-delivery.md`, `wip-cap.md`, `shell-body.md`, `upstream-interrupt.md`, `report-format.md`) rather than carrying the procedure resident. **The one candidate the sweep raised was the `Stop` hook's arrival** (joshuafolkken/kit#2121): the resident `CLAUDE.md` → "Mid-workflow stop notification" section looked like a delivered rule whose copy could shrink to a one-liner, but it fails test 3 — `scripts/document/document-markers.test.ts` pins its heading and `scripts/claude/workflow-skills.test.ts` pins its `notify` command and its `parseArgs` line — and it fails test 2, because `stop-rules.ts`'s `STOP_NOTIFY_REASON` names this very section as the single source the delivered text points at, so trimming it would strand the pointer. The hold-release and issue-citation stop rules introduced no resident duplication at all: their single sources are `working-tree-hold.md` and `issue-citation.md`, which the hook points to, and the resident issue-citation text was already a one-line trigger. **What the sweep reclaimed was a stale byte-budget record, not prose**: `chain-rule.md` was reduced in joshuafolkken/kit#2078 but its recorded size was never lowered, so the ratchet in `scripts/document/document-byte-budget.ts` was tightened 18,031 → 6,240 to hold that reduction. **The reclamation was only possible because nothing enforced it** — the ratchet's growth guard catches a document that swells past its ceiling but is blind to one that shrinks and leaves its record standing, which is how chain-rule.md's stale-loose entry survived two reduction epics unseen. So a staleness guard was added beside it (`recorded ≤ actual + slack`): an unrecorded shrink now fails `pnpm josh gate` rather than drifting, so the next reduction epic finds nothing stale to reclaim.

## Why the delivered list carries no count

The paragraph that introduced the delivered rules used to open with a count. It said `Four` and had
been wrong since the fifth row landed, which is what a restated count does; joshuafolkken/kit#1525
removed it. Its replacement then said the enumeration "has grown to nine rows" — and by
joshuafolkken/kit#2891 the table in `rule-delivery.md` carried about twenty-five, the exact drift the
paragraph itself warned about. The merged criterion therefore names `rule-delivery.md` as the single
source of the enumeration and carries no number at all.

## Why the workflow index is split by topic

`prompts/collaboration-workflow.md` used to be one 169 KB file, so checking a single section meant
reading all of it. Whatever a session reads is billed again as accumulated prefix on every remaining
turn, so the cost of one check grew with the length of the conversation (joshuafolkken/kit#965). Each
topic now has its own file, and the index exists only to pick one.

The index records no byte counts: a hand-maintained number goes stale before the prose does, and a
stale number is worse than none. `ls -l prompts/collaboration-workflow/` answers the real sizes.

A citation names the file that holds the body because routing through the index
(`prompts/collaboration-workflow.md` followed by a section name) forces a second read and dead-ends
silently when the section is renamed. `scripts/claude/collaboration-prompt-split.test.ts` checks that
every cited file exists, that every cited section resolves, and that the index lists every topic file.
These notes moved out of the index in joshuafolkken/kit#3179.

## One list, not two

Until joshuafolkken/kit#2891 the resident-rule list and the delivered-rule list each existed twice —
once in Japanese in `prompts/collaboration-workflow/residency.md`, once in English in
`.claude/skills/workflow-commands/rule-residency.md`. The duplicate in `residency.md` looked like a
clean case for the first retirement test — a stale summary sitting directly beneath a pointer to its
own single source — and failed the third, because `scripts/rules/shell-body-rule.test.ts` and
`scripts/rules/turn-batching-rule.test.ts` each asserted that a delivered rule was listed in both
files. joshuafolkken/kit#2891 merged the two documents into `residency.md` and re-pointed those
suites, and every marker that pinned the English copy, at the merged list, so the pin now holds the
one copy rather than forcing a second.
