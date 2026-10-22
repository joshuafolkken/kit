import { has_parked_label } from '#scripts/issue/issue-labels'
import type { ItemStatus, OpenRead } from './run-board-status'

// A parked child a person has released by removing `needs-decision` is no longer the run's: the
// listing, read after the park, holds it open without the label. Its status is dropped, so the board
// lays it where the plan places it, as it does any issue the run has not touched.

type ReleaseRead = Pick<OpenRead, 'read_ms' | 'labels'>

function is_read_after_park(status: ItemStatus, read_ms: number | undefined): boolean {
	return read_ms !== undefined && (status.ended_ms ?? 0) <= read_ms
}

// A person still owns a parked child while any park label (`PARKED_LABELS`) is on it. An issue the
// listing did not hold has no labels to read, and stays parked.
function is_undecided(labels: ReadonlyArray<string> | undefined): boolean {
	return labels !== undefined && !has_parked_label(labels)
}

function is_released(issue: number, status: ItemStatus, read: ReleaseRead): boolean {
	if (status.state !== 'parked') return false

	return is_read_after_park(status, read.read_ms) && is_undecided(read.labels.get(issue))
}

function without_released(
	statuses: ReadonlyMap<number, ItemStatus>,
	read: ReleaseRead,
): ReadonlyMap<number, ItemStatus> {
	return new Map([...statuses].filter(([issue, status]) => !is_released(issue, status, read)))
}

const run_board_released = { without_released }

export { run_board_released }
