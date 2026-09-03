import { describe, expect, it } from 'vitest'
import { time_duplicate, type SessionSpans } from './time-duplicate'
import type { Span } from './time-spans'
import { time_transcript_fixture as fixture } from './time-transcript-fixture'

const { span } = fixture

function map_of(spans: ReadonlyArray<Span>): Map<string, Span> {
	return new Map(spans.map((one) => [time_duplicate.span_key(one), one]))
}

// Returns the id it was given, so each test names a session once and refers to it by the binding.
function add(
	sessions: Map<string, SessionSpans>,
	session_id: string,
	own: ReadonlyArray<Span>,
	delegated: ReadonlyArray<Span> = [],
): string {
	sessions.set(session_id, { own: map_of(own), delegated: map_of(delegated) })

	return session_id
}

function labels_of(assigned: ReadonlyMap<string, SessionSpans>, session_id: string): Array<string> {
	const found = assigned.get(session_id)?.own ?? new Map<string, Span>()

	return [...found].map(([, one]) => one.label)
}

// The defect this module exists for: the original session's `Agent` span is covered by the units and
// trimmed away, while the copy in the resumed session survives whole and is counted beside them.
describe('time_duplicate.assign_duplicates — the session whose units cover the span', () => {
	it('gives a duplicated span to the session whose units account for those minutes', () => {
		const agent = span('Agent', 3, 3)
		const sessions = new Map<string, SessionSpans>()

		const resumed = add(sessions, 'resumed', [agent])
		const original = add(sessions, 'original', [agent], [span('Read', 3, 3)])
		const assigned = time_duplicate.assign_duplicates(sessions)

		expect(labels_of(assigned, original)).toStrictEqual(['Agent'])
		expect(labels_of(assigned, resumed)).toStrictEqual([])
	})

	// `list_sessions` is newest-first, so the resumed transcript is walked first and a naive first-wins
	// hands it exactly the copy it must not keep.
	it('does not hand the duplicate to whichever session was walked first', () => {
		const agent = span('Agent', 3, 3)
		const sessions = new Map<string, SessionSpans>()

		const original = add(sessions, 'original', [agent], [span('Read', 3, 3)])

		add(sessions, 'resumed', [agent])

		const assigned = time_duplicate.assign_duplicates(sessions)

		expect(labels_of(assigned, original)).toStrictEqual(['Agent'])
	})

	// Both sessions delegated, so "does it have units at all" answers the same for each and would leave
	// the session id to decide by chance. `later`'s unit runs after the copied span and covers none of
	// it, so it must not take it.
	it('ranks by how much of the span the units cover, not by whether there are units', () => {
		const agent = span('Agent', 3, 3)
		const sessions = new Map<string, SessionSpans>()

		const later = add(sessions, 'a-later', [agent], [span('Edit', 9, 3)])
		const original = add(sessions, 'b-original', [agent], [span('Read', 3, 3)])
		const assigned = time_duplicate.assign_duplicates(sessions)

		expect(labels_of(assigned, original)).toStrictEqual(['Agent'])
		expect(labels_of(assigned, later)).toStrictEqual([])
	})
})

describe('time_duplicate.assign_duplicates — when no unit covers the span', () => {
	// The plain resume, which is the common shape. The totals do not depend on which side keeps it, but
	// the answer still has to be the same on every run.
	it('gives the duplicate to the earliest-starting session', () => {
		const shared = span('Read', 8, 2)
		const sessions = new Map<string, SessionSpans>()

		const later = add(sessions, 'later', [shared, span('Edit', 12, 2)])
		const earlier = add(sessions, 'earlier', [shared, span('Write', 4, 4)])
		const assigned = time_duplicate.assign_duplicates(sessions)

		expect(labels_of(assigned, earlier)).toContain('Read')
		expect(labels_of(assigned, later)).not.toContain('Read')
	})

	// A session begins when its first transcript line was written, and a unit's transcript is one of
	// those. Reading only the own spans would date this session from minute 8 and hand the copy to the
	// session that merely wrote its own first line earlier.
	it('dates a session from its units too, not only from its own spans', () => {
		const shared = span('Read', 9, 1)
		const sessions = new Map<string, SessionSpans>()

		const own_first = add(
			sessions,
			'a-own-first',
			[shared, span('Edit', 7, 2)],
			[span('Bash: git', 3, 1)],
		)
		const units_first = add(sessions, 'b-units-first', [shared], [span('Write', 4, 4)])
		const assigned = time_duplicate.assign_duplicates(sessions)

		expect(labels_of(assigned, units_first)).toContain('Read')
		expect(labels_of(assigned, own_first)).not.toContain('Read')
	})
})

describe('time_duplicate.assign_duplicates — what it leaves alone', () => {
	// A run that never resumed anything must report exactly as it did before.
	it('is the identity when no span appears in two sessions', () => {
		const sessions = new Map<string, SessionSpans>()

		add(sessions, 'one', [span('Read', 4, 4)])
		add(sessions, 'two', [span('Edit', 9, 1)], [span('Bash: pnpm', 8, 2)])

		expect(time_duplicate.assign_duplicates(sessions)).toStrictEqual(sessions)
	})

	// A unit transcript that was itself copied must not contribute twice either, so a session's units
	// stake the same claim its own spans do.
	it('assigns a span duplicated between two sessions units to one of them', () => {
		const shared = span('Read', 3, 3)
		const sessions = new Map<string, SessionSpans>()

		add(sessions, 'one', [], [shared])
		add(sessions, 'two', [], [shared])

		const assigned = time_duplicate.assign_duplicates(sessions)

		expect([...assigned].filter(([, found]) => found.delegated.size > 0)).toHaveLength(1)
	})
})
