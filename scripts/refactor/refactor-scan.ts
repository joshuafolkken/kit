import { line_targets } from '#scripts/lines/line-targets'
import { import_graph } from './import-graph'
import { refactor_lint, type CategoryResult } from './refactor-lint'
import { refactor_targets } from './refactor-targets'

// `josh refactor:scan` — the command `prompts/refactoring.md` §4.1–§4.3 now point to instead of
// describing the search by hand (joshuafolkken/kit#2180). It selects the target files, expands the
// scope along the import graph, asks the project's own eslint which refactoring candidates the scope
// holds, and answers whether any high- or medium-priority candidate remains.
//
// **It reports and never fails**, like `josh lines`: a candidate is work to do, not a gate to break,
// so the exit code stays 0 and the answer is the printed verdict token. Convergence counts the high-
// and medium-priority categories only; the one low-priority category (unused code) is reported but
// never counted, so `clear` means the scope is empty of high/medium candidates.

// The convergence vocabulary. `clear` is what §4.3's self-reported "no high- or medium-priority
// candidate left" loop exit becomes once a command answers it: a token a caller can read, not a claim.
// `error` is the third answer (joshuafolkken/kit#2180): the eslint run itself did not complete, so the
// scope's state is unknown — kept distinct from `clear` so a failed scan is never read as converged.
const CLEAR = 'clear'
const CANDIDATES = 'candidates'
const ERROR = 'error'

interface ScanResult {
	seed_count: number
	scope_count: number
	categories: ReadonlyArray<CategoryResult>
	verdict: string
}

// Convergence counts high- and medium-priority candidates only: a low-priority finding (unused code)
// is reported but auto-implemented by nobody, so it never keeps the loop from reading `clear`.
function convergence_candidates(categories: ReadonlyArray<CategoryResult>): number {
	return categories
		.filter((category) => category.priority !== refactor_lint.LOW)
		.reduce((sum, category) => sum + category.candidates.length, 0)
}

function verdict_token(categories: ReadonlyArray<CategoryResult>): string {
	return convergence_candidates(categories) === 0 ? CLEAR : CANDIDATES
}

function scope_line(seed_count: number, scope_count: number): string {
	return `scope: ${String(scope_count)} files (seed ${String(seed_count)}, expanded via import graph, max ${String(import_graph.MAX_STAGES)} stages)`
}

function category_header(category: CategoryResult): string {
	return `${category.priority}  ${category.label}: ${String(category.candidates.length)}`
}

function candidate_lines(category: CategoryResult): ReadonlyArray<string> {
	return category.candidates.map((candidate) => `    ${candidate.location} (${candidate.rule})`)
}

function category_block(category: CategoryResult): string {
	return [category_header(category), ...candidate_lines(category)].join('\n')
}

function verdict_line(categories: ReadonlyArray<CategoryResult>): string {
	const total = convergence_candidates(categories)

	return total === 0 ? `verdict: ${CLEAR}` : `verdict: ${CANDIDATES} (${String(total)} high/medium)`
}

function render(
	categories: ReadonlyArray<CategoryResult>,
	seed_count: number,
	scope_count: number,
): string {
	const blocks = categories.map((category) => category_block(category))

	return [scope_line(seed_count, scope_count), ...blocks, verdict_line(categories)].join('\n')
}

// The failure report: the scope line and an `error` verdict, so a scan that could not run says so
// rather than printing empty categories that would read as `clear`.
function error_output(seed_count: number, scope_count: number): string {
	return [scope_line(seed_count, scope_count), `verdict: ${ERROR} (scan could not run)`].join('\n')
}

function render_result(result: ScanResult): string {
	if (result.verdict === ERROR) return error_output(result.seed_count, result.scope_count)

	return render(result.categories, result.seed_count, result.scope_count)
}

async function scan(root: string): Promise<ScanResult> {
	const seed = await refactor_targets.collect_targets(root)
	const universe = await line_targets.lint_target_files(root)
	const scope = [...import_graph.expand_scope(seed, universe, root)]
	const categories = await refactor_lint.scan_categories(scope, root)
	const counts = { seed_count: seed.length, scope_count: scope.length }

	if (categories === undefined) return { ...counts, categories: [], verdict: ERROR }

	return { ...counts, categories, verdict: verdict_token(categories) }
}

async function run_scan(): Promise<number> {
	const root = await line_targets.repo_root()
	const result = await scan(root)

	process.stdout.write(`${render_result(result)}\n`)

	return 0
}

const refactor_scan = {
	category_block,
	error_output,
	render,
	render_result,
	run_scan,
	scan,
	convergence_candidates,
	verdict_line,
	verdict_token,
	CANDIDATES,
	CLEAR,
	ERROR,
}

export type { ScanResult }
export { refactor_scan }
