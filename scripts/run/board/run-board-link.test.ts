import { describe, expect, it } from 'vitest'
import { run_board_link } from './run-board-link'

// joshuafolkken/kit#3450: an issue number on the board opens its GitHub issue — this repository's for a
// bare number, the named repository's for `owner/repo#N` — and stays plain before the plan names one.

const { issue_url, linker } = run_board_link
const REPO = 'joshuafolkken/kit'

function bracketed(text: string, url: string): string {
	return `[${text}](${url})`
}

describe('run_board_link.issue_url', () => {
	it('points a bare number at the run’s repository', () => {
		expect(issue_url('3450', REPO)).toBe('https://github.com/joshuafolkken/kit/issues/3450')
	})

	it('points a qualified reference at the repository it names', () => {
		expect(issue_url('other/repo#12', REPO)).toBe('https://github.com/other/repo/issues/12')
	})
})

describe('run_board_link.linker', () => {
	it('links the reference text to its issue', () => {
		expect(linker(REPO, bracketed)('7')).toBe('[7](https://github.com/joshuafolkken/kit/issues/7)')
	})

	it('leaves the reference plain while no repository is known', () => {
		expect(linker(undefined, bracketed)('7')).toBe('7')
	})
})
