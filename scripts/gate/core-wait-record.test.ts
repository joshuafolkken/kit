import { describe, expect, it, vi } from 'vitest'
import { core_wait_record, type WaitSink } from './core-wait-record'

// joshuafolkken/kit#4382: what an admitted claim's wait records, and that a claim that never waited
// records nothing.

const CLAIMED_AT = 1000
const ADMITTED_AT = 4000
const WAITED_MS = ADMITTED_AT - CLAIMED_AT
const LANE = '4382'

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
