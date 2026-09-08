import { file_map_stamp } from '#scripts/josh/file-map-stamp'
import { review_stamps } from '#scripts/review/review-stamps'

// The one thing `josh bench` must never do: remove a cache a `josh gate` is reading
// (joshuafolkken/kit#1314).
//
// **The shape is joshuafolkken/kit#1332's**, where the edit hook deleted the cache the gate had just
// filled and both gates of one run paid a cold lint. `josh gate` is started beside `/code-review`
// and holds its three caches open for the whole of it, so a `bench` run started in that window would
// do the same thing from the other side.
//
// **Asked before every clearing, not once at start-up.** A default-set run is minutes long and clears
// a target's caches before each cold reading, so a gate started by a hook or another session after
// the first check would be walked straight into. Once the gate is running the readings are void
// anyway — cold and warm alike are competing for the same cores — so the run stops rather than
// finishing with figures nobody can use.

const GATE_RUNNING_MESSAGE =
	'josh gate is running on this tree; its caches are in use. Try again once it has finished.'

// The marker carries the gate's pid **and the start time of the process that wrote it**, so one left
// behind by a killed gate blocks nothing — and goes on blocking nothing after the operating system
// reissues that pid, which the pid on its own could not promise (joshuafolkken/kit#1245).
//
// **The question is "am I sure the gate is gone", not "am I sure it is running".** This is a guard
// over someone else's caches, so the uncertain answer has to hold the run back: reading it as "not
// running" would let `josh bench` clear the caches out from under a live gate, which is what
// joshuafolkken/kit#1332 was filed for. The start-time probe is a subprocess and can fail on a loaded
// machine — and a machine running `josh gate` is exactly that machine.
function is_gate_running(): boolean {
	return !file_map_stamp.is_writer_gone(review_stamps.in_flight_stamp.read())
}

function assert_no_gate(): void {
	if (is_gate_running()) throw new Error(GATE_RUNNING_MESSAGE)
}

function is_gate_running_error(error: unknown): boolean {
	return error instanceof Error && error.message === GATE_RUNNING_MESSAGE
}

const bench_guard = { GATE_RUNNING_MESSAGE, assert_no_gate, is_gate_running, is_gate_running_error }

export { bench_guard }
