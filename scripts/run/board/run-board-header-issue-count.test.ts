import { describe, expect, it } from 'vitest'
import type { BoardHeader } from './run-board-header'
import { run_board_render_fixture } from './run-board-render-fixture'

// joshuafolkken/kit#7088: the first line ends on the repository's open and closed issues, on a screen
// and in a chat alike, once the plan names the repository and the count has been read.

const { header, lines_of } = run_board_render_fixture
const REPO = 'joshuafolkken/kit'
const COUNT = { open: 87, closed: 6912 }
const CHIP = '📮 87/6,912'

function first_of(extra: Partial<BoardHeader>): string {
	return lines_of(header(extra))[0] ?? ''
}

describe('run_board_header.header_lines issue count', () => {
	it('ends the first line on the open and closed counts', () => {
		expect(first_of({ repo: REPO, issue_count: COUNT })).toBe(
			`⏸ backlogrun  ⏰ 2°10′00″  ✅  0/0 ──────────  🔄 0  ⏳ 0  💤 0  ${CHIP}`,
		)
	})

	it('draws the same chip in a chat', () => {
		expect(first_of({ repo: REPO, issue_count: COUNT, form: 'chat' })).toMatch(
			/💤 0 {2}📮 87\/6,912$/u,
		)
	})

	it('draws no chip, and the line otherwise unchanged, where no count was read', () => {
		const plain = first_of({ repo: REPO })

		expect(plain).not.toContain('📮')
		expect(plain).toMatch(/💤 0$/u)
	})

	it('draws no chip before a plan names the repository', () => {
		expect(first_of({ repo: undefined, issue_count: COUNT })).toMatch(/💤 0$/u)
	})
})
