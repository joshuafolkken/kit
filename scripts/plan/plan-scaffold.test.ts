import type { FileBudget } from '#scripts/lines/line-budget'
import { describe, expect, it } from 'vitest'
import { plan_scaffold, type ScaffoldParts } from './plan-scaffold'

const ROOT = '/repo'
const LIMIT = 300
const FILE_A = 'scripts/a.ts'
const SUMMARY = ['## Now', '', '## Change', '', '## Check'].join('\n')
const DECLARED = `required: ${FILE_A}`
const BOUNDARY = 'fs'
const OWED = 'fs: missing file / permission denied'
const CONSUMERS = '### 影響を受ける既存の利用者\n\n- `run:prep`'
const NO_FILES = '(no planned file — pass paths after the issue number)'
const DOC = 'docs/b.md'
const LINES = 'lines'
const CASES = 'cases'
const DECLARED_TITLE = 'test:declared'
const CONSUMERS_TITLE = 'plan:consumers'
const NEAR: FileBudget = {
	file_path: `${ROOT}/${FILE_A}`,
	limit: LIMIT,
	budget: { code_lines: 280, limit: LIMIT, headroom: 20, is_near_limit: true },
}
const ROOMY: FileBudget = {
	file_path: `${ROOT}/scripts/b.ts`,
	limit: LIMIT,
	budget: { code_lines: 10, limit: LIMIT, headroom: 290, is_near_limit: false },
}
const UNCOUNTED: FileBudget = {
	file_path: `${ROOT}/README.md`,
	limit: undefined,
	budget: undefined,
}
const NEAR_ROW = `${FILE_A}  280/300 code lines (93%), 20 to spare  near the limit: declare the splitting plan in Step 0 before writing into it`

const PARTS: ScaffoldParts = {
	summary: SUMMARY,
	files: [FILE_A],
	near_limit: [NEAR_ROW],
	declared: DECLARED,
	cases: [BOUNDARY, OWED],
	consumers: CONSUMERS,
}

// The fixture output: the skeleton, then one `=== title ===` block per answer.
function expected(sections: ReadonlyArray<[string, ReadonlyArray<string>]>): string {
	const blocks = sections.map(([title, lines]) => [`=== ${title} ===`, ...lines].join('\n'))

	return [SUMMARY, ...blocks].join('\n\n')
}

describe('plan_scaffold.format', () => {
	it('lays the answers out in the order the work summary is written', () => {
		expect(plan_scaffold.format(PARTS)).toBe(
			expected([
				[LINES, [NEAR_ROW]],
				[DECLARED_TITLE, [DECLARED]],
				[CASES, [BOUNDARY, OWED]],
				[CONSUMERS_TITLE, [CONSUMERS]],
			]),
		)
	})

	it('says per file section that no file is planned, and that no identifier was named', () => {
		const empty = { ...PARTS, files: [], near_limit: [], cases: [], consumers: undefined }

		expect(plan_scaffold.format(empty)).toBe(
			expected([
				[LINES, [NO_FILES]],
				[DECLARED_TITLE, [NO_FILES]],
				[CASES, [NO_FILES]],
				[CONSUMERS_TITLE, ['(no backticked identifier in the issue)']],
			]),
		)
	})

	it('names the empty answer of a section with planned files but nothing to report', () => {
		const output = plan_scaffold.format({ ...PARTS, near_limit: [], cases: [] })

		expect(output).toContain('=== lines ===\nno planned file near the limit')
		expect(output).toContain('=== cases ===\nnone')
	})
})

describe('plan_scaffold.near_limit_rows', () => {
	it('keeps only the files near the limit, worded as `lines` words them', () => {
		expect(plan_scaffold.near_limit_rows([ROOMY, NEAR, UNCOUNTED], ROOT)).toStrictEqual([NEAR_ROW])
	})
})

describe('plan_scaffold.split_targets', () => {
	it('splits existing files from identifiers and drops flags and absent paths', () => {
		const files = new Set([FILE_A, DOC])
		const targets = [FILE_A, 'run:prep', '--help', 'scripts/new.ts', DOC, 'run_prep']

		expect(plan_scaffold.split_targets(targets, (target) => files.has(target))).toStrictEqual({
			files: [FILE_A, DOC],
			identifiers: ['run:prep', 'run_prep'],
		})
	})
})

describe('plan_scaffold.declared_line', () => {
	it.each([
		{ paths: [FILE_A, 'scripts/a.test.ts'], line: 'satisfied' },
		{ paths: [FILE_A], line: DECLARED },
		{ paths: [DOC], line: `exempt: ${DOC}` },
	])('answers $line for $paths', ({ paths, line }) => {
		expect(plan_scaffold.declared_line(paths, false)).toBe(line)
	})
})
