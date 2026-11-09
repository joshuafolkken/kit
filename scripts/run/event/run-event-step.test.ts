import { describe, expect, it, vi, type Mock } from 'vitest'
import { run_event_step, type StepIo } from './run-event-step'
import { run_event_stream, type RunEvent } from './run-event-stream'

// joshuafolkken/kit#6598: one `step` event per change of an issue's fullrun step.

const { STEP, record, text_of, words_of, name_of } = run_event_step
const KIND = run_event_stream.EVENT_KIND
const ISSUE = '7'
const GATE_TEXT = '#7 step 6/8 gate'

function event_of(kind: string, text: string): RunEvent {
	return { pos: 1, at: '2026-11-10T09:00:00.000Z', kind, text }
}

function io_over(events: ReadonlyArray<RunEvent>): StepIo & { emit: Mock<StepIo['emit']> } {
	return { read: vi.fn(async () => await events), emit: vi.fn<StepIo['emit']>() }
}

describe('run_event_step text', () => {
	it('names the issue, the step out of the total and its name', () => {
		expect(text_of(ISSUE, STEP.GATE)).toBe(GATE_TEXT)
	})

	it('reads back the words after the issue and the name after the count', () => {
		const event = event_of(KIND.STEP, text_of(ISSUE, STEP.UPDATE_DEPS))

		expect(words_of(event)).toBe('step 4/8 update-deps')
		expect(name_of(event)).toBe('update-deps')
	})
})

describe('run_event_step.record', () => {
	it('writes the step when the issue has none yet', async () => {
		const io = io_over([])

		await record(ISSUE, STEP.IMPLEMENT, io)

		expect(io.emit).toHaveBeenCalledWith(KIND.STEP, '#7 step 5/8 implement')
	})

	it('does not write the step again while it is the issue’s newest', async () => {
		const io = io_over([
			event_of(KIND.STEP, text_of(ISSUE, STEP.IMPLEMENT)),
			event_of(KIND.LANE_PHASE, '#7 implement'),
		])

		await record(ISSUE, STEP.IMPLEMENT, io)

		expect(io.emit).not.toHaveBeenCalled()
	})

	it('writes a changed step, reading only the issue’s own step events', async () => {
		const io = io_over([
			event_of(KIND.STEP, text_of(ISSUE, STEP.IMPLEMENT)),
			event_of(KIND.STEP, text_of('8', STEP.GATE)),
		])

		await record(ISSUE, STEP.GATE, io)

		expect(io.emit).toHaveBeenCalledWith(KIND.STEP, GATE_TEXT)
	})
})
