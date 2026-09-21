import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { bash_triggers } from './bash-triggers'
import { shell_segments } from './shell-segments'

// A dispatched lane child is stopped from running its parent's budget commands, and told the live
// carry record is its parent's rather than a competing run (joshuafolkken/kit#2267).
//
// **A child read its own parent as a competitor and refused to implement.** On 2026-09-21, inside
// `backlogrun #2252`, a lane launched for #2258 stopped before touching a line: the child ran
// `pnpm josh run:merge`, was answered `busy`, and read that as another session holding the run budget
// over the same Issue. It parked #2258 with `needs-decision` and exited. **The "other session" was the
// parent that launched it** — the parent holds the repository's one carry budget, and every lane
// shares the common git directory that budget is keyed on, so the live owner a lane child reads is
// always its parent. `run:merge` and `run:carry` are the parent's own budget/ownership commands; a
// child has no business running either, and the `busy` it gets back is never a competitor.
//
// **The judgement material already exists.** `JOSH_LANE_CHILD` (`lane-child-marker.ts`) is the same
// mechanical human-or-child fact the pre-gate cut and the interactive-ask refusal already read: a
// person working in a lane carries no mark and sees no refusal, and a mark naming a *different* issue
// leaked in from a parent session and is read as absent. The budget/ownership path reads it here so
// the parent's record is resolved as the child's own parent, not a conflict.
//
// **The stop is one shell call, so the rule is delivered rather than resident** — a lane child is
// always a `claude -p` process, so this leaves residency entirely
// (`prompts/collaboration-workflow/rule-delivery.md`). It fires on every occurrence, not once per run:
// a child must never run these commands, so the route is always "continue implementing", never a
// reissue — the disposition `git-force.ts` and `lane-interactive-ask.ts` take for the same
// "must never happen" reason.

// The parent backlogrun budget/ownership commands. A child never runs either: `run:carry` begins and
// advances the run budget the parent owns, and `run:merge` counts a returned child into it. Named in
// canonical form only — `shell_segments.is_josh_command` canonicalizes an alias (`rc`, `rmg`) before
// the match, so `pnpm josh rmg` arrives as `run:merge`.
const RUN_BUDGET_COMMANDS: ReadonlySet<string> = new Set(['run:merge', 'run:carry'])

// A segment that invokes one of the parent's budget commands. Segment-wise and alias-expanded for the
// reason every command predicate in this directory is: one shell line carries several commands, and a
// name quoted inside a body is not the command being invoked.
function invokes_budget_command(command: string): boolean {
	return shell_segments
		.segments_of(command)
		.some((segment) => shell_segments.is_josh_command(segment, RUN_BUDGET_COMMANDS))
}

// **The command test comes first and the world is consulted second**, so the `is_child_of` read — the
// dispatch mark against this checkout's own issue — runs only on the handful of calls that invoke a
// budget command, not on every `Bash` call in the run. A person working in a lane carries no mark and
// sees no refusal, exactly as `lane-park.ts` and `lane-interactive-ask.ts` gate their own reads.
function is_carry_conflict(
	command: string,
	is_lane_child: boolean = lane_child_marker.is_child_of(process.cwd()),
): boolean {
	if (!invokes_budget_command(command)) return false

	return is_lane_child
}

// The instruction in the shape a refusal can carry: what the child cannot do, why the record is not a
// conflict, and the mechanical branch to take instead — continue, never park or ask. **The procedure
// is named, not restated** — its single sources are `pre-gate-cut.md` and `backlogrun-progress.md` →
// "The hand-off", and a second copy here would be the clone `CLAUDE.md` prohibits. Apostrophes are
// avoided so the single-quoted literal needs no escaping, as the sibling reasons do.
const LANE_CARRY_CONFLICT_REASON =
	'⛔ lane child carry conflict: this session is a dispatched lane child, and ' +
	'`pnpm josh run:merge` / `pnpm josh run:carry` are the parent backlogrun budget commands — a child ' +
	'must never run them. The live carry record here belongs to the parent that launched this child, ' +
	'not to a competing run: the parent holds the one run budget for the repository, and every lane ' +
	'shares the common git directory it is keyed on, so a live owner a lane child reads is always its ' +
	'parent (joshuafolkken/kit#2267, measured 2026-09-21 in backlogrun #2252 — a child read run:merge ' +
	'`busy` as a competitor and parked #2258 unimplemented). Do not run this command, and do not treat ' +
	'it as a conflict: no `needs-decision`, no `confirmation` Telegram, no question to a person — a ' +
	'dispatched child cannot ask, and there is nothing to decide. Continue implementing this Issue; the ' +
	'parent owns the budget and counts the outcome at the return. The procedure is ' +
	'`.claude/skills/workflow-commands/pre-gate-cut.md` and `backlogrun-progress.md` → "The hand-off". ' +
	'This rule fires on every occurrence, not once per run.'

// The row itself, so `delivered-rules.ts` spreads one entry. `is_trigger` reads the input through
// `on_bash_command` — the `Bash` tool-name gate every command row shares — and `decide` returns true
// so it refuses every occurrence. It declares no `keeps`: continuing is the absence of a call, not a
// call, so the row is reported unmeasured rather than scored on an act that does not exist
// (`git-force.ts`).
const ROW = {
	id: 'lane-carry-conflict',
	is_trigger: bash_triggers.on_bash_command(is_carry_conflict),
	reason: LANE_CARRY_CONFLICT_REASON,
	decide: (): boolean => true,
}

const lane_carry_conflict = {
	LANE_CARRY_CONFLICT_REASON,
	ROW,
	invokes_budget_command,
	is_carry_conflict,
}

export { lane_carry_conflict }
