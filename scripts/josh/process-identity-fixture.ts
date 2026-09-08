import { process_identity } from './process-identity'

// The pids and start times every suite that exercises a pid-keyed record needs
// (joshuafolkken/kit#1245).
//
// Four suites ask the same three questions of `process_identity` — the in-flight gate marker's two
// readers, the unit-suite worker share, and the module's own tests — and each had begun spelling the
// constants out for itself. `DEAD_PID` had already drifted to two different values across the ones
// that existed before this, which is the drift a shared fixture removes rather than merely tidies.
//
// It is a fixture rather than an export of `process-identity.ts` itself: nothing in a shipped command
// needs a pid that cannot exist, and putting one there would invite a caller to use it.

// `2 ** 22`, one above the highest pid Linux will allocate and far above what macOS hands out, so it
// names a process that cannot exist rather than one that happens not to right now. Reusing a real pid
// that has exited would be a race against the operating system reassigning it — which is the very
// thing these suites are about. Written out because a `const` initialized by one literal satisfies
// `no-magic-numbers`, while the two operands of `2 ** 22` do not.
const DEAD_PID = 4_194_304
// Not a process at all: `process.kill(0, …)` addresses the caller's own process group, which a bare
// liveness probe reports as alive.
const GROUP_PID = 0
// Nor is this one: a negative pid addresses another process group.
const NEGATIVE_PID = -1
// A start time no live process can have. Paired with a pid that is unmistakably alive — the reading
// process's own — it is exactly what a record looks like once the operating system has reissued the
// pid it was written with, which is the case that cannot be produced on demand any other way.
const FOREIGN_START = 'Thu Jan  1 00:00:00 1970'

// Whether this platform can report a process start time at all. The probe is `/bin/ps`, which macOS
// and Linux both answer and Windows has no equivalent for, so the cases that need a real start time
// are skipped there rather than asserted loosely — a test that passed on an answer the platform
// cannot give would be asserting nothing. Derived here rather than in each suite so the three that
// depend on it cannot disagree about the condition.
const has_start_probe = process_identity.own_start() !== undefined

const process_identity_fixture = {
	DEAD_PID,
	FOREIGN_START,
	GROUP_PID,
	NEGATIVE_PID,
	has_start_probe,
}

export { process_identity_fixture }
