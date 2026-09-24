import { josh_command } from '#scripts/josh/josh-run'
import { afterEach, expect, it, vi } from 'vitest'
import { backlog_drive_finish } from './backlog-drive-finish'

const STOP = {
	reason: 'stop',
	token: 'stop',
	issue: undefined,
	detail: 'maximum reached',
	is_finish: false,
}

afterEach(() => {
	vi.restoreAllMocks()
})

it('sends the stopped reason for a limit or guarded ending', async () => {
	const run = vi.spyOn(josh_command, 'josh_run').mockResolvedValue({ code: 0, out: 'report' })

	vi.spyOn(console, 'error').mockImplementation(vi.fn())

	await backlog_drive_finish.finish(STOP)

	expect(run.mock.calls.map(([argv]) => argv)).toStrictEqual([
		['run:report'],
		['run:carry', '--end', '--stopped', STOP.detail],
	])
})

it('keeps the carry record when the report fails', async () => {
	const run = vi.spyOn(josh_command, 'josh_run').mockResolvedValue({ code: 1, out: '' })

	await expect(backlog_drive_finish.finish(STOP)).rejects.toThrow('run:report failed')
	expect(run).toHaveBeenCalledTimes(1)
})

it('does not report success when ending the carry fails', async () => {
	const run = vi
		.spyOn(josh_command, 'josh_run')
		.mockResolvedValueOnce({ code: 0, out: 'report' })
		.mockResolvedValueOnce({ code: 1, out: '' })

	vi.spyOn(console, 'error').mockImplementation(vi.fn())

	await expect(backlog_drive_finish.finish(STOP)).rejects.toThrow('run:carry --end failed')
	expect(run).toHaveBeenCalledTimes(2)
})
