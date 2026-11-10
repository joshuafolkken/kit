import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import { lane_implement_signals } from './lane-implement-signals'
import { lane_implement_signals_record, type SignalsIo } from './lane-implement-signals-record'

// joshuafolkken/kit#6983: a lane's implement signals are written once, as its run first reaches the gate.

const ISSUE = '6983'

function io_of(events: ReadonlyArray<RunEvent>, emitted: Array<string>): SignalsIo {
	return {
		read: async () => await events,
		emit: async (_kind, text) => {
			emitted.push(text)
			await Promise.resolve()
		},
		calls: () => [],
		planned: () => [],
		root: '/repo',
	}
}

describe('lane_implement_signals_record.record', () => {
	it('writes the signals when the issue recorded none', async () => {
		const emitted: Array<string> = []

		await lane_implement_signals_record.record(ISSUE, io_of([], emitted))

		expect(emitted).toEqual([
			'#6983 signals edits=0 test-related=0 lint-related=0 investigations=0 unplanned=0',
		])
	})

	it('writes nothing twice', async () => {
		const emitted: Array<string> = []
		const text = 'any'
		const events = [
			{
				pos: 1,
				at: '2026-11-10T00:00:00.000Z',
				kind: lane_implement_signals.KIND,
				text: `#${ISSUE} signals edits=1 ${text}`,
			},
		]

		await lane_implement_signals_record.record(ISSUE, io_of(events, emitted))

		expect(emitted).toEqual([])
	})
})
