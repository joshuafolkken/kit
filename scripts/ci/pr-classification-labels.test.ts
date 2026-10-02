import { beforeEach, describe, expect, it, vi } from 'vitest'
import { pr_classification } from './pr-classification'

const gh_outcomes = vi.hoisted(() => vi.fn())

vi.mock('execa', async () => {
	const { gh_execa_fixture } = await import('#scripts/git/git-gh-execa-fixture')

	return { execaSync: gh_execa_fixture.honoring_reject(gh_outcomes) }
})

const REPOSITORY = 'joshuafolkken/kit'
const PULL_NUMBER = 42
const NOT_FOUND = 'gh: Not Found (HTTP 404)'

beforeEach(() => {
	gh_outcomes.mockReset()
})

// joshuafolkken/kit#2901: pinned before the read moved behind `git_gh_exec`. The check reads the
// labels as they stand when it runs (joshuafolkken/kit#2712), one name per line, and a read that
// fails stops the check loudly rather than judging an empty label set.
describe('pr_classification.fetch_current_labels', () => {
	it('asks the issue labels endpoint for the label names', () => {
		gh_outcomes.mockReturnValue({ exitCode: 0, stdout: '' })

		pr_classification.fetch_current_labels(REPOSITORY, PULL_NUMBER)

		expect(gh_outcomes).toHaveBeenCalledWith(
			'gh',
			['api', `repos/${REPOSITORY}/issues/${String(PULL_NUMBER)}/labels`, '--jq', '.[].name'],
			expect.anything(),
		)
	})

	it('answers one label per output line, dropping blank lines', () => {
		gh_outcomes.mockReturnValue({ exitCode: 0, stdout: 'feature\nbugfix\n\n' })

		expect(pr_classification.fetch_current_labels(REPOSITORY, PULL_NUMBER)).toStrictEqual([
			'feature',
			'bugfix',
		])
	})

	it('answers no labels for a pull request that carries none', () => {
		gh_outcomes.mockReturnValue({ exitCode: 0, stdout: '' })

		expect(pr_classification.fetch_current_labels(REPOSITORY, PULL_NUMBER)).toStrictEqual([])
	})

	it('throws with gh stderr when the read fails', () => {
		gh_outcomes.mockReturnValue({ exitCode: 1, stdout: '', stderr: NOT_FOUND })

		expect(() => pr_classification.fetch_current_labels(REPOSITORY, PULL_NUMBER)).toThrow(
			`Could not read the pull request labels: ${NOT_FOUND}`,
		)
	})
})
