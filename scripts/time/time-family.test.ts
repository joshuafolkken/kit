import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { cost_transcript, type SessionFile } from '#scripts/cost/cost-transcript'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { time_corpus } from './time-corpus'
import { time_family } from './time-family'
import { time_report, type TimeReport } from './time-report'
import { time_transcript_fixture as fixture } from './time-transcript-fixture'

const { CWD, ISSUE, BRANCH } = fixture
const MAIN_BRANCH = 'main'
const NO_INSTANT = 0
const SECOND_CALL_ID = 'b'
const OTHER_BRANCH = '999-elsewhere'
const HELD_UNIT = 'agent-held'
const UNIT_NAME = 'agent-a1'
const UNIT_ID = `parent/${UNIT_NAME}`

const state = { home: '' }

beforeEach(() => {
	state.home = mkdtempSync(path.join(tmpdir(), 'time-family-'))
	vi.spyOn(cost_transcript, 'transcript_directory').mockImplementation((cwd: string) =>
		path.join(state.home, cost_transcript.project_slug(cwd)),
	)
})

afterEach(() => {
	vi.restoreAllMocks()
})

function listing(): Array<SessionFile> {
	return cost_transcript.list_sessions(cost_transcript.transcript_directory(CWD))
}

function named(session_id: string): SessionFile {
	const found = listing().find((file) => file.session_id === session_id)

	if (found === undefined) throw new Error(`no transcript named ${session_id}`)

	return found
}

// One report per scope, built the way each scope builds its own, so the comparison below is of what
// a reader is actually shown rather than of an intermediate the two happen to share.
function session_report(session_id: string): TimeReport {
	const found = time_family.for_session(listing(), named(session_id))
	const window = time_family.window_of(found.spans)

	return time_report.build_report(session_id, {
		spans: found.spans,
		started_ms: window?.started_ms ?? NO_INSTANT,
		ended_ms: window?.ended_ms ?? NO_INSTANT,
	})
}

function issue_report(): TimeReport {
	const found = time_corpus.collect_issue_spans(CWD, ISSUE)
	const window = time_family.window_of(found.spans)

	return time_report.build_report('issue', {
		spans: found.spans,
		started_ms: window?.started_ms ?? NO_INSTANT,
		ended_ms: window?.ended_ms ?? NO_INSTANT,
	})
}

describe('time_family.window_of', () => {
	it('spans from the earliest start to the latest end', () => {
		const found = time_family.window_of([fixture.span('Read', 5, 2), fixture.span('Read', 9, 1)])

		expect(found).toStrictEqual({
			started_ms: 3 * fixture.MINUTE_MS,
			ended_ms: 9 * fixture.MINUTE_MS,
		})
	})

	// "Nothing was parsed" and "an interval of no length" are different answers, and only the second
	// one is a measurement.
	it('answers undefined for no span at all', () => {
		expect(time_family.window_of([])).toBeUndefined()
	})
})

describe('time_family.adjacency_window', () => {
	const held = { started_ms: fixture.ms(10), ended_ms: fixture.ms(20) }

	// The parent's minutes in front of a sibling unit are that sibling's run's handoff, not this one's.
	it('runs from the sibling in front to the sibling behind', () => {
		const found = time_family.adjacency_window(
			[held],
			[
				{ started_ms: fixture.ms(0), ended_ms: fixture.ms(5) },
				{ started_ms: fixture.ms(30), ended_ms: fixture.ms(40) },
			],
		)

		expect(found).toStrictEqual({ started_ms: fixture.ms(5), ended_ms: fixture.ms(30) })
	})

	// An only child has no sibling to bound it, so the bound is the whole transcript — which is why
	// the idle bound is applied beside this one rather than instead of it.
	it('is unbounded on the side with no sibling', () => {
		const found = time_family.adjacency_window([held], [])

		expect(found.started_ms).toBe(0)
		expect(found.ended_ms).toBe(Number.MAX_SAFE_INTEGER)
	})
})

