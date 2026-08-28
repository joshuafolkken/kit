#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { git_epic_parse } from '#scripts/git/git-epic-parse'
import { git_gh_command } from '#scripts/git/git-gh-command'
import { epic_issue } from './epic-issue'
import { epic_plan, type EpicPlan, type PlanChild } from './epic-plan'

// `josh epic:plan <E>` — every child of an epic, in one machine-readable view, so the decisions the
// epic needs can be made in one batch instead of arriving scattered through the run
// (joshuafolkken/kit#862).

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const ARGV_OFFSET = 2
const CHILD_LIMIT = 200
const USAGE = 'Usage: josh epic:plan <epic-number>'

// Every child the epic's task list tracks. A child that could not be read is left out of the plan
// and named on stderr: the plan is a document a decision is made from, and a child silently absent
// from it is a decision made without knowing about it.
async function fetch_children(child_numbers: ReadonlyArray<number>): Promise<FetchedPlanChildren> {
	const limited = child_numbers.slice(0, CHILD_LIMIT)
	const fetched = await Promise.all(
		limited.map(async (issue_number) =>
			epic_plan.to_plan_child(await git_gh_command.issue_get_plan_fields(String(issue_number))),
		),
	)

	return {
		children: fetched.filter((child): child is PlanChild => child !== undefined),
		unreadable: limited.filter((_, index) => fetched[index] === undefined),
		skipped: child_numbers.slice(CHILD_LIMIT),
	}
}

// What the fetch produced, keeping what it could not read rather than dropping it.
interface FetchedPlanChildren {
	children: ReadonlyArray<PlanChild>
	unreadable: ReadonlyArray<number>
	skipped: ReadonlyArray<number>
}

interface BuildResult extends FetchedPlanChildren {
	plan?: EpicPlan
}

// The plan for one epic.
//
// An epic whose task list tracks nothing is an empty plan, not a failure: a checked row is still a
// tracked row, so a finished epic yields closed children rather than an empty list, and an epic that
// genuinely tracks nothing is a real answer. An epic whose *body could not be read at all* is a
// different thing — a bad number, a failed lookup — and is reported as a failure, because an empty
// plan there is indistinguishable from a finished one.
async function build(epic_number: number): Promise<BuildResult> {
	const body = await git_gh_command.issue_get_body(String(epic_number))

	if (body === undefined) return { children: [], unreadable: [], skipped: [] }
	const child_numbers = git_epic_parse.parse_task_list_issue_numbers(body)
	const fetched = await fetch_children(child_numbers)

	return { ...fetched, plan: epic_plan.build_plan(epic_number, fetched.children) }
}

// Non-zero, not just a warning: a consumer capturing stdout would otherwise act on a plan that is
// missing a child, which is a decision made without knowing about it.
function report_missing(missing: ReadonlyArray<number>): number {
	if (missing.length === 0) return SUCCESS_EXIT_CODE
	const list = missing.map((issue_number) => `#${String(issue_number)}`).join(', ')

	console.error(`✖ Could not read ${list}; they are absent from this plan.`)

	return FAILURE_EXIT_CODE
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const epic_number = epic_issue.parse_epic_number(argv[0])

	if (epic_number === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const { plan, unreadable, skipped } = await build(epic_number)

	if (plan === undefined) {
		console.error(`✖ Could not read #${String(epic_number)}.`)

		return FAILURE_EXIT_CODE
	}

	console.info(epic_plan.format_plan(plan))

	return report_missing([...unreadable, ...skipped])
}

// `process.exitCode` rather than `process.exit()`: the answer goes to standard output and a write to
// a pipe is asynchronous on macOS, so exiting can tear the process down before it drains. This
// command's answer is what a workflow reads and acts on, which is exactly that pipe. The same shape
// is in `scripts/cost/cost-cli.ts`, which met the truncation first (joshuafolkken/kit#1005).
async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const epic_plan_cli = { USAGE, CHILD_LIMIT, fetch_children, build, report_missing, run, main }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { epic_plan_cli }
