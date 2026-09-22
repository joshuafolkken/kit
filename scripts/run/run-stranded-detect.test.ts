import { describe, expect, it, vi } from 'vitest'
import type { CarryRead, RunCarry } from './run-carry'
import { run_stranded } from './run-stranded'
import { run_stranded_detect, type DetectPorts } from './run-stranded-detect'
import type { RunWake } from './run-wake'

const NONE = 0
const A_PID = 4242
const STARTED_AT = '2026-09-22T09:19:34.569Z'
const CARRY_TARGET = 'josh-run-carry-owner-repo.json'
const WAKE_TARGET = 'josh-run-wake-owner-repo.json'

function carry(overrides: Partial<RunCarry> = {}): RunCarry {
	return {
		invocation: 'backlogrun',
		started_at: STARTED_AT,
		merged: NONE,
		filed: NONE,
		cuts: NONE,
		failures: NONE,
		outages: NONE,
		is_handed_off: true,
		owner_pid: A_PID,
		owner_start: 'Tue Sep 22 10:33:08 2026',
		...overrides,
	}
}

function wake(): RunWake {
	return {
		invocation: 'backlogrun',
		started_at: STARTED_AT,
		pid: A_PID,
		woke: NONE,
	}
}

// The stranded default: the record is carried and handed off, the owner is gone, and no supervisor is
// watching — the exact state the run this fixes was left in.
function ports(overrides: Partial<DetectPorts>): DetectPorts {
	return {
		resolve_targets: async () => ({ carry: CARRY_TARGET, wake: WAKE_TARGET }),
		read_carry: (): CarryRead => ({ kind: 'carried', carry: carry() }),
		is_owner_live: () => false,
		read_wake: () => undefined,
		supervisor_liveness: () => run_stranded.GONE,
		emit_stranded: async () => true,
		notify_stranded: async () => true,
		...overrides,
	}
}

describe('run_stranded_detect.detect_and_report', () => {
	it('reports a strand and fires both side effects when handed off, owner gone, no supervisor', async () => {
		const emit_stranded = vi.fn(async () => true)
		const notify_stranded = vi.fn(async () => true)

		const verdict = await run_stranded_detect.detect_and_report(
			ports({ emit_stranded, notify_stranded }),
		)

		expect(verdict).toBe(run_stranded.STRANDED)
		expect(emit_stranded).toHaveBeenCalledOnce()
		expect(notify_stranded).toHaveBeenCalledOnce()
	})

	it('holds the notification back when the marker was a duplicate', async () => {
		const notify_stranded = vi.fn(async () => true)

		const verdict = await run_stranded_detect.detect_and_report(
			ports({ emit_stranded: async () => false, notify_stranded }),
		)

		expect(verdict).toBe(run_stranded.STRANDED)
		expect(notify_stranded).not.toHaveBeenCalled()
	})
})

describe('run_stranded_detect.detect_and_report — no strand', () => {
	it('reports ok, with no side effects, when the owner is still alive', async () => {
		const emit_stranded = vi.fn(async () => true)

		const verdict = await run_stranded_detect.detect_and_report(
			ports({ is_owner_live: () => true, emit_stranded }),
		)

		expect(verdict).toBe(run_stranded.OK)
		expect(emit_stranded).not.toHaveBeenCalled()
	})

	it('reports ok, reading no wake record, when nothing is carried', async () => {
		const read_wake = vi.fn(() => undefined)

		const verdict = await run_stranded_detect.detect_and_report(
			ports({ read_carry: () => ({ kind: 'none' }), read_wake }),
		)

		expect(verdict).toBe(run_stranded.OK)
		expect(read_wake).not.toHaveBeenCalled()
	})

	it('reports ok, with no side effects, when the carry record is unreadable', async () => {
		const emit_stranded = vi.fn(async () => true)

		const verdict = await run_stranded_detect.detect_and_report(
			ports({ read_carry: () => ({ kind: 'unreadable' }), emit_stranded }),
		)

		expect(verdict).toBe(run_stranded.OK)
		expect(emit_stranded).not.toHaveBeenCalled()
	})

	it('reports ok, with no side effects, when the run tree will not resolve', async () => {
		const emit_stranded = vi.fn(async () => true)

		const verdict = await run_stranded_detect.detect_and_report(
			ports({ resolve_targets: async () => undefined, emit_stranded }),
		)

		expect(verdict).toBe(run_stranded.OK)
		expect(emit_stranded).not.toHaveBeenCalled()
	})
})

describe('run_stranded_detect.detect_and_report — supervision present', () => {
	// The supervisor being present and alive keeps the run from reading as stranded — recovery is in
	// flight, not needed.
	it('reports ok when a live supervisor is watching the handed-off record', async () => {
		const notify_stranded = vi.fn(async () => true)
		const watched = ports({
			read_wake: () => wake(),
			supervisor_liveness: () => run_stranded.LIVE,
			notify_stranded,
		})

		const verdict = await run_stranded_detect.detect_and_report(watched)

		expect(verdict).toBe(run_stranded.OK)
		expect(notify_stranded).not.toHaveBeenCalled()
	})
})