// **Down** — the units of a session the run already reads (joshuafolkken/kit#1439, symptom 1).
describe('time_family on a unit forked on another branch', () => {
	// Run #1428's review agent recorded `main` throughout while the session that delegated it was on
	// the run's branch, so attribution by branch dropped exactly the transcript the work was in.
	it('claims a unit the session delegated while it was working on the issue', () => {
		fixture.write_session(state.home, 'parent', fixture.delegating_lines())
		fixture.write_unit(state.home, 'parent', UNIT_NAME, fixture.issue_lines(0, MAIN_BRANCH))

		const found = time_corpus.collect_issue_spans(CWD, ISSUE)

		expect(found.session_count).toBe(2)
		expect(found.spans).toHaveLength(2)
	})

	// The claim is the parent's attributed minutes, not parentage alone: a unit the parent ran outside
	// them belongs to whatever the parent was doing then.
	it('leaves out a unit that ran outside the minutes attributed to the issue', () => {
		fixture.write_session(state.home, 'parent', fixture.delegating_lines())
		fixture.write_unit(state.home, 'parent', UNIT_NAME, fixture.issue_lines(30, MAIN_BRANCH))

		expect(time_corpus.collect_issue_spans(CWD, ISSUE).session_count).toBe(1)
	})
})

function write_handoff(): void {
	fixture.write_session(state.home, 'parent', [
		fixture.josh_call_line(0, MAIN_BRANCH, 'pnpm josh doctor'),
		fixture.result_line(1, MAIN_BRANCH),
		fixture.prompt_line(2, MAIN_BRANCH),
		fixture.josh_call_line(3, MAIN_BRANCH, 'pnpm josh epic:next 1', SECOND_CALL_ID),
		fixture.result_line(4, MAIN_BRANCH, SECOND_CALL_ID),
	])
	fixture.write_unit(state.home, 'parent', UNIT_NAME, fixture.issue_lines(5))
}

function issue_commands(): Array<string> {
	return time_corpus.collect_issue_spans(CWD, ISSUE).spans.map((one) => one.josh_command)
}

// **Up** — the session that delegated a unit the run reads (joshuafolkken/kit#1439, symptom 2).
describe('time_family on a session that delegated the run', () => {
	// Run #1441 reported 45.2 minutes for a child whose real cost was 48.9: the handoff in front of it
	// and the teardown behind it are the parent's own spans, and no scope held them.
	it('adds the handoff the session ran in front of the unit', () => {
		write_handoff()

		expect(issue_commands()).toContain('josh epic:next')
	})

	// 170 minutes of a parent sitting at a prompt reached run #1441's 49 minutes when the sibling
	// bound was the only one. A human span is where the person was, so the handoff begins after it.
	it('stops the handoff at the idle time in front of it', () => {
		write_handoff()

		expect(issue_commands()).not.toContain('josh doctor')
	})
})

// The equality joshuafolkken/kit#1439 is measured by: the same run read two ways is the same run.
describe('time_family — the issue scope and the session scope of one run', () => {
	beforeEach(() => {
		fixture.write_session(state.home, 'parent', fixture.run_lines(0))
		fixture.write_unit(state.home, 'parent', UNIT_NAME, fixture.issue_lines(0, MAIN_BRANCH))
	})

	it('agrees on the segments', () => {
		expect(session_report('parent').segments).toStrictEqual(issue_report().segments)
	})

	it('agrees on the per-invocation table', () => {
		expect(session_report('parent').by_invocation).toStrictEqual(issue_report().by_invocation)
	})

	// Naming the unit is the other direction of the same union, and it answers about the same run.
	it('agrees when the unit is the transcript named', () => {
		expect(session_report(UNIT_ID).segments).toStrictEqual(issue_report().segments)
	})
})

describe('time_family on a transcript it could not read', () => {
	beforeEach(() => {
		fixture.write_session(state.home, 'parent', fixture.delegating_lines())
		fixture.write_unit(state.home, 'parent', UNIT_NAME, fixture.issue_lines(0, MAIN_BRANCH))
		vi.spyOn(cost_transcript, 'read_optional').mockReturnValue(undefined)
	})

	// A transcript nobody could read and one that cost nothing produce the same totals, and only the
	// count tells them apart.
	it('counts it as unmeasured rather than summing it in as zero', () => {
		const found = time_corpus.collect_issue_spans(CWD, ISSUE)

		expect(found.unread_count).toBe(1)
		expect(found.session_count).toBe(1)
	})

	// The session scope reaches the same state and used to fold it into an empty transcript, which is
	// the very answer the distinction was added to remove.
	it('names it in the session scope too', () => {
		expect(time_family.for_session(listing(), named('parent')).unread).toStrictEqual([
			UNIT_ID,
			'parent',
		])
	})

	// **The parent's own failure is not recorded when the named unit could not be read either**, because
	// `upward` has no unit window to bound the handoff by and returns before it reaches the parent. The
	// note then says one transcript where two failed. Asserted as it stands rather than left unsaid: with
	// the unit unreadable, nothing proves the parent belongs to this run at all.
	it('names it when the unit itself is the transcript named', () => {
		expect(time_family.for_session(listing(), named(UNIT_ID)).unread).toStrictEqual([UNIT_ID])
	})
})

