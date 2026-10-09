import { describe, expect, it, vi } from 'vitest'
import type { LimitChoice } from './lane-capacity'
import { lane_limit_cli, type LimitPorts } from './lane-limit-cli'

// joshuafolkken/kit#3434: `josh lane:limit` changes a live run's lane limit. The ports stand in for the
// carry record and the event stream, so each test reads the decision the command made.

const ENVIRONMENT_LIMIT = 6
const RAISED_LIMIT = 8
const LOWERED_LIMIT = 4
const LIMIT_ABOVE_SEATS = 12
const IN_USE = 3
const SUCCESS = 0
const FAILURE = 1

interface FakeRun {
	is_live: boolean
	override: number | undefined
	environment: LimitChoice
}

interface RunOutput {
	code: number
	output: string
}

function ports_of(run: FakeRun): LimitPorts {
	return {
		read_limit: vi.fn(async (): Promise<LimitChoice> =>
			run.override === undefined ? run.environment : { kind: 'limit', limit: run.override },
		),
		read_override: vi.fn(async () => run.override),
		write_override: vi.fn(async (limit: number | undefined) => {
			if (run.is_live) run.override = limit

			return run.is_live
		}),
		emit_raise: vi.fn(async () => undefined),
		live_lane_count: vi.fn(async () => IN_USE),
	}
}

function live_run(override?: number): FakeRun {
	return { is_live: true, override, environment: { kind: 'limit', limit: ENVIRONMENT_LIMIT } }
}

// The exit code and what the command printed on `stream`, with the stream silenced meanwhile.
async function run_capturing(
	stream: 'info' | 'error',
	argv: ReadonlyArray<string>,
	ports: LimitPorts,
): Promise<RunOutput> {
	const spy = vi.spyOn(console, stream).mockImplementation(vi.fn())
	const code = await lane_limit_cli.run(argv, ports)
	const output = spy.mock.calls.flat().join('\n')

	spy.mockRestore()

	return { code, output }
}

describe('lane_limit_cli.run — changing the limit', () => {
	it('writes a raise and emits the event that wakes the watcher', async () => {
		const ports = ports_of(live_run())

		await expect(run_capturing('info', [String(RAISED_LIMIT)], ports)).resolves.toMatchObject({
			code: SUCCESS,
		})
		expect(ports.write_override).toHaveBeenCalledWith(RAISED_LIMIT)
		expect(ports.emit_raise).toHaveBeenCalledWith('lane limit 6 → 8')
	})

	it('writes a lowered limit without waking anyone', async () => {
		const ports = ports_of(live_run())

		await run_capturing('info', [String(LOWERED_LIMIT)], ports)

		expect(ports.write_override).toHaveBeenCalledWith(LOWERED_LIMIT)
		expect(ports.emit_raise).not.toHaveBeenCalled()
	})

	it('wakes nobody for a raise past the seats that frees no lane', async () => {
		const ports = ports_of(live_run(LIMIT_ABOVE_SEATS))

		await run_capturing('info', [String(LIMIT_ABOVE_SEATS + 1)], ports)

		expect(ports.emit_raise).not.toHaveBeenCalled()
	})

	it('clears the override on --reset, and a reset that raises wakes the watcher', async () => {
		const ports = ports_of(live_run(LOWERED_LIMIT))

		await run_capturing('info', ['--reset'], ports)

		expect(ports.write_override).toHaveBeenCalledWith(undefined)
		expect(ports.emit_raise).toHaveBeenCalledWith('lane limit 4 → 6')
	})

	it('refuses with no run in progress, naming the variable to set instead', async () => {
		const ports = ports_of({ ...live_run(), is_live: false })
		const result = await run_capturing('error', [String(RAISED_LIMIT)], ports)

		expect(result.code).toBe(FAILURE)
		expect(result.output).toContain('JOSH_LANE_LIMIT')
		expect(ports.emit_raise).not.toHaveBeenCalled()
	})
})

describe('lane_limit_cli.run — refusing what is not a limit', () => {
	it.each([['0'], ['six']])('refuses %s by the JOSH_LANE_LIMIT rule', async (raw) => {
		const ports = ports_of(live_run())
		const result = await run_capturing('error', [raw], ports)

		expect(result).toMatchObject({ code: FAILURE })
		expect(result.output).toContain('must be a positive integer')
		expect(ports.write_override).not.toHaveBeenCalled()
	})

	it('refuses a negative limit, which reads as an unknown flag, without writing', async () => {
		const ports = ports_of(live_run())
		const result = await run_capturing('error', ['-2'], ports)

		expect(result.code).toBe(FAILURE)
		expect(ports.write_override).not.toHaveBeenCalled()
	})

	it.each([[['8', '9']], [['8', '--reset']], [['--unknown']]])(
		'prints the usage for %j',
		async (argv) => {
			const result = await run_capturing('error', argv, ports_of(live_run()))

			expect(result).toStrictEqual({ code: FAILURE, output: lane_limit_cli.USAGE })
		},
	)
})

describe('lane_limit_cli.run — the bare form', () => {
	it('prints the limit, its source, the lanes in use and the free ones', async () => {
		const result = await run_capturing('info', [], ports_of(live_run(RAISED_LIMIT)))

		expect(result).toStrictEqual({
			code: SUCCESS,
			output: 'lane limit 8 (lane:limit override) · in use 3 · free 5',
		})
	})

	it('names the variable as the source with no override', async () => {
		const result = await run_capturing('info', [], ports_of(live_run()))

		expect(result.output).toBe('lane limit 6 (JOSH_LANE_LIMIT) · in use 3 · free 3')
	})

	it('shows a limit past the seats at the seats', async () => {
		const result = await run_capturing('info', [], ports_of(live_run(LIMIT_ABOVE_SEATS)))

		expect(result.output).toBe(
			'lane limit 9 (12 capped at the seats) (lane:limit override) · in use 3 · free 6',
		)
	})
})
