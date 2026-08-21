import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const josh_mock = vi.hoisted(() => {
	const state: { run_command_return: number; format_help_return: string } = {
		run_command_return: 0,
		format_help_return: '',
	}

	return { state, UNKNOWN_PREFIX: 'Unknown command: ' }
})

vi.mock('./josh-logic', () => ({
	josh_logic: {
		format_help: (): string => josh_mock.state.format_help_return,
		format_unknown_command: (cmd: string): string =>
			`${josh_mock.UNKNOWN_PREFIX}${cmd}\n\n${josh_mock.state.format_help_return}`,
		run_command: (_cmd: string, _arguments: Array<string>): number =>
			josh_mock.state.run_command_return,
	},
}))

const PROCESS_EXIT_CALLED = 'process.exit called'
const HELP_OUTPUT = 'help output'
const ARGV_BASE = ['node', 'josh.ts']
const UNKNOWN_CMD = 'not-a-command'
const ORIGINAL_ARGV = process.argv

beforeEach(() => {
	vi.resetModules()
	vi.spyOn(process, 'exit').mockImplementation(() => {
		throw new Error(PROCESS_EXIT_CALLED)
	})
	vi.spyOn(console, 'info').mockImplementation(vi.fn())
	vi.spyOn(console, 'error').mockImplementation(vi.fn())
	process.argv = [...ARGV_BASE]
	josh_mock.state.run_command_return = 0
	josh_mock.state.format_help_return = HELP_OUTPUT
})

afterEach(() => {
	process.argv = ORIGINAL_ARGV
	vi.restoreAllMocks()
})

describe('josh.ts — no command', () => {
	it('prints help when no command argument is given', async () => {
		await import('./josh')

		expect(vi.mocked(console.info)).toHaveBeenCalledWith(HELP_OUTPUT)
	})
})

describe('josh.ts — help command', () => {
	// The flag spellings are here because #825 moved the unknown-command path to stderr, and they
	// used to reach the listing only by falling into it: `josh --help | less` printed the listing
	// before that move and nothing after it.
	it.each(['help', '--help', '-h'])('prints help to stdout for %s', async (help_command) => {
		process.argv = [...ARGV_BASE, help_command]

		await import('./josh')

		expect(vi.mocked(console.info)).toHaveBeenCalledWith(HELP_OUTPUT)
		expect(vi.mocked(console.error)).not.toHaveBeenCalled()
	})
})

describe('josh.ts — unknown command', () => {
	beforeEach(() => {
		josh_mock.state.run_command_return = -1
		process.argv = [...ARGV_BASE, UNKNOWN_CMD]
	})

	it('calls process.exit(1) for an unknown command', async () => {
		await expect(import('./josh')).rejects.toThrow(PROCESS_EXIT_CALLED)
	})

	// #825: the error line went to stderr while the help listing went to stdout, so a script wiring
	// `--port $(josh port dev)` substituted the whole toolkit index into the port argument whenever
	// the name did not resolve. Nothing may reach stdout on a path that produced no answer.
	it('writes nothing to stdout for an unknown command', async () => {
		await expect(import('./josh')).rejects.toThrow(PROCESS_EXIT_CALLED)

		expect(vi.mocked(console.info)).not.toHaveBeenCalled()
	})

	it('reports the command name and the help listing on stderr', async () => {
		await expect(import('./josh')).rejects.toThrow(PROCESS_EXIT_CALLED)

		expect(vi.mocked(console.error)).toHaveBeenCalledWith(
			expect.stringContaining(`${josh_mock.UNKNOWN_PREFIX}${UNKNOWN_CMD}`),
		)
		expect(vi.mocked(console.error)).toHaveBeenCalledWith(expect.stringContaining(HELP_OUTPUT))
	})
})

describe('josh.ts — command with non-zero exit code', () => {
	it('calls process.exit when command returns non-zero exit code', async () => {
		josh_mock.state.run_command_return = 1
		process.argv = [...ARGV_BASE, 'lint']

		await expect(import('./josh')).rejects.toThrow(PROCESS_EXIT_CALLED)
	})
})

describe('josh.ts — command with zero exit code', () => {
	it('does not call process.exit when command succeeds', async () => {
		process.argv = [...ARGV_BASE, 'lint']

		await import('./josh')

		expect(vi.mocked(console.error)).not.toHaveBeenCalled()
	})
})
