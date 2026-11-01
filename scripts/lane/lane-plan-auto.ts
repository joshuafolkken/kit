import { backlog_overlap } from '#scripts/backlog/backlog-overlap'
import { plan_consumers_section } from '#scripts/issue/plan-consumers-section'
import { shell_quote } from '#scripts/lib/shell-quote'
import { lane_plan_check } from './lane-plan-check'

// `lane:plan` run off a plan's own text (joshuafolkken/kit#5738): a lane child that records its plan with
// `issue:plan` no longer copies the plan's paths into a second `lane:plan` call — every backticked path
// outside the consumers section is declared, the way `run:step` reads a plan comment's paths. A plan
// with no path it can read prints the `lane:plan` command instead, for the child to name its own.

const SUCCESS_EXIT_CODE = 0
const PATH_PLACEHOLDER = '<path>...'

// The `lane:plan` command for `paths`, `<path>...` standing in when there are none.
function command_of(issue_number: string, paths: ReadonlyArray<string>): string {
	const named =
		paths.length === 0 ? PATH_PLACEHOLDER : paths.map((path) => shell_quote.word(path)).join(' ')

	return `pnpm josh lane:plan ${issue_number} ${named}`
}

// The paths the plan's text declares, its consumers section aside — that section names readers the
// change leaves alone or fixes elsewhere, not files this lane edits.
function paths_of(plan: string): ReadonlyArray<string> {
	return [...backlog_overlap.declared_paths(plan_consumers_section.without(plan))]
}

// Runs `lane:plan`'s check on the plan's paths and returns its exit code, its verdict printed under the
// command it stands for; with none readable, prints the command and returns success. The check is
// `lane-plan-check.ts`'s, imported past `lane-plan-cli.ts`'s main guard.
async function run_from_plan(
	issue_number: string,
	plan: string,
	directory: string = process.cwd(),
): Promise<number> {
	const paths = paths_of(plan)
	const lane = lane_plan_check.plan_of([issue_number, ...paths], new Date())

	console.info(command_of(issue_number, paths))
	if (lane === undefined) return SUCCESS_EXIT_CODE

	return await lane_plan_check.check_plan(lane_plan_check.placed(lane, directory), directory)
}

const lane_plan_auto = { command_of, run_from_plan }

export { lane_plan_auto }
