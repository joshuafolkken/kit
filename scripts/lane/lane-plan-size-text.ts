import { issue_body_keys } from '#scripts/issue/issue-body-keys'
import { session_cite } from '#scripts/issue/session-cite'
import { split_assess, type SplitGuide } from '#scripts/split/split-assess'
import { lane_plan_moves } from './lane-plan-moves'
import { lane_plan_new_files, type NewFilesFloor } from './lane-plan-new-files'
import { lane_stage_budget } from './lane-stage-budget'

// What `josh lane:plan` prints for a plan past its size bar (`lane-plan-size.ts`). Every `split` names
// both ways on: carve a separately-mergeable part off as a follow-up this Issue does not wait on, or —
// one deliverable, or a carve-off what stays would wait on (joshuafolkken/kit#8661) — run again with
// `--single`, the child's own tier-A step. A carve-off the rest waits on is a pure serial chain, slower
// than one Issue (split-assessment.md → "The question", 3).

interface FilesOver {
	reason: 'files'
	declared: number
	limit: number
	kept: ReadonlyArray<string>
	split_off: ReadonlyArray<string>
}

interface MeasureOver {
	reason: 'hunks' | 'lines'
	declared: number
	limit: number
	measured: number
	floor?: NewFilesFloor | undefined
	moved?: number | undefined
}

// `limit` is the test-file cap the hubs' reach passes.
interface HubOver {
	reason: 'hub'
	limit: number
	hubs: ReadonlyArray<string>
}

type Oversize = (FilesOver | MeasureOver | HubOver) & { guide?: SplitGuide }

const SIZE_PREFIX = issue_body_keys.prefix('size')
const SINGLE_HINT =
	'`--single "<why it cannot be merged in parts>"` — the reason goes on the Issue and the ledger'
const FILE_SPLIT = '`pnpm josh issue:file "<title>" --body-file <body.md> --route split`'

function bar_tail(): string {
	return `A \`${split_assess.REASON_PREFIX}\` comment does not pass this bar — split-assessment.md → "${split_assess.QUESTION_SECTION}".`
}

// The way on with no split: one deliverable, or a carve-off what stays would wait on.
function single_way(): string {
	return `What stays would wait on the carved part's merge, or it is one deliverable → that is no split (split-assessment.md → "${split_assess.QUESTION_SECTION}", 3): run this \`lane:plan\` again with ${SINGLE_HINT} — your own step, no park. ${bar_tail()}`
}

function files_text(issue: number, over: FilesOver): string {
	const planned = [...over.kept, ...over.split_off]
	const counted = split_assess.units_of(planned, new Set()).length
	const bar = `${String(counted)} files (tests included, generated artifacts excluded), over ${String(over.limit)} — ${String(over.limit / over.declared)} times the ${String(over.declared)} its \`${SIZE_PREFIX}\` declares`
	const replan = ['pnpm josh lane:plan', String(issue), ...over.kept].join(' ')

	return `split (files): ${session_cite.issue(issue)}'s plan holds ${bar}, so it is not recorded. Keep in this Issue: ${over.kept.join(', ')}. Split off: ${over.split_off.join(', ')} — file them as a follow-up Issue this one does not wait on with ${FILE_SPLIT}, revert any edit to them here, run \`${replan}\`, and ship this Issue on the kept files. ${single_way()}`
}

function waiver_text(issue: number, over: Oversize): string {
	return `size warning (${over.reason}): ${session_cite.issue(issue)}'s plan is past its ${String(over.limit)} bar, recorded and noted on the ledger — a warning, not a stop; finish this Issue, never split it — an overrun past the cap at the merge is recorded as a pre-split miss (split-assessment.md → "${split_assess.NOTICE_SECTION}").`
}

function measure_bar(over: MeasureOver): string {
	if (over.reason === 'hunks') {
		return `change holds ${String(over.measured)} hunks outside the plan's files (tests excluded), over ${String(over.limit)} — ${String(over.limit / over.declared)} times the ${String(over.declared)} files its \`${SIZE_PREFIX}\` declares`
	}

	const floor =
		over.floor === undefined ? '' : `, and ${lane_plan_new_files.floor_text(over.floor)}`
	const moved = over.moved === undefined ? '' : `, and ${lane_plan_moves.moved_text(over.moved)}`

	return `\`${SIZE_PREFIX}\` declares ${String(over.declared)} lines, about ${String(over.measured)} at the lines lanes ran over their declaration${floor}${moved} — over the ${String(over.limit)} declared lines the size bar allows`
}

function measure_text(issue: number, over: MeasureOver): string {
	return `split (${over.reason}): ${session_cite.issue(issue)}'s ${measure_bar(over)}, so the plan is not recorded. Carve a separately-mergeable part off as a follow-up Issue this one does not wait on with ${FILE_SPLIT}, revert any edit to it here, and run \`pnpm josh lane:plan ${String(issue)} <paths>\` again on what stays. ${single_way()}`
}

function hub_text(issue: number, over: HubOver): string {
	return `split (hub): ${session_cite.issue(issue)}'s plan edits ${over.hubs.join(', ')}, whose \`test:related\` reach passes the ${String(over.limit)}-test-file cap, so the plan is not recorded. Carve the hub edit off as a follow-up Issue this one does not wait on with ${FILE_SPLIT}, revert any edit to it here, and run \`pnpm josh lane:plan ${String(issue)} <paths>\` again on what stays. ${single_way()}`
}

function over_text(issue: number, over: Oversize): string {
	if (over.reason === 'files') return files_text(issue, over)

	return over.reason === 'hub' ? hub_text(issue, over) : measure_text(issue, over)
}

function refusal_text(issue: number, over: Oversize): string {
	const text = over_text(issue, over)
	const { implement } = lane_stage_budget.BUDGET_MINUTES
	const guide = over.guide ?? split_assess.guide_for(implement, undefined)

	return `${text} ${split_assess.policy_text(guide)}`
}

const lane_plan_size_text = { refusal_text, waiver_text }

export type { FilesOver, HubOver, MeasureOver, Oversize }
export { lane_plan_size_text }
