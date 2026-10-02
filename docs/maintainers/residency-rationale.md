# Rule residency — rationale

This is maintainer-only history behind `prompts/collaboration-workflow/residency.md`, the single
source of where a rule is written and how much of it stays resident. It is never read during a run,
and a change to this file changes no rule. It used to close `.claude/skills/workflow-commands/rule-residency.md`,
which said of it that it was "retained as history, not as a live constraint"; that file was merged
into `residency.md` and this text moved here unchanged (joshuafolkken/kit#2891).

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

**The fourth reading swept the eight mechanization PRs of the reduction epic (joshuafolkken/kit#2117–#2124) and retired nothing, which is again the route working** (joshuafolkken/kit#2125). Each PR that moved a judgement into a command trimmed its own resident prose to trigger-plus-pointer as it landed, so the sweep found no procedure restated in full: the mechanized triggers — the computable-answer question 0 (`oracle:list`), `test:declared`, `issue:scout` and the filing cap, the shell-body guard, `repo:party`, and the fixed-shape linters (`issue:lint` / `report:lint`) — each already resolve to their declared single source (`prompts/collaboration-workflow/residency.md`, `rule-delivery.md`, `wip-cap.md`, `shell-body.md`, `upstream-interrupt.md`, `report-format.md`) rather than carrying the procedure resident. **The one candidate the sweep raised was the `Stop` hook's arrival** (joshuafolkken/kit#2121): the resident `CLAUDE.md` → "Mid-workflow stop notification" section looked like a delivered rule whose copy could shrink to a one-liner, but it fails test 3 — `scripts/document/document-markers.test.ts` pins its heading and `scripts/claude/workflow-skills.test.ts` pins its `notify` command and its `parseArgs` line — and it fails test 2, because `stop-rules.ts`'s `STOP_NOTIFY_REASON` names this very section as the single source the delivered text points at, so trimming it would strand the pointer. The hold-release and issue-citation stop rules introduced no resident duplication at all: their single sources are `SKILL.md` → §2f and `issue-citation.md`, which the hook points to, and the resident issue-citation text was already a one-line trigger. **What the sweep reclaimed was a stale byte-budget record, not prose**: `chain-rule.md` was reduced in joshuafolkken/kit#2078 but its recorded size was never lowered, so the ratchet in `scripts/document/document-byte-budget.ts` was tightened 18,031 → 6,240 to hold that reduction. **The reclamation was only possible because nothing enforced it** — the ratchet's growth guard catches a document that swells past its ceiling but is blind to one that shrinks and leaves its record standing, which is how chain-rule.md's stale-loose entry survived two reduction epics unseen. So a staleness guard was added beside it (`recorded ≤ actual + slack`): an unrecorded shrink now fails `pnpm josh gate` rather than drifting, so the next reduction epic finds nothing stale to reclaim.

## Why the delivered list carries no count

The paragraph that introduced the delivered rules used to open with a count. It said `Four` and had
been wrong since the fifth row landed, which is what a restated count does; joshuafolkken/kit#1525
removed it. Its replacement then said the enumeration "has grown to nine rows" — and by
joshuafolkken/kit#2891 the table in `rule-delivery.md` carried about twenty-five, the exact drift the
paragraph itself warned about. The merged criterion therefore names `rule-delivery.md` as the single
source of the enumeration and carries no number at all.

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
