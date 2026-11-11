import path from 'node:path'
import { line_budget, type FileBudget, type LineBudget } from '#scripts/lines/line-budget'
import { run_prep_locate } from '#scripts/run/run-prep-locate'
import { size_estimate } from './size-estimate'

// The files an Issue body names that sit at or past 90% of their code-line limit
// (joshuafolkken/kit#7184). Adding lines to one makes the lane split the file mid-implementation
// (`prompts/refactoring.md`) — an unplanned diff and review — so `issue:file` steers the filing to a
// refactor Issue that splits it first, and `backlog:next` warns on one filed before this check.
//
// Counted as ESLint's `max-lines` counts them, through `line_budget` — the one counter the gate
// agrees with. A body that adds no lines to the file declares `NO_LINES_PREFIX` with its reason; one
// refiled after its refactor Issue declares `REFACTOR_PREFIX` with that Issue, which it waits on.

const PERCENT = 100
const CAP_PERCENT = 90
const CAP_FRACTION = CAP_PERCENT / PERCENT
const NO_LINES_PREFIX = '- 行を増やさない:'
const REFACTOR_PREFIX = '- 先行リファクタ:'
const ISSUE_REFERENCE = /^#\d+$/u
const REFACTOR_GUIDE = 'prompts/refactoring.md'
// The files `max-lines` limits: every script and component ESLint lints (`eslint/base.js`).
const CODE_FILE = /\.(?:[cm]?[jt]sx?|svelte)$/u

// A backticked repository path to a code file ESLint counts; a bare file name or a missing path is
// not weighed — its limit and count would be guesses.
function counted_paths(body: string, project_root: string): ReadonlyArray<string> {
	return run_prep_locate
		.names_of(body)
		.filter((name) => CODE_FILE.test(name))
		.filter((name) => line_budget.is_lintable_path(path.resolve(project_root, name)))
}

function is_near_cap(budget: LineBudget | undefined): budget is LineBudget {
	if (budget === undefined) return false

	return budget.code_lines >= Math.ceil(budget.limit * CAP_FRACTION)
}

function is_declared(body: string): boolean {
	if ((size_estimate.declared(body, NO_LINES_PREFIX) ?? '') !== '') return true

	return ISSUE_REFERENCE.test(size_estimate.declared(body, REFACTOR_PREFIX) ?? '')
}

function near_of(
	named: ReadonlyArray<ReadonlyArray<string>>,
	budgets: ReadonlyArray<FileBudget>,
): ReadonlyArray<ReadonlyArray<FileBudget>> {
	const near = budgets.filter((entry) => is_near_cap(entry.budget))

	return named.map((paths) => near.filter((entry) => paths.includes(entry.file_path)))
}

// Per body, the named files near their cap — `[]` when none is or the body declares it adds no
// lines. One ESLint run counts every body's files, and none runs when no body names one.
async function near_cap_by_body(
	bodies: ReadonlyArray<string>,
	project_root: string,
): Promise<ReadonlyArray<ReadonlyArray<FileBudget>>> {
	const named = bodies.map((body) => (is_declared(body) ? [] : counted_paths(body, project_root)))
	const paths = [...new Set(named.flat())]

	if (paths.length === 0) return named.map(() => [])

	return near_of(named, await line_budget.budgets_for(paths, project_root))
}

async function near_cap(body: string, project_root: string): Promise<ReadonlyArray<FileBudget>> {
	const [near] = await near_cap_by_body([body], project_root)

	return near ?? []
}

function described(entry: FileBudget): string {
	const { budget } = entry

	return budget === undefined
		? entry.file_path
		: `${entry.file_path} (${line_budget.describe(budget)})`
}

function named_line(near: ReadonlyArray<FileBudget>): string {
	return `names ${near.map((entry) => described(entry)).join(', ')}, at or past ${String(CAP_PERCENT)}% of the code-line limit`
}

// The refusal `issue:file` prints: file the refactor first, then record it as this Issue's blocker.
function problem(near: ReadonlyArray<FileBudget>): string | undefined {
	if (near.length === 0) return undefined

	return `${named_line(near)} — file a refactor Issue that splits it first (${REFACTOR_GUIDE}), refile this one declaring \`${REFACTOR_PREFIX} #<refactor>\`, then \`pnpm josh backlog:triage --apply <N> --blocked-by <refactor> --reason "<why>"\`; or declare \`${NO_LINES_PREFIX} <理由>\` when the change adds no lines to it`
}

// The line `backlog:next` warns with — the same finding, offered anyway (joshuafolkken/kit#7074).
function note(near: ReadonlyArray<FileBudget>): string | undefined {
	if (near.length === 0) return undefined

	return `${named_line(near)} with no \`${NO_LINES_PREFIX}\` — split it first (${REFACTOR_GUIDE})`
}

const issue_cap_files = {
	NO_LINES_PREFIX,
	REFACTOR_PREFIX,
	near_cap,
	near_cap_by_body,
	note,
	problem,
}

export { issue_cap_files }
