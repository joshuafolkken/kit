import type { GuardedCall } from '#scripts/time-runtime/time-batch-guard'
import { bash_triggers } from './bash-triggers'
import { shell_segments } from './shell-segments'
import { tail_commands } from './tail-commands'

// The trigger and the delivered text behind the `issue-scout` row of `delivered-rules.ts`
// (joshuafolkken/kit#2119).
//
// **A filing without `pnpm josh issue:scout` in front of it, refused at the filing itself.** §2e
// requires the scout before every `gh api … issues` call, and a duplicate is likeliest for the work
// that just finished — the one case self-restraint is least able to catch. The input is mechanical —
// did the run already run the scout — so it is a delivered rule rather than resident prose.
//
// **It is `issue-comments`'s shape, not the WIP cap's.** Like that row it is once per run with an
// `already_satisfied` stand-down read off the tail, and the refusal hands over the command rather than
// asking the run to "scout first" — a body-only read is refused so the reissue makes the comments
// present, and here a scout-less filing is refused so the reissue makes the scout present. **No new
// delivery path**: the trigger is `bash_triggers.is_issue_filing`, reused verbatim.

// `pnpm josh issue:scout`, the one act the rule asks for. The alias `isc` is expanded where the
// command is read, so the canonical name matches both spellings (joshuafolkken/kit#1789).
const SCOUT_NAMES: ReadonlySet<string> = new Set(['issue:scout'])

// Keeping the rule: a call that runs the scout. Segment-wise, so a spelling quoted inside a filing's
// own body is not read as the scout that filing skipped.
function runs_the_scout(command: string): boolean {
	return shell_segments
		.segments_of(command)
		.some((segment) => shell_segments.is_josh_command(segment, SCOUT_NAMES))
}

// The `already_satisfied` stand-down: the run has already scouted, so this filing asks for nothing new.
// The tool-name gate the row's trigger applies has already passed, so `call` only marks the shape; the
// answer is entirely in the tail.
function already_scouted(tail: string, _call: GuardedCall): boolean {
	return tail_commands.prior_bash_commands(tail).some((command) => runs_the_scout(command))
}

// The instruction in the shape a refusal can carry: what the call skipped, why it matters most here,
// and the command that fixes it. The duplicate risk is named because it is the half that makes the
// rule believable — the filing most likely to duplicate is the one about work that just finished.
const ISSUE_SCOUT_REASON =
	'⛔ issue scout: this files an Issue with no `pnpm josh issue:scout` earlier in the run. A ' +
	'duplicate is likeliest for the work that just finished, which is exactly where self-restraint is ' +
	'weakest. Reissue after scouting: `pnpm josh issue:scout "<title>"` (add `--body "<one-line ' +
	'summary, citing #N where the work follows one>"` so the epic half can answer), then read its ' +
	'`Duplicates:` — an **open** candidate covering the same work stops the run rather than filing a ' +
	'second Issue, and a `(closed)` one means the work is already done — before reissuing this filing. ' +
	'The procedure is `.claude/skills/workflow-commands/SKILL.md` → §2e. It fires once per run and ' +
	'cannot repeat on the call in hand.'

// The enumeration row itself, so `delivered-rules.ts` spreads one entry rather than restating the
// trigger and reason it already single-sources here. Once per run with the stand-down above.
const ROW = {
	id: 'issue-scout',
	is_trigger: bash_triggers.on_bash_command(bash_triggers.is_issue_filing),
	reason: ISSUE_SCOUT_REASON,
	already_satisfied: already_scouted,
	keeps: bash_triggers.on_bash_command(runs_the_scout),
}

const issue_scout = { ISSUE_SCOUT_REASON, ROW, already_scouted, runs_the_scout }

export { issue_scout }
