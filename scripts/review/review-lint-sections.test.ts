import { describe, expect, it } from 'vitest'
import { review_lint_sections } from './review-lint-sections'

describe('review_lint_sections.parse_sections', () => {
	it('drops the category number and a trailing parenthetical from a heading', () => {
		const sections = review_lint_sections.parse_sections(
			'intro\n### 4. Project conventions (`CLAUDE.md`)\nbody',
		)

		expect(sections).toEqual([{ heading: 'Project conventions', lines: ['body'] }])
	})
})

describe('review_lint_sections.item_blocks', () => {
	it('joins an indented continuation to its item and closes an item at prose', () => {
		const blocks = review_lint_sections.item_blocks([
			'- first',
			'  more of first',
			'1. second',
			'prose after the list',
			'  indented prose',
		])

		expect(blocks).toEqual(['- first\n  more of first', '1. second'])
	})
})
