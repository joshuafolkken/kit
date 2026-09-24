import { beforeEach, describe, expect, it, vi } from 'vitest'
import { backlog_budget } from './backlog-budget'

// joshuafolkken/kit#2508: the argument half of `backlog:drive` and the two refusals it makes before any
// loop starts — no carry record, and a `--only` invocation whose named list the session runs itself.

const read_record_mock = vi.hoisted(() => vi.fn())

vi.mock('./backlog-drive-ports', () => ({
	backlog_drive_ports: { read_record: read_record_mock, ports_for: vi.fn() },
}))

const { backlog_drive_cli } = await import('./backlog-drive-cli')

const info_lines: Array<string> = []
const IDLE_MINUTES = 10
const MAX = 4

beforeEach(() => {
	read_record_mock.mockReset()
	info_lines.length = 0
	vi.spyOn(console, 'info').mockImplementation((line: string) => {
		info_lines.push(line)
	})
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('backlog_drive_cli.parse — the flags mean what they mean to backlog:budget', () => {
	it('defaults to the default idle watch, no maximum and no stash', () => {
		expect(backlog_drive_cli.parse([])).toMatchObject({
			options: { max_issues: undefined, idle_budget_ms: backlog_budget.DEFAULT_IDLE_MS },
			stash: undefined,
		})
	})

	it('reads --max, --idle in minutes, --idle 0 as the watch off, and --stash', () => {
		const parsed = backlog_drive_cli.parse([
			'--max',
			String(MAX),
			'--idle',
			String(IDLE_MINUTES),
			'--stash',
			'msg',
		])

		expect(parsed).toMatchObject({
			options: { max_issues: MAX, idle_budget_ms: IDLE_MINUTES * backlog_budget.MS_PER_MINUTE },
			stash: 'msg',
		})
		expect(backlog_drive_cli.parse(['--idle', '0'])?.options.idle_budget_ms).toBeUndefined()
	})

	it('refuses an unreadable count, a zero owner and an unknown flag', () => {
		expect(backlog_drive_cli.parse(['--max', 'many'])).toBeUndefined()
		expect(backlog_drive_cli.parse(['--owner', '0'])).toBeUndefined()
		expect(backlog_drive_cli.parse(['--bogus'])).toBeUndefined()
	})
})

describe('backlog_drive_cli.run — the refusals before the loop', () => {
	it('answers no-carry when no run is open', async () => {
		read_record_mock.mockResolvedValue(undefined)

		expect(await backlog_drive_cli.run([])).toBe(1)
		expect(info_lines).toStrictEqual(['no-carry'])
	})

	it('answers only for a --only invocation and drives nothing', async () => {
		read_record_mock.mockResolvedValue({ invocation: 'backlogrun #1 --only' })

		expect(await backlog_drive_cli.run([])).toBe(0)
		expect(info_lines).toStrictEqual(['only'])
	})
})
