// joshuafolkken/kit#8787: an intro's beats paced by the wall clock, so the time a beat takes to write
// never adds to its pause. Each beat is due at the start plus the pauses of the beats before it; a beat
// waits only what is left until the next one is due, and one whose end has already passed is not
// written alone but carried into the next write. Where the ports carry no clock each beat waits its
// pause in full, as before.

// When a beat that ends `ms` after the one before it ends, and how long is left until then.
interface Schedule {
	end: (ms: number) => number
	left: (end: number) => number
}

function scheduled(now: (() => number) | undefined): Schedule {
	if (now === undefined) return { end: (ms) => ms, left: (end) => end }
	const due = { at: now() }

	return {
		end: (ms) => {
			due.at += ms

			return due.at
		},
		left: (end) => end - now(),
	}
}

// How a beat left unwritten is carried into the next write: a beat that rewrites the whole screen or
// line keeps only the later beat; a reveal's blocks, each written after the last, keep every one.
type Join = (carried: string, text: string) => string

function rewritten(_carried: string, text: string): string {
	return text
}

function appended(carried: string, text: string): string {
	return `${carried}${text}`
}

const run_board_beat_pace = { appended, rewritten, scheduled }

export { run_board_beat_pace }
export type { Join, Schedule }
