import { lane_breakdown, type Breakdown, type Stage } from './lane-breakdown'
import { lane_breakdown_implement, type ImplementDetail } from './lane-breakdown-implement'
import { lane_breakdown_pinned } from './lane-breakdown-pinned'
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
	// The followup's CI wait's last check to settle, `''` when none was recorded (joshuafolkken/kit#5295).
	critical?: string
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

// The detail a stage's line carries after its minutes, `''` for a stage with none.
function suffix_of(name: string, report: Report): string {
	const suffixes: Record<string, string | undefined> = {
		[lane_breakdown.IMPLEMENT_STAGE]: detail_text(report.detail),
		[lane_breakdown.PRE_DETACH_STAGE]: report.pinned,
		[lane_breakdown.FOLLOWUP_STAGE]: report.critical,
	}

	return suffixes[name] ?? ''
}

function stage_text(stage: Stage, report: Report): string {
	return `${part_text(stage)}${suffix_of(stage.name, report)}`
}

function entries_of(report: Report): Array<string> {
	const { breakdown } = report
	const yielded = `${YIELDED} ${lane_breakdown.minutes_text(breakdown.yield_ms)}`
	const slept = `${SLEPT} ${lane_breakdown.minutes_text(breakdown.slept_ms)}`
	const excluded = `${EXCLUDED} ${lane_breakdown.minutes_text(breakdown.excluded_ms)}, ${yielded}, ${slept}`

	const discarded =
		report.discarded === undefined || report.discarded === '' ? [] : [report.discarded]

	return [...breakdown.stages.map((stage) => stage_text(stage, report)), ...discarded, excluded]
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
		pinned: lane_breakdown_pinned.detail_text(rows),
		discarded: lane_breakdown_pinned.discarded_text(entries, issue),
		critical: lane_ci_path_stats.last_check_text(entries, issue),
	}
}

// The Issue comment and the printout: a heading, then one bullet per stage.
function comment(issue: number, minutes: number, report: Report): string {
	const lead = `${HEADING}, ${String(minutes)} min of net time`
	const source = `(\`pnpm josh lane:breakdown ${String(issue)}\`):`

	return [`${lead} ${source}`, '', ...entries_of(report).map((entry) => `- ${entry}`)].join('\n')
}

// One line, the form the investigation's prompt leads with.
function line(report: Report): string {
	return `${HEADING}: ${entries_of(report).join('; ')}.`
}

const lane_breakdown_text = { comment, line, report_of }

export { lane_breakdown_text }
export type { Report }
