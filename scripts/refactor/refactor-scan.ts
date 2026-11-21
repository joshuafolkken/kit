import { git_command } from '#scripts/git/git-command'
import { line_targets } from '#scripts/lines/line-targets'
import { import_graph } from './import-graph'
import { refactor_lint, type CategoryResult } from './refactor-lint'
import { refactor_targets } from './refactor-targets'

// `josh refactor:scan` — the command `prompts/refactoring.md` §4.1–§4.3 now point to instead of
// describing the search by hand. It selects the target files, expands the
// scope along the import graph, asks the project's own eslint which refactoring candidates the scope
// holds, and answers whether any high- or medium-priority candidate remains.
//
// Candidates are work to do, so valid scans exit 0; execution failures exit non-zero. Convergence counts the high-
// and medium-priority categories only; the one low-priority category (unused code) is reported but
// never counted, so `clear` means the scope is empty of high/medium candidates.

// The convergence vocabulary. `clear` is what §4.3's self-reported "no high- or medium-priority
// candidate left" loop exit becomes once a command answers it: a token a caller can read, not a claim.
// `error` is the third answer: the eslint run itself did not complete, so the
// scope's state is unknown — kept distinct from `clear` so a failed scan is never read as converged.
const CLEAR = 'clear'
const CANDIDATES = 'candidates'
const ERROR = 'error'

// The scope line's facts: how many files seeded the walk, how many it reached, and the stage the scope
// cap kept it from taking (`undefined` when every stage fit).
interface ScopeCounts {
	seed_count: number
	scope_count: number
	stopped_at: number | undefined
}

interface ScanResult extends ScopeCounts {
	categories: ReadonlyArray<CategoryResult>
	verdict: string
	diagnostic?: string
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

function scope_limit(stopped_at: number | undefined): string {
	if (stopped_at === undefined) return `max ${String(import_graph.MAX_STAGES)} stages`

	return `stopped before stage ${String(stopped_at)}: cap ${String(import_graph.MAX_SCOPE_FILES)} files`
}

function scope_line(counts: ScopeCounts): string {
	return `scope: ${String(counts.scope_count)} files (seed ${String(counts.seed_count)}, expanded via import graph, ${scope_limit(counts.stopped_at)})`
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

function render(categories: ReadonlyArray<CategoryResult>, counts: ScopeCounts): string {
	const blocks = categories.map((category) => category_block(category))

	return [scope_line(counts), ...blocks, verdict_line(categories)].join('\n')
}

// The failure report: the scope line and an `error` verdict, so a scan that could not run says so
// rather than printing empty categories that would read as `clear`.
function error_output(counts: ScopeCounts, diagnostic?: string): string {
	return [scope_line(counts), diagnostic, `verdict: ${ERROR} (scan could not run)`]
		.filter(Boolean)
		.join('\n')
}

function render_result(result: ScanResult): string {
	if (result.verdict === ERROR) return error_output(result, result.diagnostic)

	return render(result.categories, result)
}

async function scan(root: string): Promise<ScanResult> {
	const seed = await refactor_targets.collect_targets(root)
	const universe = await line_targets.lint_target_files(root)
	const expansion = import_graph.expand_scope(seed, universe, root)
	const scope = [...expansion.files]
	const counts = {
		seed_count: seed.length,
		scope_count: scope.length,
		stopped_at: expansion.stopped_at,
	}

	try {
		const categories = await refactor_lint.scan_categories(scope, root)

		return { ...counts, categories, verdict: verdict_token(categories) }
	} catch (error) {
		return { ...counts, categories: [], verdict: ERROR, diagnostic: String(error) }
	}
}

async function run_scan(): Promise<number> {
	const root = await git_command.repository_root()
	const result = await scan(root)

	process.stdout.write(`${render_result(result)}\n`)

	return result.verdict === ERROR ? 1 : 0
}

const refactor_scan = {
	category_block,
	error_output,
	render,
	render_result,
	run_scan,
	scope_line,
	convergence_candidates,
	verdict_line,
	verdict_token,
	CANDIDATES,
	CLEAR,
	ERROR,
}

export type { ScanResult, ScopeCounts }
export { refactor_scan }
