import { shared_cache_fixture } from '#scripts/josh/shared-cache-fixture'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { gh_author_association } from './gh-author-association'
import type { ConditionalRead } from './git-gh-conditional'

// joshuafolkken/kit#4037: `author_association` alone does not say "can write" — `MEMBER` is any org
// member and `COLLABORATOR` includes read-only outside collaborators — so those two are asked of the
// collaborator-permission endpoint.

// The lookup goes through the ETag layer (joshuafolkken/kit#6754), so the mock stands in for its
// conditional GET, and each test keeps its ETag records in its own memory.
const api_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/gh/git-gh-conditional', () => ({
	git_gh_conditional: { read_conditional: api_mock },
}))

beforeEach(() => {
	api_mock.mockReset()
	vi.restoreAllMocks()
	shared_cache_fixture.keep_in_memory()
})

// The REST placeholders `gh api` fills in, kept out of a template literal.
const COLLABORATORS_PATH = 'repos/{owner}/{repo}/collaborators/'
const LOOKUP_TIMEOUT_MS = 5000
const OTHER_REPO = 'joshuafolkken/app-kit'
const SESSION_REPO = '{owner}/{repo}'
const ETAG = 'W/"kept"'

function permission(role_name: string, level = role_name): ConditionalRead {
	return {
		kind: 'changed',
		etag: undefined,
		body: JSON.stringify({ permission: level, role_name }),
	}
}

describe('is_trusted — without a request', () => {
	it('trusts OWNER without asking for its permission', async () => {
		expect(await gh_author_association.is_trusted({ login: 'me', association: 'OWNER' })).toBe(true)
		expect(api_mock).not.toHaveBeenCalled()
	})

	// On a public repository anyone can comment, so a body kit acts on is never taken from them.
	it.each(['CONTRIBUTOR', 'FIRST_TIME_CONTRIBUTOR', 'FIRST_TIMER', 'NONE', 'owner'])(
		'does not trust %s',
		async (association) => {
			expect(await gh_author_association.is_trusted({ login: 'someone', association })).toBe(false)
			expect(api_mock).not.toHaveBeenCalled()
		},
	)

	it('does not trust an author whose association is unknown', async () => {
		expect(await gh_author_association.is_trusted({ login: 'a', association: undefined })).toBe(
			false,
		)
		// eslint-disable-next-line unicorn/no-null -- REST sends null for an author it cannot classify
		expect(await gh_author_association.is_trusted({ login: 'a', association: null })).toBe(false)
	})

	it.each([undefined, 'claude[bot]', '../admin'])(
		'does not trust a MEMBER whose login is not a user login (%s)',
		async (login) => {
			expect(await gh_author_association.is_trusted({ login, association: 'MEMBER' })).toBe(false)
			expect(api_mock).not.toHaveBeenCalled()
		},
	)
})

describe('is_trusted — MEMBER / COLLABORATOR', () => {
	it.each([
		['admin', 'admin'],
		['maintain', 'write'],
		['write', 'write'],
	])('trusts a write role (%s)', async (role_name, level) => {
		api_mock.mockResolvedValue(permission(role_name, level))
		const login = `writer-${role_name}`

		expect(await gh_author_association.is_trusted({ login, association: 'MEMBER' })).toBe(true)
		expect(api_mock).toHaveBeenCalledWith(
			`${COLLABORATORS_PATH}${login}/permission`,
			undefined,
			undefined,
		)
	})

	it('asks for an Enterprise Managed User login carrying an underscore', async () => {
		api_mock.mockResolvedValue(permission('write'))
		const login = 'jane_acme'

		expect(await gh_author_association.is_trusted({ login, association: 'MEMBER' })).toBe(true)
		expect(api_mock).toHaveBeenCalledWith(
			`${COLLABORATORS_PATH}${login}/permission`,
			undefined,
			undefined,
		)
	})
})

describe('is_trusted — MEMBER / COLLABORATOR refused', () => {
	it.each([
		['read', 'read'],
		['triage', 'read'],
		['none', 'none'],
	])('does not trust a role without write (%s)', async (role_name, level) => {
		api_mock.mockResolvedValue(permission(role_name, level))
		const author = { login: `reader-${role_name}`, association: 'COLLABORATOR' }

		expect(await gh_author_association.is_trusted(author)).toBe(false)
	})

	it('does not trust an author whose permission cannot be read', async () => {
		api_mock.mockRejectedValue(new Error('HTTP 404'))
		const author = { login: 'unreadable', association: 'COLLABORATOR' }

		expect(await gh_author_association.is_trusted(author)).toBe(false)
	})
})

