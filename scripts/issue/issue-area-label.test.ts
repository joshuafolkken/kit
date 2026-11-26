import { describe, expect, it } from 'vitest'
import { issue_area_label } from './issue-area-label'
import { AREA_BOARD_LABEL, AREA_THEME_LABEL, ENHANCEMENT_LABEL } from './issue-labels'

// joshuafolkken/kit#8960: `issue:file` labels a new issue with the area the paths in its body name.

const BOARD_BODY = 'Reads `scripts/run/board/run-board-render-row.ts` — `lead_of`.'
const THEME_BODY = `${BOARD_BODY} And \`scripts/run/board/run-board-theme-wopr.ts\`.`

describe('issue_area_label.area_label_of', () => {
	it('reads a board module as the board area', () => {
		expect(issue_area_label.area_label_of(BOARD_BODY)).toBe(AREA_BOARD_LABEL)
	})

	it('reads a theme module or the theme skill as the theme area alone', () => {
		expect(issue_area_label.area_label_of(THEME_BODY)).toBe(AREA_THEME_LABEL)
		expect(issue_area_label.area_label_of('See `.claude/skills/board-theme/SKILL.md`.')).toBe(
			AREA_THEME_LABEL,
		)
	})

	it('reads no area where the body names no board path, or names one outside backticks', () => {
		expect(issue_area_label.area_label_of('Reads `scripts/issue/issue-file.ts`.')).toBeUndefined()
		expect(issue_area_label.area_label_of('Reads scripts/run/board/run-board.ts.')).toBeUndefined()
	})
})

describe('issue_area_label.with_label', () => {
	it('adds the body’s area to the labels', () => {
		expect(issue_area_label.with_label([ENHANCEMENT_LABEL], THEME_BODY)).toStrictEqual([
			ENHANCEMENT_LABEL,
			AREA_THEME_LABEL,
		])
	})

	it('keeps an area a `--label` named, and adds nothing without an area', () => {
		const named = [ENHANCEMENT_LABEL, AREA_BOARD_LABEL]

		expect(issue_area_label.with_label(named, THEME_BODY)).toBe(named)
		expect(issue_area_label.with_label([ENHANCEMENT_LABEL], 'No paths.')).toStrictEqual([
			ENHANCEMENT_LABEL,
		])
	})
})