describe('time_family on a run that never delegated', () => {
	// The whole of the "a run that never delegated reports exactly as it did" guarantee.
	it('adds nothing and reports nothing unread', () => {
		fixture.write_session(state.home, 'one', fixture.issue_lines(0))

		const found = time_corpus.collect_issue_spans(CWD, ISSUE)

		expect(found.spans).toHaveLength(2)
		expect(found.unread_count).toBe(0)
		expect(found.session_count).toBe(1)
	})
})

describe('time_family.for_session on a transcript with no family', () => {
	it('reports the named transcript alone', () => {
		fixture.write_session(state.home, 'one', fixture.issue_lines(0, BRANCH))

		const found = time_family.for_session(listing(), named('one'))

		expect(found.spans).toHaveLength(2)
		expect(found.unread).toStrictEqual([])
	})
})

// The concurrent-sibling subtraction (joshuafolkken/kit#1439). A sibling that overlaps the held unit
// moves the adjacency window not at all, so without this the parent's spans bracketing that sibling
// are taken whole into a run whose corpus holds nothing to subtract them.
describe('time_family on a sibling unit that ran beside the one this run holds', () => {
	beforeEach(() => {
		fixture.write_session(state.home, 'parent', [
			fixture.call_line(0, MAIN_BRANCH, 'Agent', 'g'),
			fixture.result_line(3, MAIN_BRANCH, 'g'),
			fixture.call_line(4, MAIN_BRANCH, 'Agent', 'h'),
			fixture.result_line(8, MAIN_BRANCH, 'h'),
		])
		fixture.write_unit(state.home, 'parent', HELD_UNIT, fixture.issue_lines(0))
		fixture.write_unit(state.home, 'parent', UNIT_NAME, fixture.issue_lines(2, OTHER_BRANCH))
	})

	it('leaves the parent minutes that bracket the sibling out of this run', () => {
		const found = time_corpus.collect_issue_spans(CWD, ISSUE)

		expect(fixture.total_span_ms(found.spans)).toBe(3 * fixture.MINUTE_MS)
	})

	// **A sibling read as empty is a sibling that bounds nothing.** Folding an unreadable transcript
	// to no spans drops it out of the window that bounds the handoff and out of the subtraction that
	// removes it, so the parent minutes bracketing it are charged to this run — measured at zero,
	// which is the answer this Issue exists to remove.
	it('reports an unreadable sibling rather than taking the parent minutes around it', () => {
		vi.spyOn(cost_transcript, 'read_optional').mockImplementation((file) =>
			file.session_id === UNIT_ID ? undefined : cost_transcript.read_raw(file),
		)

		const found = time_corpus.collect_issue_spans(CWD, ISSUE)

		expect(found.unread_count).toBe(1)
		expect(fixture.total_span_ms(found.spans)).toBe(3 * fixture.MINUTE_MS)
	})
})

// A unit whose spans all close on the same instant has a window of no length, and `uncovered_ms`
// answers zero for one of those whatever it is measured against — including nothing at all.
describe('time_family on a unit whose spans share one instant', () => {
	it('does not claim it for a session with no attributed minutes of its own', () => {
		fixture.write_session(state.home, 'parent', [
			fixture.call_line(0, MAIN_BRANCH, 'Agent', 'g'),
			fixture.result_line(3, MAIN_BRANCH, 'g'),
		])
		fixture.write_unit(state.home, 'parent', HELD_UNIT, fixture.issue_lines(0))
		fixture.write_unit(state.home, 'parent', UNIT_NAME, [
			fixture.call_line(20, OTHER_BRANCH, 'Glob', 'z'),
			fixture.result_line(20, OTHER_BRANCH, 'z'),
		])

		const labels = time_corpus.collect_issue_spans(CWD, ISSUE).spans.map((one) => one.label)

		expect(labels).not.toContain('Glob')
	})
})
