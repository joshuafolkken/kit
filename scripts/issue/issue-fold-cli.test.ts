import { split_assess } from '#scripts/split/split-assess'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { issue_fold } from './issue-fold'
import { issue_fold_cli } from './issue-fold-cli'

// joshuafolkken/kit#2213: the CLI sources the size half from `split:assess` and defaults to `fold`.
// The git read is mocked so the size question can be steered — including to the failure that must fold
// rather than separate.

const { diff_main_numstat } = vi.hoisted(() => ({
	diff_main_numstat: vi.fn<() => Promise<string>>(),
}))

vi.mock('#scripts/git/git-command', () => ({
	git_command: { diff_main_numstat },
}))

const FILE_COUNT = 11

// A numstat that clears both guides: eleven non-test files well past four hundred changed lines.
const OVERSIZE_DIFF = Array.from(
	{ length: FILE_COUNT },
	(_row, index) => `300\t300\tsrc/f${String(index)}.ts`,
).join('\n')

// Two candidate titles — the smallest input the fold question is asked of.
const TITLES = ['a', 'b']
const NOT_SEPARABLE = '--not-separable'

// Captured standard output, so the printed verdict token can be read back. A const array mutated in
// place, never reassigned, so the harness stays clear of top-level reassignment inside a hook.
const printed: Array<string> = []

beforeEach(() => {
	printed.length = 0
	vi.spyOn(console, 'info').mockImplementation((line: unknown) => {
		printed.push(String(line))
	})
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	diff_main_numstat.mockReset()
})

afterEach(() => {
	vi.restoreAllMocks()
})

function output(): string {
	return printed.join('\n')
}

describe('issue:fold — the size half is single-sourced from split:assess', () => {
	it('separates two separable findings whose combined size clears the guide', async () => {
		diff_main_numstat.mockResolvedValue(OVERSIZE_DIFF)

		expect(await issue_fold_cli.run(TITLES)).toBe(0)
		expect(output()).toContain(issue_fold.SEPARATE)
	})

	it('folds two findings when the size is under the guide', async () => {
		diff_main_numstat.mockResolvedValue('3\t1\tsrc/one.ts')

		expect(await issue_fold_cli.run(TITLES)).toBe(0)
		expect(output()).toContain(issue_fold.FOLD)
		expect(output()).not.toContain(issue_fold.SEPARATE)
	})

	it('folds rather than separates when the diff cannot be read', async () => {
		diff_main_numstat.mockRejectedValue(new Error('no base'))

		expect(await issue_fold_cli.run(TITLES)).toBe(0)
		expect(output()).toContain(issue_fold.FOLD)
	})

	it('answers no-fold-needed for a single candidate without measuring', async () => {
		expect(await issue_fold_cli.run(['only one'])).toBe(0)
		expect(output()).toContain(issue_fold.NO_FOLD_NEEDED)
		expect(diff_main_numstat).not.toHaveBeenCalled()
	})

	it('folds a --not-separable pair even when the size clears the guide', async () => {
		diff_main_numstat.mockResolvedValue(OVERSIZE_DIFF)

		expect(await issue_fold_cli.run([...TITLES, NOT_SEPARABLE])).toBe(0)
		expect(output()).toContain(issue_fold.FOLD)
		expect(output()).not.toContain(issue_fold.SEPARATE)
	})
})

describe('size_verdict defaults to single on an unreadable diff', () => {
	it('returns single when the git read throws', async () => {
		diff_main_numstat.mockRejectedValue(new Error('not a checkout'))

		expect(await issue_fold_cli.size_verdict()).toBe(split_assess.SINGLE_VERDICT)
	})
})

describe('read_arguments', () => {
	it('reads --not-separable and --json off the argv', () => {
		expect(issue_fold_cli.read_arguments([...TITLES, NOT_SEPARABLE, '--json'])).toEqual({
			titles: TITLES,
			is_separable: false,
			is_json: true,
		})
	})

	it('returns undefined on an unknown flag', () => {
		expect(issue_fold_cli.read_arguments(['a', '--nope'])).toBeUndefined()
	})
})
