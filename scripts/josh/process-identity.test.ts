import { describe, expect, it } from 'vitest'
import { process_identity } from './process-identity'
import { process_identity_fixture } from './process-identity-fixture'

// joshuafolkken/kit#1245: the in-flight gate marker reported a gate that a reissued pid made look
// alive. `process.kill(pid, 0)` answers about whatever holds the number now, so a marker left behind
// by an interrupted `josh gate` began asserting a running gate again the moment the operating system
// handed that pid to something unrelated.
//
// **The recycled pid is testable without waiting for the operating system to reissue anything**: what
// the reader sees in that situation is a pid that is alive paired with a recorded start time that is
// not the one that pid has now. This suite constructs exactly that.

const { DEAD_PID, FOREIGN_START, GROUP_PID, NEGATIVE_PID, has_start_probe } =
	process_identity_fixture

describe('process_identity.is_same_process — a pid is not a process identity', () => {
	it.skipIf(!has_start_probe)('recognizes this process by its own pid and start time', () => {
		expect(process_identity.is_same_process(process.pid, process_identity.own_start())).toBe(true)
	})

	// **The assertion this Issue was filed for.** The pid is live — it is this very process — and the
	// recorded start time belongs to some other process, which is precisely the state a reissued pid
	// leaves a marker in. Answering `true` here is what let the brief print "a gate is running".
	it.skipIf(!has_start_probe)('refuses a live pid the record did not name', () => {
		expect(process_identity.is_same_process(process.pid, FOREIGN_START)).toBe(false)
	})

	it.each([[DEAD_PID], [GROUP_PID], [NEGATIVE_PID]])(
		'answers false for pid %i, which no live process holds',
		(pid: number) => {
			expect(process_identity.is_same_process(pid, FOREIGN_START)).toBe(false)
		},
	)

	it('answers false when the record names no process at all', () => {
		expect(process_identity.is_same_process(undefined, FOREIGN_START)).toBe(false)
	})

	// **`undefined` is a third answer and not a soft `false`.** A record written before the start time
	// existed, or on a platform that cannot report one, is a live pid nobody can identify — and the two
	// callers resolve that in opposite directions, so it must reach them intact.
	it('answers undefined for a live pid whose record carries no start time', () => {
		expect(process_identity.is_same_process(process.pid, undefined)).toBeUndefined()
	})
})

describe('process_identity — reading a start time', () => {
	it('answers nothing for a pid no process holds', () => {
		expect(process_identity.read_start(DEAD_PID)).toBeUndefined()
	})

	// A process's own start time cannot change, and the probe costs a subprocess that every record
	// write would otherwise pay again — so the answer is read once and kept.
	it('answers the same start time for this process every time it is asked', () => {
		expect(process_identity.own_start()).toBe(process_identity.own_start())
	})
})

describe('process_identity.own_fields — the identity a record carries', () => {
	it('names this process', () => {
		expect(process_identity.own_fields().pid).toBe(process.pid)
	})

	// **Absent rather than `undefined` where the platform cannot answer.** Every reader treats a missing
	// key as "cannot tell", and an explicit `undefined` would be a different thing under
	// `exactOptionalPropertyTypes` while meaning the same thing on disk.
	it('carries a start time exactly when this platform can report one', () => {
		expect(Object.hasOwn(process_identity.own_fields(), 'process_start')).toBe(has_start_probe)
	})

	it.skipIf(!has_start_probe)('carries the start time the probe reports', () => {
		expect(process_identity.own_fields().process_start).toBe(process_identity.own_start())
	})
})
