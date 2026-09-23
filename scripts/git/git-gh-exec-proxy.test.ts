import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { agent_session_environment } from '#scripts/josh/agent-session-environment'
import { execa, execaSync } from 'execa'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { git_gh_exec } from './git-gh-exec'

vi.mock('execa', () => ({
	execa: vi.fn(),
	execaSync: vi.fn(),
}))

vi.mock('./git-gh-check', () => ({
	check_gh_installed: vi.fn(),
	GH_NOT_INSTALLED_MSG: 'gh CLI is not installed. Install it from https://cli.github.com/',
}))

const mocked_execa = vi.mocked(execa)
const mocked_execa_sync = vi.mocked(execaSync)

type ExecaResult = Awaited<ReturnType<typeof execa>>
type ExecaSyncResult = ReturnType<typeof execaSync>

// Only `stdout` is read, so a minimal stub is bridged through `unknown` — the shape the sibling
// `git-gh-exec*.test.ts` files use.
function fake_result(stdout: string): ExecaResult {
	const result = { stdout }

	return result as unknown as ExecaResult
}

function fake_sync_result(stdout: string): ExecaSyncResult {
	const result = { stdout }

	return result as unknown as ExecaSyncResult
}

const API_PATH = 'repos/o/r/pulls/1'
const EMPTY_OBJECT = '{}'
const API_BODY = '{"merge_method":"merge"}'
const PUT_METHOD = 'PUT'
const LOOPBACK_PROXY = 'http://localhost:60759'
const HOST_PROXY = 'https://proxy.example.com:8080'
const CERTIFICATE_PATH = '/Users/somebody/.safe-chain/certs/ca-cert.pem'
const HTTPS_PROXY_KEY = 'HTTPS_PROXY'
const HTTP_PROXY_KEY = 'HTTP_PROXY'
const GLOBAL_AGENT_KEY = 'GLOBAL_AGENT_HTTP_PROXY'

// Each case declares exactly the proxy it is about; every other spelling starts blank because the
// unit projects blank them (`unit-projects.ts`), whatever wrapper launched the suite.
beforeEach(() => {
	vi.clearAllMocks()
})

afterEach(() => {
	vi.unstubAllEnvs()
})

function spawn_options(): unknown {
	return mocked_execa.mock.calls[0]?.at(-1)
}

function stub_scanner_proxy(): void {
	vi.stubEnv(HTTPS_PROXY_KEY, LOOPBACK_PROXY)
	vi.stubEnv(GLOBAL_AGENT_KEY, LOOPBACK_PROXY)
	vi.stubEnv(agent_session_environment.PROXY_CERTIFICATE_KEY, CERTIFICATE_PATH)
}

const SCANNER_REMOVED = {
	[HTTPS_PROXY_KEY]: undefined,
	[GLOBAL_AGENT_KEY]: undefined,
	[agent_session_environment.PROXY_CERTIFICATE_KEY]: undefined,
}

// joshuafolkken/kit#2436: under a supply-chain scanner's loopback proxy, one 30-second stall made the
// proxy refuse every later api.github.com connection of that `followup` run, so the merge gate's
// retries could only fail. GitHub requests now bypass a proxy this machine stood up on loopback.
describe('git_gh_exec — a loopback proxy is not handed to gh', () => {
	it('removes the scanner proxy and its certificate from a REST read', async () => {
		stub_scanner_proxy()
		mocked_execa.mockResolvedValueOnce(fake_result(EMPTY_OBJECT))

		await git_gh_exec.exec_gh_api({ path: API_PATH })

		expect(spawn_options()).toMatchObject({ env: SCANNER_REMOVED })
	})

	it('removes it from a write that carries a body, such as the merge request', async () => {
		stub_scanner_proxy()
		mocked_execa.mockResolvedValueOnce(fake_result(EMPTY_OBJECT))

		await git_gh_exec.exec_gh_api({ path: API_PATH, method: PUT_METHOD, body: API_BODY })

		expect(spawn_options()).toMatchObject({ input: API_BODY, env: SCANNER_REMOVED })
	})

	it('removes it from the status probe', async () => {
		stub_scanner_proxy()
		mocked_execa.mockResolvedValueOnce(fake_result('HTTP/2.0 200 OK\n'))

		await git_gh_exec.exec_gh_api_status(API_PATH)

		expect(spawn_options()).toMatchObject({ env: SCANNER_REMOVED })
	})

	it('removes it from the synchronous entry', () => {
		stub_scanner_proxy()
		mocked_execa_sync.mockReturnValueOnce(fake_sync_result(EMPTY_OBJECT))

		git_gh_exec.exec_gh_api_sync({ path: API_PATH, method: PUT_METHOD, body: API_BODY })

		expect(mocked_execa_sync.mock.calls[0]?.at(-1)).toMatchObject({ env: SCANNER_REMOVED })
	})
})

