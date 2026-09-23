import { beforeEach, describe, expect, it, vi } from 'vitest'

const josh_run_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/josh/josh-run', () => ({ josh_command: { josh_run: josh_run_mock } }))
// A fresh ship: nothing recorded and nothing committed, pushed or merged. The resume paths are pinned in
// `run-ship-resume.test.ts`.
vi.mock('./run-ship-probe', () => ({
	run_ship_probe: {
		read_state: vi.fn().mockResolvedValue({
			is_committed: false,
			is_pushed: false,
			is_merged: false,
		}),
		record_target: vi.fn().mockResolvedValue(undefined),
	},
}))
vi.mock('./run-event-stream-emit', () => ({ run_event_stream_emit: { emit: vi.fn() } }))

const { run_ship_cli } = await import('./run-ship-cli')

const OK = 0
const FAILED = 1
const TITLE = 'Fold the ship region #2398'
const NUMBER = '2398'

const NOTIFY_FLAG = '--notify-message'
const NOTIFY = 'done: cause/fix/result'
const NOTIFY_FILE_FLAG = '--notify-message-file'
const BODY_PATH = 'notify-body.txt'
const GATE = ['gate']
const COMMIT = ['git', '-y', TITLE]
const FOLLOWUP = ['followup', TITLE]
const REPORT = ['run:tail', NUMBER]

const info_lines: Array<string> = []

function argv_calls(): ReadonlyArray<ReadonlyArray<string>> {
	return josh_run_mock.mock.calls.map((call) => call[0] as ReadonlyArray<string>)
}

beforeEach(() => {
	josh_run_mock.mockReset().mockResolvedValue({ code: OK, out: '' })
	info_lines.length = 0
	vi.spyOn(console, 'info').mockImplementation((line: string) => {
		info_lines.push(line)
	})
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('run_ship_cli.run — folds the four ship steps into one call', () => {
	it('runs gate, commit, followup and report in order', async () => {
		const code = await run_ship_cli.run([TITLE])

		expect(code).toBe(OK)
		expect(argv_calls()).toStrictEqual([GATE, COMMIT, FOLLOWUP, REPORT])
	})

	it('reads the issue number off the title tail for the report step', async () => {
		await run_ship_cli.run(['Some other #17 mid-title work #2398'])

		expect(argv_calls().at(-1)).toStrictEqual(['run:tail', '2398'])
	})

	it('forwards follow-up citations filed this run to the report step', async () => {
		await run_ship_cli.run([TITLE, '2400', '2401'])

		expect(argv_calls().at(-1)).toStrictEqual(['run:tail', NUMBER, '2400', '2401'])
	})

	it('joins each executed step under its header in one composite report', async () => {
		josh_run_mock
			.mockResolvedValueOnce({ code: OK, out: 'green' })
			.mockResolvedValueOnce({ code: OK, out: 'pushed' })
			.mockResolvedValueOnce({ code: OK, out: 'merged' })
			.mockResolvedValueOnce({ code: OK, out: 'shipped' })

		await run_ship_cli.run([TITLE])

		expect(info_lines[0]).toBe(
			'=== gate ===\ngreen\n\n=== commit/push/PR ===\npushed\n\n=== followup ===\nmerged\n\n=== report ===\nshipped',
		)
	})
})

describe('run_ship_cli.run — forwards the notify body to followup alone', () => {
	it('forwards an inline notify message', async () => {
		await run_ship_cli.run([TITLE, NOTIFY_FLAG, NOTIFY])

		expect(argv_calls()).toStrictEqual([
			GATE,
			COMMIT,
			['followup', TITLE, NOTIFY_FLAG, NOTIFY],
			REPORT,
		])
	})

	it('forwards the shell-body-safe file form', async () => {
		await run_ship_cli.run([TITLE, NOTIFY_FILE_FLAG, BODY_PATH])

		expect(argv_calls().at(-2)).toStrictEqual(['followup', TITLE, NOTIFY_FILE_FLAG, BODY_PATH])
	})
})

describe('run_ship_cli.run — a failed step stops the ship', () => {
	it('does not run the commit when the gate failed, and exits non-zero', async () => {
		josh_run_mock.mockResolvedValueOnce({ code: FAILED, out: 'lint red' })

		const code = await run_ship_cli.run([TITLE])

		expect(code).toBe(FAILED)
		expect(argv_calls()).toStrictEqual([GATE])
	})

	it('names the stopped step in the report', async () => {
		josh_run_mock.mockResolvedValueOnce({ code: FAILED, out: 'lint red' })

		await run_ship_cli.run([TITLE])

		expect(info_lines[0]).toBe('=== gate ===\nlint red\n\nstopped at: === gate ===')
	})

	it('refuses a title with no issue number rather than shipping past run:tail', async () => {
		expect(await run_ship_cli.run(['A title with no reference'])).toBe(FAILED)
		expect(josh_run_mock).not.toHaveBeenCalled()
	})

	it('refuses a non-numeric follow-up citation rather than forwarding it', async () => {
		expect(await run_ship_cli.run([TITLE, 'not-a-number'])).toBe(FAILED)
		expect(josh_run_mock).not.toHaveBeenCalled()
	})

	it('refuses a stray flag rather than forwarding it to a step', async () => {
		expect(await run_ship_cli.run(['--force'])).toBe(FAILED)
		expect(josh_run_mock).not.toHaveBeenCalled()
	})
})
