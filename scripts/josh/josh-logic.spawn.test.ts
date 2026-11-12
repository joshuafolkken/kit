import { constants } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const execa_sync_mock = vi.hoisted(() => vi.fn())

vi.mock('execa', () => ({ execaSync: execa_sync_mock }))
// `constants` stays real: the lane ledger reads its open flags at import.
vi.mock('node:fs', () => ({
	constants,
	existsSync: vi.fn().mockReturnValue(false),
	readFileSync: vi.fn().mockReturnValue('{"version":"0.0.0"}'),
	// The gh tally handoff removes its file after a spawn (joshuafolkken/kit#6965).
	rmSync: vi.fn(),
}))

const { COMMAND_MAP, josh_logic, SPAWN_ERROR_EXIT_CODE, USAGE_ERROR_EXIT_CODE } =
	await import('./josh-logic')
const { core_budget } = await import('#scripts/gate/core-budget')
const { gate_plan } = await import('#scripts/gate/gate-plan')
const { OPTIONAL_ENV_FILE_FLAGS } = await import('./josh-command-types')
const { josh_environment_file } = await import('./josh-environment-file')
const { josh_in_process } = await import('./josh-in-process')

const SPAWN_ERROR_MESSAGE = 'ENOENT: no such file or directory'
const SHELL_CMD = ['/bin/sh', '-c', 'echo hello']
// execa reports a spawn failure as `exitCode: undefined` plus a `shortMessage`.
const SPAWN_FAILURE = { exitCode: undefined, shortMessage: SPAWN_ERROR_MESSAGE }
const SPAWN_SUCCESS = { exitCode: 0 }

const WORKERS_FLAG = '--workers=1'
const TEST_CMD = 'test'

