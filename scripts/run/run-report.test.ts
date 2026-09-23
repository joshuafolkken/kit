import { release_scope_cli } from '#scripts/release/release-scope-cli'
import { describe, expect, it } from 'vitest'
import { run_event_scope, type EventScope } from './run-event-scope'
import { run_event_stream, type RunEvent } from './run-event-stream'
import { run_report } from './run-report'

// joshuafolkken/kit#2249: the report generated from the run's event stream. The generator is pure — it
// takes the events and the release verdict and returns a string — so the tests hand it fixed inputs and
// pin the string. The criteria pinned here: the same events return the same text (determinism), each
// event is `format_event`'s own line so parks carry their reason, and the release tail is present with the
// command on `required`, distinct on `unknown`, and absent on `skip`.
//
// joshuafolkken/kit#2393 adds the scope. The stream outlives the invocation, so the boundary is pinned here
// rather than trusted to stay wired — #2308 filed the same defect and closed with no fix, which is the whole
// reason a regression test exists for it.

const KIND = run_event_stream.EVENT_KIND
const AT = '2026-09-21T00:00:00.000Z'
const PARK_TEXT = '#8 parked (needs-decision)'
const NOT_A_TIME = 'not-a-time'

function since(started_at: string): EventScope {
	return { kind: 'since', started_at }
}

const SCOPE = since(AT)

function event(pos: number, kind: string, text: string): RunEvent {
	return { pos, at: AT, kind, text }
}

function event_at(pos: number, kind: string, text: string, at: string): RunEvent {
	return { pos, at, kind, text }
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
		const first = run_report.build_report({ events: EVENTS, release: SKIP, scope: SCOPE })
		const second = run_report.build_report({ events: EVENTS, release: SKIP, scope: SCOPE })

		expect(first).toBe(second)
	})
})

describe('run_report.build_report — enumeration', () => {
	it('renders each event as its format_event line, so a park carries its reason', () => {
		const report = run_report.build_report({ events: EVENTS, release: SKIP, scope: SCOPE })

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

		const report = run_report.build_report({ events, release: SKIP, scope: SCOPE })

		expect(report).toContain(RETRO_TEXT)
	})
})

describe('run_report.build_report — release tail', () => {
	it('closes with the request and the exact command on required', () => {
		const report = run_report.build_report({ events: EVENTS, release: REQUIRED, scope: SCOPE })

		expect(report.endsWith(REQUIRED.reason)).toBe(true)
		expect(report).toContain(release_scope_cli.RELEASE_HINT)
	})

	it('says unknown and stays distinct from skip, never rounding to it', () => {
		const unknown = run_report.build_report({ events: EVENTS, release: UNKNOWN, scope: SCOPE })
		const skip = run_report.build_report({ events: EVENTS, release: SKIP, scope: SCOPE })

		expect(unknown).toContain(release_scope_cli.UNKNOWN_REASON)
		expect(unknown).not.toBe(skip)
	})

	it('appends no tail line on skip', () => {
		const report = run_report.build_report({ events: EVENTS, release: SKIP, scope: SCOPE })
		const last = run_event_stream.format_event(CUT_EVENT)

		expect(report.endsWith(last)).toBe(true)
	})
})

// joshuafolkken/kit#2393: the scope. The observed body carried a merge from two days earlier, so the
// fixture is that shape — one event from a previous invocation ahead of this one's.
const EARLIER_TEXT = '#2216 merged'
const EARLIER = event_at(0, KIND.MERGE, EARLIER_TEXT, '2026-09-19T18:00:14.732Z')
const MIXED: ReadonlyArray<RunEvent> = [EARLIER, ...EVENTS]
const MERGE_TEXT = '#7 merged'

