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

interface Oversize {
	declared: number
	limit: number
	kept: ReadonlyArray<string>
	split_off: ReadonlyArray<string>
	tests: ReadonlyArray<string>
}

function declared_of(issue: number, issues: ReadonlyArray<OpenIssueData>): number | undefined {
	const body = issues.find((candidate) => candidate.number === issue)?.body
	const files = body === undefined ? undefined : size_estimate.declared_files(body)

	return files === 0 ? undefined : files
}

// The files the recorded plan already held stay first, so the ones this re-run adds are the ones split off.
function ordered(counted: ReadonlyArray<string>, recorded: ReadonlyArray<string>): Array<string> {
	const held = new Set(recorded)

	return [...counted.filter((file) => held.has(file)), ...counted.filter((file) => !held.has(file))]
}

function sized(
	plan: LanePlan,
	declared: number,
	recorded: ReadonlyArray<string>,
): Oversize | undefined {
	const limit = declared * split_assess.PLAN_GROWTH_FACTOR
	const counted = plan.paths.filter((file) => !test_declared_logic.is_test_file(file))

	if (counted.length <= limit) return undefined
	const files = ordered(counted, recorded)
	const tests = plan.paths.filter((file) => test_declared_logic.is_test_file(file))

	return { declared, limit, kept: files.slice(0, limit), split_off: files.slice(limit), tests }
}

// `undefined` while the plan's counted files stay within twice the declaration, or none is declared.
function oversize(
	plan: LanePlan,
	issues: ReadonlyArray<OpenIssueData>,
	recorded: LanePlan | undefined,
): Oversize | undefined {
	const declared = declared_of(plan.issue, issues)

	return declared === undefined ? undefined : sized(plan, declared, recorded?.paths ?? [])
}

function refusal_text(issue: number, over: Oversize): string {
	const counted = over.kept.length + over.split_off.length
	const bar = `${String(counted)} files (tests excluded), over ${String(over.limit)} — ${String(split_assess.PLAN_GROWTH_FACTOR)} times the ${String(over.declared)} its \`- 規模見積もり:\` declares`
	const replan = ['pnpm josh lane:plan', String(issue), ...over.kept, ...over.tests].join(' ')

	return `split: ${session_cite.issue(issue)}'s plan holds ${bar}, so it is not recorded. Keep in this Issue: ${over.kept.join(', ')}. Split off: ${over.split_off.join(', ')} — file them as a follow-up Issue with \`pnpm josh issue:file "<title>" --body-file <body.md> --route split\`, revert any edit to them here, run \`${replan}\`, and ship this Issue on the kept files. A \`${split_assess.REASON_PREFIX}\` comment does not pass this bar — split-assessment.md → "${split_assess.QUESTION_SECTION}".`
}

const lane_plan_size = { oversize, refusal_text }

export { lane_plan_size }
export type { Oversize }