describe('is_trusted — the lookup', () => {
	it('asks for one login once per process', async () => {
		api_mock.mockResolvedValue(permission('write'))
		const author = { login: 'asked-once', association: 'MEMBER' }

		await Promise.all([
			gh_author_association.is_trusted(author),
			gh_author_association.is_trusted(author),
		])
		expect(await gh_author_association.is_trusted(author)).toBe(true)
		expect(api_mock).toHaveBeenCalledOnce()
	})

	it('asks again after a lookup that failed', async () => {
		api_mock.mockRejectedValueOnce(new Error('HTTP 502')).mockResolvedValue(permission('write'))
		const author = { login: 'asked-again', association: 'COLLABORATOR' }

		expect(await gh_author_association.is_trusted(author)).toBe(false)
		expect(await gh_author_association.is_trusted(author)).toBe(true)
		expect(api_mock).toHaveBeenCalledTimes(2)
	})

	it('bounds the lookup by the caller’s timeout', async () => {
		api_mock.mockResolvedValue(permission('write'))
		const login = 'bounded'

		await gh_author_association.is_trusted({
			login,
			association: 'MEMBER',
			timeout_ms: LOOKUP_TIMEOUT_MS,
		})
		expect(api_mock).toHaveBeenCalledWith(
			`${COLLABORATORS_PATH}${login}/permission`,
			undefined,
			LOOKUP_TIMEOUT_MS,
		)
	})
})

// joshuafolkken/kit#6754: a later process asks with the ETag the earlier one kept, and a 304 answers
// the role it read then. The session's repository named outright is the same path under another
// in-process key, so it stands in for that later process, whose own memo starts empty.
describe('is_trusted — the ETag layer', () => {
	const login = 'kept-writer'

	it('answers the kept role on a 304', async () => {
		api_mock
			.mockResolvedValueOnce({ ...permission('write'), etag: ETAG })
			.mockResolvedValueOnce({ kind: 'unchanged' })
		const author = { login, association: 'MEMBER' }

		expect(await gh_author_association.is_trusted(author)).toBe(true)
		expect(await gh_author_association.is_trusted({ ...author, repo: SESSION_REPO })).toBe(true)
		expect(api_mock.mock.calls.map(([, etag]: Array<unknown>) => etag)).toStrictEqual([
			undefined,
			ETAG,
		])
	})
})

// joshuafolkken/kit#5851: `issue:read --repo` reads another repository's authors, and write access is a
// property of one repository — so it is asked of that one, and never answered from another's lookup.
describe('is_trusted — the repository asked', () => {
	it('asks the repository the row was read from', async () => {
		api_mock.mockResolvedValue(permission('write'))
		const login = 'other-repo-writer'

		await gh_author_association.is_trusted({ login, association: 'MEMBER', repo: OTHER_REPO })
		expect(api_mock).toHaveBeenCalledWith(
			`repos/${OTHER_REPO}/collaborators/${login}/permission`,
			undefined,
			undefined,
		)
	})

	it('asks again for the same login in another repository', async () => {
		api_mock.mockResolvedValueOnce(permission('write')).mockResolvedValueOnce(permission('read'))
		const author = { login: 'writes-here-only', association: 'COLLABORATOR' }

		expect(await gh_author_association.is_trusted(author)).toBe(true)
		expect(await gh_author_association.is_trusted({ ...author, repo: OTHER_REPO })).toBe(false)
		expect(api_mock).toHaveBeenCalledTimes(2)
	})
})

describe('trust_of', () => {
	it('answers undefined, not false, for a lookup that failed', async () => {
		api_mock.mockRejectedValue(new Error('HTTP 502'))
		const author = { login: 'unanswered', association: 'MEMBER' }

		expect(await gh_author_association.trust_of(author)).toBeUndefined()
	})

	it('answers false for a role without write and true for OWNER', async () => {
		api_mock.mockResolvedValue(permission('read'))

		expect(
			await gh_author_association.trust_of({ login: 'read-only', association: 'COLLABORATOR' }),
		).toBe(false)
		expect(await gh_author_association.trust_of({ login: 'me', association: 'OWNER' })).toBe(true)
	})
})

describe('TRUSTED_LIST', () => {
	it('names who is trusted for a refusal message', () => {
		expect(gh_author_association.TRUSTED_LIST).toBe(
			'OWNER, or MEMBER / COLLABORATOR with write access',
		)
	})
})
