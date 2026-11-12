import { shared_cache_fixture } from '#scripts/josh/shared-cache-fixture'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { git_gh_exec } from './git-gh-exec'
import { gh_failure } from './git-gh-failure'
import {
	git_gh_transport,
	PROBE_QUERY,
	REFUSED_MESSAGE,
	TRANSPORT_ENV_VAR,
} from './git-gh-transport'

vi.mock('./git-gh-exec', () => ({
	git_gh_exec: { exec_gh_api: vi.fn(), exec_gh_command: vi.fn() },
}))

// joshuafolkken/kit#6784: one switch decides a session's GitHub transport, probing once an hour
// under `auto` and keeping the answer in the shared cache.

const mocked_api = vi.mocked(git_gh_exec.exec_gh_api)
const mocked_command = vi.mocked(git_gh_exec.exec_gh_command)

const FORBIDDEN_STATUS = 403
const SERVER_ERROR_STATUS = 502
const HOUR_MS = 3_600_000
const NOW_MS = 1_800_000_000_000
const ANSWER = '{"data":{"viewer":{"login":"octocat"}}}'
const BODY = { query: 'query { rateLimit { cost } }' }

function failure(status: number): Error {
	return gh_failure.attach(new Error(`status ${String(status)}`), { status })
}

// `gh` exits non-zero on a GraphQL document with `errors`; the execa error keeps it on `stdout`.
function exited_with(stdout: string): Error {
	return new Error('gh exited 1', { cause: Object.assign(new Error('exit 1'), { stdout }) })
}

function probes(): number {
	return mocked_api.mock.calls.filter(([request]) => request.body?.includes(PROBE_QUERY)).length
}

beforeEach(() => {
	mocked_api.mockReset().mockResolvedValue(ANSWER)
	mocked_command.mockReset().mockResolvedValue('octocat')
	git_gh_transport.forget_logins()
	vi.stubEnv(TRANSPORT_ENV_VAR, 'auto')

	return shared_cache_fixture.isolate_shared_cache(git_gh_transport.TRANSPORT_CACHE)
})

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('git_gh_transport.current under auto', () => {
	it('answers graphql once the probe succeeds, and probes once for the hour', async () => {
		await expect(git_gh_transport.current(NOW_MS)).resolves.toBe('graphql')
		await expect(git_gh_transport.current(NOW_MS + 1)).resolves.toBe('graphql')
		expect(probes()).toBe(1)
	})

	it('answers rest when the probe is refused', async () => {
		mocked_api.mockRejectedValue(failure(FORBIDDEN_STATUS))

		await expect(git_gh_transport.current(NOW_MS)).resolves.toBe('rest')
	})

	it('probes again once the hour is up', async () => {
		await git_gh_transport.current(NOW_MS)
		mocked_api.mockRejectedValue(failure(FORBIDDEN_STATUS))

		await expect(git_gh_transport.current(NOW_MS + HOUR_MS)).resolves.toBe('rest')
		expect(probes()).toBe(2)
	})

	it('keeps nothing when the probe fails for another reason, and probes again next time', async () => {
		mocked_api.mockRejectedValueOnce(failure(SERVER_ERROR_STATUS))

		await expect(git_gh_transport.current(NOW_MS)).resolves.toBe('graphql')
		await git_gh_transport.current(NOW_MS + 1)
		expect(probes()).toBe(2)
	})
})

describe('git_gh_transport.query under auto', () => {
	it('switches the session to rest when a later read is refused', async () => {
		await git_gh_transport.current(NOW_MS)
		mocked_api.mockRejectedValueOnce(failure(FORBIDDEN_STATUS))

		await expect(git_gh_transport.query(BODY, NOW_MS + 1)).resolves.toBeUndefined()
		await expect(git_gh_transport.current(NOW_MS + 2)).resolves.toBe('rest')
		await expect(git_gh_transport.query(BODY, NOW_MS + 2)).resolves.toBeUndefined()
		expect(mocked_api).toHaveBeenCalledTimes(2)
	})

	it('keeps the session on graphql when a 403 names a secondary rate limit', async () => {
		await git_gh_transport.current(NOW_MS)
		const throttled = gh_failure.attach(new Error('You have exceeded a secondary rate limit'), {
			status: FORBIDDEN_STATUS,
		})

		mocked_api.mockRejectedValueOnce(throttled)

		await expect(git_gh_transport.query(BODY, NOW_MS + 1)).resolves.toBeUndefined()
		await expect(git_gh_transport.query(BODY, NOW_MS + 2)).resolves.toBe(ANSWER)
	})

	it("hands one read's other failure to REST without switching the session", async () => {
		await git_gh_transport.current(NOW_MS)
		mocked_api.mockRejectedValueOnce(failure(SERVER_ERROR_STATUS))

		await expect(git_gh_transport.query(BODY, NOW_MS + 1)).resolves.toBeUndefined()
		await expect(git_gh_transport.query(BODY, NOW_MS + 2)).resolves.toBe(ANSWER)
	})
})

