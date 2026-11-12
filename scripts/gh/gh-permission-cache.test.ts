import { shared_cache_fixture } from '#scripts/josh/shared-cache-fixture'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { gh_author_association } from './gh-author-association'
import { gh_permission_cache } from './gh-permission-cache'

const api_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/gh/git-gh-exec', () => ({ git_gh_exec: { exec_gh_api: api_mock } }))
// The permission lookup goes through the ETag layer (joshuafolkken/kit#6754); here it reaches the mock.
vi.mock('#scripts/gh/git-gh-etag-read', () => ({
	git_gh_etag_read: { read: async (api_path: string) => await api_mock({ path: api_path }) },
}))

const REPO = 'owner/repo'
const READ_AT = 1_000_000
const HALF_AN_HOUR = 1_800_000
const AN_HOUR = 3_600_000
const WRITE_ROLE = JSON.stringify({ permission: 'write', role_name: 'write' })
const READ_ROLE = JSON.stringify({ permission: 'read', role_name: 'read' })

beforeEach(() => shared_cache_fixture.isolate_shared_cache(gh_permission_cache.WRITERS_CACHE))

// The in-process memo outlives a test, so each test asks about a login of its own.
async function shared_trust(login: string): Promise<boolean> {
	return await gh_author_association.is_trusted({
		login,
		association: 'MEMBER',
		repo: REPO,
		is_shared: true,
	})
}

describe('gh_permission_cache — the record of write roles', () => {
	it('answers a login kept within the hour', () => {
		gh_permission_cache.remember_writer(REPO, 'alice', READ_AT)

		expect(gh_permission_cache.is_writer(REPO, 'alice', READ_AT + HALF_AN_HOUR)).toBe(true)
	})

	it('does not answer a login kept an hour ago', () => {
		gh_permission_cache.remember_writer(REPO, 'alice', READ_AT)

		expect(gh_permission_cache.is_writer(REPO, 'alice', READ_AT + AN_HOUR)).toBe(false)
	})

	it('does not extend a kept login when another is added', () => {
		gh_permission_cache.remember_writer(REPO, 'alice', READ_AT)
		gh_permission_cache.remember_writer(REPO, 'bob', READ_AT + HALF_AN_HOUR)
		gh_permission_cache.remember_writer(REPO, 'alice', READ_AT + HALF_AN_HOUR)

		expect(gh_permission_cache.is_writer(REPO, 'alice', READ_AT + AN_HOUR)).toBe(false)
		expect(gh_permission_cache.is_writer(REPO, 'bob', READ_AT + AN_HOUR)).toBe(true)
	})

	it('does not answer a login kept for another repository', () => {
		gh_permission_cache.remember_writer('other/repo', 'alice', READ_AT)

		expect(gh_permission_cache.is_writer(REPO, 'alice', READ_AT)).toBe(false)
	})
})

describe('gh_author_association.is_trusted — a shared ask', () => {
	it('keeps a write role for the next process, which asks nothing', async () => {
		api_mock.mockResolvedValueOnce(WRITE_ROLE)

		await expect(shared_trust('writer')).resolves.toBe(true)
		expect(gh_permission_cache.is_writer(REPO, 'writer')).toBe(true)
	})

	it('answers from the record without a request', async () => {
		gh_permission_cache.remember_writer(REPO, 'kept')

		await expect(shared_trust('kept')).resolves.toBe(true)
		expect(api_mock).not.toHaveBeenCalled()
	})

	it('does not keep a refusal', async () => {
		api_mock.mockResolvedValueOnce(READ_ROLE)

		await expect(shared_trust('reader')).resolves.toBe(false)
		expect(gh_permission_cache.is_writer(REPO, 'reader')).toBe(false)
	})

	it('does not keep a failed lookup', async () => {
		api_mock.mockRejectedValueOnce(new Error('HTTP 502'))

		await expect(shared_trust('unanswered')).resolves.toBe(false)
		expect(gh_permission_cache.is_writer(REPO, 'unanswered')).toBe(false)
	})

	it('leaves the record alone for an ask that is not shared', async () => {
		api_mock.mockResolvedValueOnce(WRITE_ROLE)

		await expect(
			gh_author_association.is_trusted({ login: 'unshared', association: 'MEMBER', repo: REPO }),
		).resolves.toBe(true)
		expect(gh_permission_cache.is_writer(REPO, 'unshared')).toBe(false)
	})
})
