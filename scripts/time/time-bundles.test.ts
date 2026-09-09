import { describe, expect, it } from 'vitest'
import { time_bundles } from './time-bundles'
import { time_span_fixture } from './time-span-fixture'
import { time_spans, type Span } from './time-spans'

const MODEL = time_span_fixture.span(time_spans.MODEL_CATEGORY)
const HUMAN = time_span_fixture.span(time_spans.HUMAN_CATEGORY)
const PRICE = { round_trip_count: 6, model_ms_per_round_trip: 8800 }
// The assistant message a turn's spans all carry (joshuafolkken/kit#1406).
const TURN = 'msg-1'

// One call of a single-call turn. The two fields the grouping reads are the two `time-bundle-call.ts`
// puts on the span; everything else about it is the shared fixture's.
function call(targets: Array<string>, is_bundleable = true, is_writing = false): Span {
	return {
		...time_span_fixture.span(time_spans.TOOL_CATEGORY),
		is_bundleable,
		targets,
		is_writing,
	}
}

// An edit of one file, which is the call the whole of joshuafolkken/kit#1509 is about.
function edit(target: string): Span {
	return call([target], true, true)
}

// The same call, tagged with the turn that issued it (joshuafolkken/kit#1406).
function call_of(message_id: string, target: string): Span {
	return { ...call([target]), message_id }
}

// A turn that composed and then issued one call, which is the pair the walk reads as one round trip.
function turn_of(message_id: string, target: string): Array<Span> {
	return [{ ...MODEL, message_id }, call_of(message_id, target)]
}

// The same call, named with the tool that issued it — which is what the per-tool breakdown keys on
// (joshuafolkken/kit#1607). The cases above leave the label empty on purpose: an unnamed call is what
// the breakdown reports as unattributed rather than as a bucket.
function named_call(label: string, target: string): Span {
	return { ...call([target]), label }
}

// A run of consecutive single-call turns, one per pair — the shape every attribution case is built
// from, so a case reads as its labels rather than as a span list.
function named_turns(calls: ReadonlyArray<[string, string]>): Array<Span> {
	return calls.flatMap(([label, target]) => [MODEL, named_call(label, target)])
}

const EDIT = 'Edit'
const READ = 'Read'
const GREP = 'Bash: grep'

// Sharing a target is a proxy for "the later call needed the earlier one's result". These four cases
// are the whole of what the proxy now says (joshuafolkken/kit#1509).
describe('time_bundles.is_dependent — what sharing a target is evidence of', () => {
	const READS = { targets: ['a.ts'], is_writing: false }
	const WRITES = { targets: ['a.ts'], is_writing: true }

	it('reads two writes of one file as independent', () => {
		expect(time_bundles.is_dependent(WRITES, WRITES)).toBe(false)
	})

	it('reads a write after a read of one file as dependent', () => {
		expect(time_bundles.is_dependent(READS, WRITES)).toBe(true)
	})

	it('reads a read after a write of one file as dependent', () => {
		expect(time_bundles.is_dependent(WRITES, READS)).toBe(true)
	})

	it('reads two calls naming different files as independent however they touch them', () => {
		expect(time_bundles.is_dependent(WRITES, { targets: ['b.ts'], is_writing: true })).toBe(false)
	})
})

describe('time_bundles.build_bundles — what counts as a sequence', () => {
	it('reads consecutive single-call turns with disjoint targets as one sequence', () => {
		const spans = [MODEL, call(['a.ts']), MODEL, call(['b.ts']), MODEL, call(['c.ts'])]
		const totals = time_bundles.build_bundles(spans)

		expect(totals.sequence_count).toBe(1)
		expect(totals.longest_sequence).toBe(3)
		expect(totals.recoverable_round_trips).toBe(2)
	})

	// A person typing means the second turn was composed after an interruption, so the two calls could
	// never have gone out together however independent they look.
	it('breaks a sequence at a human wait', () => {
		const spans = [MODEL, call(['a.ts']), HUMAN, call(['b.ts'])]

		expect(time_bundles.build_bundles(spans).recoverable_round_trips).toBe(0)
	})

	// A turn that already batched is the improvement, not the defect, so it is not folded in.
	it('breaks a sequence at a turn that issued several calls', () => {
		const spans = [MODEL, call(['a.ts']), MODEL, call(['b.ts']), call(['c.ts']), MODEL]

		expect(time_bundles.build_bundles(spans).recoverable_round_trips).toBe(0)
	})

	it('breaks a sequence at a call that is not bundleable', () => {
		const spans = [MODEL, call(['a.ts']), MODEL, call(['b.ts'], false), MODEL, call(['c.ts'])]

		expect(time_bundles.build_bundles(spans).recoverable_round_trips).toBe(0)
	})
})

