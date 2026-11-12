import { describe, expect, it } from 'vitest'
import { run_board_link } from './run-board-link'

// joshuafolkken/kit#3450: an issue number on the board opens its GitHub issue — this repository's for a
// bare number, the named repository's for `owner/repo#N` — and stays plain before the plan names one.

const { issue_url, linker, pull_linker, pull_url, repo_linker, repo_url } = run_board_link
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

// joshuafolkken/kit#4625: a followup row's pull request number opens the pull request.
describe('run_board_link.pull_linker', () => {
	it('points the number at the repository’s pull request', () => {
		expect(pull_url(4618, REPO)).toBe('https://github.com/joshuafolkken/kit/pull/4618')
	})

	it('links the number text to its pull request', () => {
		expect(pull_linker(REPO, bracketed)(4618)).toBe(
			'[4618](https://github.com/joshuafolkken/kit/pull/4618)',
		)
	})

	it('leaves the number plain while no repository is known', () => {
		expect(pull_linker(undefined, bracketed)(4618)).toBe('4618')
	})
})

// joshuafolkken/kit#7089: the header's repository name opens the repository, its issue counts the lists.
describe('run_board_link.repo_linker', () => {
	it('points each page at the repository’s top or its open or closed issues', () => {
		expect([
			repo_url(REPO, 'home'),
			repo_url(REPO, 'open'),
			repo_url(REPO, 'closed'),
		]).toStrictEqual([
			'https://github.com/joshuafolkken/kit',
			'https://github.com/joshuafolkken/kit/issues?q=is%3Aissue+is%3Aopen',
			'https://github.com/joshuafolkken/kit/issues?q=is%3Aissue+is%3Aclosed',
		])
	})

	it('links the text to the page', () => {
		expect(repo_linker(REPO, bracketed)('kit', 'home')).toBe(
			'[kit](https://github.com/joshuafolkken/kit)',
		)
	})

	it('leaves the text plain while no repository is known', () => {
		expect(repo_linker(undefined, bracketed)('87', 'open')).toBe('87')
	})
})
