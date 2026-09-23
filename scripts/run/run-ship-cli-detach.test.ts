import { beforeEach, describe, expect, it, vi } from 'vitest'

const josh_run_mock = vi.hoisted(() => vi.fn())
const detach_mock = vi.hoisted(() => vi.fn())
const read_log_mock = vi.hoisted(() => vi.fn())
const is_supervised_mock = vi.hoisted(() => vi.fn())
const return_mock = vi.hoisted(() => vi.fn())
const repository_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/josh/josh-run', () => ({ josh_command: { josh_run: josh_run_mock } }))
vi.mock('./run-ship-probe', () => ({
	run_ship_probe: {
		read_state: vi.fn().mockResolvedValue({
			is_committed: false,
			is_pushed: false,
			is_merged: false,
		}),
		record_target: vi.fn().mockResolvedValue(undefined),
		repository_directory: repository_mock,
	},
}))
vi.mock('./run-event-stream-emit', () => ({ run_event_stream_emit: { emit: vi.fn() } }))
vi.mock('./run-ship-detach', () => ({
	run_ship_detach: {
		LAUNCHED: 'launched',
		FAILED: 'failed',
		detach: detach_mock,
		read_log: read_log_mock,
		is_supervised: is_supervised_mock,
	},
}))
vi.mock('./run-ship-return', () => ({ run_ship_return: { return_control: return_mock } }))

const { run_ship_cli } = await import('./run-ship-cli')

// joshuafolkken/kit#2428: the CLI side of the detached supervisor — `--detach` hands the region over and
// runs nothing itself, `--log <N>` prints what a stopped supervisor left, `--cite` carries follow-ups so
// the title stays last, and only a supervised ship hands a failed stage back.

const OK = 0
const FAILED = 1
const TITLE = 'Hand the region over #2428'
const NUMBER = '2428'
const REPOSITORY = '/repo/.git'
const STOPPED_REPORT = '=== gate ===\nred'

const info_lines: Array<string> = []

beforeEach(() => {
	josh_run_mock.mockReset().mockResolvedValue({ code: OK, out: '' })
	detach_mock.mockReset().mockResolvedValue({ verdict: 'launched', note: 'supervisor 1' })
	read_log_mock.mockReset().mockReturnValue(STOPPED_REPORT)
	is_supervised_mock.mockReset().mockReturnValue(false)
	return_mock.mockReset().mockResolvedValue('recorded')
	repository_mock.mockReset().mockResolvedValue(REPOSITORY)
	info_lines.length = 0
	vi.spyOn(console, 'info').mockImplementation((line: string) => {
		info_lines.push(line)
	})
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('run_ship_cli.run — --detach hands the region to a supervisor', () => {
	it('launches the supervisor with the parsed request and runs no step itself', async () => {
		expect(await run_ship_cli.run([TITLE, '--detach', '--review', '--cite', '2500'])).toBe(OK)
		expect(detach_mock).toHaveBeenCalledWith(
			expect.objectContaining({
				title: TITLE,
				number: NUMBER,
				cites: ['2500'],
				is_review: true,
				repository: REPOSITORY,
			}),
		)
		expect(josh_run_mock).not.toHaveBeenCalled()
		expect(info_lines).toEqual(['launched'])
	})

	it('exits non-zero on a refused launch', async () => {
		detach_mock.mockResolvedValue({ verdict: 'busy', note: 'already running' })

		expect(await run_ship_cli.run([TITLE, '--detach'])).toBe(FAILED)
	})
})

describe('run_ship_cli.run — --log prints the stopped supervisor report', () => {
	it('prints the log for the issue', async () => {
		expect(await run_ship_cli.run(['--log', NUMBER])).toBe(OK)
		expect(read_log_mock).toHaveBeenCalledWith(REPOSITORY, NUMBER)
		expect(info_lines).toEqual([STOPPED_REPORT])
	})

	it('exits non-zero where no supervisor ever logged', async () => {
		read_log_mock.mockReturnValue(undefined)

		expect(await run_ship_cli.run(['--log', NUMBER])).toBe(FAILED)
	})

	it.each([[['--log', 'abc']], [['--log', NUMBER, TITLE]]])(
		'refuses a malformed --log: %s',
		async (argv) => {
			expect(await run_ship_cli.run(argv)).toBe(FAILED)
			expect(read_log_mock).not.toHaveBeenCalled()
		},
	)
})

describe('run_ship_cli.run — --cite is a follow-up citation like a trailing positional', () => {
	it('forwards option and positional citations to run:tail', async () => {
		await run_ship_cli.run([TITLE, '2500', '--cite', '2501'])

		expect(josh_run_mock.mock.calls.at(-1)?.[0]).toStrictEqual(['run:tail', NUMBER, '2500', '2501'])
	})
})

describe('run_ship_cli.run — only a supervised ship hands a failed stage back', () => {
	it('hands the stopped stage back when supervised', async () => {
		is_supervised_mock.mockReturnValue(true)
		josh_run_mock.mockResolvedValueOnce({ code: FAILED, out: 'lint red' })

		expect(await run_ship_cli.run([TITLE])).toBe(FAILED)
		expect(return_mock).toHaveBeenCalledWith(NUMBER, 'gate')
	})

	it('hands nothing back from a ship run in the agent’s own turn', async () => {
		josh_run_mock.mockResolvedValueOnce({ code: FAILED, out: 'lint red' })

		await run_ship_cli.run([TITLE])

		expect(return_mock).not.toHaveBeenCalled()
	})
})
