import { review_stamps } from '#scripts/review/review-stamps'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bench_guard } from './bench-guard'

// A pid well above what any of these platforms hands out, so the liveness probe answers "gone".
const DEAD_PID = 2_147_483_646

function stub_marker(pid: number | undefined): void {
	vi.spyOn(review_stamps.in_flight_stamp, 'read').mockReturnValue({
		taken_at: new Date().toISOString(),
		files: {},
		...(pid !== undefined && { pid }),
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
		stub_marker(process.pid)

		expect(bench_guard.is_gate_running()).toBe(true)
		expect(() => {
			bench_guard.assert_no_gate()
		}).toThrow(bench_guard.GATE_RUNNING_MESSAGE)
	})

	// A marker outliving the process that wrote it would otherwise block the command forever.
	it('lets the run proceed when the marker names a process that is gone', () => {
		stub_marker(DEAD_PID)

		expect(bench_guard.is_gate_running()).toBe(false)
	})

	it('lets the run proceed when the marker carries no process at all', () => {
		stub_marker(undefined)

		expect(bench_guard.is_gate_running()).toBe(false)
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
