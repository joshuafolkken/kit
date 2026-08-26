import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('#scripts/local-bin', () => ({
	find_local_bin_upwards: vi.fn(),
}))

vi.mock('execa', () => ({
	execa: vi.fn(),
}))

const { DEFAULT_TYPE_CHECK_ARGS, type_check_step } = await import('./type-check-step')
const local_bin_module = await import('#scripts/local-bin')
const execa_module = await import('execa')
const mocked_find_bin = vi.mocked(local_bin_module.find_local_bin_upwards)
const mocked_execa = vi.mocked(execa_module.execa)

type ExecaResult = Awaited<ReturnType<typeof execa_module.execa>>
type ExecaImplementation = Parameters<typeof mocked_execa.mockImplementation>[0]

const START_DIRECTORY = '/project/src/lib'
const APP_KIT_USAGE =
	'Usage: josh-app <init|sync|check|check:ci|dast|load|shot|verify|version|v|version:upgrade|vu>'
const GAME_KIT_USAGE = 'Usage: josh-game <init|sync|version|v|version:upgrade|vu> [name|--force]'

// execa is declared with overloaded signatures, so `mock.calls` types the options out of the
// position they are actually passed in. The stub records them as it receives them instead.
interface ObservedExecaOptions {
	timeout?: number
}

const spawn_options: Array<ObservedExecaOptions> = []

function fake_output(output: string): ExecaResult {
	return { all: output } as unknown as ExecaResult
}

// `bin_names` are the toolkits whose shim the upward walk finds; every other name resolves to
// nothing, which is what a globally installed toolkit looks like from here.
function mock_installed(bin_names: ReadonlyArray<string>, usage: string): void {
	mocked_find_bin.mockImplementation((_start: string, bin_name: string) =>
		bin_names.includes(bin_name) ? `/project/node_modules/.bin/${bin_name}` : undefined,
	)

	async function fake_execa(
		_file: unknown,
		_arguments: unknown,
		options: ObservedExecaOptions,
	): Promise<ExecaResult> {
		spawn_options.push(options)

		return fake_output(usage)
	}

	mocked_execa.mockImplementation(fake_execa as unknown as ExecaImplementation)
}

beforeEach(() => {
	vi.clearAllMocks()
	spawn_options.length = 0
})

describe('resolve_type_check_args', () => {
	// The kit-only case: no application toolkit is a dependency, so the plain TypeScript check is
	// what a project gets — unchanged from before the step became resolvable.
	it('falls back to josh check when no toolkit is installed in this project', async () => {
		mock_installed([], APP_KIT_USAGE)

		await expect(type_check_step.resolve_type_check_args(START_DIRECTORY)).resolves.toEqual(
			DEFAULT_TYPE_CHECK_ARGS,
		)
	})

	// A globally installed toolkit is not this project's: resolving through it would run a SvelteKit
	// type check on a project that is not one — which is what `pnpm josh-app` does in kit today.
	it('never spawns a toolkit the shim walk did not find', async () => {
		mock_installed([], APP_KIT_USAGE)

		await type_check_step.resolve_type_check_args(START_DIRECTORY)

		expect(mocked_execa).not.toHaveBeenCalled()
	})

	// pnpm finds a shim by walking up, so a gate typed in a subdirectory must resolve the toolkit
	// its sibling checks resolve — the lookup starts where the command was typed, not at a root.
	it('looks for the shim from the directory it was given', async () => {
		mock_installed(['josh-app'], APP_KIT_USAGE)

		await type_check_step.resolve_type_check_args(START_DIRECTORY)

		expect(mocked_find_bin).toHaveBeenCalledWith(START_DIRECTORY, 'josh-app')
	})

	it('prefers the toolkit strict check when its usage line names one', async () => {
		mock_installed(['josh-app'], APP_KIT_USAGE)

		await expect(type_check_step.resolve_type_check_args(START_DIRECTORY)).resolves.toEqual([
			'josh-app',
			'check:ci',
		])
	})
})

describe('resolve_type_check_args — what the toolkit actually offers', () => {
	// Presence of the toolkit is not presence of the command — game-kit ships neither `check` nor
	// `check:ci`, so a game project keeps the plain TypeScript check.
	it('falls back when the installed toolkit names no type-check command', async () => {
		mock_installed(['josh-game'], GAME_KIT_USAGE)

		await expect(type_check_step.resolve_type_check_args(START_DIRECTORY)).resolves.toEqual(
			DEFAULT_TYPE_CHECK_ARGS,
		)
	})

	it('takes the fast check when the toolkit has no strict variant', async () => {
		mock_installed(['josh-app'], 'Usage: josh-app <init|sync|check|version>')

		await expect(type_check_step.resolve_type_check_args(START_DIRECTORY)).resolves.toEqual([
			'josh-app',
			'check',
		])
	})

	// A toolkit that cannot be spawned at all must not take the gate down with it.
	it('falls back when the toolkit cannot be spawned', async () => {
		mocked_find_bin.mockReturnValue('/project/node_modules/.bin/josh-app')
		mocked_execa.mockImplementation(() => {
			throw new Error('ENOENT')
		})

		await expect(type_check_step.resolve_type_check_args(START_DIRECTORY)).resolves.toEqual(
			DEFAULT_TYPE_CHECK_ARGS,
		)
	})
})

describe('the usage probe', () => {
	// A hung toolkit must not hold the gate open, and the probe prints nothing while it waits.
	it('is bounded by a timeout', async () => {
		mock_installed(['josh-app'], APP_KIT_USAGE)

		await type_check_step.resolve_type_check_args(START_DIRECTORY)

		expect(Number(spawn_options[0]?.timeout)).toBeGreaterThan(0)
	})
})

describe('parse_usage_commands', () => {
	it('reads the pipe-separated group of a usage line', () => {
		expect(type_check_step.parse_usage_commands(APP_KIT_USAGE)).toContain('check:ci')
	})

	// A trailing `[name|--force]` group must not be read as commands; the first group is the one.
	it('reads only the first group, not a trailing argument group', () => {
		expect(type_check_step.parse_usage_commands(GAME_KIT_USAGE)).not.toContain('--force')
	})

	it('returns nothing when the output has no command group', () => {
		expect(type_check_step.parse_usage_commands('command not found')).toEqual([])
	})

	// The output is stdout and stderr merged, so a bracketed line printed before the usage line
	// would be read as the command list by a pattern that did not anchor on `Usage:`.
	it('reads the usage line, not an earlier bracketed line', () => {
		const noisy = `warning <deprecated|legacy>\n${APP_KIT_USAGE}`

		expect(type_check_step.parse_usage_commands(noisy)).toContain('check:ci')
	})

	// execa joins the two streams without inserting a newline, so the usage line can begin
	// mid-line — an anchor on the start of a line would miss it and silently fall back.
	it('reads a usage line that is not at the start of a line', () => {
		expect(type_check_step.parse_usage_commands(`building…${APP_KIT_USAGE}`)).toContain('check:ci')
	})
})
