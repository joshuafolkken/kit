// How late a themed board's sound is heard after it starts (joshuafolkken/kit#9087): the output device's
// own reported latency — read by the resident player as it opens the output — plus a hand-set offset,
// held between none and `MAX_DELAY_MS`. The theme layer draws that much behind the sounds it starts, so
// a slow output (Bluetooth) is heard with the picture rather than after it. No report (no resident
// player, or one that could not read its device) counts as none.

const OFFSET_ENV = 'JOSH_BOARD_SOUND_OFFSET_MS'
// The most the picture waits on its sound, so a device reporting far too much never leaves the board
// out of step with what is happening.
const MAX_DELAY_MS = 500
const MS_PER_SECOND = 1000
const REPORT_PREFIX = 'latency '

interface LatencyState {
	reported_ms: number | undefined
}

const STATE: LatencyState = { reported_ms: undefined }

// The device's latency in a resident player's report line (`latency <seconds>`); none in any other line.
function reported_of(line: string): number | undefined {
	if (!line.startsWith(REPORT_PREFIX)) return undefined
	const seconds = Number(line.slice(REPORT_PREFIX.length))

	return Number.isFinite(seconds) && seconds >= 0 ? seconds * MS_PER_SECOND : undefined
}

// The hand-set offset in whole milliseconds, added to the report (negative takes off); none unset or
// unreadable.
function offset_of(environment: NodeJS.ProcessEnv): number {
	const offset = Math.trunc(Number(environment[OFFSET_ENV] ?? ''))

	return Number.isFinite(offset) ? offset : 0
}

// The picture's delay for a report and an offset, held between none and the cap.
function delay_of(reported_ms: number | undefined, offset_ms: number): number {
	return Math.min(MAX_DELAY_MS, Math.max(0, Math.round((reported_ms ?? 0) + offset_ms)))
}

// The resident player's report kept, or forgotten as it closes.
function report(reported_ms: number | undefined): void {
	STATE.reported_ms = reported_ms
}

// The delay the board draws behind its sounds now; none until a resident player reports.
function delay_ms(environment: NodeJS.ProcessEnv = process.env): number {
	if (STATE.reported_ms === undefined) return 0

	return delay_of(STATE.reported_ms, offset_of(environment))
}

const run_board_sound_latency = {
	MAX_DELAY_MS,
	OFFSET_ENV,
	delay_ms,
	delay_of,
	offset_of,
	report,
	reported_of,
}

export { run_board_sound_latency }
