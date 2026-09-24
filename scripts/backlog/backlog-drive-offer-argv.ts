import type { RunCarry } from '#scripts/run/run-carry'
import type { DriveState } from './backlog-drive'

const LIST_SEPARATOR = ','

function offer_argv(
	state: DriveState,
	carry: RunCarry,
	forwarded: ReadonlyArray<string>,
): ReadonlyArray<string> {
	return [
		'backlog:offer',
		'--json',
		'--started',
		carry.started_at,
		'--active',
		state.active,
		'--merged',
		String(carry.merged),
		'--running',
		String(state.in_flight.length),
		'--retries',
		String(state.retries),
		...(state.exclude.length === 0 ? [] : ['--exclude', state.exclude.join(LIST_SEPARATOR)]),
		...forwarded,
	]
}

export const backlog_drive_offer_argv = { offer_argv }
