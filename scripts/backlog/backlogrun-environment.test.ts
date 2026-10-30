import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { environment_file_fixture } from '#ports/environment-file-fixture'
import { josh_environment_file } from '#scripts/josh/josh-environment-file'
import type { LaunchResult } from '#scripts/run/detached-launch'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { backlogrun_cli, type BacklogrunPorts } from './backlogrun-cli'
import type { StartResult } from './backlogrun-launch'
import type { StopReport } from './backlogrun-stop'

const DIRECTORY = environment_file_fixture.make_project_directory('kit-backlogrun-environment-')
const ORIGINAL_DIRECTORY = process.cwd()
const PROVIDER_KEY = 'JOSH_AGENT_PROVIDER'
const GIT_DIRECTORY = '/repo/.git'
const OPENAI_FILE = 'JOSH_AGENT_PROVIDER=openai\n'
const INVALID_FILE = 'JOSH_AGENT_PROVIDER=invalid\n'

function ports_for(is_running = false): BacklogrunPorts {
	return {
		repository_directory: vi.fn(async () => GIT_DIRECTORY),
		is_running: () => is_running,
		replacement: async () => ({ kind: 'same' }),
		stranded: async () => undefined,
		start: vi.fn((): StartResult => ({
			kind: 'launched',
			launched: { pid: 1, log_path: '/log', session: undefined },
		})),
		start_supervisor: vi.fn((): LaunchResult => ({ kind: 'launched', pid: 1 })),
		stop: vi.fn(async (): Promise<StopReport> => ({
			supervisor: undefined,
			parent: undefined,
			session: undefined,
			record: { kind: 'ended' },
			lanes: [],
		})),
		restart: vi.fn(async () => 0),
		show_board: vi.fn(async () => 0),
		write: vi.fn(),
	}
}

async function run(argv: ReadonlyArray<string>, ports: BacklogrunPorts): Promise<number> {
	josh_environment_file.load_environment_file()

	return await backlogrun_cli.run(argv, ports, process.env)
}

beforeEach(() => {
	process.chdir(DIRECTORY)
	vi.stubEnv(PROVIDER_KEY, undefined)
})

afterEach(() => {
	process.chdir(ORIGINAL_DIRECTORY)
	environment_file_fixture.clear_environment_file(DIRECTORY)
	vi.unstubAllEnvs()
})

afterAll(() => {
	environment_file_fixture.remove_project_directory(DIRECTORY)
})

describe('backlogrun CLI environment integration', () => {
	it.each([
		{ contents: OPENAI_FILE, provider: 'openai' },
		{ contents: 'JOSH_AGENT_PROVIDER=anthropic\n', provider: 'anthropic' },
		{ contents: 'JOSH_AGENT_PROVIDER=\n', provider: 'anthropic' },
		{ contents: '', provider: 'anthropic' },
	])(
		'hands $provider from a temporary .env to parent and supervisor',
		async ({ contents, provider }) => {
			environment_file_fixture.write_environment_file(DIRECTORY, contents)
			const ports = ports_for()

			await expect(run(['5403', '--only'], ports)).resolves.toBe(0)
			expect(ports.start).toHaveBeenCalledWith(
				{ provider, invocation: 'backlogrun #5403 --only', issues: [5403] },
				{ worktree: '/repo', git_directory: GIT_DIRECTORY },
			)
			expect(ports.start_supervisor).toHaveBeenCalledWith(GIT_DIRECTORY, provider)
		},
	)

	it('works without an environment file', async () => {
		const ports = ports_for()

		await expect(run([], ports)).resolves.toBe(0)
		expect(ports.start_supervisor).toHaveBeenCalledWith(GIT_DIRECTORY, 'anthropic')
	})

	it.each(['anthropic', ''])('keeps exported value %s ahead of the file', async (value) => {
		environment_file_fixture.write_environment_file(DIRECTORY, OPENAI_FILE)
		vi.stubEnv(PROVIDER_KEY, value)
		const ports = ports_for()

		await expect(run([], ports)).resolves.toBe(0)
		expect(ports.start_supervisor).toHaveBeenCalledWith(GIT_DIRECTORY, 'anthropic')
	})
})

describe('backlogrun CLI environment overrides', () => {
	it.each([
		{ value: 'openai', agent: 'claude', provider: 'anthropic' },
		{ value: 'anthropic', agent: 'codex', provider: 'openai' },
		{ value: 'invalid', agent: 'codex', provider: 'openai' },
	])('lets explicit $agent override configured $value', async ({ value, agent, provider }) => {
		environment_file_fixture.write_environment_file(DIRECTORY, `JOSH_AGENT_PROVIDER=${value}\n`)
		const ports = ports_for()

		await expect(run(['--agent', agent], ports)).resolves.toBe(0)
		expect(ports.start_supervisor).toHaveBeenCalledWith(GIT_DIRECTORY, provider)
	})

	it('refuses an invalid default before starting anything and explains why', async () => {
		environment_file_fixture.write_environment_file(DIRECTORY, INVALID_FILE)
		const ports = ports_for()

		await expect(run([], ports)).resolves.toBe(1)
		expect(ports.write).toHaveBeenCalledWith(expect.stringContaining('is not an allowed provider'))
		expect(ports.start).not.toHaveBeenCalled()
		expect(ports.start_supervisor).not.toHaveBeenCalled()
	})
})

describe('backlogrun real CLI entry', () => {
	it('reads and forwards the temporary .env before launching', () => {
		environment_file_fixture.write_environment_file(DIRECTORY, INVALID_FILE)
		expect(spawnSync('git', ['init', '--quiet', DIRECTORY]).status).toBe(0)
		const result = spawnSync(
			process.execPath,
			[
				fileURLToPath(import.meta.resolve('tsx/cli')),
				'--tsconfig',
				path.join(ORIGINAL_DIRECTORY, 'tsconfig.json'),
				fileURLToPath(new URL('backlogrun-cli.ts', import.meta.url)),
			],
			{ cwd: DIRECTORY, env: process.env, encoding: 'utf8' },
		)

		expect(result.status).toBe(1)
		expect(result.stdout).toContain('JOSH_AGENT_PROVIDER=invalid is not an allowed provider')
	})
})

describe('backlogrun CLI environment beside an existing run', () => {
	it.each([OPENAI_FILE, INVALID_FILE])(
		'shows an existing run without switching its provider for %s',
		async (contents) => {
			environment_file_fixture.write_environment_file(DIRECTORY, contents)
			const ports = ports_for(true)

			await expect(run([], ports)).resolves.toBe(0)
			expect(ports.show_board).toHaveBeenCalledOnce()
			expect(ports.start).not.toHaveBeenCalled()
			expect(ports.start_supervisor).not.toHaveBeenCalled()
		},
	)

	it('refuses an invalid default before stopping an idle run for replacement', async () => {
		environment_file_fixture.write_environment_file(DIRECTORY, INVALID_FILE)
		const ports = { ...ports_for(true), replacement: async () => ({ kind: 'replace' }) as const }

		await expect(run(['5403'], ports)).resolves.toBe(1)
		expect(ports.stop).not.toHaveBeenCalled()
		expect(ports.start).not.toHaveBeenCalled()
	})

	it('restarts with the recorded provider even when the configured default is invalid', async () => {
		environment_file_fixture.write_environment_file(DIRECTORY, INVALID_FILE)
		const ports = ports_for(true)

		await expect(run(['--restart'], ports)).resolves.toBe(0)
		expect(ports.restart).toHaveBeenCalledWith(GIT_DIRECTORY)
		expect(ports.start_supervisor).not.toHaveBeenCalled()
	})
})