describe('josh_logic.run_command — composite commands reject extra arguments', () => {
	beforeEach(() => {
		execa_sync_mock.mockClear()
		execa_sync_mock.mockReturnValue(SPAWN_SUCCESS)
		vi.spyOn(console, 'error').mockImplementation(() => {
			/* suppress */
		})
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('refuses to run josh test when a flag was appended', async () => {
		await expect(josh_logic.run_command(TEST_CMD, [WORKERS_FLAG])).resolves.toBe(
			USAGE_ERROR_EXIT_CODE,
		)
	})

	// The whole point is that the flag never silently reaches a run: nothing may be spawned.
	it('spawns nothing when the arguments are refused', async () => {
		await josh_logic.run_command(TEST_CMD, [WORKERS_FLAG])

		expect(execa_sync_mock).not.toHaveBeenCalled()
	})

	it('prints where the arguments belong', async () => {
		await josh_logic.run_command(TEST_CMD, [WORKERS_FLAG])

		expect(vi.mocked(console.error)).toHaveBeenCalledWith(expect.stringContaining('josh test:unit'))
		expect(vi.mocked(console.error)).toHaveBeenCalledWith(expect.stringContaining('josh test:e2e'))
	})

	it('still runs josh test unchanged when no arguments were appended', async () => {
		await expect(josh_logic.run_command(TEST_CMD, [])).resolves.toBe(0)
		expect(execa_sync_mock).toHaveBeenCalledOnce()
	})

	// `t` is the alias for `test`; the guard resolves it first, so the alias cannot slip past.
	it('applies the refusal to the aliased form as well', async () => {
		await expect(josh_logic.run_command('t', [WORKERS_FLAG])).resolves.toBe(USAGE_ERROR_EXIT_CODE)
		expect(execa_sync_mock).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#4660: node's own `--env-file` loader would take a guard switch from `.env`, so the
// dispatcher loads the file itself. joshuafolkken/kit#7013: the command then runs in this process, so
// the file is loaded here before the script is imported, and nothing is spawned.
describe('josh_logic.run_command — the .env flag', () => {
	beforeEach(() => {
		execa_sync_mock.mockClear()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('loads .env in this process before running a command declaring the flag', async () => {
		const [environment_flag = ''] = OPTIONAL_ENV_FILE_FLAGS
		const name = Object.keys(COMMAND_MAP).find((key) =>
			COMMAND_MAP[key]?.tsx_arguments?.includes(environment_flag),
		)
		const apply = vi.spyOn(josh_environment_file, 'apply_node_flags').mockReturnValue([])
		const run = vi.spyOn(josh_in_process, 'run_in_process').mockResolvedValue(0)

		await expect(josh_logic.run_command(name ?? '', [])).resolves.toBe(0)
		expect(apply).toHaveBeenCalledWith([environment_flag])
		expect(apply.mock.invocationCallOrder[0]).toBeLessThan(run.mock.invocationCallOrder[0] ?? 0)
		expect(execa_sync_mock).not.toHaveBeenCalled()
	})
})

// Direct heavy commands must reserve their declared weight through the common dispatch so they
// respect the machine-wide core budget (joshuafolkken/kit#3345).
const WEIGHTED_COMMANDS: ReadonlyArray<string> = [
	'lines',
	'refactor:scan',
	'lint',
	'lint:related',
	'check',
	'cspell:dot',
	'test:unit',
	// joshuafolkken/kit#4516
	'test:pinned',
	// joshuafolkken/kit#3944
	'retrospective',
]

function declared_weight(command: string): number | undefined {
	const weight = COMMAND_MAP[command]?.core_weight

	return typeof weight === 'function' ? weight() : weight
}

describe('josh_logic.run_command — the core budget a command reserves', () => {
	beforeEach(() => {
		execa_sync_mock.mockClear()
		execa_sync_mock.mockReturnValue(SPAWN_SUCCESS)
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it.each(WEIGHTED_COMMANDS)('reserves the weight %s declares before it runs', async (command) => {
		const reservation = vi
			.spyOn(core_budget, 'with_command_reservation')
			.mockResolvedValue(SPAWN_SUCCESS.exitCode)

		await expect(josh_logic.run_command(command, [])).resolves.toBe(SPAWN_SUCCESS.exitCode)
		// The reserved weight is read off the call: a unit run's weight follows the live runs on the
		// machine, so a second read could differ from the one the dispatch made.
		const [weight] = reservation.mock.calls[0] ?? []

		expect(reservation).toHaveBeenCalledOnce()
		expect(weight).toBeGreaterThanOrEqual(1)
	})

	it('reserves nothing for a command that declares no weight', async () => {
		const reservation = vi.spyOn(core_budget, 'with_command_reservation')

		await expect(josh_logic.run_command(TEST_CMD, [])).resolves.toBe(SPAWN_SUCCESS.exitCode)
		expect(reservation).not.toHaveBeenCalled()
	})

	// joshuafolkken/kit#5135: the dispatch reserves before the related scope resolves, so it could
	// only claim the whole width — `josh test:related` claims in its body instead.
	it('declares no weight for test:related, which claims once its scope is known', () => {
		expect(COMMAND_MAP['test:related']?.core_weight).toBeUndefined()
		expect(COMMAND_MAP['test:related']?.is_unit_claim).toBeUndefined()
	})

	// One table of weights: a direct `josh lint` claims exactly what the gate's lint check claims.
	it('declares the same weight the gate reserves for the same command', () => {
		const reserving = gate_plan.GATE_CHECKS.filter((check) => check.reserved_cores > 0)

		for (const check of reserving) {
			expect(declared_weight(check.target)).toBe(check.reserved_cores)
		}
	})
})

// joshuafolkken/kit#3371: the memory the command's tool holds is claimed with its cores.
describe('josh_logic.run_command — the memory a command claims', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('claims the memory the command declares with its weight', async () => {
		execa_sync_mock.mockReturnValue(SPAWN_SUCCESS)
		const reservation = vi
			.spyOn(core_budget, 'with_command_reservation')
			.mockResolvedValue(SPAWN_SUCCESS.exitCode)

		await josh_logic.run_command('lint', [])

		expect(reservation.mock.calls[0]?.[2]).toEqual({
			memory_mb: core_budget.MEMORY_MB.lint,
			command: 'lint',
		})
	})

	// joshuafolkken/kit#4235: a unit suite's claim is marked so it can be narrowed past the wait cap.
	it.each([
		['test:unit', true],
		['lint', undefined],
	])('marks a unit suite claim on %s', async (command, is_unit) => {
		execa_sync_mock.mockReturnValue(SPAWN_SUCCESS)
		const reservation = vi
			.spyOn(core_budget, 'with_command_reservation')
			.mockResolvedValue(SPAWN_SUCCESS.exitCode)

		await josh_logic.run_command(command, [])

		expect(reservation.mock.calls[0]?.[2]?.is_unit).toBe(is_unit)
	})
})

describe('josh_logic.run_shell_command — spawn error', () => {
	it('returns SPAWN_ERROR_EXIT_CODE when executable fails to start', () => {
		execa_sync_mock.mockReturnValue(SPAWN_FAILURE)
		vi.spyOn(console, 'error').mockImplementation(() => {
			/* suppress */
		})

		const code = josh_logic.run_shell_command(SHELL_CMD, [])

		expect(code).toBe(SPAWN_ERROR_EXIT_CODE)
		vi.restoreAllMocks()
	})

	it('returns actual status code when command succeeds', () => {
		execa_sync_mock.mockReturnValue(SPAWN_SUCCESS)

		const code = josh_logic.run_shell_command(SHELL_CMD, [])

		expect(code).toBe(0)
	})
})
