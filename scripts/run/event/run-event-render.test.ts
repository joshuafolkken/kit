import { describe, expect, it } from 'vitest'
import { run_event_render } from './run-event-render'
import { run_event_stream, type RunEvent } from './run-event-stream'

// joshuafolkken/kit#2492: the watch pane renders each event itself, in the session language, so no
// conversation has to relay it. The table covers every kind, and an unknown kind is shown, never dropped.

const AT = '2026-09-24T05:31:00.000Z'
const MERGE_TEXT = '#2489 merged'
const JA = 'ja'
const EN = 'en'

function event_of(kind: string, text: string): RunEvent {
	return { pos: 1, at: AT, kind, text }
}

function local_clock(at: string): string {
	const date = new Date(at)

	return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

describe('run_event_render.render — one line per event, in the session language', () => {
	it('renders a merge in Japanese with the local clock time', () => {
		const line = run_event_render.render(event_of('merge', MERGE_TEXT), JA)

		expect(line).toBe(`${local_clock(AT)} · マージ · ${MERGE_TEXT}`)
	})

	it('renders the same event in English for a non-Japanese session', () => {
		const line = run_event_render.render(event_of('merge', MERGE_TEXT), EN)

		expect(line).toBe(`${local_clock(AT)} · merged · ${MERGE_TEXT}`)
	})

	it('shows an unknown kind as written rather than dropping it', () => {
		const unknown_kind = 'future-kind'

		expect(run_event_render.label_of(unknown_kind, JA)).toBe(unknown_kind)
	})

	it('shows an unparseable stamp as written rather than NaN', () => {
		const unparseable = 'not a time'

		expect(run_event_render.clock_of(unparseable)).toBe(unparseable)
	})
})

describe('run_event_render — every stream kind has a label in both languages', () => {
	it.each(run_event_stream.EVENT_KINDS)('labels %s', (kind) => {
		expect(run_event_render.label_of(kind, JA)).not.toBe(kind)
		expect(run_event_render.label_of(kind, EN).length).toBeGreaterThan(0)
	})
})
