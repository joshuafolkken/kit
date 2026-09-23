import type { GuardRun } from '#scripts/josh/hook-decision'
import { time_density_hook } from '#scripts/time-runtime/time-density-hook'
import { time_shell } from '#scripts/time-runtime/time-shell'
import { time_transcript_line, type Block } from '#scripts/time-runtime/time-transcript-line'
import { bash_triggers } from './bash-triggers'
import { tail_commands } from './tail-commands'

// The trigger and the decision behind the `filing-cap` row of `delivered-rules.ts`
// (joshuafolkken/kit#2119).
//
// **Automatic filing is capped at 10 Issues per run, refused at the eleventh filing.** §2d and
// `observation-filing.md` state the ceiling; nothing counted it, so a run that over-filed was held
// only by self-restraint. The input is mechanical — how many Issues this run has already filed — so
// it is a delivered rule rather than resident prose. **No new predicate**: the filing is
// `bash_triggers.is_issue_filing`, reused verbatim.
//
// **It fires on every filing past the cap, not once per run.** The subject is a recurring act — one
// more filing — so `DeliveredRule.decide` is the right disposition (joshuafolkken/kit#1570): refused
// once and free afterwards would put the enforcement back on the self-restraint that failed.
//
// **A guard-refused filing does not count.** Claude Code writes a denied call to the transcript as a
// `tool_use` block with an errored `tool_result`, so the WIP cap's own reissue would otherwise
// double-count one Issue — the same exclusion `investigation-reads.ts` makes for a refused read
// (joshuafolkken/kit#1764). The filing is counted only where its result carried no guard refusal.

const FILING_CAP = 10
// The current call is not yet on the tail, so the count read there is of filings *already* made. At
// this many, the call in hand is the eleventh and is refused.
const CAP_REACHED = FILING_CAP

interface TailFilings {
	// The `tool_use` id of every filing on the tail.
	filing_ids: Array<string>
	// Each result's id mapped to the guard that refused it, and `''` for a result no guard refused.
	refusals: Map<string, string>
}

function is_filing_use(block: Block): boolean {
	if (!tail_commands.is_bash_use(block)) return false

	return bash_triggers.is_issue_filing(time_shell.bash_command(block.input))
}

function collect_block(block: Block, found: TailFilings): void {
	if (block.result_id !== '') found.refusals.set(block.result_id, block.refusal_guard)
	if (is_filing_use(block)) found.filing_ids.push(block.id)
}

function collect_line(line: string, found: TailFilings): void {
	const parsed = time_transcript_line.parse_line(line)

	if (parsed === undefined) return

	for (const block of parsed.blocks) collect_block(block, found)
}

function scan_tail(tail: string): TailFilings {
	const found: TailFilings = { filing_ids: [], refusals: new Map<string, string>() }

	for (const line of tail.split('\n')) collect_line(line, found)

	return found
}

// How many Issues the run has already filed, counting only filings no guard refused.
function prior_filing_count(tail: string): number {
	const { filing_ids, refusals } = scan_tail(tail)

	return filing_ids.filter((id) => (refusals.get(id) ?? '') === '').length
}

// A person's prompt: a `user` line carrying no tool result. Tool results ride `user` lines too, so the
// absence of one is what marks the line as typed rather than returned.
function is_prompt_line(line: string): boolean {
	const parsed = time_transcript_line.parse_line(line)

	if (parsed?.type !== 'user') return false

	return parsed.blocks.every((block) => block.result_id === '')
}

// The tail from the last prompt on, so a filing an earlier turn made does not answer for this one
// (joshuafolkken/kit#2422). A tail with no prompt on it is returned whole.
function current_turn(tail: string): string {
	const lines = tail.split('\n')
	const start = lines.findLastIndex((line) => is_prompt_line(line))

	return lines.slice(Math.max(start, 0)).join('\n')
}

// How many Issues this turn has filed — the per-run count read over `current_turn`.
function turn_filing_count(tail: string): number {
	return prior_filing_count(current_turn(tail))
}

// **Fires on every filing past the cap, not once per run.** It records nothing and ignores the
// last-fired instant, so `decide` — which the enumeration asks unconditionally — refuses each filing
// while the count stands at or above the ceiling. `can_record` has nothing to protect for a row that
// writes no stamp.
function decide(_call: unknown, run: GuardRun): boolean {
	return prior_filing_count(time_density_hook.read_tail(run.transcript)) >= CAP_REACHED
}

const FILING_CAP_REASON =
	`⛔ filing cap: this run has already filed ${String(FILING_CAP)} Issues, the per-run ceiling — on ` +
	'reaching it, stop and report rather than filing more. Automatic filing is capped so a run cannot ' +
	'manufacture Issues faster than they can be closed (`.claude/skills/workflow-commands/SKILL.md` → ' +
	"§2d, `observation-filing.md`). A further Issue that genuinely must exist is a person's call, not " +
	"this run's. **This rule fires on every filing past the cap, not once per run**, so reissuing the " +
	'same filing will be refused again.'

// The enumeration row itself, so `delivered-rules.ts` spreads one entry rather than restating the
// trigger and reason it already single-sources here. It declares no `keeps`: staying under a cap is
// not a call, so the row is reported unmeasured rather than scored on an act that does not exist —
// the honest answer `investigation` gives for the same reason.
const ROW = {
	id: 'filing-cap',
	is_trigger: bash_triggers.on_bash_command(bash_triggers.is_issue_filing),
	reason: FILING_CAP_REASON,
	decide,
}

const filing_cap = {
	FILING_CAP,
	FILING_CAP_REASON,
	ROW,
	decide,
	prior_filing_count,
	turn_filing_count,
}

export { filing_cap }
