import { release_scope_cli } from '#scripts/release/release-scope-cli'
import { describe, expect, it } from 'vitest'
import { run_event_stream, type RunEvent } from './run-event-stream'
import { run_report } from './run-report'

// joshuafolkken/kit#2249: the report generated from the run's event stream. The generator is pure — it
// takes the events and the release verdict and returns a string — so the tests hand it fixed inputs and
// pin the string. The criteria pinned here: the same events return the same text (determinism), each
// event is `format_event`'s own line so parks carry their reason, and the release tail is present with the
// command on `required`, distinct on `unknown`, and absent on `skip`.

const KIND = run_event_stream.EVENT_KIND
const AT = '2026-09-21T00:00:00.000Z'
const PARK_TEXT = '#8 parked (needs-decision)'

function event(pos: number, kind: string, text: string): RunEvent {
	return { pos, at: AT, kind, text }
}

const CUT_EVENT = event(3, KIND.CUT, 'cut at the pre-gate boundary')
const EVENTS: ReadonlyArray<RunEvent> = [
	event(1, KIND.MERGE, '#7 merged'),
	event(2, KIND.PARK, PARK_TEXT),
	CUT_EVENT,
]

const SKIP = release_scope_cli.decide(0)
const REQUIRED = release_scope_cli.decide(3)
const UNKNOWN = release_scope_cli.decide(undefined)

describe('run_report.build_report — determinism', () => {
	it('returns the same text for the same events and verdict', () => {
		const first = run_report.build_report({ events: EVENTS, release: SKIP })
		const second = run_report.build_report({ events: EVENTS, release: SKIP })

		expect(first).toBe(second)
	})
})

describe('run_report.build_report — enumeration', () => {
	it('renders each event as its format_event line, so a park carries its reason', () => {
		const report = run_report.build_report({ events: EVENTS, release: SKIP })

		for (const one of EVENTS) expect(report).toContain(run_event_stream.format_event(one))
		expect(report).toContain(PARK_TEXT)
	})
})

describe('run_report.build_report — the retrospective result', () => {
	// joshuafolkken/kit#2342: the retrospective's result is one more event on the stream, so the report
	// generated from the stream carries its line without a second format — including a zero-filing result,
	// the case that needs the record.
	it('renders a zero-filing retrospective event as its own line', () => {
		const RETRO_TEXT = '0 filed; dropped #2240 already merged'
		const events = [...EVENTS, event(4, KIND.RETROSPECTIVE, RETRO_TEXT)]

		const report = run_report.build_report({ events, release: SKIP })

		expect(report).toContain(RETRO_TEXT)
	})
})

describe('run_report.build_report — release tail', () => {
	it('closes with the request and the exact command on required', () => {
		const report = run_report.build_report({ events: EVENTS, release: REQUIRED })

		expect(report.endsWith(REQUIRED.reason)).toBe(true)
		expect(report).toContain(release_scope_cli.RELEASE_HINT)
	})

	it('says unknown and stays distinct from skip, never rounding to it', () => {
		const unknown = run_report.build_report({ events: EVENTS, release: UNKNOWN })
		const skip = run_report.build_report({ events: EVENTS, release: SKIP })

		expect(unknown).toContain(release_scope_cli.UNKNOWN_REASON)
		expect(unknown).not.toBe(skip)
	})

	it('appends no tail line on skip', () => {
		const report = run_report.build_report({ events: EVENTS, release: SKIP })
		const last = run_event_stream.format_event(CUT_EVENT)

		expect(report.endsWith(last)).toBe(true)
	})
})
