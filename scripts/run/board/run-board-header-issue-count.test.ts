import { describe, expect, it } from 'vitest'
import type { BoardHeader } from './run-board-header'
import { run_board_link, type Link } from './run-board-link'
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

// joshuafolkken/kit#7089: each count opens its issue list, and the repository's name its top.
const ESCAPE = '\u{1B}'
const ISSUES = `https://github.com/${REPO}/issues?q=is%3Aissue+is%3A`

// A link drawn as text, naming the address it opens.
function bracketed(text: string, url: string): string {
	return `[${text}](${url})`
}

// A link as a terminal that opens one draws it: the escape draws nothing.
function hyperlink(text: string, url: string): string {
	return `${ESCAPE}]8;;${url}${ESCAPE}\\${text}${ESCAPE}]8;;${ESCAPE}\\`
}

// The header's lines with its links made as the board makes them for `repo`.
function linked_by(repo: string | undefined, link: Link): Array<string> {
	return lines_of(header({ repo, issue_count: COUNT, ...run_board_link.links_of(repo, link) }))
}

describe('run_board_header.header_lines repository links', () => {
	it('links the open count to the open issues and the closed count to the closed ones', () => {
		expect(linked_by(REPO, bracketed)[0]).toContain(
			`📮 [87](${ISSUES}open)/[6,912](${ISSUES}closed)`,
		)
	})

	it('links the repository’s name to its top on the second line', () => {
		expect(linked_by(REPO, bracketed)[1]).toContain(`[kit](https://github.com/${REPO})`)
	})

	it('pads the columns on the text before it is linked', () => {
		expect(linked_by(REPO, hyperlink)).toStrictEqual(
			lines_of(header({ repo: REPO, issue_count: COUNT })),
		)
	})

	it('leaves the name blank and unlinked before a plan names the repository', () => {
		expect(linked_by(undefined, bracketed)[1]).not.toContain('](')
	})
})
