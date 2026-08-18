import { execaSync } from 'execa'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetch_latest_version, fetch_release_times, with_page_size } from './version-remote'

vi.mock('execa', () => ({ execaSync: vi.fn() }))

const mocked_execa_sync = vi.mocked(execaSync)

type ExecaSyncResult = ReturnType<typeof execaSync>

interface FakeResult {
	stdout?: string
	stderr?: string
	exitCode?: number
	shortMessage?: string
}

function fake_result(overrides: FakeResult): ExecaSyncResult {
	const result = { stdout: '', stderr: '', exitCode: 0, ...overrides }

	return result as unknown as ExecaSyncResult
}

function fake_stdout(stdout: string): ExecaSyncResult {
	return fake_result({ stdout })
}

function expect_gh_call(endpoint: string): void {
	expect(mocked_execa_sync).toHaveBeenCalledWith('gh', ['api', endpoint, '--jq', '.[0].name'], {
		reject: false,
	})
}

beforeEach(() => {
	vi.clearAllMocks()
})

const KIT_ENDPOINT = '/users/joshuafolkken/packages/npm/kit/versions?per_page=1'
const KIT_PACKAGE = '@joshuafolkken/kit'
const GAME_PACKAGE = '@joshuafolkken/game-kit'
const BLANK_SPACES = 3

describe('fetch_latest_version returns', () => {
	it('returns the trimmed version from gh api stdout', () => {
		mocked_execa_sync.mockReturnValue(fake_stdout('0.223.0\n'))

		expect(fetch_latest_version(KIT_ENDPOINT, KIT_PACKAGE)).toBe('0.223.0')
	})

	it('queries the supplied versions endpoint via gh api', () => {
		mocked_execa_sync.mockReturnValue(fake_stdout('0.223.0'))

		fetch_latest_version(KIT_ENDPOINT, KIT_PACKAGE)

		expect_gh_call(KIT_ENDPOINT)
	})

	it('queries a different package endpoint when configured for another package', () => {
		const other_endpoint = '/users/joshuafolkken/packages/npm/game-kit/versions?per_page=1'

		mocked_execa_sync.mockReturnValue(fake_stdout('1.0.0'))

		fetch_latest_version(other_endpoint, GAME_PACKAGE)

		expect_gh_call(other_endpoint)
	})
})

describe('fetch_latest_version guards', () => {
	it('throws an actionable error naming the package when the endpoint is undefined', () => {
		expect(() => fetch_latest_version(undefined, KIT_PACKAGE)).toThrow(
			/Could not derive a versions endpoint for @joshuafolkken\/kit/u,
		)
		expect(mocked_execa_sync).not.toHaveBeenCalled()
	})

	it('throws an actionable error naming the package when the endpoint is empty', () => {
		expect(() => fetch_latest_version(' '.repeat(BLANK_SPACES), GAME_PACKAGE)).toThrow(
			/Could not derive a versions endpoint for @joshuafolkken\/game-kit/u,
		)
		expect(mocked_execa_sync).not.toHaveBeenCalled()
	})
})

describe('fetch_latest_version wraps failures', () => {
	it('wraps a gh api failure into a concise message instead of a raw ExecaSyncError', () => {
		mocked_execa_sync.mockReturnValue(
			fake_result({ exitCode: 1, stderr: 'gh: Not Found (HTTP 404)' }),
		)

		expect(() => fetch_latest_version(KIT_ENDPOINT, KIT_PACKAGE)).toThrow(
			`Failed to fetch latest version for ${KIT_PACKAGE} via ${KIT_ENDPOINT}: gh: Not Found (HTTP 404)`,
		)
	})

	it('falls back to the execa short message when the failure has no stderr', () => {
		mocked_execa_sync.mockReturnValue(
			fake_result({ exitCode: 1, stderr: '', shortMessage: 'Command failed with exit code 1' }),
		)

		expect(() => fetch_latest_version(KIT_ENDPOINT, KIT_PACKAGE)).toThrow(
			/Command failed with exit code 1/u,
		)
	})
})

// The publish timestamps behind the release-age hold explanation (joshuafolkken/kit#808). Unlike
// `fetch_latest_version` this must never throw: the data only enriches a note, and a package whose
// history cannot be read keeps the report it had before.
const KIT_VERSION = '1.80.0'
const KIT_PUBLISHED_AT = '2026-08-18T09:09:57Z'
const TIMES_PAGE_SIZE = 100
const TIMES_JQ = '[.[] | {(.name): .created_at}] | add'

describe('with_page_size', () => {
	it('widens the default single-entry page', () => {
		expect(with_page_size(KIT_ENDPOINT, TIMES_PAGE_SIZE)).toBe(
			`/users/joshuafolkken/packages/npm/kit/versions?per_page=${String(TIMES_PAGE_SIZE)}`,
		)
	})

	it('adds the page size to an endpoint that carries no query', () => {
		expect(with_page_size('/users/x/packages/npm/kit/versions', TIMES_PAGE_SIZE)).toBe(
			`/users/x/packages/npm/kit/versions?per_page=${String(TIMES_PAGE_SIZE)}`,
		)
	})

	// The endpoint is consumer-overridable, so other query parameters must survive.
	it('preserves other query parameters', () => {
		expect(with_page_size('/versions?state=active&per_page=1', TIMES_PAGE_SIZE)).toContain(
			'state=active',
		)
	})
})

describe('fetch_release_times', () => {
	it('returns the version to publish-date map', () => {
		mocked_execa_sync.mockReturnValue(fake_stdout(`{"${KIT_VERSION}":"${KIT_PUBLISHED_AT}"}`))

		expect(fetch_release_times(KIT_ENDPOINT)).toStrictEqual(
			Object.fromEntries([[KIT_VERSION, KIT_PUBLISHED_AT]]),
		)
	})

	it('requests a widened page rather than the single-entry default', () => {
		mocked_execa_sync.mockReturnValue(fake_stdout('{}'))
		fetch_release_times(KIT_ENDPOINT)

		expect(mocked_execa_sync).toHaveBeenCalledWith(
			'gh',
			[
				'api',
				`/users/joshuafolkken/packages/npm/kit/versions?per_page=${String(TIMES_PAGE_SIZE)}`,
				'--jq',
				TIMES_JQ,
			],
			{ reject: false },
		)
	})
})

describe('fetch_release_times — degrading instead of throwing', () => {
	it('returns nothing when gh fails, without throwing', () => {
		mocked_execa_sync.mockReturnValue(fake_result({ exitCode: 1, stderr: 'gh: Not Found' }))

		expect(fetch_release_times(KIT_ENDPOINT)).toBeUndefined()
	})

	it('returns nothing when the payload is not valid JSON', () => {
		mocked_execa_sync.mockReturnValue(fake_stdout('null'))

		expect(fetch_release_times(KIT_ENDPOINT)).toBeUndefined()
	})

	it('returns nothing when the payload is not a version to date map', () => {
		mocked_execa_sync.mockReturnValue(fake_stdout('{"1.80.0":123}'))

		expect(fetch_release_times(KIT_ENDPOINT)).toBeUndefined()
	})

	it('returns nothing for an absent endpoint instead of running gh', () => {
		expect(fetch_release_times(undefined)).toBeUndefined()
		expect(mocked_execa_sync).not.toHaveBeenCalled()
	})

	it('returns nothing for a blank endpoint instead of running gh', () => {
		expect(fetch_release_times(' '.repeat(3))).toBeUndefined()
		expect(mocked_execa_sync).not.toHaveBeenCalled()
	})
})
