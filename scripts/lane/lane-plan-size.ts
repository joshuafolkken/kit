import type { OpenIssueData } from '#scripts/git/git-schemas'
import { session_cite } from '#scripts/issue/session-cite'
import { size_estimate } from '#scripts/issue/size-estimate'
import { split_assess } from '#scripts/split/split-assess'
import { test_declared_logic } from '#scripts/test/test-declared-logic'
import type { LanePlan } from './lane-plan'

// The size bar `josh lane:plan` holds a plan to (joshuafolkken/kit#5533): a plan whose files outgrow
// twice the size estimate its Issue declares is refused, not recorded, and the lane splits the rest
// off rather than writing why it stays one. Two lanes declared at 4 files planned 9 with that comment
// and shipped 16 and 18, their implement step twice the median. Files count as the declaration counts
// them (`size-estimate.ts`): tests excluded, documents and snapshots included. An Issue with no
// declaration — an epic — or one declaring 0 files, as `lane:stats` skips it, is never refused.
//
// **Two more axes answer `split`** (joshuafolkken/kit#5568), since declarations run short — merged lanes
// changed 1.5 times the files and 1.8 times the lines they declared, so twice the files alone rarely
// fired: the probed hunks past twice the declared files, and the declared lines times the period's
// `lines actual / declared median` (`DEFAULT_LINES_RATIO` without one) past the line guide (200 declared lines at 1.8 split). Both
// stand down once the lane has filed a split child: the lines axis reads the declaration alone, and the
// hunks the tree already holds would otherwise refuse every re-plan the ship's `unplanned` stop asks for.
// The lines axis also stands down on a re-plan of a cleared plan (joshuafolkken/kit#5600): the
// declaration was judged when the plan cleared, and a plan cleared before #5568 would be refused on
// every re-plan. A yielded plan the entry probe recorded never met the bar, so it still does.

type SplitReason = 'files' | 'hunks' | 'lines'

// What `lane:plan` measured beside the plan (`lane-plan-signals.ts`).
interface PlanSignals {
	hunks: number
	lines_ratio: number | undefined
	split_filed: boolean
}

interface FilesOver {
	reason: 'files'
	declared: number
	limit: number
	kept: ReadonlyArray<string>
	split_off: ReadonlyArray<string>
	tests: ReadonlyArray<string>
}

interface MeasureOver {
	reason: 'hunks' | 'lines'
	declared: number
	limit: number
	measured: number
}

type Oversize = FilesOver | MeasureOver

interface Declared {
	files: number
	lines: number
}

const DEFAULT_LINES_RATIO = 1.8

function declared_of(issue: number, issues: ReadonlyArray<OpenIssueData>): Declared | undefined {
	const body = issues.find((candidate) => candidate.number === issue)?.body
	const size = body === undefined ? undefined : size_estimate.declared_size(body)

	return size === undefined || size.files === 0 ? undefined : size
}

// Whether the bar applies at all — read before the signals, so an undeclared Issue measures nothing.
function declares(issue: number, issues: ReadonlyArray<OpenIssueData>): boolean {
	return declared_of(issue, issues) !== undefined
}

// The files the recorded plan already held stay first, so the ones this re-run adds are the ones split off.
function ordered(counted: ReadonlyArray<string>, recorded: ReadonlyArray<string>): Array<string> {
	const held = new Set(recorded)

	return [...counted.filter((file) => held.has(file)), ...counted.filter((file) => !held.has(file))]
}

function files_over(
	plan: LanePlan,
	declared: number,
	recorded: ReadonlyArray<string>,
): FilesOver | undefined {
	const limit = declared * split_assess.PLAN_GROWTH_FACTOR
	const counted = plan.paths.filter((file) => !test_declared_logic.is_test_file(file))

	if (counted.length <= limit) return undefined
	const files = ordered(counted, recorded)
	const tests = plan.paths.filter((file) => test_declared_logic.is_test_file(file))
	const kept = files.slice(0, limit)

	return { reason: 'files', declared, limit, kept, split_off: files.slice(limit), tests }
}

