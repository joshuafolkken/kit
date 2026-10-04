import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { run_ship_scoped as real_scoped } from './run-ship-scoped'

const josh_run_mock = vi.hoisted(() => vi.fn())
const detach_mock = vi.hoisted(() => vi.fn())
const read_log_mock = vi.hoisted(() => vi.fn())
const is_supervised_mock = vi.hoisted(() => vi.fn())
const return_mock = vi.hoisted(() => vi.fn())
const repository_mock = vi.hoisted(() => vi.fn())
const is_lane_child_mock = vi.hoisted(() => vi.fn())
const mark_result_mock = vi.hoisted(() => vi.fn())
const preflight_mock = vi.hoisted(() => vi.fn())

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
// The preflight's own branches are pinned in `run-ship-preflight.test.ts`; here it passes.
vi.mock('./run-ship-preflight', () => ({ run_ship_preflight: { stage: preflight_mock } }))
vi.mock('./run-ship-scoped', async (import_original) => {
	const actual = await import_original<{ run_ship_scoped: typeof real_scoped }>()
	const scoped_pair = vi
		.fn<typeof real_scoped.scoped_pair>()
		.mockResolvedValue({ code: 0, out: '' })

	return { run_ship_scoped: { ...actual.run_ship_scoped, scoped_pair } }
})
vi.mock('./run-ship-detach', () => ({
	run_ship_detach: {
		LAUNCHED: 'launched',
		FAILED: 'failed',
		detach: detach_mock,
		read_log: read_log_mock,
		is_supervised: is_supervised_mock,
		mark_result: mark_result_mock,
		claim_identity: vi.fn(),
	},
}))
vi.mock('./run-ship-return', () => ({ run_ship_return: { return_control: return_mock } }))
vi.mock('#scripts/lane/lane-child-marker', () => ({
	lane_child_marker: { is_child_of: is_lane_child_mock },
}))

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
const PREFLIGHT_REFUSAL = '1 pull-request precondition(s) unmet before the review and the gate:'

const info_lines: Array<string> = []

beforeEach(() => {
	josh_run_mock.mockReset().mockResolvedValue({ code: OK, out: '' })
	detach_mock.mockReset().mockResolvedValue({ verdict: 'launched', note: 'supervisor 1' })
	read_log_mock.mockReset().mockReturnValue(STOPPED_REPORT)
	is_supervised_mock.mockReset().mockReturnValue(false)
	return_mock.mockReset().mockResolvedValue('recorded')
	repository_mock.mockReset().mockResolvedValue(REPOSITORY)
	is_lane_child_mock.mockReset().mockReturnValue(false)
	info_lines.length = 0
	vi.spyOn(console, 'info').mockImplementation((line: string) => {
		info_lines.push(line)
	})
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

beforeEach(() => {
	mark_result_mock.mockReset()
	preflight_mock.mockReset().mockResolvedValue({ code: OK, out: 'ready' })
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

// joshuafolkken/kit#2457: a headless lane child's turn ending killed a ship it ran in its own process.
describe('run_ship_cli.run — a lane child always ships through the supervisor', () => {
	it('detaches without the flag inside a lane child and runs no step itself', async () => {
		is_lane_child_mock.mockReturnValue(true)

		expect(await run_ship_cli.run([TITLE])).toBe(OK)
		expect(detach_mock).toHaveBeenCalledWith(
			expect.objectContaining({ title: TITLE, number: NUMBER }),
		)
		expect(josh_run_mock).not.toHaveBeenCalled()
		expect(info_lines).toEqual(['launched'])
	})

	it('runs the stages itself when it is the supervisor, lane mark inherited', async () => {
		is_lane_child_mock.mockReturnValue(true)
		is_supervised_mock.mockReturnValue(true)

		expect(await run_ship_cli.run([TITLE])).toBe(OK)
		expect(detach_mock).not.toHaveBeenCalled()
		expect(josh_run_mock).toHaveBeenCalled()
	})

	it('leaves a ship typed outside a lane in the foreground', async () => {
		expect(await run_ship_cli.run([TITLE])).toBe(OK)
		expect(detach_mock).not.toHaveBeenCalled()
		expect(josh_run_mock).toHaveBeenCalled()
	})
})

// joshuafolkken/kit#2966: a preflight stop returns to the lane child rather than to a relaunched session.
describe('run_ship_cli.run — the preflight runs before the hand-off', () => {
	it('does not detach and reports the refusal when the preflight fails in a lane child', async () => {
		is_lane_child_mock.mockReturnValue(true)
		preflight_mock.mockResolvedValue({ code: FAILED, out: PREFLIGHT_REFUSAL })

		expect(await run_ship_cli.run([TITLE])).toBe(FAILED)
		expect(detach_mock).not.toHaveBeenCalled()
		expect(info_lines.join('\n')).toContain(PREFLIGHT_REFUSAL)
	})

	it('detaches once the preflight passes in a lane child', async () => {
		is_lane_child_mock.mockReturnValue(true)

		expect(await run_ship_cli.run([TITLE])).toBe(OK)
		expect(preflight_mock).toHaveBeenCalledWith({ title: TITLE, body_path: undefined })
		expect(detach_mock).toHaveBeenCalledOnce()
	})

	it('does not detach on a failed preflight under an explicit --detach', async () => {
		preflight_mock.mockResolvedValue({ code: FAILED, out: PREFLIGHT_REFUSAL })

		expect(await run_ship_cli.run([TITLE, '--detach'])).toBe(FAILED)
		expect(detach_mock).not.toHaveBeenCalled()
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

		const flags = ['--body-file', 'evidence.md', '--cite', '2500']

		expect(await run_ship_cli.run([TITLE, ...flags])).toBe(FAILED)
		expect(return_mock).toHaveBeenCalledWith(NUMBER, 'gate', {
			title: TITLE,
			flags,
			is_review: false,
		})
	})

	it('hands nothing back from a ship run in the agent’s own turn', async () => {
		josh_run_mock.mockResolvedValueOnce({ code: FAILED, out: 'lint red' })

		await run_ship_cli.run([TITLE])

		expect(return_mock).not.toHaveBeenCalled()
	})
})