describe('git_gh_transport.query_partial', () => {
	const PARTIAL =
		'{"data":{"repository":{"issue1":{},"issue2":null}},"errors":[{"type":"NOT_FOUND"}]}'
	const FAILED = '{"data":null,"errors":[{"type":"NOT_FOUND"}]}'

	beforeEach(() => {
		vi.stubEnv(TRANSPORT_ENV_VAR, 'graphql')
	})

	it('answers the document whose errors sit beside answered data', async () => {
		mocked_api.mockRejectedValueOnce(exited_with(PARTIAL))

		await expect(git_gh_transport.query_partial(BODY, NOW_MS)).resolves.toBe(PARTIAL)
	})

	it('leaves a document with no data to REST', async () => {
		mocked_api.mockRejectedValueOnce(exited_with(FAILED))

		await expect(git_gh_transport.query_partial(BODY, NOW_MS)).resolves.toBeUndefined()
	})

	it('keeps query answering nothing for the same partial document', async () => {
		mocked_api.mockRejectedValueOnce(exited_with(PARTIAL))

		await expect(git_gh_transport.query(BODY, NOW_MS)).resolves.toBeUndefined()
	})
})

describe('git_gh_transport with an explicit setting', () => {
	it('sends no GraphQL request under rest', async () => {
		vi.stubEnv(TRANSPORT_ENV_VAR, 'rest')

		await expect(git_gh_transport.query(BODY, NOW_MS)).resolves.toBeUndefined()
		expect(mocked_api).not.toHaveBeenCalled()
		expect(mocked_command).not.toHaveBeenCalled()
	})

	it('reads without a probe under graphql', async () => {
		vi.stubEnv(TRANSPORT_ENV_VAR, 'graphql')

		await expect(git_gh_transport.query(BODY, NOW_MS)).resolves.toBe(ANSWER)
		expect(probes()).toBe(0)
	})

	it('stops with the reason when graphql is refused, rather than reading through REST', async () => {
		vi.stubEnv(TRANSPORT_ENV_VAR, 'graphql')
		mocked_api.mockRejectedValue(failure(FORBIDDEN_STATUS))

		await expect(git_gh_transport.query(BODY, NOW_MS)).rejects.toThrow(REFUSED_MESSAGE)
	})

	it('refuses a value it does not know', async () => {
		vi.stubEnv(TRANSPORT_ENV_VAR, 'soap')

		await expect(git_gh_transport.query(BODY, NOW_MS)).rejects.toThrow(/auto, graphql or rest/u)
	})
})

describe('git_gh_transport.label', () => {
	it('names the explicit setting alone', async () => {
		vi.stubEnv(TRANSPORT_ENV_VAR, 'rest')

		await expect(git_gh_transport.label(NOW_MS)).resolves.toBe('rest')
	})

	it('names the kept answer under auto, without probing', async () => {
		await expect(git_gh_transport.label(NOW_MS)).resolves.toBe('not probed (auto)')
		expect(probes()).toBe(0)

		await git_gh_transport.current(NOW_MS)

		await expect(git_gh_transport.label(NOW_MS + 1)).resolves.toBe('graphql (auto)')
	})
})

// joshuafolkken/kit#7150: the login the cache record is keyed under costs one `gh config get` per host.
function config_reads(host: string): number {
	return mocked_command.mock.calls.filter(([arguments_]) => arguments_.includes(host)).length
}

describe('git_gh_transport login', () => {
	const OTHER_HOST = 'ghe.example.com'

	it('runs gh config get at most once per host within the process', async () => {
		await git_gh_transport.current(NOW_MS)
		await git_gh_transport.known(NOW_MS + 1)
		await git_gh_transport.label(NOW_MS + 2)
		expect(config_reads('github.com')).toBe(1)

		vi.stubEnv('GH_HOST', OTHER_HOST)
		await git_gh_transport.known(NOW_MS + 3)
		await git_gh_transport.known(NOW_MS + 4)
		expect(config_reads(OTHER_HOST)).toBe(1)
		expect(mocked_command).toHaveBeenCalledTimes(2)
	})
})

describe('git_gh_transport.known', () => {
	it('answers the kept transport under auto, and none before the probe, without probing', async () => {
		await expect(git_gh_transport.known(NOW_MS)).resolves.toBeUndefined()
		expect(mocked_api).not.toHaveBeenCalled()

		await git_gh_transport.current(NOW_MS)

		await expect(git_gh_transport.known(NOW_MS + 1)).resolves.toBe('graphql')
		expect(probes()).toBe(1)
	})

	it('answers the explicit setting, and none for a value it does not know', async () => {
		vi.stubEnv(TRANSPORT_ENV_VAR, 'rest')

		await expect(git_gh_transport.known(NOW_MS)).resolves.toBe('rest')

		vi.stubEnv(TRANSPORT_ENV_VAR, 'soap')

		await expect(git_gh_transport.known(NOW_MS)).resolves.toBeUndefined()
	})
})
