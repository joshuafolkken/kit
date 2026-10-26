import { lane_breakdown, type Breakdown, type Stage } from './lane-breakdown'
import { lane_breakdown_implement, type ImplementDetail } from './lane-breakdown-implement'

// A lane's breakdown in words (joshuafolkken/kit#4995): the stages longest first, the implementation's
// tool-call kinds beside it, and the waits taken out last. `josh lane:breakdown` prints it, the overrun
// investigation comments it on the lane's Issue and leads its prompt with it (`lane-overrun.ts`).

const HEADING = 'Net time by stage, longest first'
const EXCLUDED = 'waits taken out (park, outage, usage limit, host sleep)'
const SLEPT = 'of which host sleep'

interface Report {
	breakdown: Breakdown
	detail: ImplementDetail
}

function part_text(part: Stage): string {
	return `${part.name} ${lane_breakdown.minutes_text(part.ms)}`
}

function detail_text(detail: ImplementDetail): string {
	const kinds = detail.kinds.map((kind) => part_text(kind))
	const count = String(detail.background)
	const background =
		detail.background > 0 ? [`${count} backgrounded calls, their waits in editing & thinking`] : []

	return ` (${[...kinds, ...background].join(', ')})`
}

function stage_text(stage: Stage, detail: ImplementDetail): string {
	const is_implement = stage.name === lane_breakdown.IMPLEMENT_STAGE

	return is_implement ? `${part_text(stage)}${detail_text(detail)}` : part_text(stage)
}

function entries_of(report: Report): Array<string> {
	const { breakdown, detail } = report
	const slept = `${SLEPT} ${lane_breakdown.minutes_text(breakdown.slept_ms)}`
	const excluded = `${EXCLUDED} ${lane_breakdown.minutes_text(breakdown.excluded_ms)}, ${slept}`

	return [...breakdown.stages.map((stage) => stage_text(stage, detail)), excluded]
}

// `issue`'s breakdown with its implementation's tool calls read off its transcripts.
function report_of(issue: number, breakdown: Breakdown): Report {
	const calls = lane_breakdown_implement.read(issue, breakdown)

	return { breakdown, detail: lane_breakdown_implement.of(calls, breakdown) }
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
