import { repo_discovery } from '#scripts/discovery/repo-discovery'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { git_gh_etag_read } from './git-gh-etag-read'
import { git_gh_repo } from './git-gh-repo'

vi.mock('./git-gh-etag-read', () => ({
	git_gh_etag_read: { read: vi.fn() },
}))

const mocked_read = vi.mocked(git_gh_etag_read.read)

const REPO = 'joshuafolkken/kit'
const REPO_BODY = JSON.stringify({ full_name: REPO })
const REPO_API_PATH = 'repos/{owner}/{repo}'
const HTTPS_ORIGIN = `https://github.com/${REPO}.git`
const OVERRIDE_REPO = 'example-org/other-repo'
const RATE_LIMITED = 'gh: API rate limit exceeded for user ID 1. (HTTP 403)'

function use_remotes(urls: Array<string>): void {
	vi.spyOn(repo_discovery, 'read_remote_urls').mockReturnValue(urls)
}

beforeEach(() => {
	vi.stubEnv('GH_REPO', '')
})

afterEach(() => {
	vi.unstubAllEnvs()
	vi.restoreAllMocks()
	mocked_read.mockReset()
})

// joshuafolkken/kit#6752: `{owner}/{repo}` is what gh expands from GH_REPO or the remotes, so the
// slug is read locally and a run no longer spends one REST call per process on it.
describe('repo_get_name_with_owner — resolved locally', () => {
	it.each([
		HTTPS_ORIGIN,
		'https://github.com/joshuafolkken/kit',
		'git@github.com:joshuafolkken/kit.git',
		'git@github.com:joshuafolkken/kit',
		'ssh://git@github.com/joshuafolkken/kit.git',
		'ssh://git@github.com/joshuafolkken/kit',
	])('reads %s without calling the API', async (url) => {
		use_remotes([url])

		await expect(git_gh_repo.repo_get_name_with_owner()).resolves.toBe(REPO)
		expect(mocked_read).not.toHaveBeenCalled()
	})

	it('prefers GH_REPO over the origin remote', async () => {
		vi.stubEnv('GH_REPO', OVERRIDE_REPO)
		use_remotes([HTTPS_ORIGIN])

		await expect(git_gh_repo.repo_get_name_with_owner()).resolves.toBe(OVERRIDE_REPO)
		expect(mocked_read).not.toHaveBeenCalled()
	})
})

describe('repo_get_name_with_owner — API fallback', () => {
	it.each([
		['a non-GitHub host', ['https://gitlab.com/joshuafolkken/kit.git']],
		['no origin', []],
	])('reads through the ETag layer for %s', async (_label, urls) => {
		use_remotes(urls)
		mocked_read.mockResolvedValueOnce(REPO_BODY)

		await expect(git_gh_repo.repo_get_name_with_owner()).resolves.toBe(REPO)
		expect(mocked_read).toHaveBeenCalledWith(REPO_API_PATH)
	})

	it('surfaces an exhausted rate limit instead of answering undefined', async () => {
		use_remotes([])
		mocked_read.mockRejectedValueOnce(new Error(RATE_LIMITED))

		await expect(git_gh_repo.repo_get_name_with_owner()).rejects.toThrow(RATE_LIMITED)
	})

	it('returns undefined when the request fails otherwise', async () => {
		use_remotes([])
		mocked_read.mockRejectedValueOnce(new Error('gh: Not Found (HTTP 404)'))

		await expect(git_gh_repo.repo_get_name_with_owner()).resolves.toBeUndefined()
	})
})

describe('repo_get_name_with_owner — API response normalization', () => {
	// A renamed repository's old remote still names the old slug, which a GitHub-returned name never matches.
	it.each([HTTPS_ORIGIN.toUpperCase(), 'https://github.com/joshuafolkken/old-kit.git'])(
		'reads the canonical name through the ETag layer for %s',
		async (url) => {
			use_remotes([url])
			mocked_read.mockResolvedValueOnce(REPO_BODY)

			await expect(git_gh_repo.repo_get_canonical_name_with_owner()).resolves.toBe(REPO)
			expect(mocked_read).toHaveBeenCalledWith(REPO_API_PATH)
		},
	)

	it('returns undefined when the response names no repository', async () => {
		use_remotes([])
		mocked_read.mockResolvedValueOnce(JSON.stringify({ full_name: '  ' }))

		await expect(git_gh_repo.repo_get_name_with_owner()).resolves.toBeUndefined()
	})

	it.each([
		['fallback', git_gh_repo.repo_get_name_with_owner],
		['canonical', git_gh_repo.repo_get_canonical_name_with_owner],
	])('trims whitespace off the name through the %s read', async (_label, read_name) => {
		use_remotes([])
		mocked_read.mockResolvedValueOnce(JSON.stringify({ full_name: `  ${REPO}\n` }))

		await expect(read_name()).resolves.toBe(REPO)
		expect(mocked_read).toHaveBeenCalledWith(REPO_API_PATH)
	})
})
