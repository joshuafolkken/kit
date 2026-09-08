import type { FileMapStamp } from '#scripts/josh/file-map-stamp'
import { process_identity } from '#scripts/josh/process-identity'
import { process_identity_fixture } from '#scripts/josh/process-identity-fixture'
import { review_stamps } from '#scripts/review/review-stamps'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bench_guard } from './bench-guard'

// A pid no live process holds, and a start time none can have — `process-identity-fixture.ts` for why
// each is the value it is. Paired with this run's own pid, the second is what a marker looks like
// after the operating system has reissued the pid its gate held (joshuafolkken/kit#1245).
const { DEAD_PID, FOREIGN_START } = process_identity_fixture

// The identity fields rather than a bare pid, because since joshuafolkken/kit#1245 the guard asks who
// the process is and not merely whether the number is taken.
function stub_marker(identity: Partial<FileMapStamp>): void {
	vi.spyOn(review_stamps.in_flight_stamp, 'read').mockReturnValue({
		taken_at: new Date().toISOString(),
		files: {},
		...identity,
	})
}

// joshuafolkken/kit#1332 is what this guard is written against: a second process removing the cache
// a running check is reading. `josh gate` is started beside `/code-review` and holds its three
// caches open for the whole of it.
describe('bench guard — a gate running on this tree stops the clearing', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('lets the run proceed when no gate has left a marker', () => {
		vi.spyOn(review_stamps.in_flight_stamp, 'read').mockReturnValue(undefined)

		expect(bench_guard.is_gate_running()).toBe(false)
		expect(() => {
			bench_guard.assert_no_gate()
		}).not.toThrow()
	})

	it('refuses while the marker names a live process', () => {
		stub_marker(process_identity.own_fields())

		expect(bench_guard.is_gate_running()).toBe(true)
		expect(() => {
			bench_guard.assert_no_gate()
		}).toThrow(bench_guard.GATE_RUNNING_MESSAGE)
	})

	// A marker outliving the process that wrote it would otherwise block the command forever.
	it('lets the run proceed when the marker names a process that is gone', () => {
		stub_marker({ pid: DEAD_PID })

		expect(bench_guard.is_gate_running()).toBe(false)
	})

	// The same marker after the operating system reissued its pid: the number is alive, the process
	// behind it is not the gate's. A pid-only probe passed here and blocked `josh bench` for good
	// (joshuafolkken/kit#1245).
	it('lets the run proceed when the marker names a pid that was reissued', () => {
		stub_marker({ pid: process.pid, process_start: FOREIGN_START })

		expect(bench_guard.is_gate_running()).toBe(false)
	})

	it('lets the run proceed when the marker carries no process at all', () => {
		stub_marker({})

		expect(bench_guard.is_gate_running()).toBe(false)
	})

	// **A guard resolves "cannot tell" toward refusing, which is the opposite of what the brief does
	// with the same answer** (joshuafolkken/kit#1245). A live pid whose start time cannot be read — an
	// older marker, a platform with no `ps`, or a probe that failed on a machine loaded by the very
	// gate being asked about — must not read as "no gate is running", because being wrong there
	// deletes the caches a running gate is holding open.
	it('refuses while the marker names a live pid it cannot identify', () => {
		stub_marker({ pid: process.pid })

		expect(bench_guard.is_gate_running()).toBe(true)
	})
})

// The CLI turns this one refusal into an exit code and lets every other failure through, so the
// recognizer has to be exact rather than a message match on any error.
describe('bench guard — telling its own refusal apart from any other failure', () => {
	it('recognizes the refusal it raised', () => {
		expect(bench_guard.is_gate_running_error(new Error(bench_guard.GATE_RUNNING_MESSAGE))).toBe(
			true,
		)
	})

	it('does not claim an unrelated failure', () => {
		expect(bench_guard.is_gate_running_error(new Error('spawn ENOENT'))).toBe(false)
		expect(bench_guard.is_gate_running_error('not an error')).toBe(false)
	})
})
