import { codex_hooks } from '#scripts/agent/codex-hooks'
import type { OpenIssueData } from '#scripts/git/git-schemas'
import { session_cite } from '#scripts/issue/session-cite'
import { size_estimate } from '#scripts/issue/size-estimate'
import { run_ship_planned } from '#scripts/run/ship/run-ship-planned'
import { declared_growth } from '#scripts/split/declared-growth'
import { split_assess, type SplitGuide } from '#scripts/split/split-assess'
import { test_declared_logic } from '#scripts/test/test-declared-logic'
import { test_pinned_logic } from '#scripts/test/test-pinned-logic'
import type { ImplementRate } from './lane-implement-rate'
import { lane_plan, type LanePlan } from './lane-plan'
import { lane_plan_approval } from './lane-plan-approval'
import type { SizeRatios } from './lane-size-stats'
import { lane_stage_budget } from './lane-stage-budget'

// The size bar `josh lane:plan` holds a plan to (joshuafolkken/kit#5533): a plan whose files outgrow
// the size estimate times the period's files ratio is refused, not recorded, and the lane splits the rest
// off rather than writing why it stays one. Two lanes declared at 4 files planned 9 with that comment
// and shipped 16 and 18, their implement step twice the median. Files count as the declaration counts
// them (`size-estimate.ts`): tests excluded, documents and snapshots included, and a generated artifact
// planned beside its source (`codex_hooks.GENERATED_SOURCES`) excluded. An Issue with no
// declaration — an epic — or one declaring 0 files, as `lane:stats` skips it, is never refused.
//
// **Two more axes answer `split`** (joshuafolkken/kit#5568), since declarations run short — merged lanes
// changed 1.5 times the files and 1.8 times the lines they declared, so twice the files alone rarely
// fired: the probed hunks past the grown declared files, and the declared lines times the period's
// `lines actual / declared median` past the size bar the filing refuses on (`size_estimate`,
// joshuafolkken/kit#7074). Each unmeasured axis uses 2. Both
// stand down once the lane has filed a split child: the lines axis reads the declaration alone, and the
// hunks the tree already holds would otherwise refuse every re-plan the ship's `unplanned` stop asks for.
// The lines axis also stands down on a re-plan of a cleared plan (joshuafolkken/kit#5600): the
// declaration was judged when the plan cleared, and a plan cleared before #5568 would be refused on
// every re-plan. So does a re-plan of a sized plan — one that met the bar and was recorded before an
// unread listing or a yield (joshuafolkken/kit#5605). A yielded plan the entry probe recorded never met
// the bar, so it still does.
//
// **The hunks axis counts only the hunks outside the plan's files** (joshuafolkken/kit#5601):
// those files already passed the files axis, so more edits inside them grow no new deliverable, and a
// re-plan that adds one document would otherwise be refused on the hunks it already planned. The files
// an earlier clear of this lane held count as the recorded plan's too (joshuafolkken/kit#5672), so a
// re-plan that restores a file a narrowing re-plan dropped is not refused on its edits. The files this
// plan lists count too (joshuafolkken/kit#5679): the files axis is read first, so a plan that reaches
// the hunks axis passed it, and the re-plan the ship's `unplanned` stop asks for is not refused on the
// hunks of the files it adds. A cleared record with no `cleared_paths` — one narrowed before #5672, or a
// lane's first cleared plan — has the files this lane's branch has committed stand in for that history
// (joshuafolkken/kit#5684): only the ship commits, and its preflight held each commit to the plan of its time.
//
// **A plan declared one deliverable (`--single`) is not refused on any axis** (joshuafolkken/kit#6647,
// joshuafolkken/kit#6602): a split needs a separately-mergeable part as well as the size
// (split-assessment.md → "The question"), and a short declaration alone would push the lane into a split
// child that takes every acceptance criterion. **Nor is a re-plan after the lane started**: an overrun
// then is a warning, and only an independent added requirement or unverifiable scope growth re-splits.
// Either overrun still goes on the ledger as a notice, which the later steps print and never stop on.
//
// **A new scripts module and its importer count and split as one file** (joshuafolkken/kit#6635), or
// the kept lane ships a module `pack-boundary.test.ts` finds unreached. As in `epic-split-reach.ts`, a
// planned scripts module the base holds is a candidate importer, here only one in the new module's
// directory; with no `base_files`, every file stands alone. The grouping is the split notice's
// (`split_assess.units_of`, joshuafolkken/kit#6724).
//
// **A plan that edits a `test:related` hub answers `split (hub)`** (joshuafolkken/kit#6543), naming it:
// a file whose reach passes the test-file cap (`test-related-cap.ts`) runs past the cap on every check,
// and lanes that edited one overran their budget among the most often. With no graph no file reads as a hub, so the
// other axes decide as before. Splitting the hub itself is joshuafolkken/kit#6180.

