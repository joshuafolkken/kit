# Triggered delivery — rationale

This is maintainer-only rationale behind
[`prompts/collaboration-workflow/rule-delivery.md`](../../prompts/collaboration-workflow/rule-delivery.md):
the measurements and arguments that justify the procedure's boundaries and mechanism, and the list
of what each marker test pins. No run reads it — every trigger, action, verdict and boundary an
agent follows stays in the procedure, and a change to this file changes no rule.

## Why delivery is needed

`CLAUDE.md` was packed to within a few tokens of its effective ceiling (6 tokens, about 15–18
characters, when joshuafolkken/kit#1524 was filed), while `prompts/` and
`.claude/skills/` hold fifteen times the resident part. **Only one route — residency — is full.**

Delivery is not only cheaper, it is **stronger**:

|                        | Resident prose                  | Triggered delivery          |
| ---------------------- | ------------------------------- | --------------------------- |
| Cost                   | Every turn                      | Only at the matching moment |
| Is it read?            | It can be skimmed past          | **A refusal cannot be**     |
| Can firing be checked? | No                              | A unit test pins it         |
| Ceiling on the total   | Capped by the effective ceiling | Effectively none            |

**This is measured, not assumed.** joshuafolkken/kit#1344 recorded three consecutive runs in which
the batching instruction moved nothing, as prose and as a runtime note alike; it moved only once it
became a `PreToolUse` hook. The investigation guard (joshuafolkken/kit#1460) followed the same path.
**A rule can sit resident and never fire**, so what a move loses is only prose that was not working.

A move is not a deletion, so it does not wait on joshuafolkken/kit#1477 (measuring what reading the
instruction costs) — that measurement gates **deleting** a rule, not moving it.

## The mechanism

Every delivery rides on `create_transcript_guard` in `scripts/josh/hook-decision.ts`, the one
foundation the batching guard (joshuafolkken/kit#1390) and the investigation guard
(joshuafolkken/kit#1460) already share: the payload schema, the
`deny` envelope, the environment switch, the `.env` read and the record that fires a rule once per
run. A second delivery route would be the one place two of them could disagree about whether a rule
was delivered.

- **The enumeration**: `scripts/rules/delivered-rules.ts` — one rule per row (`id`, trigger, message).
- **The entry point**: `scripts/hooks/pretool-guard-cli.ts` (the guards are composed in
  `scripts/hooks/pretool-guard.ts`), run as `pnpm josh pretool:guard`. It folds the three
  `PreToolUse` guards — batching, investigation and rule — into one process, wired as a **single
  entry** in `.claude/settings.json`'s `PreToolUse` with the matcher
  `Bash|Edit|Read|Write|AskUserQuestion`. A
  batching refusal wins over an investigation refusal, which wins over a rule refusal, and each guard
  still honors its own environment switch.
- **The switch**: `JOSH_RULE_GUARD` for the rule guard — on by default, off with `off` / `0` /
  `false` / `no`. The batching and investigation guards each have their own.

**A delivery may be a rewrite rather than a refusal** (joshuafolkken/kit#3570) — only where the rule's
outcome can be produced mechanically, as the piped-verification row's `set -o pipefail;` prefix is
(`output-bounds-rationale.md`). The call is recorded as typed and nothing errors, so the note the hook
attaches (a row's `rewrite_note`) is the one trace; `scripts/rules/hook-context-line.ts` reads it and
`pnpm josh rule:value` counts it as `rewritten`, a delivery that cost no round trip.

**The rule guard's enumeration holds only rules whose moment is a shell call** (the later `Edit` /
`Write` and `AskUserQuestion` rows aside). Claude Code refuses one call of a turn and runs the rest,
so a refused `Edit` leaves the state where only its siblings were applied (joshuafolkken/kit#1390).

### The Stop hook — a second entry point on the same foundation

`stop:guard` (`scripts/hooks/stop-guard.ts`, run as `pnpm josh stop:guard`, joshuafolkken/kit#2121)
is **the entry point for the `Stop` event**. It is wired as a **single entry** with an empty matcher under `.claude/settings.json`'s
`Stop`, and runs at the end of every turn.

**It shares the foundation and reuses the verdicts.** The switch (`JOSH_STOP_GUARD`) and the `.env`
read come from `hook-decision.ts`; whether a message is a stop notice comes from the pattern in
`lane-park.ts`; whether a hold is in place comes from the `run:hold` record — **no second verdict
mechanism is built**. Whether anything was filed uses the count in `filing-cap.ts`, and whether a
repository is first-party uses the comparison in `repo-party.ts`. Only the event differs: a `Stop`
payload carries no tool call, and all four rows answer with `{"decision":"block","reason":…}`. That
is the only route by which a `Stop` event can put text in front of the model (joshuafolkken/kit#2247).

**Two entry points, one foundation.** "One route, never a new one" forbids a second copy of the
shared part, not an entry point per event. The four `stop:guard` rows are triggered by **the run
stopping**, not by a shell call, so they live in `stop-rules.ts` rather than in `DELIVERED_RULES` in
`delivered-rules.ts`, which is `PreToolUse`-only. Every error lets the stop through (fail-open): each
of the four blocking rows resolves itself (send the notice, release the hold, file the Issue, fix the
citation and reissue the reply), and `stop_hook_active` stops an endless loop.

`backlogrun`'s ordinary parent loop and the fetch of the next Issue are handled by the supervisor
process, so the Stop verdict that made a run fetch the next Issue was removed. On the route that hands
a named epic to a headless session for decisions, the wait for child lanes stays in that session, so
the wait protection stays. Stall and stranded-run detection runs only when a Stop event fires, and is
reported independently of the stop verdict.

### Per-row wiring details

The implementation reuse and verdict details taken out of the procedure's list.

- **The direct-filing refusal** — `issue:file` runs the duplicate search, the body check and type
  label, the `## Origin` check and `epic:bundle`, so none of them is watched by a row of its own
- **The 10-filings-per-run cap** — reuses `is_issue_filing` rather than a new predicate; an
  `issue:file` that exits non-zero is not counted as a filing
- **The early progress report** — a waiting-only `Bash` is one that is `sleep` throughout, or `sleep`
  beside nothing but `echo` / `:` / `date`
- **The idle run tail** — a call carrying `run_in_background` is not the trigger
- **The implementation-phase cut** — the cost is measured with the same statistics and the same
  `CONTEXT_CUT_THRESHOLD` as `pnpm josh cost --cut`, and an unmeasurable cost fires on the safe side
  through `!== UNDER`. It fires every time the threshold is crossed (`decide`,
  joshuafolkken/kit#2385), and it lets the
  immediate reissue of the same edit through, so `busy` / `failed` do not spin
- **The test declaration** — reuses `run_tail_rule`'s commit-stage match rather than a new delivery
  route; the exemption is declared by a person at Step 0, so it is delivered once per run
- **Force push / branch deletion** — `git push` / `git branch` are parsed as argv, so grouped short
  flags (`-uf`) and a `git -C` prefix are judged the same whatever the spelling
- **No file body on the shell** — the existence check is one `stat`
- **The stop notice / releasing the hold** — the hold is read off the `run:hold` record, and a clean
  tree as an empty `git status --porcelain`
- **The Issue-citation format / the offer to file** — reads `last_assistant_message`; whether
  anything was filed uses `filing_cap`'s count, a third party is judged by `repo_party.classify`, and
  the row stays silent while `stop_hook_active` is set
- **Appending to a rule body** — the stand-down came with joshuafolkken/kit#2324: it stands down once the transcript tail records both `oracle:list` and
  `run:step` having run (it passes on "were the questions answered", not on a reminder)
- **An action that skips its oracle** — the refusal is assembled from the registry (decision,
  command, answer vocabulary, single source), never hand-written. `release:scope` sits on the reason
  side: it reads the release owed **after** `pnpm josh followup` merges, so it trails the merge rather
  than gating it (joshuafolkken/kit#2334). An oracle whose firing point cannot be named declares its reason and stays as
  **visible non-enforcement** (`oracle:list` prints the firing point or the reason)

**The four spellings of the trigger.** The filing check covers `-f` / `-F` / `--field` /
`--raw-field`. `gh api --input <file>`, which passes the body as a file, never shows the title in the
string and is not caught; nor is a filing made over REST from inside node (`pnpm josh propagate` and
the like). Delivered alone, the rule would reach only the spellings the pattern knows — which is why
the one resident line stays.

### Posting a comment is not a trigger

The filing rows' triggers look only at **creating** an Issue. `…/issues/<N>/comments` is a comment,
not a filing — comments outnumber filings by an order of magnitude, and a hook that refused there would
be exactly "a hook that fires on the wrong turn". `scripts/rules/delivered-rules.test.ts` pins that
boundary from both sides.

### Reading Issue comments — put them in front of the run, do not ask it to read them

This row came from joshuafolkken/kit#1319. **The trigger is the one call through which the body
arrived, not the start of implementation.**
"The moment implementation starts" cannot be named as one tool call; "the moment an Issue body
reaches the run" can — `gh issue view <N>`, or a GET ending in `…/issues/<N>`. That is where this row
passes the criterion.

**The refusal hands over the re-read command itself, not a request to read the comments too.** A
prose request is the form joshuafolkken/kit#1344 measured to move nothing over three consecutive
runs; this row avoids it
because a body-only read **does not pass**. A `PreToolUse` refusal carries a single string, though,
so **the hook does not inject the comment text** — the run fetches it itself, one round trip later.

**This is the only row whose trigger overlaps `batch:guard`'s.** `time_batch_guard.is_guarded_call`
treats `gh issue view` as a candidate (`gh issue create` it does not). But this row refuses every time
until its prerequisite is met, so it skips the `is_first_delivery` yield branch and refuses even on a
turn that also draws a batching refusal. `delivered-rules.test.ts` pins this.

**The check runs per command, anchored at the start.** One shell line carries several commands, so
each segment split on `&&` / `||` / `;` / a newline is judged separately (`|` is not a separator — it
appears far more often inside `--jq`). Without that, a write quoting `gh issue view` inside its body
(`gh issue comment <N> -b "…"`) would read as a read, and a line such as
`gh issue view <N> && grep -c x` would read as "with comments" off an unrelated `-c`, and the delivery
would vanish.

**A write is not a read.** `gh api` becomes a POST as soon as `-f` / `-F` / `--field` / `--raw-field`
/ `--input` appears, and `kickoff` PATCHes `…/issues/<N>` to normalize the title and fill an empty
body. A call whose method is not explicitly `GET`, or that carries a field flag, is out of scope.

**`-c` does not count as "with comments".** `gh issue view <N> -c` is a correct read, but `-c` belongs
to `wc` / `grep` / `sort` far more often, and accepting it anywhere on the line would silence the rule
on every compound line ending in a pipe. The row errs toward costing one round trip, and only three
spellings count as "with comments": `--comments`, `comments` in `--json`, and the `…/comments`
endpoint. The last is needed because batching folds the body and the comments into one line.

**It still sees only the shell string.** A route that reads the body over REST from inside node is
never caught. That is why the procedure itself lives in `issue-comments.md`, and the hook only
reinforces it.

## One delivery per run

The record is the stamp `hook-decision.ts` keeps. **Once per run is right only for a row whose
refusal changes what the run knows.** Reading the comments, counting Issues, writing a body to a
file — once delivered, the run carries on knowing it.

### Exception — a row that stops a repeated action fires every time

When the thing to stop is itself a repeated action, a one-time delivery means "free once refused
once", and enforcement falls back on the parent's restraint. That restraint is what failed in
joshuafolkken/kit#1570: the parent set a fresh waiting timer every time it woke, several ran at
once, and progress reports landed every few minutes instead of once per interval. So **a row that
owns its own `decide` is outside once-per-run and refuses every time its condition holds**.

**For such a row, the yield branch shared with `batch:guard` protects something else.** A
once-per-run row protected its **record** — losing the race would waste the run's only delivery. A
call that sets a waiting timer is by definition a single `Bash`, a shape the batching guard also
treats as a candidate, so **yielding the refusal as well would let a reissue inside the 10-second
window silence the rule entirely**. The refusal is therefore unconditional, and the yield is passed to
the row as "may this be recorded" — what must not happen on a call another hook can stop is recording
a timer that never ran as alive.

### Exception — a row that demands a prerequisite refuses until it is met

**A row with `already_satisfied` (is the prerequisite action at the transcript tail?) is outside
once-per-run** (joshuafolkken/kit#2807). Kept once-per-run, a run that skipped the prerequisite would pass on its reissue, and
the run that skimmed the procedure would be the one that walked past the guard. The rows are
`issue-comments`, `rule-body` and `oracle-consulted:*`. A run that complies is never
stuck — once the prerequisite is done, the stand-down answers first and lets it through. There is no
record to use up either, so it does not yield to `batch:guard` (yielding would let a reissue inside
the 10-second window through without the prerequisite).

**When the evidence of the prerequisite cannot be read, the default is to refuse.** A deliberate
pass is explained in a code comment. The current ones:

- The transcript itself cannot be read (`hook-decision.ts`)
- No progress record (`early-heartbeat.ts`)
- A failed git read treated as no change (the `test-declared` row in `delivered-rules.ts`)

## Shell evaluation of a body is one more row of the same mechanism

A comment body put on the shell runs its backticks as commands. **One more row of this mechanism
covers it**: no new mechanism was needed, only the `shell-body` row in `delivered-rules.ts` and the
tests that pin when it fires and when it does not. (joshuafolkken/kit#1542, where this was first
planned, was closed as a duplicate of joshuafolkken/kit#1198, so the work landed under
joshuafolkken/kit#1198.)

**The trigger is narrower than a flag.** It does not fire on the `-f body=` / `--body "` flag; it fires
**only when a double-quoted body value actually contains `` ` `` or `$`**. Every example in this
repository's prompts passes a placeholder (`-f body="<plan>"`), which is harmless, so a flag trigger
would **refuse on turns that already follow the rule** — against the procedure's "a hook that fires on
the wrong turn is worse than no hook". `!` (history expansion) is not a trigger either — it was
measured not to fire in non-interactive zsh. The rule body and the trigger's blind spots are in
[`shell-body.md`](../../prompts/collaboration-workflow/shell-body.md).

## Marker tests

The suites pinning the delivery list's items are `scripts/rules/turn-batching-rule.test.ts`,
`scripts/rules/shell-body-rule.test.ts`, `scripts/rules/piped-verification-rule.test.ts`,
`scripts/rules/pre-gate-cut.test.ts`, `scripts/rules/implementation-cut-rule.test.ts`,
`scripts/rules/implementation-cut.test.ts`, `scripts/rules/lane-park.test.ts`,
`scripts/rules/lane-interactive-ask.test.ts` and `scripts/rules/rule-body-guard.test.ts`. What each
test file pins:

- `scripts/rules/delivered-rules.test.ts` — each entry **actually fires** on its trigger and is silent
  otherwise. Prose that did not work is where this mechanism started, so **a move that does not fire
  is not a move**
- `scripts/claude/claude-settings-hooks.test.ts` — `rule:guard` is wired under `PreToolUse` naming
  `Bash` alone, declares a timeout and points at a josh subcommand that exists
- `scripts/backlog/backlog-manufacturing-rule.test.ts` — the WIP cap exists in `wip-cap.md` as its
  single source, and the hold `issue:file` prints carries the refusal, the two exemptions and the
  three conditions that decide an exemption (no longer a delivered row since joshuafolkken/kit#3423)
- `scripts/rules/turn-batching-rule.test.ts` — the batching message carries the criterion, and points
  at `turn-batching.md` in this directory rather than at `CLAUDE.md`
- `scripts/document/document-markers.test.ts` — the early-progress-report procedure exists as its
  single source in its section of `.claude/skills/workflow-commands/backlogrun.md`, and this document
  states the row and its once-per-run exception. `scripts/rules/early-heartbeat.test.ts` pins when it
  fires, when it does not, and that it fires every time
- `scripts/rules/issue-comments-rule.test.ts` — the comment-reading procedure exists in
  `issue-comments.md` as its single source, and the three `#N` entries **point at it without
  restating it** (copying the conflict rule into three places would be a clone). The pair keeps the
  rule alive in a session the hook does not reach
- `scripts/rules/shell-body-rule.test.ts` — shell evaluation of a body exists in `shell-body.md` as
  its single source, and the message carries the damage, the safe spelling and the reissue instruction
- `scripts/rules/raw-field-body.test.ts` — pins the predicate and the message wording for the raw-field
  `body=@` misfire (joshuafolkken/kit#2304). `scripts/rules/delivered-rules-bash.test.ts` pins firing on the real delivery route
  (`-f` / `--raw-field body=@`), silence (`-F` / `--field body=@`, a body without `@`,
  `pnpm josh issue:comment`), and that only one row claims a command
- `scripts/rules/piped-verification-rule.test.ts` — piping a verification command exists in
  `output-bounds.md` as its single source, the message carries the mechanism, the way out and the
  boundary, and read-only listings are left alone
- `scripts/rules/pre-gate-cut-rule.test.ts` — the pre-gate cut procedure exists as its single source
  in `.claude/skills/workflow-commands/pre-gate-cut.md`, and both this document and
  `docs/josh-commands.md` state the trigger. `scripts/rules/pre-gate-cut.test.ts` pins firing and
  silence (it refuses only for a lane with the marker that has not cut, and is silent for a person
  without the marker, outside a lane, or after the cut)
- `scripts/rules/implementation-cut-rule.test.ts` — the implementation-phase cut procedure exists as
  its single source in `.claude/skills/workflow-commands/pre-gate-cut.md` → "It is a guard, fired at
  the edit that crosses the threshold", and the message carries that section, the instruction and the
  re-arming contract (a resume clears the record and re-arms both guards, joshuafolkken/kit#2310).
  `scripts/rules/implementation-cut.test.ts` pins firing and silence (it refuses only an `Edit` /
  `Write` over the threshold by a lane child with the marker that has not cut, and is silent outside
  a lane, without the marker, for a non-edit, after the cut and under the threshold)
- `scripts/rules/delivered-rules-filing.test.ts` — a direct filing (`gh issue create`, a POST with a
  `title` to `…/issues`) is refused every time and pointed to `pnpm josh issue:file`, and the
  `issue:file` call itself is not refused. The same suite pins that the cap and fold rows fire on an
  `issue:file` call, and that a failed `issue:file` call is not counted as a filing
- `scripts/rules/filing-cap.test.ts` — pins the filing count (a refused filing is not counted).
  `scripts/rules/delivered-rules.test.ts` pins firing and silence (silent through the tenth, refused at
  the eleventh, every time)
- `scripts/rules/lane-park-rule.test.ts` — the lane child's park procedure exists as its single source
  in `.claude/skills/workflow-commands/pre-gate-cut.md`, and the message points at that section.
  `scripts/rules/lane-park.test.ts` pins firing and silence (it refuses only a lane child's stop
  notice, and is silent outside a lane, without the marker, or when the message is not a stop notice)
- `scripts/rules/lane-interactive-ask-rule.test.ts` — the lane child's interactive-ask procedure exists
  as its single source in `.claude/skills/workflow-commands/pre-gate-cut.md` → "The interactive ask is
  refused one call earlier", and the message points at that section (joshuafolkken/kit#2201).
  `scripts/rules/lane-interactive-ask.test.ts` pins firing and silence (it refuses only a lane child's
  `AskUserQuestion`, and is silent outside a lane, without the marker, or for a non-interactive tool)
  and that it fires every time; `scripts/agent/interactive-ask.test.ts` pins extracting the question
  and the options from the exit record
- `scripts/rules/lane-switch-main.test.ts` — pins the predicates (`switch_target` /
  `is_switch_away_from_lane`) that refuse a lane child's `git switch main` (joshuafolkken/kit#2313)
  before it fails, and the
  message wording. The procedure's single source is `.claude/skills/workflow-commands/backlogrun-lanes.md`
  / `backlogrun-child.md`. The same suite pins firing and silence (it refuses only a lane child
  switching to a branch other than its own lane branch, and is silent for its own branch, a create or
  detach, outside a lane, and in the main checkout), that it fires every time, and that only one row
  claims a command
- `scripts/rules/git-argv.test.ts` / `scripts/rules/git-force.test.ts` /
  `scripts/rules/worktree-guard.test.ts` / `scripts/rules/file-body.test.ts` — pin the predicates and
  message wording of the three groups of Bash-string rows (joshuafolkken/kit#2120). `scripts/rules/delivered-rules-bash.test.ts`
  pins firing and silence on the real delivery route, and that only one row claims a command
- `scripts/rules/index-guard.test.ts` / `scripts/rules/destructive-command.test.ts` /
  `scripts/rules/protected-files.test.ts` — pin the predicates of the three rows that stop the
  paraphrases slipping past the deny list's prefix match (joshuafolkken/kit#2983) by parsing arguments and paths.
  `permission-guards.ts` folds the three into one and hands them to the enumeration
- `scripts/rules/direct-pr-create.test.ts` — pins the predicate that stops a direct PR creation which
  never generates `closes #N` (`gh pr create`, a `gh api` write to pulls, joshuafolkken/kit#3183). It is delivered as the
  fourth row of `permission-guards.ts`
- `scripts/rules/rule-body-guard.test.ts` — pins the predicate, the message and the enumeration entry
  for an `Edit` / `Write` that appends a rule body to prose (joshuafolkken/kit#2272). This one suite pins firing (an append to
  a rule document), silence (a typo fix, a link swap, a deletion, a non-rule file, a non-Edit/Write),
  and, on the real delivery route, "refused every time until both commands have run". The same suite
  checks that the message carries question 0 (`oracle:list`) and the ordering question (`run:step`),
  and that the single source is `residency.md`
- `scripts/rules/stop-rules-rule.test.ts` — pins the single sources of the four stop rules (the stop
  notification in `CLAUDE.md`, `working-tree-hold.md`, `observation-filing.md`, `issue-citation.md`)
  and their entry in `pnpm josh rule:list`. `scripts/rules/stop-rules.test.ts`,
  `scripts/rules/filing-offer.test.ts` and `scripts/rules/issue-citation.test.ts` pin firing and
  silence (hold × no notice blocks; clean × hold blocks; dirty or notified is silent;
  `stop_hook_active` is silent; an unattended offer to file × nothing filed blocks, while an interactive session, filed, a third-party
  repository or an unknown owner is silent; a bare `#N` blocks, while one in link form, a code fence,
  inline code, a quoted line or a PR reference is silent), and
  `scripts/claude/claude-settings-hooks.test.ts` pins the `Stop` hook's wiring
