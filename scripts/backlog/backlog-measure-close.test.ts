import { git_gh_command } from '#scripts/gh/git-gh-command'
import { issue_measured_close } from '#scripts/issue/issue-measured-close'
import { trusted_measure, type CommandRun } from '#scripts/issue/trusted-measure'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { backlog_measure_close } from './backlog-measure-close'

// joshuafolkken/kit#4621: the drive runs a due issue's measurement declaration before it opens a lane.
// The body read, the command, the GitHub writes and the event stream are mocked.

vi.mock('#scripts/issue/trusted-measure', () => ({
	trusted_measure: { read_trusted_body: vi.fn(), run_command: vi.fn(), text_of: vi.fn() },
}))
vi.mock('#scripts/issue/issue-measured-close', () => ({
	issue_measured_close: { close: vi.fn() },
}))
vi.mock('#scripts/gh/git-gh-command', () => ({ git_gh_command: { issue_comment: vi.fn() } }))
vi.mock('#scripts/run/event/run-event-stream-emit', () => ({
	run_event_stream_emit: { emit: vi.fn() },
}))

const ISSUE = '4599'
const DECLARED = '## 背景\n\n- 計測宣言: `pnpm josh count` <= 5\n'
const UNREADABLE = 'Value: unreadable'

function given(body: string, run: CommandRun): void {
	vi.mocked(trusted_measure.read_trusted_body).mockResolvedValue({ kind: 'trusted', body })
	vi.mocked(trusted_measure.run_command).mockReturnValue(run)
}

beforeEach(() => {
	vi.mocked(trusted_measure.text_of).mockReturnValue('output')
	vi.mocked(issue_measured_close.close).mockReset().mockResolvedValue(true)
	vi.mocked(git_gh_command.issue_comment).mockReset().mockResolvedValue('url')
	vi.mocked(run_event_stream_emit.emit).mockReset().mockResolvedValue()
})

describe('backlog_measure_close.closed — a value within the bound', () => {
	it('closes the issue and puts a measured event on the stream', async () => {
		given(DECLARED, { kind: 'ok', output: '3' })

		await expect(backlog_measure_close.closed(ISSUE)).resolves.toBe(true)
		expect(issue_measured_close.close).toHaveBeenCalledWith(
			ISSUE,
			expect.stringContaining('Value: 3'),
		)
		expect(run_event_stream_emit.emit).toHaveBeenCalledWith(
			run_event_stream.EVENT_KIND.MEASURED,
			`#${ISSUE} measured by backlog:drive: 3 <= 5`,
		)
	})

	it('launches the lane and emits nothing when the close fails', async () => {
		given(DECLARED, { kind: 'ok', output: '3' })
		vi.mocked(issue_measured_close.close).mockResolvedValue(false)

		await expect(backlog_measure_close.closed(ISSUE)).resolves.toBe(false)
		expect(run_event_stream_emit.emit).not.toHaveBeenCalled()
	})
})

describe('backlog_measure_close.closed — handed to the lane with the result', () => {
	it.each([
		['a value out of bound', { kind: 'ok', output: '9' }, 'Value: 9'],
		['output that is not one number', { kind: 'ok', output: 'nine' }, UNREADABLE],
		['a failed command', { kind: 'failed', message: 'exit 1' }, UNREADABLE],
	] as const)('comments %s and launches', async (_case, run, value) => {
		given(DECLARED, run)

		await expect(backlog_measure_close.closed(ISSUE)).resolves.toBe(false)
		expect(git_gh_command.issue_comment).toHaveBeenCalledWith(ISSUE, expect.stringContaining(value))
		expect(issue_measured_close.close).not.toHaveBeenCalled()
	})

	it('still launches when the comment cannot be posted', async () => {
		given(DECLARED, { kind: 'ok', output: '9' })
		vi.mocked(git_gh_command.issue_comment).mockRejectedValue(new Error('HTTP 502'))
		vi.spyOn(console, 'error').mockImplementation(() => undefined)

		await expect(backlog_measure_close.closed(ISSUE)).resolves.toBe(false)
	})
})

describe('backlog_measure_close.closed — nothing to run', () => {
	it('launches without a comment when the body declares nothing', async () => {
		given('## 背景\n\n- 種別: 非不具合\n', { kind: 'ok', output: '3' })

		await expect(backlog_measure_close.closed(ISSUE)).resolves.toBe(false)
		expect(trusted_measure.run_command).not.toHaveBeenCalled()
		expect(git_gh_command.issue_comment).not.toHaveBeenCalled()
	})

	it('launches without running anything when the body is not trusted', async () => {
		vi.mocked(trusted_measure.read_trusted_body).mockResolvedValue({ kind: 'refused', reason: 'x' })
		vi.mocked(trusted_measure.run_command).mockClear()

		await expect(backlog_measure_close.closed(ISSUE)).resolves.toBe(false)
		expect(trusted_measure.run_command).not.toHaveBeenCalled()
		expect(git_gh_command.issue_comment).not.toHaveBeenCalled()
	})
})
