import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { line_budget } from './line-budget'
import { lines_command } from './lines-command'

// joshuafolkken/kit#1425: the report a Step 0 declaration reads before it names a target file. What is
// pinned here is what the reader has to be able to act on — the boundary printed beside the rows, the
// splitting advice on a file that is close, and a path that carries no number saying so rather than
// looking like zero.

const PROJECT_ROOT = '/repo'
const LIMIT = line_budget.configured_limit()
const THRESHOLD = line_budget.near_limit_threshold()

describe('lines_command.header', () => {
	it('prints the limit and where "near" begins', () => {
		expect(lines_command.header()).toBe(
			`limit ${String(LIMIT)} code lines · near from ${String(THRESHOLD)}`,
		)
	})
})

describe('lines_command.row', () => {
	it('states the headroom for a file with room left', () => {
		const row = lines_command.row('scripts/small.ts', line_budget.budget_of(100), '')

		expect(row).toContain(`100/${String(LIMIT)} code lines`)
		expect(row).toContain('to spare')
		expect(row).not.toContain('—')
	})

	it('tells a file at the threshold to declare its splitting plan', () => {
		expect(lines_command.row('scripts/big.ts', line_budget.budget_of(THRESHOLD), '')).toContain(
			'Step 0',
		)
	})

	it('says why a path carries no number, rather than leaving it blank', () => {
		const row = lines_command.row('README.md', undefined, lines_command.NOT_COUNTED)

		expect(row).toContain(lines_command.NOT_COUNTED)
		expect(row).not.toContain('0/')
	})
})

describe('lines_command.rows_for', () => {
	it('prints each path relative to the project root', () => {
		const rows = lines_command.rows_for(
			[{ file_path: path.join(PROJECT_ROOT, 'scripts', 'a.ts'), budget: undefined }],
			PROJECT_ROOT,
		)

		expect(rows[0]?.startsWith('scripts/a.ts')).toBe(true)
	})

	// A mistyped path is never sent to eslint, so a row quoting eslint's verdict for it would be a
	// claim about a question nobody asked — and the reader would read the typo as a real file.
	it('says a mistyped path is not a file rather than blaming eslint', () => {
		const rows = lines_command.rows_for(
			[{ file_path: path.join(PROJECT_ROOT, 'nope.ts'), budget: undefined }],
			PROJECT_ROOT,
		)

		expect(rows[0]).toContain(lines_command.NOT_A_FILE)
	})
})

describe('lines_command.not_counted_reason', () => {
	it('blames eslint only for a path that really is there', () => {
		expect(lines_command.not_counted_reason(import.meta.filename)).toBe(lines_command.NOT_COUNTED)
		expect(lines_command.not_counted_reason(path.join(PROJECT_ROOT, 'nope.ts'))).toBe(
			lines_command.NOT_A_FILE,
		)
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
