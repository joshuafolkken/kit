#!/usr/bin/env tsx
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { line_budget, type FileBudget } from './line-budget'

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
const USAGE = 'usage: pnpm josh lines <path> [<path>...]'
const EXIT_USAGE = 1
const ROW_GAP = '  '

// Why a path carries no number, said in the row rather than left blank — a blank would read as zero
// code lines, which is the one answer this command must never appear to give.
//
// **Two reasons, and neither claims more than it knows.** A path that is not a regular file — a typo,
// or a directory — is never sent to eslint at all, so quoting eslint's verdict for it would answer a
// question nobody asked, and a reader would take a typo for a real file eslint declined to count. The
// other reason covers everything that reached the probe without coming back with a number: a path
// eslint ignores, one no configuration covers, one it could not parse, and a probe that could not run
// at all. It deliberately does not name eslint, because the last of those is not eslint's doing.
const NOT_A_FILE = 'not counted: not a regular file'
const NOT_COUNTED = 'not counted: no line count for this path'

function not_counted_reason(file_path: string): string {
	return line_budget.is_lintable_path(file_path) ? NOT_COUNTED : NOT_A_FILE
}

function row(relative_path: string, budget: FileBudget['budget'], reason: string): string {
	if (budget === undefined) return `${relative_path}${ROW_GAP}${reason}`

	const note = line_budget.advice(budget)
	const suffix = note === undefined ? '' : ` — ${note}`

	return `${relative_path}${ROW_GAP}${line_budget.describe(budget)}${suffix}`
}

// The threshold is printed with the rows rather than left implicit: a reader who sees "near the limit"
// on one file and nothing on the next needs the boundary to know which side a third one is on.
function header(): string {
	const limit = line_budget.configured_limit()

	const threshold = line_budget.near_limit_threshold(limit)

	return `limit ${String(limit)} code lines · near from ${String(threshold)}`
}

function rows_for(budgets: ReadonlyArray<FileBudget>, project_root: string): ReadonlyArray<string> {
	return budgets.map((entry) =>
		row(
			path.relative(project_root, entry.file_path),
			entry.budget,
			not_counted_reason(entry.file_path),
		),
	)
}

async function run_lines(
	command_arguments: ReadonlyArray<string>,
	project_root: string,
): Promise<number> {
	if (command_arguments.length === 0) {
		process.stdout.write(`${USAGE}\n`)

		return EXIT_USAGE
	}

	const targets = command_arguments.map((argument) => path.resolve(project_root, argument))
	const budgets = await line_budget.budgets_for(targets, project_root)

	process.stdout.write(`${[header(), ...rows_for(budgets, project_root)].join('\n')}\n`)

	return 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = await run_lines(process.argv.slice(ARGV_START), process.cwd())
}

const lines_command = {
	header,
	not_counted_reason,
	row,
	rows_for,
	run_lines,
	NOT_A_FILE,
	NOT_COUNTED,
	USAGE,
}

export { lines_command }