// The transport above is not the only place `gh` is spawned: a synchronous reader that spells its
// own `gh api` and forgets the helper routes GitHub back through the loopback proxy, and nothing else
// would notice until a `notify` or `doctor` failed the same way `followup` did.
const SCRIPTS_ROOT = fileURLToPath(new URL('..', import.meta.url))
const GH_API_SPAWN = /execa(?:Sync)?\('gh', \['api'/u
const HELPER_CALL = 'direct_environment()'

function spawning_sources(): Array<string> {
	const files = readdirSync(SCRIPTS_ROOT, { recursive: true, encoding: 'utf8' })

	return files
		.filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
		.filter((file) => GH_API_SPAWN.test(readFileSync(path.join(SCRIPTS_ROOT, file), 'utf8')))
}

describe('every `gh api` spawn under scripts/ bypasses the loopback proxy', () => {
	it('finds the spawning readers, so the scan cannot pass by matching nothing', () => {
		expect(spawning_sources().length).toBeGreaterThan(1)
	})

	it('spreads the shared direct environment wherever `gh api` is spawned', () => {
		for (const file of spawning_sources()) {
			const source = readFileSync(path.join(SCRIPTS_ROOT, file), 'utf8')
			const spawns = source.split(GH_API_SPAWN).length - 1

			expect(source.split(HELPER_CALL).length - 1, file).toBeGreaterThanOrEqual(spawns)
		}
	})
})

describe('git_gh_exec — what the bypass must leave alone', () => {
	it('keeps a proxy naming a real host, and the certificate that proxy may need', async () => {
		vi.stubEnv(HTTPS_PROXY_KEY, LOOPBACK_PROXY)
		vi.stubEnv(HTTP_PROXY_KEY, HOST_PROXY)
		vi.stubEnv(agent_session_environment.PROXY_CERTIFICATE_KEY, CERTIFICATE_PATH)
		mocked_execa.mockResolvedValueOnce(fake_result(EMPTY_OBJECT))

		await git_gh_exec.exec_gh_api({ path: API_PATH })

		expect(spawn_options()).toStrictEqual(
			expect.objectContaining({ env: { [HTTPS_PROXY_KEY]: undefined } }),
		)
	})

	it('keeps a loopback proxy that is not the scanner, which may be the only way out', async () => {
		vi.stubEnv(HTTPS_PROXY_KEY, LOOPBACK_PROXY)
		mocked_execa.mockResolvedValueOnce(fake_result(EMPTY_OBJECT))

		await git_gh_exec.exec_gh_api({ path: API_PATH })

		expect(spawn_options()).not.toHaveProperty('env')
	})

	it('adds no environment at all when no loopback proxy is declared', async () => {
		vi.stubEnv(HTTPS_PROXY_KEY, HOST_PROXY)
		mocked_execa.mockResolvedValueOnce(fake_result(EMPTY_OBJECT))

		await git_gh_exec.exec_gh_api({ path: API_PATH })

		expect(spawn_options()).not.toHaveProperty('env')
	})
})
