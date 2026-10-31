import { lane_breakdown, type Breakdown, type Stage } from './lane-breakdown'
import { lane_breakdown_calls, type CallGroup } from './lane-breakdown-calls'
import { lane_breakdown_implement, type ImplementDetail } from './lane-breakdown-implement'
import { lane_breakdown_laps, type Laps } from './lane-breakdown-laps'
import { lane_breakdown_pinned } from './lane-breakdown-pinned'
import { lane_breakdown_related } from './lane-breakdown-related'
import { lane_ci_path_stats } from './lane-ci-path-stats'
import type { LedgerEntry } from './lane-ledger'

// A lane's breakdown in words (joshuafolkken/kit#4995): the stages longest first, the implementation's
// tool-call kinds beside it, and the waits taken out last. `josh lane:breakdown` prints it, the overrun
// investigation comments it on the lane's Issue and leads its prompt with it (`lane-overrun.ts`).

const HEADING = 'Net time by stage, longest first'
const EXCLUDED = 'waits taken out (park, outage, usage limit, yield, host sleep)'
const SLEPT = 'of which host sleep'
const YIELDED = 'of which yield wait'

interface Report {
	breakdown: Breakdown
	detail: ImplementDetail
	// The ship pre-detach line's `test:pinned` detail, `''` when none (joshuafolkken/kit#5078).
	pinned?: string
	// The discarded `run:review` background probes' line, `''` when none (joshuafolkken/kit#5262).
	discarded?: string
	// The `test:related` files past the reach cap, `''` when none (joshuafolkken/kit#5532).
	related?: string
	// The followup's CI wait's last check to settle, `''` when none was recorded (joshuafolkken/kit#5295).
	critical?: string
	// Each ship stage's laps, and the Bash between ship stages, longest first (joshuafolkken/kit#5294).
	laps?: Laps
	// The start to plan's longest call groups (joshuafolkken/kit#5539).
	plan_calls?: ReadonlyArray<CallGroup>
}

// A stage's line, the laps printed under it, and the call groups printed under it in the bullets
// alone — the one-line form leaves them out.
interface Entry {
	text: string
	laps: ReadonlyArray<string>
	calls: ReadonlyArray<string>
}

function part_text(part: Stage): string {
	return `${part.name} ${lane_breakdown.minutes_text(part.ms)}`
}

// A kind's minutes, and the backgrounded subagent calls it counted at no time.
function kind_text(kind: Stage, untimed: ImplementDetail['untimed']): string {
	const count = untimed.get(kind.name) ?? 0

	return count > 0 ? `${part_text(kind)} + ${String(count)} backgrounded, untimed` : part_text(kind)
}

function detail_text(detail: ImplementDetail): string {
	const kinds = detail.kinds.map((kind) => kind_text(kind, detail.untimed))
	const count = String(detail.background)
	const background =
		detail.background > 0 ? [`${count} backgrounded calls, their waits in editing & thinking`] : []

	return ` (${[...kinds, ...background].join(', ')})`
}

// Why a ship stage ran or was skipped, as its event line said (joshuafolkken/kit#5296).
function reason_text(reason: string | undefined): string {
	return reason === undefined ? '' : ` (${reason})`
}

// The detail a stage's line carries after its minutes, `''` for a stage with none.
function suffix_of(name: string, report: Report): string {
	const suffixes: Record<string, string | undefined> = {
		[lane_breakdown.IMPLEMENT_STAGE]: detail_text(report.detail),
		[lane_breakdown.PRE_DETACH_STAGE]: report.pinned,
		[lane_breakdown.FOLLOWUP_STAGE]: report.critical,
	}

	return suffixes[name] ?? reason_text(report.breakdown.reasons?.get(name))
}

// Each implementation kind's longest call groups, the kind leading each line.
function implement_calls(detail: ImplementDetail): Array<string> {
	return detail.kinds.flatMap((kind) =>
		(detail.calls?.get(kind.name) ?? []).map(
			(group) => `${kind.name} › ${lane_breakdown_calls.group_text(group)}`,
		),
	)
}

// The call groups printed under a stage, none for a stage other than the start to plan and the implement.
function calls_of(name: string, report: Report): Array<string> {
	if (name === lane_breakdown.IMPLEMENT_STAGE) return implement_calls(report.detail)
	if (name !== lane_breakdown.PLAN_STAGE) return []

	return (report.plan_calls ?? []).map((group) => lane_breakdown_calls.group_text(group))
}

function stage_entry(stage: Stage, report: Report): Entry {
	const laps = report.laps?.get(stage.name) ?? []

	return {
		text: `${part_text(stage)}${suffix_of(stage.name, report)}`,
		laps: laps.map((lap) => part_text(lap)),
		calls: calls_of(stage.name, report),
	}
}

function entries_of(report: Report): Array<Entry> {
	const { breakdown } = report
	const yielded = `${YIELDED} ${lane_breakdown.minutes_text(breakdown.yield_ms)}`
	const slept = `${SLEPT} ${lane_breakdown.minutes_text(breakdown.slept_ms)}`
	const excluded = `${EXCLUDED} ${lane_breakdown.minutes_text(breakdown.excluded_ms)}, ${yielded}, ${slept}`

	const notes = [report.discarded, report.related].filter(
		(text): text is string => text !== undefined && text !== '',
	)

	const tail = [...notes, excluded].map((text) => ({ text, laps: [], calls: [] }))

	return [...breakdown.stages.map((stage) => stage_entry(stage, report)), ...tail]
}

function bullets_of(entry: Entry): Array<string> {
	return [`- ${entry.text}`, ...[...entry.laps, ...entry.calls].map((lap) => `  - ${lap}`)]
}

function inline_of(entry: Entry): string {
	return entry.laps.length > 0 ? `${entry.text} [${entry.laps.join(', ')}]` : entry.text
}

// `issue`'s breakdown with its implementation's tool calls read off its transcripts, and its ship
// pre-detach's `test:pinned` rows read off `entries`.
function report_of(
	issue: number,
	breakdown: Breakdown,
	entries: ReadonlyArray<LedgerEntry>,
): Report {
	const calls = lane_breakdown_implement.read(issue, breakdown)
	const rows = lane_breakdown_pinned.rows_of(entries, issue, breakdown)

	return {
		breakdown,
		detail: lane_breakdown_implement.of(calls, breakdown),
		laps: lane_breakdown_laps.of(entries, issue, breakdown, calls),
		pinned: lane_breakdown_pinned.detail_text(rows),
		discarded: lane_breakdown_pinned.discarded_text(entries, issue),
		related: lane_breakdown_related.over_cap_text(entries, issue),
		critical: lane_ci_path_stats.last_check_text(entries, issue),
		plan_calls: lane_breakdown_implement.plan_calls(calls, breakdown),
	}
}

// The Issue comment and the printout: a heading, then one bullet per stage.
function comment(issue: number, minutes: number, report: Report): string {
	const lead = `${HEADING}, ${String(minutes)} min of net time`
	const source = `(\`pnpm josh lane:breakdown ${String(issue)}\`):`

	return [
		`${lead} ${source}`,
		'',
		...entries_of(report).flatMap((entry) => bullets_of(entry)),
	].join('\n')
}

// One line, the form the investigation's prompt leads with.
function line(report: Report): string {
	return `${HEADING}: ${entries_of(report)
		.map((entry) => inline_of(entry))
		.join('; ')}.`
}

const lane_breakdown_text = { comment, line, report_of }

export { lane_breakdown_text }
export type { Report }
