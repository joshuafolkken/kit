import { lane_yield } from '#scripts/lane/lane-yield'
import { run_event_retry } from '#scripts/run/event/run-event-retry'
import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import { run_add_withdrawn } from './run-add-withdrawn'

// joshuafolkken/kit#8619: `run:add --retry --withdrawn` stands for the issues a person withdrew from
// the live run and nobody launched again, each with its withdrawal's reason.

const AT = '2026-11-22T00:00:00.000Z'
const WITHDRAWN = 8449
const OTHER = 8353
const REASON = 'replaced by #8600'

function event(kind: string, text: string): RunEvent {
	return { pos: 0, at: AT, kind, text }
}

function withdraw(issue: number, reason = REASON): RunEvent {
	return event('withdraw', `#${String(issue)} withdrawn by a person: ${reason}`)
}

function launch(issue: number): RunEvent {
	return event('child-launch', `#${String(issue)} dispatched`)
}

// The targets of a stream holding `events` in order, each at its stream position.
function targets_of(...events: ReadonlyArray<RunEvent>): ReadonlyArray<number> {
	return run_add_withdrawn.targets(events.map((each, pos) => ({ ...each, pos })))
}

describe('run_add_withdrawn.targets', () => {
	it('names every issue a person withdrew and nobody launched again', () => {
		const events = [launch(WITHDRAWN), launch(OTHER), withdraw(WITHDRAWN), withdraw(OTHER)]

		expect(targets_of(...events)).toStrictEqual([WITHDRAWN, OTHER])
	})

	it('leaves out an issue launched again after its withdrawal', () => {
		expect(targets_of(launch(WITHDRAWN), withdraw(WITHDRAWN), launch(WITHDRAWN))).toStrictEqual([])
	})

	it('leaves out a lane that yielded its plan', () => {
		const note = event('note', `#${String(OTHER)} yielded its lane: #1 holds a.ts · at: entry`)
		const yielded = event(
			'withdraw',
			`#${String(OTHER)} withdrawn by ${lane_yield.YIELD_TEXT.name}: ${lane_yield.YIELD_REASON}`,
		)

		expect(targets_of(launch(OTHER), note, yielded)).toStrictEqual([])
	})

	it('leaves out an issue a retry already re-admitted', () => {
		const retried = event('add', run_event_retry.text_of(WITHDRAWN))

		expect(targets_of(launch(WITHDRAWN), withdraw(WITHDRAWN), retried)).toStrictEqual([])
	})
})

describe('run_add_withdrawn.suffix_of', () => {
	it('reads the latest withdrawal reason after its prefix', () => {
		const events = [withdraw(WITHDRAWN, 'first'), withdraw(WITHDRAWN)]

		expect(run_add_withdrawn.suffix_of(events, WITHDRAWN)).toBe(` · withdrawn: ${REASON}`)
	})

	it('marks the line withdrawn when no reason was recorded', () => {
		expect(run_add_withdrawn.suffix_of([], WITHDRAWN)).toBe(' · withdrawn')
	})
})
