import type { RunCarry } from '#scripts/run/carry/run-carry'
import type { DriveState } from './backlog-drive'
import { backlog_drive_park_triage } from './backlog-drive-park-triage'
import { backlog_offer_exclude } from './backlog-offer-exclude'

// **A child in flight is never offered**. A lane child merges its own PR and
// drops `in-progress` before GitHub closes the issue and before the loop collects it, so `backlog:next`
// can offer it again; launching it then is refused by its still-open lane and handed to an AI session.
// A park owing the parent triage still counts as running, so an empty pool reads as `blocked`, not the
// drain that would owe the run's retrospective before the triage (joshuafolkken/kit#6871).
function running_of(state: DriveState): number {
	return state.in_flight.length + (backlog_drive_park_triage.is_owed(state) ? 1 : 0)
}

function offer_argv(
	state: DriveState,
	carry: RunCarry,
	forwarded: ReadonlyArray<string>,
): ReadonlyArray<string> {
	const settled = [...state.exclude, ...(state.waiting ?? [])]
	const exclude = backlog_offer_exclude.exclude_of(settled, state.in_flight)

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
		String(running_of(state)),
		'--retries',
		String(state.retries),
		...backlog_offer_exclude.exclude_argv(exclude),
		...forwarded,
	]
}

export const backlog_drive_offer_argv = { offer_argv }
