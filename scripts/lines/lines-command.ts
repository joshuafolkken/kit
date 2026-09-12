#!/usr/bin/env tsx
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { line_budget, type FileBudget, type LineBudget } from './line-budget'
import { line_targets } from './line-targets'

// `josh lines` — the ask-before-writing half of joshuafolkken/kit#1425. `pnpm josh lint` reports the
// file line limit only once it has been broken, and by then the writing is finished and the splitting
// that follows is rework. This answers the same question before the first edit: how many code lines
// each target file already has, and how many are left.
//
// **It reports and never fails.** The limit is lint's to enforce, and a second command exiting
// non-zero on the same condition would be a second enforcement point for it — which is how a headroom
// report turns into a way to reinterpret the gate. A non-zero exit here means the arguments were
// unusable, never that a file is large.

const ARGV_START = 2
const ROW_GAP = '  '
// The no-argument scan's answer when nothing is near the limit — a defined "none" rather than a
// failure, so an empty result reads as "the repository is clear" instead of "the command broke".
const NONE_NEAR = 'no files near the limit'

// Why a path carries no number, said in the row rather than left blank — a blank would read as zero
// code lines, which is the one answer this command must never appear to give.
//
// **Three reasons, and none claims more than it knows.** A path that is not a regular file — a typo,
// or a directory — is never sent to eslint at all, so quoting eslint's verdict for it would answer a
// question nobody asked, and a reader would take a typo for a real file eslint declined to count. A
// path this project sets no `max-lines` on has nothing to be counted *against*, which is `NO_LIMIT`
// below. The last covers everything that reached the probe without coming back with a number: a path
// eslint ignores, one no configuration covers, one it could not parse, and a probe that could not run
// at all. It deliberately does not name eslint, because the last of those is not eslint's doing.
const NOT_A_FILE = 'not counted: not a regular file'
const NOT_COUNTED = 'not counted: no line count for this path'
// The third reason, and the one that replaced a wrong number (joshuafolkken/kit#1454). This project's
// eslint enforces no `max-lines` here, so there is nothing to report a budget against — and the
// alternative to saying so is quoting kit's limit for someone else's project, which is the defect. It
// names no cause because there are several: the rule is turned off for this path, no configuration
// covers it with a `max`, or the project's eslint could not be loaded at all. The row would otherwise
// assert whichever of them it guessed.
const NO_LIMIT = 'not counted: no max-lines limit for this path'

function not_counted_reason(entry: FileBudget): string {
	if (!line_budget.is_lintable_path(entry.file_path)) return NOT_A_FILE

	return entry.limit === undefined ? NO_LIMIT : NOT_COUNTED
}

function budgeted(budget: NonNullable<FileBudget['budget']>): string {
	const note = line_budget.advice(budget)
	const suffix = note === undefined ? '' : ` — ${note}`

	return `${line_budget.describe(budget)}${suffix}`
}

function row(relative_path: string, entry: FileBudget): string {
	const body = entry.budget === undefined ? not_counted_reason(entry) : budgeted(entry.budget)

	return `${relative_path}${ROW_GAP}${body}`
}

// The threshold is printed with the rows rather than left implicit: a reader who sees "near the limit"
// on one file and nothing on the next needs the boundary to know which side a third one is on.
//
// **It is read off the budgets rather than from a limit of this command's own** (joshuafolkken/kit#1454).
// Each file's limit is whatever that project's eslint enforces for it, so there is a line count to
// print here only where every counted file agrees on one; where they do not — or where none was
// resolved — the boundary is stated as the share it has always been, and each row carries its own
// limit beside its own percentage.
function header(budgets: ReadonlyArray<FileBudget>): string {
	const limits = [...new Set(budgets.map((entry) => entry.limit))].filter(
		(limit) => limit !== undefined,
	)
	const [only] = limits

	if (only === undefined || limits.length !== 1) {
		return `near from ${String(line_budget.near_limit_percent())}% of each file's own limit`
	}

	return `limit ${String(only)} code lines · near from ${String(line_budget.near_limit_threshold(only))}`
}

function rows_for(budgets: ReadonlyArray<FileBudget>, project_root: string): ReadonlyArray<string> {
	return budgets.map((entry) => row(path.relative(project_root, entry.file_path), entry))
}

// A budget that reached the "near the limit" threshold, narrowed so the sort below can read
// `headroom` without a non-null assertion — the filter is what proves `budget` is present.
function is_near(entry: FileBudget): entry is FileBudget & { budget: LineBudget } {
	return entry.budget?.is_near_limit === true
}

// The no-argument scan reports only what is near the limit, least headroom first, so an over-limit
// file — negative headroom — sorts ahead of one that merely has little room left.
function near_limit_budgets(budgets: ReadonlyArray<FileBudget>): ReadonlyArray<FileBudget> {
	return budgets
		.filter(is_near)
		.toSorted((left, right) => left.budget.headroom - right.budget.headroom)
}

async function scan_budgets(root: string): Promise<ReadonlyArray<FileBudget>> {
	const targets = await line_targets.lint_target_files(root)
	const budgets = await line_budget.budgets_for(targets, root)

	return near_limit_budgets(budgets)
}

async function argument_budgets(
	command_arguments: ReadonlyArray<string>,
	project_root: string,
): Promise<ReadonlyArray<FileBudget>> {
	const targets = command_arguments.map((argument) => path.resolve(project_root, argument))

	return await line_budget.budgets_for(targets, project_root)
}

// Only the scan can be empty — a path argument always yields a row, even a "not counted" one — so the
// none-line is the scan's defined answer and never a path run's.
function render(budgets: ReadonlyArray<FileBudget>, project_root: string): string {
	if (budgets.length === 0) return NONE_NEAR

	return [header(budgets), ...rows_for(budgets, project_root)].join('\n')
}

// The scan resolves the repository root first — `budgets_for` and the row display both key off it — so
// a run started from a subdirectory reports the same files as one started from the root.
async function run_scan(): Promise<number> {
	const root = await line_targets.repo_root()
	const budgets = await scan_budgets(root)

	process.stdout.write(`${render(budgets, root)}\n`)

	return 0
}

async function run_arguments(
	command_arguments: ReadonlyArray<string>,
	project_root: string,
): Promise<number> {
	const budgets = await argument_budgets(command_arguments, project_root)

	process.stdout.write(`${render(budgets, project_root)}\n`)

	return 0
}

async function run_lines(
	command_arguments: ReadonlyArray<string>,
	project_root: string,
): Promise<number> {
	return command_arguments.length === 0
		? await run_scan()
		: await run_arguments(command_arguments, project_root)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = await run_lines(process.argv.slice(ARGV_START), process.cwd())
}

const lines_command = {
	header,
	near_limit_budgets,
	not_counted_reason,
	render,
	row,
	rows_for,
	run_lines,
	NONE_NEAR,
	NOT_A_FILE,
	NO_LIMIT,
	NOT_COUNTED,
}

export { lines_command }
