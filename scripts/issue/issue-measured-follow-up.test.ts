import { afterEach, describe, expect, it, vi } from 'vitest'
import { issue_measured_follow_up } from './issue-measured-follow-up'

// joshuafolkken/kit#9063: a measurement's follow-up lines, which the lane child writes and the parent
// files — the titles read out of the evidence, the parent's filing line, and the unfiled ones.

const ISSUE = '9063'

afterEach(() => {
	vi.restoreAllMocks()
})

describe('issue_measured_follow_up.titles_of', () => {
	it('reads every follow-up line, trimmed, list marker and full-width colon included', () => {
		const text = '結果\n後続: First  \n- 後続：Second\n  * 後続:Third\n'

		expect(issue_measured_follow_up.titles_of(text)).toStrictEqual(['First', 'Second', 'Third'])
	})

	it('reads nothing from text without a follow-up line or with an empty one', () => {
		expect(issue_measured_follow_up.titles_of('result\n後続:   \nnot 後続: inline')).toStrictEqual(
			[],
		)
	})
})

describe('issue_measured_follow_up.filing_line', () => {
	it('single-quotes the title so a backtick or quote stays literal', () => {
		expect(issue_measured_follow_up.filing_line("Fix `run:merge`'s gap", ISSUE)).toBe(
			`pnpm josh issue:file 'Fix \`run:merge\`'\\''s gap' --found-during ${ISSUE} --body-file <body.md>`,
		)
	})
})

describe('issue_measured_follow_up.unfiled', () => {
	it('keeps only the titles no filed title matches exactly, whitespace aside', () => {
		expect(issue_measured_follow_up.unfiled(['A', 'B', 'C'], [' A ', 'b'])).toStrictEqual([
			'B',
			'C',
		])
	})
})

describe('issue_measured_follow_up.print_filing_lines', () => {
	it('prints nothing for evidence without a follow-up line', () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		issue_measured_follow_up.print_filing_lines('result only', ISSUE)

		expect(info).not.toHaveBeenCalled()
	})
})
