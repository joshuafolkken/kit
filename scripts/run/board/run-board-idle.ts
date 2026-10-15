import { lane_await } from '#scripts/lane/lane-await'

// A lane is drawn stopped only once it has read idle for `lane_await.RECONFIRM_MS`: a boundary cut drops
// the child's process for a moment before its resume takes over, and one bare probe cannot tell that
// handoff from a child that died — `lane:await` re-confirms a disappearance over the same window. A live
// board carries when each lane was first read idle across its reads; a single frame has no earlier read,
// so it reads the lanes again after the window (`run-board-tick.ts`).

/** When each lane the last read found idle was first read so. */
type IdleSince = ReadonlyMap<string, number>

const NO_IDLE: IdleSince = new Map()

// The lanes read idle now, each keeping the moment it was first read so; a lane read working drops out.
function since_of(before: IdleSince, idle: ReadonlyArray<string>, now_ms: number): IdleSince {
	return new Map(idle.map((lane) => [lane, before.get(lane) ?? now_ms]))
}

// The lanes idle for the whole window as of the read at `read_ms`; none before any read.
function stopped_of(since: IdleSince, read_ms: number | undefined): Array<string> {
	if (read_ms === undefined) return []

	const lasted = [...since].filter(([, at]) => read_ms - at >= lane_await.RECONFIRM_MS)

	return lasted.map(([lane]) => lane)
}

const run_board_idle = { NO_IDLE, since_of, stopped_of }

export type { IdleSince }
export { run_board_idle }