function hunks_over(declared: number, hunks: number): MeasureOver | undefined {
	const limit = declared * split_assess.PLAN_GROWTH_FACTOR

	return hunks > limit ? { reason: 'hunks', declared, limit, measured: hunks } : undefined
}

function lines_over(declared: number, lines_ratio: number | undefined): MeasureOver | undefined {
	const measured = Math.round(declared * (lines_ratio ?? DEFAULT_LINES_RATIO))
	const limit = split_assess.LINE_GUIDE

	return measured > limit ? { reason: 'lines', declared, limit, measured } : undefined
}

function measure_over(
	declared: Declared,
	signals: PlanSignals,
	recorded: LanePlan | undefined,
): MeasureOver | undefined {
	if (signals.split_filed) return undefined
	const { hunks, lines_ratio } = signals
	const lines = recorded?.cleared === true ? undefined : lines_over(declared.lines, lines_ratio)

	return hunks_over(declared.files, hunks) ?? lines
}

// `undefined` while every axis stays within its bar, or no size is declared; files first, then hunks, then lines.
function oversize(
	plan: LanePlan,
	issues: ReadonlyArray<OpenIssueData>,
	recorded: LanePlan | undefined,
	signals: PlanSignals,
): Oversize | undefined {
	const declared = declared_of(plan.issue, issues)
	if (declared === undefined) return undefined

	return (
		files_over(plan, declared.files, recorded?.paths ?? []) ??
		measure_over(declared, signals, recorded)
	)
}

function bar_tail(): string {
	return `A \`${split_assess.REASON_PREFIX}\` comment does not pass this bar — split-assessment.md → "${split_assess.QUESTION_SECTION}".`
}

function files_text(issue: number, over: FilesOver): string {
	const counted = over.kept.length + over.split_off.length
	const bar = `${String(counted)} files (tests excluded), over ${String(over.limit)} — ${String(split_assess.PLAN_GROWTH_FACTOR)} times the ${String(over.declared)} its \`- 規模見積もり:\` declares`
	const replan = ['pnpm josh lane:plan', String(issue), ...over.kept, ...over.tests].join(' ')

	return `split (files): ${session_cite.issue(issue)}'s plan holds ${bar}, so it is not recorded. Keep in this Issue: ${over.kept.join(', ')}. Split off: ${over.split_off.join(', ')} — file them as a follow-up Issue with \`pnpm josh issue:file "<title>" --body-file <body.md> --route split\`, revert any edit to them here, run \`${replan}\`, and ship this Issue on the kept files. ${bar_tail()}`
}

function measure_bar(over: MeasureOver): string {
	if (over.reason === 'hunks') {
		return `change holds ${String(over.measured)} hunks (tests excluded), over ${String(over.limit)} — ${String(split_assess.PLAN_GROWTH_FACTOR)} times the ${String(over.declared)} files its \`- 規模見積もり:\` declares`
	}

	return `\`- 規模見積もり:\` declares ${String(over.declared)} lines, about ${String(over.measured)} at the lines lanes ran over their declaration — over the ${String(over.limit)}-line guide`
}

function measure_text(issue: number, over: MeasureOver): string {
	return `split (${over.reason}): ${session_cite.issue(issue)}'s ${measure_bar(over)}, so the plan is not recorded. Carve a separately-mergeable part off as a follow-up Issue with \`pnpm josh issue:file "<title>" --body-file <body.md> --route split\`, revert any edit to it here, and run \`pnpm josh lane:plan ${String(issue)} <paths>\` again on what stays. ${bar_tail()}`
}

function refusal_text(issue: number, over: Oversize): string {
	return over.reason === 'files' ? files_text(issue, over) : measure_text(issue, over)
}

const lane_plan_size = { declares, oversize, refusal_text }

export { lane_plan_size }
export type { Oversize, PlanSignals, SplitReason }