describe('run_report.build_report — the invocation scope', () => {
	it('renders no event from before the invocation began', () => {
		const report = run_report.build_report({ events: MIXED, release: SKIP, scope: SCOPE })

		expect(report).not.toContain(EARLIER_TEXT)
		expect(report).toContain(MERGE_TEXT)
	})

	it('keeps both sides of a cut, since the start time survives the cut unchanged', () => {
		const after_cut = event_at(4, KIND.MERGE, '#9 merged', '2026-09-21T06:00:00.000Z')

		const report = run_report.build_report({
			events: [...EVENTS, after_cut],
			release: SKIP,
			scope: SCOPE,
		})

		expect(report).toContain(MERGE_TEXT)
		expect(report).toContain(run_event_stream.format_event(CUT_EVENT))
		expect(report).toContain('#9 merged')
	})

	it('drops an event whose own timestamp cannot be read', () => {
		const corrupt_text = '#11 merged'
		const corrupt = event_at(5, KIND.MERGE, corrupt_text, NOT_A_TIME)

		const report = run_report.build_report({
			events: [...EVENTS, corrupt],
			release: SKIP,
			scope: SCOPE,
		})

		expect(report).not.toContain(corrupt_text)
		expect(report).toContain(MERGE_TEXT)
	})
})

// The undetermined scope is its own group: what it must *not* do is fall back to the whole stream, which is
// the rounding #2308 named and #2393 saw again.
describe('run_report.build_report — an undetermined scope', () => {
	it('prints the notice rather than the whole stream', () => {
		const report = run_report.build_report({
			events: MIXED,
			release: SKIP,
			scope: run_event_scope.UNKNOWN_EVENT_SCOPE,
		})

		expect(report).toContain(run_report.UNKNOWN_SCOPE_NOTICE)
		expect(report).not.toContain(EARLIER_TEXT)
		expect(report).not.toContain(MERGE_TEXT)
	})

	it('reads a start time that is not a time as undetermined, never as everything', () => {
		const report = run_report.build_report({
			events: MIXED,
			release: SKIP,
			scope: since(NOT_A_TIME),
		})

		expect(report).toContain(run_report.UNKNOWN_SCOPE_NOTICE)
		expect(report).not.toContain(EARLIER_TEXT)
	})
})

// The scope derivation itself (`scope_of`) and its undetermined answers are pinned in
// `run-event-scope.test.ts`, its single-source home (joshuafolkken/kit#2395); this file pins how the report
// renders a scope, not how the scope is derived.

// The harm the scope removes: the observed body was 138 events and 11,689 bytes, and Telegram rejected it for
// length. The fixture is that stream — 138 events of which 40 are this invocation's — so the byte count
// measures the scope rather than `format_event`'s line length: unscoped, the same input is over the limit.
const TELEGRAM_BODY_LIMIT_BYTES = 4096
const OBSERVED_STREAM_EVENTS = 138
const BUSY_INVOCATION_EVENTS = 40
const FIRST_ISSUE_NUMBER = 2300

function observed_stream(): ReadonlyArray<RunEvent> {
	return Array.from({ length: OBSERVED_STREAM_EVENTS }, (_unused, index) => {
		const text = `#${String(FIRST_ISSUE_NUMBER + index)} merged`

		return index < OBSERVED_STREAM_EVENTS - BUSY_INVOCATION_EVENTS
			? event_at(index, KIND.MERGE, text, EARLIER.at)
			: event(index, KIND.MERGE, text)
	})
}

describe('run_report.build_report — the Telegram body', () => {
	it('keeps a whole busy invocation inside the Telegram body limit', () => {
		const report = run_report.build_report({
			events: observed_stream(),
			release: REQUIRED,
			scope: SCOPE,
		})

		expect(new TextEncoder().encode(report).length).toBeLessThan(TELEGRAM_BODY_LIMIT_BYTES)
	})

	it('measures the scope, since the same stream unscoped is over the limit', () => {
		const whole = observed_stream()
			.map((one) => run_event_stream.format_event(one))
			.join('\n')

		expect(new TextEncoder().encode(whole).length).toBeGreaterThan(TELEGRAM_BODY_LIMIT_BYTES)
	})
})
