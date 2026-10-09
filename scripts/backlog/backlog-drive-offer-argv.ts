import type { RunCarry } from '#scripts/run/carry/run-carry'
import type { DriveState } from './backlog-drive'

const LIST_SEPARATOR = ','

// **A child in flight is never offered**. A lane child merges its own PR and
// drops `in-progress` before GitHub closes the issue and before the loop collects it, so `backlog:next`
// can offer it again; launching it then is refused by its still-open lane and handed to an AI session.
function excluded(state: DriveState): ReadonlyArray<string> {
	return [...new Set([...state.exclude, ...state.in_flight])]
}

function offer_argv(
	state: DriveState,
	carry: RunCarry,
	forwarded: ReadonlyArray<string>,
): ReadonlyArray<string> {
	const exclude = excluded(state)

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
		...(exclude.length === 0 ? [] : ['--exclude', exclude.join(LIST_SEPARATOR)]),
		...forwarded,
	]
}

export const backlog_drive_offer_argv = { offer_argv }