describe('time_bundles.build_bundles — a run touching one file', () => {
	// **The case joshuafolkken/kit#1509 was filed for.** Before the fix, sharing a target flushed the
	// sequence whatever the two calls were, so a stretch of single-call turns all editing one file
	// could never take the run past a length of 1 — and the guard, which needs 2, stayed silent for a
	// whole run. A second edit needs nothing from the first: the text is already held.
	it('reads consecutive single-call edits of one file as one sequence', () => {
		const spans = [MODEL, edit('a.ts'), MODEL, edit('a.ts'), MODEL, edit('a.ts')]
		const totals = time_bundles.build_bundles(spans)

		expect(totals.sequence_count).toBe(1)
		expect(totals.longest_sequence).toBe(3)
		expect(totals.recoverable_round_trips).toBe(2)
	})

	// The counter-case, kept deliberately: two reads of one file *can* depend — a grep that finds a
	// line number and a `sed -n` that prints around it — so the shared-target proxy still earns its
	// place there and this stays at zero.
	it('still breaks a sequence where one read follows another of the same file', () => {
		const spans = [MODEL, call(['a.ts']), MODEL, call(['a.ts']), MODEL, call(['a.ts'])]

		expect(time_bundles.build_bundles(spans).recoverable_round_trips).toBe(0)
	})

	// A write after a read of the same file is the `Read` → `Edit` pair, which is a real dependency:
	// the edit's `old_string` came from the read.
	it('breaks a sequence where an edit follows a read of the same file', () => {
		const spans = [MODEL, call(['a.ts']), MODEL, edit('a.ts')]

		expect(time_bundles.build_bundles(spans).recoverable_round_trips).toBe(0)
	})
})

describe('time_bundles.build_bundles — what else breaks a sequence', () => {
	// The tail of a call whose middle went to a delegated unit. The unit ran between the two turns, so
	// they were not consecutive at all.
	it('breaks a sequence at the tail of a call split around a delegated unit', () => {
		const tail = { ...call(['b.ts']), is_continuation: true }
		const spans = [MODEL, call(['a.ts']), MODEL, tail, MODEL, call(['c.ts'])]

		expect(time_bundles.build_bundles(spans).recoverable_round_trips).toBe(0)
	})
})

// joshuafolkken/kit#1406. Claude Code writes each `tool_use` block as its own assistant line and the
// harness returns each result as it arrives, so a turn's calls reach the timeline separated by that
// turn's own model spans. Read as several single-call turns, a turn that had already batched was
// offered back as a sequence that could have been bundled — which is where run #1399's whole
// `recoverable round trips 8` came from.
describe('time_bundles.build_bundles — a turn told apart by its message id', () => {
	it('breaks a sequence at a batched turn whose calls arrived one at a time', () => {
		const thinking = { ...MODEL, message_id: TURN }
		const spans = [
			thinking,
			call_of(TURN, 'a.ts'),
			thinking,
			call_of(TURN, 'b.ts'),
			thinking,
			call_of(TURN, 'c.ts'),
			MODEL,
		]

		expect(time_bundles.build_bundles(spans).recoverable_round_trips).toBe(0)
	})

	// The counterpart, so the rule above cannot pass by refusing every sequence: three turns of one
	// call each, told apart by their ids rather than by adjacency.
	it('still reads three single-call turns carrying their own ids as one sequence', () => {
		const spans = [...turn_of('m1', 'a.ts'), ...turn_of('m2', 'b.ts'), ...turn_of('m3', 'c.ts')]

		expect(time_bundles.build_bundles(spans).recoverable_round_trips).toBe(2)
	})

	// `time_overlap.trim` copies the head's fields onto the tail, so the tail carries the very message
	// the turn was issuing from. Read as that turn still issuing calls, it would skip the flush that
	// says a delegated unit ran in between.
	it('breaks a sequence at a tail carrying the message id of the turn it interrupted', () => {
		const tail = { ...call_of(TURN, 'b.ts'), is_continuation: true }
		const spans = [call_of(TURN, 'a.ts'), tail, ...turn_of('m2', 'c.ts')]

		expect(time_bundles.build_bundles(spans).recoverable_round_trips).toBe(0)
	})
})

