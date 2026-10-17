import { beforeEach, describe, expect, it, vi } from 'vitest'
import { gh_author_association } from './gh-author-association'

// joshuafolkken/kit#4037: `author_association` alone does not say "can write" — `MEMBER` is any org
// member and `COLLABORATOR` includes read-only outside collaborators — so those two are asked of the
// collaborator-permission endpoint.

const api_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/gh/git-gh-exec', () => ({ git_gh_exec: { exec_gh_api: api_mock } }))

beforeEach(() => {
	api_mock.mockReset()
})

// The REST placeholders `gh api` fills in, kept out of a template literal.
const COLLABORATORS_PATH = 'repos/{owner}/{repo}/collaborators/'
const LOOKUP_TIMEOUT_MS = 5000

function permission(role_name: string, level = role_name): string {
	return JSON.stringify({ permission: level, role_name })
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
		expect(api_mock).toHaveBeenCalledWith({ path: `${COLLABORATORS_PATH}${login}/permission` })
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
		expect(api_mock).toHaveBeenCalledWith({
			path: `${COLLABORATORS_PATH}${login}/permission`,
			timeout_ms: LOOKUP_TIMEOUT_MS,
		})
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
