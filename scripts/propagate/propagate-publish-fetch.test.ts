import { beforeEach, describe, expect, it, vi } from 'vitest'
import { propagate_publish } from './propagate-publish'

const gh_outcomes = vi.hoisted(() => vi.fn())

vi.mock('execa', async () => {
	const { gh_execa_fixture } = await import('#scripts/gh/git-gh-execa-fixture')

	return { execaSync: gh_execa_fixture.honoring_reject(gh_outcomes) }
})

const ENDPOINT = '/users/joshuafolkken/packages/npm/kit/versions?per_page=1'
const WIDENED_ENDPOINT = '/users/joshuafolkken/packages/npm/kit/versions?per_page=100'
const NAMES_JQ = '[.[] | .name]'
const REQUEST_TIMEOUT_MS = 20_000

beforeEach(() => {
	gh_outcomes.mockReset()
})

// joshuafolkken/kit#2901: pinned before the read moved behind `git_gh_exec`. The registry read
// answers the names it lists, and anything it could not read is `undefined` — never a throw, and
// never an empty list that would read as "not published yet".
describe('propagate_publish.fetch_published_versions', () => {
	it('returns the version names the registry lists', () => {
		gh_outcomes.mockReturnValue({ exitCode: 0, stdout: '["1.111.0","1.110.0"]\n' })

		expect(propagate_publish.fetch_published_versions(ENDPOINT)).toStrictEqual([
			'1.111.0',
			'1.110.0',
		])
	})

	it('asks for a widened page, bounded by its own budget', () => {
		gh_outcomes.mockReturnValue({ exitCode: 0, stdout: '[]' })

		propagate_publish.fetch_published_versions(ENDPOINT)

		expect(gh_outcomes).toHaveBeenCalledWith(
			'gh',
			['api', WIDENED_ENDPOINT, '--jq', NAMES_JQ],
			expect.objectContaining({ timeout: REQUEST_TIMEOUT_MS }),
		)
	})

	it('drops entries that are not names', () => {
		gh_outcomes.mockReturnValue({ exitCode: 0, stdout: '["1.111.0",7]' })

		expect(propagate_publish.fetch_published_versions(ENDPOINT)).toStrictEqual(['1.111.0'])
	})

	it('answers undefined when gh fails, without throwing', () => {
		gh_outcomes.mockReturnValue({ exitCode: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)' })

		expect(propagate_publish.fetch_published_versions(ENDPOINT)).toBeUndefined()
	})

	it('answers undefined when the output is not a list', () => {
		gh_outcomes.mockReturnValue({ exitCode: 0, stdout: '{"name":"1.111.0"}' })

		expect(propagate_publish.fetch_published_versions(ENDPOINT)).toBeUndefined()
	})
})