type SplitReason = 'files' | 'hunks' | 'lines' | 'hub'

// What `lane:plan` measured beside the plan (`lane-plan-signals.ts`); one `hunk_files` entry per hunk,
// one `committed_files` entry per file the branch changed between its base and `HEAD`, and the files
// that base already holds (undefined when the base does not resolve).
interface PlanSignals {
	hunk_files: ReadonlyArray<string>
	committed_files: ReadonlyArray<string>
	base_files?: ReadonlySet<string> | undefined
	files_ratio?: number | undefined
	lines_ratio: number | undefined
	implement_rate: ImplementRate | undefined
	split_filed: boolean
	hubs?: ReadonlyArray<string> | undefined
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

// `limit` is the test-file cap the hubs' reach passes.
interface HubOver {
	reason: 'hub'
	limit: number
	hubs: ReadonlyArray<string>
}

type Oversize = (FilesOver | MeasureOver | HubOver) & { guide?: SplitGuide }

interface Declared {
	files: number
	lines: number
}

function declared_of(issue: number, issues: ReadonlyArray<OpenIssueData>): Declared | undefined {
	const body = issues.find((candidate) => candidate.number === issue)?.body
	const size = body === undefined ? undefined : size_estimate.declared_size(body)

	return size === undefined || size.files === 0 ? undefined : size
}

// Whether the bar applies at all — read before the signals, so an undeclared Issue measures nothing.
function declares(issue: number, issues: ReadonlyArray<OpenIssueData>): boolean {
	return declared_of(issue, issues) !== undefined
}

function ratios_of(signals: PlanSignals): SizeRatios {
	return { files: signals.files_ratio, lines: signals.lines_ratio }
}

function guide_of(signals: PlanSignals): SplitGuide {
	return split_assess.guide_for(
		lane_stage_budget.BUDGET_MINUTES.implement,
		signals.implement_rate,
		ratios_of(signals),
	)
}

// The files the recorded plan already held stay first, so the ones this re-run adds are the ones split off.
function ordered(counted: ReadonlyArray<string>, recorded: ReadonlyArray<string>): Array<string> {
	const held = new Set(recorded)

	return [...counted.filter((file) => held.has(file)), ...counted.filter((file) => !held.has(file))]
}

// The counted files grouped into what splits as one, on the split notice's units: a planned file the base
// does not hold is added.
function units_of(files: ReadonlyArray<string>, signals: PlanSignals): Array<Array<string>> {
	const base = signals.base_files ?? new Set(files)

	return split_assess.units_of(files, new Set(files.filter((file) => !base.has(file))))
}

function files_approved(
	plan: LanePlan,
	declared: number,
	recorded: LanePlan | undefined,
	measured: number,
): boolean {
	const approval = plan.size_approval ?? recorded?.size_approval

	return (
		approval !== undefined &&
		lane_plan_approval.allows(approval, plan, { reason: 'files', declared, measured })
	)
}

// An artifact a build regenerates from one of `sources` (joshuafolkken/kit#6666): its edit is its source's,
// so it is not counted and stays or splits off with its source — apart, the parity test fails.
function is_generated_from(file: string, sources: ReadonlyArray<string>): boolean {
	const source = codex_hooks.GENERATED_SOURCES.get(file)

	return source !== undefined && sources.includes(source)
}

function is_counted(file: string, paths: ReadonlyArray<string>): boolean {
	return !test_declared_logic.is_test_file(file) && !is_generated_from(file, paths)
}

function with_artifacts(files: ReadonlyArray<string>, paths: ReadonlyArray<string>): Array<string> {
	return [...files, ...paths.filter((file) => is_generated_from(file, files))]
}

function files_over(
	plan: LanePlan,
	declared: number,
	recorded: LanePlan | undefined,
	signals: PlanSignals,
): FilesOver | undefined {
	const limit = declared * declared_growth.factor(ratios_of(signals), 'files')
	const counted = plan.paths.filter((file) => is_counted(file, plan.paths))
	const units = units_of(ordered(counted, recorded?.paths ?? []), signals)

	if (units.length <= limit || files_approved(plan, declared, recorded, units.length)) {
		return undefined
	}

	const tests = plan.paths.filter((file) => test_declared_logic.is_test_file(file))
	const kept = with_artifacts(units.slice(0, limit).flat(), plan.paths)
	const split_off = with_artifacts(units.slice(limit).flat(), plan.paths)

	return { reason: 'files', declared, limit, kept, split_off, tests }
}

// The files an earlier clear held — the recorded history, else, for a cleared record that predates it,
// the files the branch committed.
function earlier_cleared(
	recorded: LanePlan | undefined,
	signals: PlanSignals,
): ReadonlyArray<string> {
	if (recorded?.cleared_paths !== undefined) return recorded.cleared_paths

	return recorded?.cleared === true ? signals.committed_files : []
}

// Matched by the ship's `unplanned` rule — a claim ending in `/` holds every file under it — against a
// wider set: this plan's files and a path an earlier clear of this lane held count as planned too, while
// the ship's stop reads the recorded `paths` alone (joshuafolkken/kit#5672, joshuafolkken/kit#5679).
// A directory this plan claims is left out: the files axis counts it as one file, so it passed nothing.
function unplanned_hunks(
	signals: PlanSignals,
	plan: LanePlan,
	recorded: LanePlan | undefined,
): number {
	const listed = plan.paths.filter((path) => !path.endsWith('/'))
	const planned = [...listed, ...(recorded?.paths ?? []), ...earlier_cleared(recorded, signals)]

	return run_ship_planned.unplanned_of(planned, signals.hunk_files).length
}

function hunks_over(
	declared: number,
	hunks: number,
	signals: PlanSignals,
): MeasureOver | undefined {
	const limit = declared * declared_growth.factor(ratios_of(signals), 'files')

	return hunks > limit ? { reason: 'hunks', declared, limit, measured: hunks } : undefined
}

// The declared lines past the size bar `issue:file` refuses on and `backlog:next` notes
// (joshuafolkken/kit#7074); `limit` is the most declared lines the bar allows, `measured` the grown
// count. With no measured rate the bar is the guide's fallback lines, which the filing refuses past too.
function lines_limit(signals: PlanSignals): number {
	const growth = ratios_of(signals)
	const bar = size_estimate.declared_lines_bar(signals.implement_rate, growth)

	return bar ?? Math.floor(guide_of(signals).lines / declared_growth.factor(growth, 'lines'))
}

function lines_over(declared: number, signals: PlanSignals): MeasureOver | undefined {
	const limit = lines_limit(signals)
	if (declared <= limit) return undefined
	const measured = Math.round(declared * declared_growth.factor(ratios_of(signals), 'lines'))

	return { reason: 'lines', declared, limit, measured }
}

function unapproved(
	over: MeasureOver | undefined,
	plan: LanePlan,
	approval: LanePlan['size_approval'],
): MeasureOver | undefined {
	if (over === undefined || approval === undefined) return over
	if (over.reason !== 'lines') return over
	const is_within = lane_plan_approval.allows(approval, plan, { ...over, reason: over.reason })

	return is_within ? undefined : over
}

function planned_lines(
	declared: number,
	signals: PlanSignals,
	plan: LanePlan,
	recorded: LanePlan | undefined,
): MeasureOver | undefined {
	const approval = plan.size_approval ?? recorded?.size_approval
	if (approval === undefined && lane_plan.is_sized(recorded)) return undefined

	return unapproved(lines_over(declared, signals), plan, approval)
}

function measure_over(
	declared: Declared,
	signals: PlanSignals,
	plan: LanePlan,
	recorded: LanePlan | undefined,
): MeasureOver | undefined {
	if (signals.split_filed) return undefined

	return (
		hunks_over(declared.files, unplanned_hunks(signals, plan, recorded), signals) ??
		planned_lines(declared.lines, signals, plan, recorded)
	)
}

// Whether `over` is noted, not refused: a plan declared one deliverable, or one re-registered after its
// lane started — a met bar recorded `sized` — warns on any axis (joshuafolkken/kit#6602). Only the first
// plan of an Issue with no single-deliverable decision answers `split`, and only before work starts.
function is_waived(plan: LanePlan, over: Oversize | undefined): boolean {
	return over !== undefined && (plan.single === true || plan.sized === true)
}

function hub_over(signals: PlanSignals): HubOver | undefined {
	const hubs = signals.hubs ?? []

	return hubs.length === 0
		? undefined
		: { reason: 'hub', limit: test_pinned_logic.MAX_TEST_FILES, hubs }
}

// Files first, then hubs, hunks and lines; a waived files overrun stands only once the other axes pass.
function first_over(
	plan: LanePlan,
	declared: Declared,
	recorded: LanePlan | undefined,
	signals: PlanSignals,
): FilesOver | MeasureOver | HubOver | undefined {
	const files = files_over(plan, declared.files, recorded, signals)
	if (files !== undefined && !is_waived(plan, files)) return files

	return hub_over(signals) ?? measure_over(declared, signals, plan, recorded) ?? files
}

// `undefined` while every axis stays within its bar, or no size is declared.
function oversize(
	plan: LanePlan,
	issues: ReadonlyArray<OpenIssueData>,
	recorded: LanePlan | undefined,
	signals: PlanSignals,
): Oversize | undefined {
	const declared = declared_of(plan.issue, issues)
	if (declared === undefined) return undefined

	const over = first_over(plan, declared, recorded, signals)

	return over === undefined ? undefined : { ...over, guide: guide_of(signals) }
}

function bar_tail(): string {
	return `A \`${split_assess.REASON_PREFIX}\` comment does not pass this bar — split-assessment.md → "${split_assess.QUESTION_SECTION}".`
}

function files_text(issue: number, over: FilesOver): string {
	const planned = [...over.kept, ...over.split_off]
	const counted = planned.filter((file) => is_counted(file, planned)).length
	const bar = `${String(counted)} files (tests and generated artifacts excluded), over ${String(over.limit)} — ${String(over.limit / over.declared)} times the ${String(over.declared)} its \`- 規模見積もり:\` declares`
	const replan = ['pnpm josh lane:plan', String(issue), ...over.kept, ...over.tests].join(' ')

	return `split (files): ${session_cite.issue(issue)}'s plan holds ${bar}, so it is not recorded. Keep in this Issue: ${over.kept.join(', ')}. Split off: ${over.split_off.join(', ')} — file them as a follow-up Issue with \`pnpm josh issue:file "<title>" --body-file <body.md> --route split\`, revert any edit to them here, run \`${replan}\`, and ship this Issue on the kept files. One deliverable with no separately-mergeable part instead → run this \`lane:plan\` again with \`--single\`. ${bar_tail()}`
}

function waiver_text(issue: number, over: Oversize): string {
	return `size warning (${over.reason}): ${session_cite.issue(issue)}'s plan is past its ${String(over.limit)} bar, recorded and noted on the ledger — a warning, not a stop; re-split only on an independent added requirement or scope growth this Issue cannot verify (split-assessment.md → "${split_assess.NOTICE_SECTION}").`
}

function measure_bar(over: MeasureOver): string {
	if (over.reason === 'hunks') {
		return `change holds ${String(over.measured)} hunks outside the plan's files (tests excluded), over ${String(over.limit)} — ${String(over.limit / over.declared)} times the ${String(over.declared)} files its \`- 規模見積もり:\` declares`
	}

	return `\`- 規模見積もり:\` declares ${String(over.declared)} lines, about ${String(over.measured)} at the lines lanes ran over their declaration — over the ${String(over.limit)} declared lines the size bar allows`
}

function measure_text(issue: number, over: MeasureOver): string {
	return `split (${over.reason}): ${session_cite.issue(issue)}'s ${measure_bar(over)}, so the plan is not recorded. Carve a separately-mergeable part off as a follow-up Issue with \`pnpm josh issue:file "<title>" --body-file <body.md> --route split\`, revert any edit to it here, and run \`pnpm josh lane:plan ${String(issue)} <paths>\` again on what stays. ${bar_tail()}`
}

function hub_text(issue: number, over: HubOver): string {
	return `split (hub): ${session_cite.issue(issue)}'s plan edits ${over.hubs.join(', ')}, whose \`test:related\` reach passes the ${String(over.limit)}-test-file cap, so the plan is not recorded. Carve the hub edit off as a follow-up Issue with \`pnpm josh issue:file "<title>" --body-file <body.md> --route split\`, revert any edit to it here, and run \`pnpm josh lane:plan ${String(issue)} <paths>\` again on what stays. The hub edit is the one deliverable instead → run this \`lane:plan\` again with \`--single\`. ${bar_tail()}`
}

function over_text(issue: number, over: Oversize): string {
	if (over.reason === 'files') return files_text(issue, over)

	return over.reason === 'hub' ? hub_text(issue, over) : measure_text(issue, over)
}

function refusal_text(issue: number, over: Oversize): string {
	const text = over_text(issue, over)
	const guide = over.guide ?? split_assess.guide_for(lane_stage_budget.BUDGET_MINUTES.implement)

	return `${text} ${split_assess.policy_text(guide)}`
}

const lane_plan_size = { declares, is_waived, oversize, refusal_text, waiver_text }

export { lane_plan_size }
export type { Oversize, PlanSignals, SplitReason }
