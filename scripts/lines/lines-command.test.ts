import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { line_budget, type FileBudget } from './line-budget'
import { lines_command } from './lines-command'

// joshuafolkken/kit#1425: the report a Step 0 declaration reads before it names a target file. What is
// pinned here is what the reader has to be able to act on — the boundary printed beside the rows, the
// splitting advice on a file that is close, and a path that carries no number saying so rather than
// looking like zero.

const PROJECT_ROOT = '/repo'
const LIMIT = 300
const OTHER_LIMIT = 400
const THRESHOLD = line_budget.near_limit_threshold(LIMIT)
const SMALL = 'scripts/small.ts'
const BIG = 'scripts/big.ts'
const MISSING = path.join(PROJECT_ROOT, 'nope.ts')

function entry(
	file_path: string,
	code_lines: number | undefined,
	limit: number | undefined,
): FileBudget {
	return {
		file_path,
		limit,
		budget:
			code_lines === undefined || limit === undefined
				? undefined
				: line_budget.budget_of(code_lines, limit),
	}
}

describe('lines_command.header', () => {
	it('prints the limit and where "near" begins', () => {
		expect(lines_command.header([entry('a.ts', 100, LIMIT)])).toBe(
			`limit ${String(LIMIT)} code lines · near from ${String(THRESHOLD)}`,
		)
	})

	// The limit is per file, so there is a line count to print here only where every file agrees on
	// one. Where they do not, a single number in the header would be wrong about one of them
	// (joshuafolkken/kit#1454) — so the boundary is stated as the share each row's own percentage is
	// read against.
	it('states the boundary as a share when the files do not share one limit', () => {
		const header = lines_command.header([
			entry('a.ts', 100, LIMIT),
			entry('b.ts', 100, OTHER_LIMIT),
		])

		expect(header).toContain(`${String(line_budget.near_limit_percent())}%`)
		expect(header).not.toContain(String(LIMIT))
	})

	it('states the share too when nothing resolved a limit at all', () => {
		expect(lines_command.header([entry('README.md', undefined, undefined)])).toContain(
			`${String(line_budget.near_limit_percent())}%`,
		)
	})
})

describe('lines_command.row', () => {
	it('states the headroom for a file with room left', () => {
		const row = lines_command.row(SMALL, entry(SMALL, 100, LIMIT))

		expect(row).toContain(`100/${String(LIMIT)} code lines`)
		expect(row).toContain('to spare')
		expect(row).not.toContain('—')
	})

	it('tells a file at the threshold to declare its splitting plan', () => {
		expect(lines_command.row(BIG, entry(BIG, THRESHOLD, LIMIT))).toContain('Step 0')
	})

	// A real file this project enforces no `max-lines` on. The reason has to say that rather than say
	// the count failed, and above all it must not print a limit borrowed from kit.
	it('says why a path carries no number, rather than leaving it blank', () => {
		const row = lines_command.row('here.ts', entry(import.meta.filename, undefined, undefined))

		expect(row).toContain(lines_command.NO_LIMIT)
		expect(row).not.toContain('0/')
	})
})

describe('lines_command.rows_for', () => {
	it('prints each path relative to the project root', () => {
		const rows = lines_command.rows_for(
			[entry(path.join(PROJECT_ROOT, 'scripts', 'a.ts'), undefined, undefined)],
			PROJECT_ROOT,
		)

		expect(rows[0]?.startsWith('scripts/a.ts')).toBe(true)
	})

	// A mistyped path is never sent to eslint, so a row quoting eslint's verdict for it would be a
	// claim about a question nobody asked — and the reader would read the typo as a real file.
	it('says a mistyped path is not a file rather than blaming eslint', () => {
		const rows = lines_command.rows_for([entry(MISSING, undefined, undefined)], PROJECT_ROOT)

		expect(rows[0]).toContain(lines_command.NOT_A_FILE)
	})
})

describe('lines_command.not_counted_reason', () => {
	// Three answers, and each says only what it knows: a path that is not a file, a real file this
	// project sets no limit on, and a real file with a limit whose count never came back
	// (joshuafolkken/kit#1454).
	it('separates a missing file, a missing limit and a missing count', () => {
		const counted = entry(import.meta.filename, undefined, LIMIT)
		const unlimited = entry(import.meta.filename, undefined, undefined)
		const missing = entry(MISSING, undefined, undefined)

		expect(lines_command.not_counted_reason(counted)).toBe(lines_command.NOT_COUNTED)
		expect(lines_command.not_counted_reason(unlimited)).toBe(lines_command.NO_LIMIT)
		expect(lines_command.not_counted_reason(missing)).toBe(lines_command.NOT_A_FILE)
	})
})

describe('lines_command.run_lines', () => {
	// A report never fails on a large file — the limit is lint's to enforce, and a second command
	// exiting non-zero on the same condition would be a second enforcement point for it. An unusable
	// argument list is the one thing that does.
	it('prints the usage line and fails when no path was given', async () => {
		const written: Array<string> = []
		const write = vi
			.spyOn(process.stdout, 'write')
			.mockImplementation((chunk: string | Uint8Array) => {
				written.push(String(chunk))

				return true
			})

		const code = await lines_command.run_lines([], PROJECT_ROOT)

		write.mockRestore()

		expect(code).not.toBe(0)
		expect(written.join('')).toContain(lines_command.USAGE)
	})
})
