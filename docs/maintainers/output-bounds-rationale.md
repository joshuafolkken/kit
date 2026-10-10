# Output bounds — rationale

This is maintainer-only rationale behind `prompts/collaboration-workflow/output-bounds.md`: the
measurements behind the Bash output cap, the alternatives rejected on the way, and the incident that
produced the pipe rule. It is never read during a run, and a change to this file changes no rule. It
moved out of the procedure in joshuafolkken/kit#3177.

## Why 8,000

**The default 30,000 never bound.** Across the latest 25 sessions, 2,333 tool_results were measured.
**Bash output was 87.5% of tool_result tokens (1,848 results, 1,241,642 tokens)**, and of those 1,848
**none exceeded 30,000 characters** — the default cap had never once acted in this project. A cap that
exists but is never reached is the same as no cap. The harness accepts at most 150,000 (`default:30000,
upperLimit:150000` in the `claude` binary).

Bash output length distribution (characters): p50 = 570 / p75 = 1,920 / p90 = 4,421 / p95 = 8,342 /
p99 = 15,989 / max = 28,908.

What eliding the middle would cut at each cap:

| Cap (characters) | Calls affected | Share of all tool_results cut |
| ---------------- | -------------- | ----------------------------- |
| 4,000            | 218 (11.8%)    | 26.6%                         |
| 6,000            | 124 (6.7%)     | 18.2%                         |
| **8,000**        | **95 (5.1%)**  | **12.7%**                     |
| 10,000           | 69 (3.7%)      | 8.7%                          |
| 15,000           | 22 (1.2%)      | 2.5%                          |
| 30,000 (default) | 0              | 0%                            |

**8,000 was chosen because it is the p95.** Nineteen calls in twenty change nothing, and the twentieth
becomes a ranged re-read. 4,000 cuts twice as much but truncates one call in eight, and the re-read
round trips eat back what the cap saved.

**Rejected alternatives for the cap itself:**

- **A PreToolUse guard that refuses unbounded commands.** Refuted by measurement. The top tool_results
  include `cd` (5.4%) and `for` (4.4%), whose leading word says nothing — the command is inside
  `cd <dir> && …` or `for n in …; do …; done`. The second-ranked `sed` (16.6%) is exactly the ranged form
  the Issue recommends, syntactically bounded yet carrying 8,000 tokens a block (`sed -n '30,400p'`).
  **Telling by shape misses on real data**; cutting by size has no such weakness.
- **Truncating through a shared wrapper (a `josh` subcommand or the like).** Whether to go through the
  wrapper becomes the caller's judgement, leaving the very structure the Issue objected to. It fails
  the requirement that the cap be a mechanism.

**What the cap does not reach.** `BASH_MAX_OUTPUT_LENGTH` applies to the Bash tool alone. Measured,
`Read` was 10.6% of tool_results (largest single result 18,991 tokens) and `Agent` 2.3%; both are
outside this cap and are a separate quantity. When the gate reuses a recorded green and skips, it
prints only `✔ this tree is already green …` — two lines, never truncated, and only ever green
(joshuafolkken/kit#1328).

## Why the pipe rule is delivered by a trigger

**The incident.** It happened during joshuafolkken/kit#1546: the second gate printed
`✗ verification gate failed` while the pipeline returned 0. The failure was real (a Prettier format
and one marker test), and **it was caught because the child that ran it read the output**. Reading the exit code alone
would have committed a red tree.

**Rejected alternatives:**

- **Rewrite the worked examples in the procedures.** Rejected: **there is no example to rewrite**.
  Searching every document, prompt and skill found one piped
  verification example — in `docs/josh-commands.md` — and it was the description of this very defect.
  The pipe is not copied from a model; **it is invented fresh every turn**.
- **Write it as a calling convention** ("never pipe the gate", "prefix `set -o pipefail`"). Rejected:
  **the same idea was already rejected**.
  `scripts/time-runtime/time-reported-failure.ts` turned it down because "a convention is either kept or
  not, and what the chart must capture is what was actually done, not what should have been", and
  placed a detector instead. joshuafolkken/kit#1344 and joshuafolkken/kit#1460 also measured prose that
  moved no number.

**Triggered delivery was adopted** (`rule-delivery.md`): `pnpm josh rule:guard` refuses, on the spot, a
`Bash` call where a pass/fail josh check stands before a pipe. **A refusal cannot be skimmed past.**

**The commonest shape is rewritten instead of refused** (joshuafolkken/kit#3570). Almost every
refusal was a check narrowed with `| tail` or `| grep`, and each one cost a round trip only to arrive at
the call `set -o pipefail;` in front would have made — the prefix _is_ the rule's outcome. So when every
pipeline on the line is a check followed only by filters that read their input to the end, the hook returns that call as
`updatedInput` and attaches a note. **An early-exit filter stays refused**: `head`, or a `grep` that
stops at its first match (`-q` / `-m` / `-l` / `-L`), closes the pipe on a check still writing, and
under `pipefail` the check's SIGPIPE turns a passing run into exit 141 — and `head` also cuts the
verdict line josh prints last. **A line that runs anything besides checks is refused too** — a listing
(`git log | head`) would be put under a `pipefail` it was not written for, and since the rewrite
answers `allow`, a command chained beside the check (`&& rm -r dist`) would skip its own permission
prompt. The Codex adapter cannot apply a
rewritten input, so it keeps refusing. Every other guard judges the rewritten call, so another rule's
refusal still wins and the piped-verification row spends no delivery on a call it rewrote.

**The detector stays**. `scripts/time-runtime/time-reported-failure.ts` reads the gate's
own `✗ verification gate failed:` line on top of `is_error`. A hook reaches Claude Code alone — not a
session with the stop switch set, not another harness — so the detector covers the outside and is **the
only path that can measure afterwards whether the rule was kept**. Delivery and detection are not
alternatives: the first prevents, the second counts.

**The boundary is deliberate.** Narrowing a listing with `| head` is the right way to read one, and a
hook refusing it would fire on the commonest shape in the transcript. **Widening a rule makes it
ignored, and an ignored rule is worse than none** — a hook that fires on the wrong turn is worse than
no hook (`rule-delivery.md` → "配送されている規則"). The hook also stays silent on two shapes: a pipeline prefixed with
`set -o pipefail` carries the check's status, and a command string inside quotes (an Issue body such
as `--body "cd x && pnpm josh gate | tail"`) is text, not a call. **Both keep a compliant call from being
refused** — delivery is once per run, so spending it on a compliant call would let a genuinely
swallowing call through later. Silent failure of command substitution itself is a separate rule
(`docs/josh-commands.md` → "`VAR=$(...) && cmd`").

## What the tests pin

- `scripts/lib/bash-output-cap.test.ts` pins that the distributed settings declare the cap, that the
  value is below the harness default 30,000 (so it actually binds), that it does not exceed the
  accepted maximum 150,000, and that the procedure states the same number as the settings. **"Declared"
  alone is not enough** — a cap set back to 30,000 or more is declared and never acts, which is why the
  document was written.
- `scripts/rules/piped-verification-rule.test.ts` pins that the delivered text carries the mechanism,
  the escape hatch and the boundary; that the procedure holds the rule and this file the rejected
  alternatives; and that `rule-delivery.md`'s enumeration has the row. Firing and non-firing are pinned
  both ways by `scripts/rules/delivered-rules.test.ts`.
