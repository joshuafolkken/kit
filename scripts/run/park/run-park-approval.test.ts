import { describe, expect, it } from 'vitest'
import { run_park_approval, type ParkApproval } from './run-park-approval'

const LINES = '- 規模承認の行数: 150 / 260'
const FULL: ParkApproval = {
	paths: ['scripts/a.ts', 'docs/b.md'],
	lines: { declared: 150, max: 260 },
	files: { declared: 4, max: 6 },
}

function read(lines: ReadonlyArray<string>): ParkApproval | undefined {
	let approval: ParkApproval | undefined

	for (const line of lines) approval = run_park_approval.with_line(approval, line)

	return approval
}

// joshuafolkken/kit#6776: a size-approval option's three lines, read one by one.
describe('run_park_approval', () => {
	it('reads the paths and both axes', () => {
		const approval = read([
			'- 規模承認のパス: `scripts/a.ts`, `docs/b.md`',
			LINES,
			'- 規模承認のファイル数: 4/6',
		])

		expect(approval).toStrictEqual(FULL)
		expect(run_park_approval.is_complete(approval)).toBe(true)
		expect(run_park_approval.problem_of(approval, 'option 1')).toBeUndefined()
	})

	it('names the first missing line of a partial range', () => {
		const approval = read([LINES])

		expect(run_park_approval.is_complete(approval)).toBe(false)
		expect(run_park_approval.problem_of(approval, 'option 1')).toBe(
			'option 1 has no "- 規模承認のパス: <path> …" line',
		)
	})

	it('leaves an option with no range alone', () => {
		expect(read(['- 層: A'])).toBeUndefined()
		expect(run_park_approval.problem_of(undefined, 'option 1')).toBeUndefined()
	})

	it('prints the three lines indented under an option', () => {
		expect(run_park_approval.schema_lines()).toHaveLength(3)
		expect(run_park_approval.schema_lines()[1]).toBe('   - 規模承認の行数: <declared> / <max>')
	})
})
