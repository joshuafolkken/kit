import path from 'node:path'
import { issue_body_keys } from '#scripts/issue/issue-body-keys'
import { line_budget, type FileBudget } from '#scripts/lines/line-budget'
import type { DeclaredSize } from '#scripts/split/split-assess'
import { test_declared_logic, type Verdict } from '#scripts/test/test-declared-logic'

// The formatting half of `josh plan:scaffold`: each section is an existing command's answer, computed
// by that command's own functions in `plan-scaffold-cli.ts`, laid out here in the order the work summary
// is written — skeleton, line budgets, the test verdict, the owed cases, the existing consumers.

const NO_FILES = '(no planned file — pass paths after the issue number)'
const NO_IDENTIFIERS = '(no backticked identifier in the issue)'
const NONE_NEAR = 'no planned file near the limit'
const NO_CASES = 'none'
const ROW_GAP = '  '
const FILE_TITLES = ['lines', 'test:declared', 'cases'] as const

interface Targets {
	files: ReadonlyArray<string>
	identifiers: ReadonlyArray<string>
}

interface ScaffoldParts {
	summary: string
	files: ReadonlyArray<string>
	near_limit: ReadonlyArray<string>
	declared: string
	cases: ReadonlyArray<string>
	consumers: string | undefined
	estimate?: DeclaredSize | undefined
}

// A body target that names a file is a planned file; any other name is an identifier whose consumers
// the plan lists. A path that does not exist yet, or a flag, is neither.
function split_targets(
	targets: ReadonlyArray<string>,
	is_file: (target: string) => boolean,
): Targets {
	const files = targets.filter((target) => is_file(target))
	const identifiers = targets.filter(
		(target) => !is_file(target) && !target.startsWith('-') && !target.includes('/'),
	)

	return { files, identifiers }
}

function budget_row(entry: FileBudget, root: string): string | undefined {
	const { budget } = entry

	if (budget?.is_near_limit !== true) return undefined

	const advice = line_budget.advice(budget) ?? ''

	return [path.relative(root, entry.file_path), line_budget.describe(budget), advice].join(ROW_GAP)
}

function near_limit_rows(budgets: ReadonlyArray<FileBudget>, root: string): ReadonlyArray<string> {
	return budgets.map((entry) => budget_row(entry, root)).filter((row) => row !== undefined)
}

function declared_files(
	verdict: Verdict,
	paths: ReadonlyArray<string>,
	is_basic: boolean,
): ReadonlyArray<string> {
	if (verdict === 'required') return test_declared_logic.runtime_files(paths, is_basic)
	if (verdict === 'exempt') return test_declared_logic.exempt_files(paths, is_basic)

	return []
}

// The `test:declared` verdict the planned files would get, with the files that decide it.
function declared_line(paths: ReadonlyArray<string>, is_basic: boolean): string {
	const verdict = test_declared_logic.verdict_for(paths, is_basic)
	const files = declared_files(verdict, paths, is_basic)

	return files.length === 0 ? verdict : `${verdict}: ${files.join(', ')}`
}

function section(title: string, lines: ReadonlyArray<string>, empty: string): string {
	const body = lines.length === 0 ? [empty] : lines

	return [`=== ${title} ===`, ...body].join('\n')
}

// The three answers that read the planned files say so once each when there are none, rather than
// answering for an empty plan — `test:declared` would call it `exempt`.
function file_sections(parts: ScaffoldParts): ReadonlyArray<string> {
	if (parts.files.length === 0) return FILE_TITLES.map((title) => section(title, [], NO_FILES))

	const [lines, declared, owed] = FILE_TITLES

	return [
		section(lines, parts.near_limit, NONE_NEAR),
		section(declared, [parts.declared], NO_FILES),
		section(owed, parts.cases, NO_CASES),
	]
}

function estimate_lines(size: DeclaredSize | undefined): Array<string> {
	if (size === undefined) return []
	const counts = issue_body_keys.size_value(String(size.files), String(size.lines))

	return [`${issue_body_keys.prefix('size')} ${counts}`]
}

function format(parts: ScaffoldParts): string {
	return [
		parts.summary,
		...estimate_lines(parts.estimate),
		...file_sections(parts),
		section(
			'plan:consumers',
			parts.consumers === undefined ? [] : [parts.consumers],
			NO_IDENTIFIERS,
		),
	].join('\n\n')
}

const plan_scaffold = { declared_line, format, near_limit_rows, split_targets }

export type { ScaffoldParts, Targets }
export { plan_scaffold }
