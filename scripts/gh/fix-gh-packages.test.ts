import { timed_fetch } from '#scripts/lib/timed-fetch'
import { execaSync } from 'execa'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fix_gh_packages } from './fix-gh-packages'
import { gh_cli_token } from './gh-cli-token'

vi.mock('execa', () => ({ execaSync: vi.fn() }))
vi.mock('#scripts/lib/timed-fetch', () => ({ timed_fetch: vi.fn() }))

const mocked_execa_sync = vi.mocked(execaSync)
const SLOW_MS = 20
const SCOPES = new Set(['@acme'])
const SLOW_KEY = '@acme/slow@1.0.0'
const FAST_KEY = '@acme/fast@2.0.0'
const SLOW_TARBALL = 'https://example.test/slow.tgz'
const FAST_TARBALL = 'https://example.test/fast.tgz'
const PACKAGES = Object.fromEntries([
	[SLOW_KEY, {}],
	[FAST_KEY, {}],
	['@acme/done@3.0.0', { resolution: { tarball: 'https://example.test/done.tgz' } }],
	['left-pad@1.3.0', {}],
])

function packument(version: string, tarball: string): Response {
	return Response.json({ versions: { [version]: { dist: { tarball } } } })
}

// The slow package answers after the fast one, so a result that tracked completion order would differ.
async function answer(url: string): Promise<Response> {
	if (!url.endsWith('/@acme/slow')) return packument('2.0.0', FAST_TARBALL)

	await new Promise((resolve) => setTimeout(resolve, SLOW_MS))

	return packument('1.0.0', SLOW_TARBALL)
}

type ExecaSyncResult = ReturnType<typeof execaSync>

function fake_stdout(stdout: string): ExecaSyncResult {
	const result = { stdout }

	return result as unknown as ExecaSyncResult
}

beforeEach(() => {
	vi.clearAllMocks()
})

describe('get_gh_cli_token', () => {
	it('returns the trimmed token from gh auth token', () => {
		mocked_execa_sync.mockReturnValue(fake_stdout('ghp_abc123\n'))

		expect(gh_cli_token.get()).toBe('ghp_abc123')
	})

	it('returns undefined when the token output is empty', () => {
		mocked_execa_sync.mockReturnValue(fake_stdout('  \n'))

		expect(gh_cli_token.get()).toBeUndefined()
	})

	it('returns undefined when gh auth token throws (not authenticated)', () => {
		mocked_execa_sync.mockImplementation(() => {
			throw new Error('not logged in')
		})

		expect(gh_cli_token.get()).toBeUndefined()
	})
})

// joshuafolkken/kit#3047: the packument reads run together, so the fixes must not depend on which
// read finishes first.
describe('fix_gh_packages.collect_fixes', () => {
	it('fixes every scoped package without a tarball, in lockfile order, whatever the finish order', async () => {
		vi.mocked(timed_fetch).mockImplementation(answer)

		const fixes = await fix_gh_packages.collect_fixes(PACKAGES, SCOPES, 'token')

		expect([...fixes]).toStrictEqual([
			[SLOW_KEY, SLOW_TARBALL],
			[FAST_KEY, FAST_TARBALL],
		])
		expect(timed_fetch).toHaveBeenCalledTimes(2)
	})
})
