// joshuafolkken/kit#8787: an intro's beats paced by the wall clock, so the time a beat takes to write
// never adds to its pause. Each beat is due at the start plus the pauses of the beats before it; a beat
// waits only what is left until the next one is due, and one whose end has already passed is not
// written alone but carried, whole, into the next write — a rain or arrival beat writes only the cells
// changed since the beat before (joshuafolkken/kit#8788, #8790), so none can be dropped. Where the
// ports carry no clock each beat waits its pause in full, as before.

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

const run_board_beat_pace = { scheduled }

export { run_board_beat_pace }
export type { Schedule }
