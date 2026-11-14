import { describe, expect, it, vi } from 'vitest'
import type { Admission } from './core-admission'
import { core_wait_record, type WaitSink } from './core-wait-record'

// joshuafolkken/kit#4382: what an admitted claim's wait records, and that a claim that never waited
// records nothing.

const CLAIMED_AT = 1000
const ADMITTED_AT = 4000
const WAITED_MS = ADMITTED_AT - CLAIMED_AT
const LANE = '4382'
const CPU_DEADLINE = 'cpu-deadline'

describe('core_wait_record.wait_of', () => {
	it('is the command, the wait and the lane of a claim that waited', () => {
		const claim = { command: 'lint', lane: LANE, wait_reason: 'cores', claimed_at: CLAIMED_AT }

		expect(core_wait_record.wait_of(claim, ADMITTED_AT)).toStrictEqual({
			command: 'lint',
			waited_ms: WAITED_MS,
			issue: Number(LANE),
		})
	})

	it('names no lane outside one, and an unnamed command as a step', () => {
		const claim = { wait_reason: 'pressure', claimed_at: CLAIMED_AT }

		expect(core_wait_record.wait_of(claim, ADMITTED_AT)).toStrictEqual({
			command: 'a step',
			waited_ms: WAITED_MS,
		})
	})

	it('is nothing for a claim that never waited', () => {
		expect(core_wait_record.wait_of({ claimed_at: CLAIMED_AT }, ADMITTED_AT)).toBeUndefined()
	})
})

describe('core_wait_record.record_admitted', () => {
	it('hands a wait to the sink', async () => {
		const sink = vi.fn<WaitSink>().mockResolvedValue(undefined)

		await core_wait_record.record_admitted(
			{ command: 'lint', wait_reason: 'cores', claimed_at: CLAIMED_AT },
			ADMITTED_AT,
			sink,
		)

		expect(sink).toHaveBeenCalledExactlyOnceWith({ command: 'lint', waited_ms: WAITED_MS })
	})

	it('hands nothing to the sink for a claim that never waited', async () => {
		const sink = vi.fn<WaitSink>().mockResolvedValue(undefined)

		await core_wait_record.record_admitted({ claimed_at: CLAIMED_AT }, ADMITTED_AT, sink)

		expect(sink).not.toHaveBeenCalled()
	})
})

function admission_fixture(overflows: boolean): Admission {
	const budget = { cores: 1, memory_mb: Infinity }
	const overflow = { waited_ms: WAITED_MS, ledger: { cores: 2, memory_mb: 0 }, budget }

	return {
		overflow: overflows ? overflow : undefined,
		granted: 1,
		waited_ms: WAITED_MS,
		decision: { reason: CPU_DEADLINE, budget, reading: { busy_cores: 1, available_mb: undefined } },
	}
}

describe('core_wait_record admission evidence', () => {
	it.each([false, true])(
		'records the decision and overflow=%s without losing the wait',
		(overflows) => {
			const claim = {
				command: 'lint',
				weight: 2,
				memory_mb: 0,
				claimed_at: CLAIMED_AT,
				wait_reason: 'cores',
			}
			const admission = admission_fixture(overflows)
			const record = core_wait_record.wait_of(claim, ADMITTED_AT, admission)

			expect(record).toMatchObject({
				command: 'lint',
				waited_ms: WAITED_MS,
				overflow: overflows,
				budget_cores: 1,
				admission_reason: CPU_DEADLINE,
				requested_cores: 2,
				granted_cores: 1,
				admission_waited_ms: WAITED_MS,
				wait_reason: 'cores',
			})
			expect(JSON.stringify(record)).not.toContain('budget_memory_mb')
		},
	)
})
