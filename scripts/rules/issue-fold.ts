import type { GuardedCall } from '#scripts/time-runtime/time-batch-guard'
import { bash_triggers } from './bash-triggers'
import { filing_cap } from './filing-cap'
import { shell_segments } from './shell-segments'
import { tail_commands } from './tail-commands'

// The trigger and the delivered text behind the `issue-fold` row of `delivered-rules.ts`
// (joshuafolkken/kit#2213).
//
// **A second filing in one run with no `pnpm josh issue:fold` in front of it, refused at that second
// filing.** A run that files several findings from one session should first ask whether they fold
// into one Issue — the filing-time counterpart to the split assessment. The **first** filing asks
// nothing: there is nothing yet to fold it with, which is why the rule stands down when no earlier
// filing is on the tail. From the second on the run holds two or more findings and the fold question
// binds. The input is mechanical — has the run filed before, did it fold — so it is a delivered rule
// rather than resident prose.
//
// **It is `issue-scout`'s shape, not `filing-cap`'s.** Once per run with an `already_satisfied`
// stand-down read off the tail: a filing with no prior filing is stood down (nothing to fold), and so
// is one the run has already folded. The refusal hands over the command rather than asking the run to
// "fold first". **No new predicate**: the filing trigger is `bash_triggers.is_issue_filing`, and the
// prior-filing count is `filing_cap.prior_filing_count`, both reused verbatim.

// `pnpm josh issue:fold`, the one act the rule asks for. The alias `isf` is expanded where the command
// is read, so the canonical name matches both spellings.
const FOLD_NAMES: ReadonlySet<string> = new Set(['issue:fold'])

// Keeping the rule: a call that runs the fold. Segment-wise, so a spelling quoted inside a filing's
// own body is not read as the fold that filing skipped.
function runs_the_fold(command: string): boolean {
	return shell_segments
		.segments_of(command)
		.some((segment) => shell_segments.is_josh_command(segment, FOLD_NAMES))
}

// The `already_satisfied` stand-down. Two runs ask nothing new: one with no earlier filing — the first
// filing has nothing to fold with — and one that has already folded. Only the second-or-later filing
// of an unfolded run is left for the delivery. `prior_filing_count` counts real filings, excluding a
// guard-refused one, exactly as `filing-cap` reads it (no clones).
function already_folded(tail: string, _call: GuardedCall): boolean {
	if (filing_cap.prior_filing_count(tail) === 0) return true

	return tail_commands.prior_bash_commands(tail).some((command) => runs_the_fold(command))
}

// The instruction in the shape a refusal can carry: what the call skipped, the criterion it reuses,
// and the command that fixes it. The default is named because it is the half that makes the rule
// believable — fold is what a session's several findings do unless the size clearly forbids it.
const ISSUE_FOLD_REASON =
	'⛔ issue fold: this run has filed an Issue before and is filing another with no `pnpm josh ' +
	'issue:fold` between them. Several findings from one session fold into one Issue by default — the ' +
	'filing-time counterpart to the split assessment, whose two questions it reuses: are the findings ' +
	'separable, and does the whole clearly exceed one verification gate (the size half is ' +
	'`split:assess`, called not recomputed). Reissue after folding: `pnpm josh issue:fold "<title>" ' +
	'"<title>" …` — `fold` means file one Issue covering them, `separate` means file them apart ' +
	'(separable findings whose combined size clears the split guide), and the default is `fold`. Add ' +
	'`--not-separable` when they are really one deliverable. The procedure is ' +
	'`.claude/skills/workflow-commands/split-assessment.md` → "The question". It fires once per run ' +
	'and cannot repeat on the call in hand.'

// The enumeration row itself, so `delivered-rules.ts` spreads one entry rather than restating the
// trigger and reason it already single-sources here. Once per run with the stand-down above.
const ROW = {
	id: 'issue-fold',
	is_trigger: bash_triggers.on_bash_command(bash_triggers.is_issue_filing),
	reason: ISSUE_FOLD_REASON,
	already_satisfied: already_folded,
	keeps: bash_triggers.on_bash_command(runs_the_fold),
}

const issue_fold = { ISSUE_FOLD_REASON, ROW, already_folded, runs_the_fold }

export { issue_fold }