describe('time_bundles.build_bundles — the target test', () => {
	// The search-then-read pair: the second call's path sits inside the directory the first one named,
	// which is how it learned the answer.
	it('starts a new sequence where a call reads inside a directory an earlier one named', () => {
		const spans = [MODEL, call(['scripts']), MODEL, call(['scripts/a.ts']), MODEL, call(['b.ts'])]
		const totals = time_bundles.build_bundles(spans)

		expect(totals.sequence_count).toBe(1)
		expect(totals.longest_sequence).toBe(2)
		expect(totals.recoverable_round_trips).toBe(1)
	})

	it('starts a new sequence where two calls name the same path', () => {
		const spans = [MODEL, call(['a.ts']), MODEL, call(['a.ts']), MODEL, call(['b.ts'])]

		expect(time_bundles.build_bundles(spans).recoverable_round_trips).toBe(1)
	})

	// A call naming nothing cannot be shown to depend on anything, which is the direction this figure
	// over-reports in — stated in the module header rather than left to be discovered.
	it('treats calls that name nothing as independent of each other', () => {
		const spans = [MODEL, call([]), MODEL, call([]), MODEL, call([])]

		expect(time_bundles.build_bundles(spans).recoverable_round_trips).toBe(2)
	})
})

describe('time_bundles.build_bundles — measured against unread', () => {
	it('says a run that batched everything was measured and had nothing to recover', () => {
		const totals = time_bundles.build_bundles([MODEL, call(['a.ts']), call(['b.ts'])])

		expect(totals.is_measured).toBe(true)
		expect(totals.recoverable_round_trips).toBe(0)
	})

	it('says a run whose transcript was never read measured nothing', () => {
		expect(time_bundles.build_bundles([]).is_measured).toBe(false)
	})
})

// What the count could never say on its own: which tool's turns the avoidable trips were
// (joshuafolkken/kit#1607).
describe('time_bundles.build_bundles — which tool the recoverable trips belong to', () => {
	it('attributes a sequence of one tool to that tool', () => {
		const spans = named_turns([
			[EDIT, 'a.ts'],
			[EDIT, 'b.ts'],
			[EDIT, 'c.ts'],
		])

		expect(time_bundles.build_bundles(spans).by_tool).toEqual([
			{ label: EDIT, sequence_count: 1, recoverable_round_trips: 2 },
		])
	})

	// The shape a real run makes: the trip goes to the call that made it its own turn, so a mixed
	// sequence still names both tools rather than falling out of the table entirely.
	it('attributes each trip to the call that made it its own turn', () => {
		const spans = named_turns([
			[GREP, 'a.ts'],
			[GREP, 'b.ts'],
			[EDIT, 'c.ts'],
		])

		expect(time_bundles.build_bundles(spans).by_tool).toEqual([
			{ label: GREP, sequence_count: 1, recoverable_round_trips: 1 },
			{ label: EDIT, sequence_count: 1, recoverable_round_trips: 1 },
		])
	})
})

describe('time_bundles.build_bundles — how the per-tool rows are counted and ordered', () => {
	// A tool that appears twice inside one sequence is one place to go and look at, not two.
	it('counts a sequence once per tool however many trips it held there', () => {
		const first = named_turns([
			[EDIT, 'a.ts'],
			[EDIT, 'b.ts'],
		])
		const second = named_turns([
			[EDIT, 'c.ts'],
			[EDIT, 'd.ts'],
		])
		const [row] = time_bundles.build_bundles([...first, HUMAN, ...second]).by_tool

		expect(row).toEqual({ label: EDIT, sequence_count: 2, recoverable_round_trips: 2 })
	})

	it('ranks the heaviest tool first', () => {
		const spans = named_turns([
			[EDIT, 'a.ts'],
			[EDIT, 'b.ts'],
			[EDIT, 'c.ts'],
			[READ, 'd.ts'],
		])

		expect(time_bundles.build_bundles(spans).by_tool.map((row) => row.label)).toEqual([EDIT, READ])
	})
})

// The reconciliation the breakdown is required to hold. **On a real transcript the residue is always
// `0`** — only a bundleable call enters a sequence and every one of those is labelled — so these two
// build the unlabelled call deliberately: what is pinned is that a trip with nowhere to go is
// *reported* rather than dropped, which is how the row catches the walk and the attribution coming
// apart. Neither case describes a state `pnpm josh time` reaches.
describe('time_bundles.build_bundles — the trips it could not attribute', () => {
	it('reports a trip whose call named no tool rather than dropping it', () => {
		const totals = time_bundles.build_bundles([MODEL, call(['a.ts']), MODEL, call(['b.ts'])])

		expect(totals.by_tool).toEqual([])
		expect(totals.unattributed_round_trips).toBe(1)
		expect(totals.recoverable_round_trips).toBe(1)
	})

	it('leaves the rows and the residue summing to the recoverable count', () => {
		const named = named_turns([[EDIT, 'a.ts']])
		const totals = time_bundles.build_bundles([...named, MODEL, call(['b.ts'])])
		const attributed = totals.by_tool.reduce((sum, row) => sum + row.recoverable_round_trips, 0)

		expect(attributed + totals.unattributed_round_trips).toBe(totals.recoverable_round_trips)
	})
})

