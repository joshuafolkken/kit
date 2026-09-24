import { josh_command } from '#scripts/josh/josh-run'
import type { DriveEnd } from './backlog-drive'

const SUCCESS_EXIT_CODE = 0
const should_forward_stderr = true

function end_args(end: DriveEnd): ReadonlyArray<string> {
	if (end.is_finish === true) return ['run:carry', '--end']

	return ['run:carry', '--end', '--stopped', end.detail ?? 'stopped']
}

async function finish(end: DriveEnd): Promise<void> {
	const report = await josh_command.josh_run(['run:report'], should_forward_stderr)

	if (report.code !== SUCCESS_EXIT_CODE) throw new Error('run:report failed')
	console.error(report.out)
	const ended = await josh_command.josh_run(end_args(end), should_forward_stderr)

	if (ended.code !== SUCCESS_EXIT_CODE) throw new Error('run:carry --end failed')
}

export const backlog_drive_finish = { finish }
