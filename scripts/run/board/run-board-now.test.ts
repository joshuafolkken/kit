import { run_event_setup } from '#scripts/run/event/run-event-setup'
import { describe, expect, it } from 'vitest'
import { run_board_now, type NowRead } from './run-board-now'
import type { RunActivity } from './run-board-status'

// joshuafolkken/kit#3749: the header's third line — what the run is doing now, in English words with
// no label, and never blank while the stream holds an event.

const SECOND = 1000
const MINUTE = 60 * SECOND
const NOW = Date.parse('2026-10-13T09:00:00.000Z')
const { STAGE } = run_event_setup
const JAPANESE = /[぀-ヿ一-鿿]/u
const LABEL = /^now\b/iu
const WATCHED_MS = 24 * MINUTE + 10 * SECOND
const DRAINED_LINE = 'backlog drained 24:10'

// The run at no stage, the newest thing it did `text`, `age_ms` ago.
function after(text: string, age_ms: number): RunActivity {
	const at_ms = NOW - age_ms

	return { last_event_ms: at_ms, is_stopped: false, latest: { text, at_ms }, idle_ms: at_ms }
}

// The run at `setup`, entered `age_ms` ago, after a merge.
function standing(setup: string, age_ms: number): RunActivity {
	return { ...after('#5 merged', age_ms + MINUTE), setup, setup_ms: NOW - age_ms }
}

function read(extra: Partial<NowRead> = {}): NowRead {
	return {
		now_ms: NOW,
		ended_ms: undefined,
		activity: after('#5 merged', WATCHED_MS),
		running: 0,
		waiting: 0,
		people: 0,
		...extra,
	}
}

function line_of(extra: Partial<NowRead> = {}): string {
	return run_board_now.line_of(read(extra))
}

describe('run_board_now.line_of at a stage', () => {
	it('writes the stage, how long the run has stood there, then what its plan has left', () => {
		const activity = standing(STAGE.SESSION, 72 * SECOND)

		expect(line_of({ activity, waiting: 2 })).toBe('judgment session running 1:12 — 2 waiting')
	})

	it('writes the running children as the reason while any run', () => {
		const activity = standing(STAGE.SESSION, SECOND)

		expect(line_of({ activity, running: 2, waiting: 3 })).toBe(
			'judgment session running 0:01 — 2 running',
		)
	})

	it('writes no reason before the plan is read, and no time where the stage has none', () => {
		const activity = { ...standing(STAGE.PLANNING, 0), setup_ms: undefined }

		expect(line_of({ activity, waiting: undefined })).toBe('planning')
	})
})

describe('run_board_now.line_of with no stage', () => {
	it('writes how many children run', () => {
		expect(line_of({ running: 3, waiting: 2 })).toBe('3 running')
	})

	it('writes how long the run has watched since the newest thing it did, and an empty pool', () => {
		expect(line_of()).toBe('watching 24:10 — pool empty')
	})

	// A judgment session's minutes are the run's own: the watch is counted from the stage's end, not
	// from the merge before it.
	it('counts the watch from the run’s own newest moment, not from its newest position', () => {
		const activity = { ...after('#5 merged', 22 * MINUTE), idle_ms: NOW - 2 * MINUTE }

		expect(line_of({ activity })).toBe('watching 2:00 — pool empty')
	})

	it('writes what the pool holds that the run cannot take', () => {
		expect(line_of({ waiting: 3, people: 1 })).toBe('watching 24:10 — 3 waiting')
	})

	it('writes a pool left only to people as waiting on a person', () => {
		expect(line_of({ waiting: 2, people: 2 })).toBe('watching 24:10 — 2 waiting on a person')
	})

	it('writes the watch alone before the plan is read', () => {
		expect(line_of({ waiting: undefined })).toBe('watching 24:10')
	})

	it('is blank only where the stream holds no event', () => {
		const activity = { last_event_ms: undefined, is_stopped: false }

		expect(line_of({ activity })).toBe('')
	})
})

describe('run_board_now.line_of once the run has stopped', () => {
	const STOPPED = { ...after('backlog drained', WATCHED_MS), is_stopped: true }

	it('keeps the newest thing the run did, aged to now while no end is recorded', () => {
		expect(line_of({ activity: STOPPED })).toBe(DRAINED_LINE)
	})

	it('stops the age at the run’s end', () => {
		expect(line_of({ activity: STOPPED, ended_ms: NOW - WATCHED_MS + MINUTE })).toBe(
			'backlog drained 1:00',
		)
	})

	it('writes the newest event rather than a stage the run stopped at', () => {
		const activity = { ...STOPPED, setup: STAGE.SESSION, setup_ms: NOW }

		expect(line_of({ activity, running: 1 })).toBe(DRAINED_LINE)
	})
})

describe('run_board_now.line_of — its words', () => {
	const LINES = [
		line_of(),
		line_of({ running: 1 }),
		line_of({ waiting: 2, people: 2 }),
		line_of({ activity: standing(STAGE.JUDGING, SECOND), waiting: 1 }),
	]

	it.each(LINES)('writes "%s" with no Japanese and no label', (line) => {
		expect(line).not.toMatch(JAPANESE)
		expect(line).not.toMatch(LABEL)
	})
})
