import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import type { LaunchResult } from '#scripts/run/detached-launch'
import { run_wait_cli } from '#scripts/run/run-wait-cli'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bounded_check, type BoundedCall, type Dependencies } from './bounded-check'
import { COMMAND_MAP } from './josh-command-map'
import { outer_command } from './outer-command'

// joshuafolkken/kit#8708: a lane child's own call of a bounded check returns inside one chunk.

const ISSUE = '8708'
const COMMAND = 'check:related'
const LANE = `/home/dev/.kit-lanes/${ISSUE}`
const LOG_HEADER = '\n=== 2026-11-23T00:00:00.000Z · started by process 1 · pnpm ===\n'
const CHECK_OUTPUT = 'eslint: 2 problems\n'
const RED_EXIT_CODE = 1
const GREEN_EXIT_CODE = 0
const SYNC_EXIT_CODE = 7
const LONG_CHUNK_MS = 60_000
const CALL: BoundedCall = { command: COMMAND, entry: { is_bounded: true }, args: ['--full'] }
const LANE_SOURCE = { [lane_child_marker.KEY]: ISSUE, [outer_command.KEY]: COMMAND }
const create_directory = temporary_directory()

async function no_sleep(): Promise<void> {
	await Promise.resolve()
}

async function synchronous(): Promise<number> {
	return await SYNC_EXIT_CODE
}

function no_chunk(): ReturnType<Dependencies['wait']> {
	return { chunk_ms: 0, sleeper: no_sleep }
}

function failed_launch(): LaunchResult {
	return { kind: 'failed', note: 'spawn failed' }
}

// A detached check that has already finished with `exit_code`, or (`undefined`) one still running.
function finished_launcher(exit_code: number | undefined): Dependencies['launcher'] {
	return (_arguments, log_path, _root, environment): LaunchResult => {
		const directory = environment[bounded_check.RESULT_KEY] ?? ''

		writeFileSync(log_path, `${LOG_HEADER}${CHECK_OUTPUT}`)

		if (exit_code !== undefined) {
			writeFileSync(run_wait_cli.result_path(directory, 'exit'), String(exit_code))
		}

		return { kind: 'launched', pid: 1 }
	}
}

function dependencies(overrides: Partial<Dependencies> = {}): Dependencies {
	return {
		directory: LANE,
		source: LANE_SOURCE,
		root: create_directory('bounded-check-'),
		launcher: finished_launcher(GREEN_EXIT_CODE),
		wait: () => ({ chunk_ms: LONG_CHUNK_MS, sleeper: no_sleep }),
		on_exit: () => undefined,
		...overrides,
	}
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('bounded_check.run in a lane child', () => {
	it('replays a check finished inside the chunk: its output past the log header, its red code', async () => {
		const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
		const given = dependencies({ launcher: finished_launcher(RED_EXIT_CODE) })

		expect(await bounded_check.run(CALL, synchronous, given)).toBe(RED_EXIT_CODE)
		expect(write).toHaveBeenCalledWith(CHECK_OUTPUT)
	})

	it('returns pending and the next command past the chunk; that command replays the result', async () => {
		const info = vi.spyOn(console, 'info').mockReturnValue(undefined)
		const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
		const given = dependencies({ launcher: finished_launcher(undefined), wait: no_chunk })

		expect(await bounded_check.run(CALL, synchronous, given)).toBe(run_wait_cli.PENDING_EXIT_CODE)
		const pending = String(info.mock.calls[0]?.[0])
		const directory = /^pending — .*--result (\S+)`/u.exec(pending)?.[1] ?? ''

		writeFileSync(run_wait_cli.result_path(directory, 'exit'), String(RED_EXIT_CODE))
		expect(await run_wait_cli.run(['--result', directory])).toBe(RED_EXIT_CODE)
		expect(write).toHaveBeenCalledWith(CHECK_OUTPUT)
	})

	it('launches the same command and arguments', async () => {
		vi.spyOn(process.stdout, 'write').mockReturnValue(true)
		const launcher = vi.fn(finished_launcher(GREEN_EXIT_CODE))

		expect(await bounded_check.run(CALL, synchronous, dependencies({ launcher }))).toBe(0)
		expect(launcher.mock.calls[0]?.[0]).toStrictEqual([COMMAND, '--full'])
	})
})

describe('bounded_check.run in the detached child', () => {
	it('has the detached child record its exit code as it exits', async () => {
		const directory = create_directory('bounded-result-')
		const listeners: Array<(code: number) => void> = []
		const source = { [bounded_check.RESULT_KEY]: directory, [outer_command.KEY]: COMMAND }
		const given = dependencies({
			source,
			on_exit: (listener) => {
				listeners.push(listener)
			},
		})
		const exit_path = run_wait_cli.result_path(directory, 'exit')

		expect(await bounded_check.run(CALL, synchronous, given)).toBe(SYNC_EXIT_CODE)
		expect(existsSync(exit_path)).toBe(false)
		for (const listener of listeners) listener(SYNC_EXIT_CODE)
		expect(readFileSync(exit_path, 'utf8')).toBe(String(SYNC_EXIT_CODE))
		expect(existsSync(`${exit_path}.tmp`)).toBe(false)
	})
})

// A finished check's result directory, its exit code written as `exit_code`.
function result_directory(exit_code: string): string {
	const directory = create_directory('bounded-wait-')

	writeFileSync(run_wait_cli.result_path(directory, 'log'), CHECK_OUTPUT)
	writeFileSync(run_wait_cli.result_path(directory, 'exit'), exit_code)

	return directory
}

describe('josh wait --result', () => {
	it('reads an exit code that is not an integer as a failure, never as green', async () => {
		vi.spyOn(process.stdout, 'write').mockReturnValue(true)

		expect(await run_wait_cli.run(['--result', result_directory('')])).toBe(RED_EXIT_CODE)
	})

	it.each([
		['a directory no check launched into', ['--result', '/nonexistent/bounded-check']],
		['a second target beside it', ['--result', '/tmp', '--pid', '1']],
	])('refuses %s', async (_case, argv) => {
		vi.spyOn(console, 'error').mockReturnValue(undefined)

		expect(await run_wait_cli.run(argv)).toBe(RED_EXIT_CODE)
	})
})

describe('the bounded commands', () => {
	it.each([COMMAND, 'lint:related', 'test:related', 'test:unit'])(
		'marks %s as bounded',
		(command) => {
			expect(COMMAND_MAP[command]?.is_bounded).toBe(true)
		},
	)
})

describe('bounded_check.run synchronously', () => {
	const NESTED = { [lane_child_marker.KEY]: ISSUE, [outer_command.KEY]: 'gate' }

	it.each([
		['outside a lane child', { [outer_command.KEY]: COMMAND }],
		['nested in another command', NESTED],
	])('runs the check in the foreground %s', async (_case, source) => {
		const launcher = vi.fn(finished_launcher(GREEN_EXIT_CODE))
		const given = dependencies({ launcher, source })

		expect(await bounded_check.run(CALL, synchronous, given)).toBe(SYNC_EXIT_CODE)
		expect(launcher).not.toHaveBeenCalled()
	})

	it('runs an unbounded command in the foreground in a lane child', async () => {
		const call = { ...CALL, entry: {} }

		expect(await bounded_check.run(call, synchronous, dependencies())).toBe(SYNC_EXIT_CODE)
	})

	it('falls back to the foreground when the detached launch fails', async () => {
		expect(
			await bounded_check.run(CALL, synchronous, dependencies({ launcher: failed_launch })),
		).toBe(SYNC_EXIT_CODE)
	})
})