describe('time_bundles.bundle_lines', () => {
	it('prints the sequences, the trips they hold and what the model wait would return', () => {
		const spans = [MODEL, call(['a.ts']), MODEL, call(['b.ts']), MODEL, call(['c.ts'])]
		const totals = time_bundles.build_bundles(spans)
		const text = time_bundles.bundle_lines(totals, PRICE).join('\n')

		expect(text).toContain(time_bundles.HEADING)
		expect(text).toContain('longest 3 turn(s)')
		expect(text).toContain('33.3% of 6 round trip(s)')
		expect(text).toContain('0.3 min')
	})

	// A transcript that was read and called no tool has no share and no price. Printed as measured, the
	// block would say `at 0.0 s model time per round trip` beside a round-trip price row already saying
	// there was nothing to divide by — one report disagreeing with itself.
	it('says there was nothing to divide where the run made no round trip', () => {
		const totals = time_bundles.build_bundles([MODEL])
		const text = time_bundles
			.bundle_lines(totals, { round_trip_count: 0, model_ms_per_round_trip: 0 })
			.join('\n')

		expect(totals.is_measured).toBe(true)
		expect(text).toContain('no tool call to divide')
		expect(text).not.toContain('per round trip')
	})

	// Zero here would read as a run that batched everything, which is the one answer an unread
	// transcript cannot support.
	it('withholds every row where no span was read', () => {
		const lines = time_bundles.bundle_lines(time_bundles.NO_BUNDLES, PRICE)

		expect(lines.join('\n')).toContain('not measured')
		expect(lines.join('\n')).not.toContain('round trip(s)')
	})
})

describe('time_bundles.bundle_lines — the per-tool breakdown', () => {
	it('names the tool the recoverable trips belong to and reconciles the total', () => {
		const spans = named_turns([
			[EDIT, 'a.ts'],
			[EDIT, 'b.ts'],
			[EDIT, 'c.ts'],
		])
		const text = time_bundles.bundle_lines(time_bundles.build_bundles(spans), PRICE).join('\n')

		expect(text).toContain(time_bundles.BY_TOOL_LABEL)
		expect(text).toContain('2 of 2 attributed')
		expect(text).toContain('in 1 sequence(s)')
		expect(text).toContain(EDIT)
	})

	// The residue is printed rather than rounded away, so a reader sees that the trips had no tool to
	// go to instead of reading the table as the whole answer.
	it('shows the residue where a trip named no tool', () => {
		const totals = time_bundles.build_bundles([MODEL, call(['a.ts']), MODEL, call(['b.ts'])])

		expect(time_bundles.bundle_lines(totals, PRICE).join('\n')).toContain('0 of 1 attributed')
	})

	// Withheld beside the three counts rather than printed empty beneath them: an unread transcript
	// has no per-tool answer either, and an empty table would read as nothing to batch.
	it('withholds the breakdown too where no span was read', () => {
		const text = time_bundles.bundle_lines(time_bundles.NO_BUNDLES, PRICE).join('\n')

		expect(text).toContain(time_bundles.BY_TOOL_LABEL)
		expect(text).not.toContain('attributed')
	})
})

// The sequence the walk is still inside when the spans run out, which is what the live guard asks for
// (joshuafolkken/kit#1390). `build_bundles` closes the walk because it prices a run that has ended;
// this one is deliberately left open.
describe('time_bundles.open_sequence', () => {
	it('returns the run of single-call turns the next call would extend', () => {
		const spans = [MODEL, call(['a.ts']), MODEL, call(['b.ts']), MODEL]

		expect(time_bundles.open_sequence(spans).map((span) => span.targets)).toEqual([
			['a.ts'],
			['b.ts'],
		])
	})

	// A turn that already batched is the improvement rather than the defect, so nothing before it is
	// carried across.
	it('is empty where the last turn issued several calls', () => {
		const spans = [MODEL, call(['a.ts']), MODEL, call(['b.ts']), call(['c.ts']), MODEL]

		expect(time_bundles.open_sequence(spans)).toEqual([])
	})

	// A conflicting call starts a new sequence at itself rather than ending the run, because everything
	// after it may still have been bundleable with it.
	it('restarts at a call that names a target the sequence already touched', () => {
		const spans = [MODEL, call(['a.ts']), MODEL, call(['a.ts']), MODEL]

		expect(time_bundles.open_sequence(spans)).toHaveLength(1)
	})
})
