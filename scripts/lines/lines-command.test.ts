import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { line_budget, type FileBudget } from './line-budget'
import { line_targets } from './line-targets'
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

const OVER_PATH = 'scripts/over.ts'
const NEAR_PATH = 'scripts/near.ts'
const FAR_PATH = 'scripts/far.ts'
const OVER = entry(path.join(PROJECT_ROOT, OVER_PATH), LIMIT + 1, LIMIT)
const NEAR = entry(path.join(PROJECT_ROOT, NEAR_PATH), THRESHOLD, LIMIT)
const FAR = entry(path.join(PROJECT_ROOT, FAR_PATH), THRESHOLD - 1, LIMIT)

function captured_output(): Array<string> {
	const written: Array<string> = []

	vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
		written.push(String(chunk))

		return true
	})

	return written
}

describe('lines_command.near_limit_budgets', () => {
	// Near and over-limit files are kept and ordered least headroom first, so the file with the least
	// room to write into — negative, once it is already over — leads the report.
	it('keeps near and over-limit files, least headroom first', () => {
		const kept = lines_command.near_limit_budgets([FAR, NEAR, OVER])

		expect(kept.map((budget) => budget.file_path)).toEqual([OVER.file_path, NEAR.file_path])
	})
})

describe('lines_command.run_lines', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	// No argument scans the repository and reports only what is near the limit, least headroom first:
	// the far file is left out and the over-limit file leads.
	it('scans and lists near-limit files least headroom first when no path is given', async () => {
		vi.spyOn(line_targets, 'repo_root').mockResolvedValue(PROJECT_ROOT)
		vi.spyOn(line_targets, 'lint_target_files').mockResolvedValue([])
		vi.spyOn(line_budget, 'budgets_for').mockResolvedValue([FAR, NEAR, OVER])
		const written = captured_output()

		const code = await lines_command.run_lines([], PROJECT_ROOT)
		const output = written.join('')

		expect(code).toBe(0)
		expect(output).not.toContain(FAR_PATH)
		expect(output.indexOf(OVER_PATH)).toBeLessThan(output.indexOf(NEAR_PATH))
	})

	// The defined answer when nothing is near the limit is a "none" line and a clean exit, never a
	// usage failure.
	it('reports none and succeeds when the scan finds nothing near the limit', async () => {
		vi.spyOn(line_targets, 'repo_root').mockResolvedValue(PROJECT_ROOT)
		vi.spyOn(line_targets, 'lint_target_files').mockResolvedValue([])
		vi.spyOn(line_budget, 'budgets_for').mockResolvedValue([FAR])
		const written = captured_output()

		const code = await lines_command.run_lines([], PROJECT_ROOT)

		expect(code).toBe(0)
		expect(written.join('')).toContain(lines_command.NONE_NEAR)
	})

	// A named path is still reported whether or not it is near the limit — the near-only narrowing is
	// the scan's, not the path run's.
	it('reports a named path even when it is not near the limit', async () => {
		vi.spyOn(line_budget, 'budgets_for').mockResolvedValue([FAR])
		const written = captured_output()

		const code = await lines_command.run_lines([FAR.file_path], PROJECT_ROOT)
		const output = written.join('')

		expect(code).toBe(0)
		expect(output).toContain(FAR_PATH)
		expect(output).not.toContain(lines_command.NONE_NEAR)
	})
})
