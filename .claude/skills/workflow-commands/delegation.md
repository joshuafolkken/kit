# Delegation decisions — `SKILL.md` §2b's procedure

Read this file when the first delegation decision arises during a run, not at workflow entry.

Designing, assessing a split and reviewing are judgement; applying a fix the gate has already named is
not. The steps whose answer is already decided go to a cheaper execution tier, and the judgement stays
where it is.

**Ask before delegating any step of a run**, and use what it answers:

```bash
pnpm josh delegate <step>   # → delegate | keep ; the reason on stderr
pnpm josh delegate --list   # the enumeration, and what was rejected and why
```

**Never decide it yourself. Anything not on the list is `keep`.** A step earns its place by naming
**how a wrong result is caught** cheaply in the parent tier, not merely by being unlikely to fail.
`pnpm josh delegate --list` names both delegatable and rejected steps; a rejected step either has no
verifier or lets a wrong result propagate too far. The command distinguishes `kept deliberately`
from `kept by default`. `docs/josh-commands.md` → "`josh delegate`" carries the full enumeration.

**The mechanism is not the unit.** `pnpm josh delegate` covers a run step, a file-disjoint Step 0
implementation unit (`pnpm josh fanout`), and `epic-child` — an epic's child and a named issue of a
`backlogrun` alike. Do not add a second batch-child mechanism. Read `backlogrun-child.md` → "Each child
runs in a delegated unit" at child dispatch; `backlogrun-steps.md` → "Named issues run first, in order"
applies to named issues. `docs/josh-commands.md` → "`josh fanout`" carries file-disjoint dispatch.

**`followup-filing` delegates the late review-finding filing chain** with the parent's finding text;
the parent verifies the new Issue using `pnpm josh issue:state <new>`. For `epic-child`, the parent
likewise verifies `pnpm josh issue:state <N>` after the unit returns. Read `human_review:` too: an open
`needs-human-review` child is the authorized stop (`SKILL.md` → §2z), not a failed child. The per-entry
classification lives in `backlogrun-child.md` → "Each child runs in a delegated unit".

## The pre-implementation reading — what goes to a unit, and from which file

**Delegate reading that explains the Issue's subject; keep reading files this run will edit in the
main line.** The unit returns conclusions with `file:line` citations, never the file text. It may run
a temporary probe script and return its output.

**The threshold is 3 files, and it is a count, not a forecast.** When the next read reaches it,
delegate the unread investigation. Brief the unit on what was already read; do not re-read it there.
**A delegation resets the counter rather than spending it**; `pnpm josh investigation:guard` counts
unedited files and refuses the threshold read. `pnpm josh delegate --list` prints the threshold.
`docs/josh-commands.md` → "`josh investigation:guard`" carries the command's counting details.

**The main line does not idle while the unit reads:** read files this run will edit, then verify the
unit's cited lines. Independent investigations launch together; a brief that needs another unit's
answer waits for that answer.

**When the Issue already names the file, function or rule, read that edit target in the main line.**
It is not `survey`, and it is not `diagnosis`: the unit describes how the subject works;
the main line decides what that means and what to change.
