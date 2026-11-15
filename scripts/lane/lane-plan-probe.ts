import { auto_ok_cli } from '#scripts/auto-ok/auto-ok-cli'
import { backlog_overlap, type Clash } from '#scripts/backlog/backlog-overlap'
import type { OpenIssueData } from '#scripts/git/git-schemas'
import { has_any_label, IN_PROGRESS_LABEL } from '#scripts/issue/issue-labels'
import { session_cite } from '#scripts/issue/session-cite'
import { lane_plan, type LanePlan } from './lane-plan'
import { lane_plan_signals } from './lane-plan-signals'
import { lane_plan_size, type Oversize, type PlanSignals } from './lane-plan-size'

// `lane:plan`'s overlap check without its wait or its yield (`lane-plan-check.ts` acts on it), kept apart
// so `run:review`'s open widens a plan (joshuafolkken/kit#6142) without importing the yield's release.

const RUNNING = new Set([IN_PROGRESS_LABEL])
const UNREAD = 'unread'
const OVERSIZE = 'oversize'

// What the overlap check found: the clash, none, or a listing it could not read.
type Probe = Clash | typeof UNREAD | undefined
// What `extend` found: the overlap check's answer, or a widening past the Issue's declared size.
type Extended = Probe | typeof OVERSIZE

// The opted-in listing — the running lanes carry the pickup label, so it holds their bodies.
async function opted_in(): Promise<ReadonlyArray<OpenIssueData> | undefined> {
	const read = await auto_ok_cli.fetch_opted_in()

	return read.kind === 'read' ? read.issues : undefined
}

function running_of(issues: ReadonlyArray<OpenIssueData>): ReadonlyArray<OpenIssueData> {
	return issues.filter((issue) => has_any_label(issue.labels, RUNNING))
}

function clash_among(
	plan: LanePlan,
	issues: ReadonlyArray<OpenIssueData>,
	directory: string,
): Clash | undefined {
	const declared = lane_plan.with_plans(backlog_overlap.declared_of(issues), directory)

	return lane_plan.clash_of(plan, declared, directory)
}

function overlap_text(issue: number, clash: Clash): string {
	const holder = session_cite.issue(clash.holder)

	return `${session_cite.issue(issue)}'s planned \`${clash.path}\` overlaps \`${clash.claimed}\`, which ${holder} declares or plans`
}

// The overlap check alone, writing nothing — what `--probe` answers and `check_plan` acts on.
function probe(
	plan: LanePlan,
	issues: ReadonlyArray<OpenIssueData> | undefined,
	directory: string,
): Probe {
	return issues === undefined ? UNREAD : clash_among(plan, running_of(issues), directory)
}

function is_unread(found: Extended): found is typeof UNREAD {
	return found === UNREAD
}

function record_cleared(plan: LanePlan, directory: string): void {
	lane_plan.record(
		{ ...plan, cleared: true, yielded: undefined, waits_until: undefined },
		directory,
	)
}

// The signals read, its failure kept as a value until the size bar uses it, so an unused read that
// failed rejects nothing.
async function signals_or_error(plan: LanePlan): Promise<PlanSignals | Error> {
	try {
		return await lane_plan_signals.signals_of(plan.issue, plan.paths)
	} catch (error) {
		return error instanceof Error ? error : new Error(String(error))
	}
}

// A plan grown past twice its Issue's declaration is refused before it is recorded (`lane-plan-size.ts`).
async function oversize_of(
	plan: LanePlan,
	issues: ReadonlyArray<OpenIssueData> | undefined,
	directory: string,
	read: Promise<PlanSignals | Error>,
): Promise<Oversize | undefined> {
	if (issues === undefined || !lane_plan_size.declares(plan.issue, issues)) return undefined
	const signals = await read

	if (signals instanceof Error) throw signals

	return lane_plan_size.oversize(plan, issues, lane_plan.read(plan.issue, directory), signals)
}

interface SizedListing {
	issues: ReadonlyArray<OpenIssueData> | undefined
	over: Oversize | undefined
}

// The listing and the size bar's verdict on `plan`. The signals are read beside the listing, not after
// it (joshuafolkken/kit#7596): their graph walk for the hubs is `lane:plan`'s longest step, so it runs
// under the `gh` read. An Issue that declares no size leaves them unused.
async function sized_listing(plan: LanePlan, directory: string): Promise<SizedListing> {
	const read = signals_or_error(plan)
	const issues = await opted_in()

	return { issues, over: await oversize_of(plan, issues, directory, read) }
}

function is_oversize(found: Extended): found is typeof OVERSIZE {
	return found === OVERSIZE
}

// **A plan widened without the wait**: `run:review`'s open records a clear widening and stops on a clash
// itself. An oversize widening — `lane:plan`'s `split`, which a waived overrun of a `--single` or
// started (`sized`) plan is not — a clash or an unread listing writes nothing and is returned; the
// ship's `unplanned` preflight still checks.
async function extend(plan: LanePlan, directory: string): Promise<Extended> {
	const { issues, over } = await sized_listing(plan, directory)

	if (over !== undefined && !lane_plan_size.is_waived(plan, over)) return OVERSIZE
	const found = probe(plan, issues, directory)

	if (found === undefined) record_cleared(plan, directory)

	return found
}

const lane_plan_probe = {
	clash_among,
	extend,
	is_oversize,
	is_unread,
	opted_in,
	overlap_text,
	probe,
	record_cleared,
	running_of,
	sized_listing,
}

export { lane_plan_probe }
export type { Extended, Probe }
