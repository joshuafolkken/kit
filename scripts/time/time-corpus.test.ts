import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { cost_transcript } from '#scripts/cost/cost-transcript'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { time_corpus, type IssueSpans } from './time-corpus'
import { time_delegated_wait } from './time-delegated-wait'
import { time_transcript_fixture as fixture } from './time-transcript-fixture'

const { CWD, ISSUE, BRANCH, THREE_MINUTES_MS } = fixture
const OTHER_ISSUE = 1284
const OTHER_BRANCH = '1284-read-the-directory-once'
const ELSEWHERE_BRANCH = '999-elsewhere'
const SPANS_PER_SESSION = 2
// An issue number no fixture transcript mentions.
const UNWORKED_ISSUE = 4242

const state = { home: '' }

beforeEach(() => {
	state.home = mkdtempSync(path.join(tmpdir(), 'time-corpus-'))
	vi.spyOn(cost_transcript, 'transcript_directories').mockImplementation((cwd: string) => [
		path.join(state.home, cost_transcript.project_slug(cwd)),
	])
})

afterEach(() => {
	vi.restoreAllMocks()
})

function write_session(name: string, lines: ReadonlyArray<string>): void {
	fixture.write_session(state.home, name, lines)
}

function write_unit(session_name: string, agent_name: string, lines: ReadonlyArray<string>): void {
	fixture.write_unit(state.home, session_name, agent_name, lines)
}

function collect(issue_number: number = ISSUE): IssueSpans {
	return time_corpus.collect_issue_spans(CWD, issue_number)
}

function earliest_start(found: IssueSpans): number {
	return Math.min(...found.spans.map((one) => one.ended_ms - one.duration_ms))
}

describe('time_corpus.collect_issue_spans', () => {
	// A run is not a session: the `fullrun` for issue #1256 ran in a different one from the session
	// that reported it, so a command reading one transcript reports half a run.
	it('adds up every session attributed to the issue', () => {
		write_session('one', fixture.issue_lines(0))
		write_session('two', fixture.issue_lines(10))

		const found = collect()

		expect(found.session_count).toBe(2)
		expect(found.spans).toHaveLength(4)
	})

	it('leaves out a session that never touched the issue', () => {
		write_session('one', fixture.issue_lines(0))
		write_session('other', fixture.issue_lines(0, ELSEWHERE_BRANCH))

		expect(collect().session_count).toBe(1)
	})

	// The fill-forward walk is `cost_attribute`'s and is reused, not copied: work done on the default
	// branch before `josh git` created the branch still belongs to the issue.
	it('claims the work done on the default branch before the branch existed', () => {
		write_session('one', [
			fixture.prompt_line(0, 'main'),
			fixture.call_line(1, 'main'),
			fixture.result_line(3, BRANCH),
		])

		expect(collect().spans).toHaveLength(SPANS_PER_SESSION)
	})
})

// A lane run's session never checks the issue branch out — the work happens in a linked work tree the
// session only shells into — so the fill-forward walk has no issue branch to carry in either
// direction, and before joshuafolkken/kit#1617 the whole run reported as `no transcript`. Measured on
// 2026-09-09: six of six merged runs, and issues 1445, 1510 and 1511 left no `<N>-` branch anywhere in
// the corpus.
describe('time_corpus.collect_issue_spans on a run that never checked the issue branch out', () => {
	it('attributes a session that named the issue only through the in-progress label', () => {
		write_session('lane', fixture.lane_lines(0))

		const found = collect()

		expect(found.session_count).toBe(1)
		expect(found.spans).toHaveLength(SPANS_PER_SESSION)
	})

	// The declaration names one issue, so it must not hand the run to an adjacent one — which is what
	// a filter loose enough to match the number anywhere in the text would have done.
	it('leaves that session out of an issue it never named', () => {
		write_session('lane', fixture.lane_lines(0))

		expect(collect(OTHER_ISSUE).session_count).toBe(0)
	})
})

// joshuafolkken/kit#1648. An `epicrun` or a `backlogrun` runs its children in delegated units of one
// session, and the units are pooled under that session's key — so the whole batch was handed to every
// child. Run #1630 recorded 361 minutes against about 45 and 421 turns against about 130, while its
// sibling #1633, run in the same parent minutes earlier, recorded correctly: the same defect, visible
// only in the child whose declaration fell furthest from the session's first span.
describe('time_corpus.collect_issue_spans on a parent that ran several children', () => {
	const SIBLING_ISSUE = 1633
	const SIBLING_OFFSET = 0
	const RUN_OFFSET = 20
	const DEFAULT_BRANCH = 'main'
	// How far apart the two declarations sit, which is what the child's start has to move by.
	const DECLARATION_GAP_MS = RUN_OFFSET * fixture.MINUTE_MS

	function write_batch(): void {
		write_session('batch', fixture.issue_lines(SIBLING_OFFSET, DEFAULT_BRANCH))
		write_unit('batch', 'first', fixture.lane_lines(SIBLING_OFFSET, SIBLING_ISSUE))
		write_unit('batch', 'second', fixture.lane_lines(RUN_OFFSET, ISSUE))
	}

	// The sibling ran first, so under the old reading both children started where the parent's own
	// spans did and the two rows opened at the same instant — which is what made #1630's row 361
	// minutes long. Both shapes are asserted rather than only the broken one, because the pair is the
	// evidence: the same defect produced a wrong row and a right-looking one.
	it('starts each child at its own declaration rather than at the parent', () => {
		write_batch()

		const found = collect()

		// `earliest_start` is `Math.min()` of an empty list — `Infinity` — so a narrowing that dropped
		// the child entirely would satisfy every comparison below. The count is what rules that out.
		expect(found.spans.length).toBeGreaterThan(0)
		expect(earliest_start(found) - earliest_start(collect(SIBLING_ISSUE))).toBeGreaterThanOrEqual(
			DECLARATION_GAP_MS,
		)
	})

	// A floor alone only removes the sibling that ran first, so the child that ran first absorbed every
	// later one — including a research unit inside them, which declares no issue to be told apart by.
	it('leaves a later sibling out of the child that ran before it', () => {
		write_batch()

		const found = collect(SIBLING_ISSUE)
		const run_started = earliest_start(collect())

		expect(found.spans.length).toBeGreaterThan(0)
		expect(Math.max(...found.spans.map((one) => one.ended_ms))).toBeLessThan(run_started)
	})

	// **Measured from the declaration, so the unit's own minutes before it are `pre-run`** — the same
	// line `time-phases.ts` already draws for a session, and the only line that separates two children
	// pooled under one key: a research unit inside the sibling declares no issue at all.
	it('leaves the sibling unit out of the child that ran after it', () => {
		write_batch()

		const found = collect()
		const sibling_ended = Math.max(...collect(SIBLING_ISSUE).spans.map((one) => one.ended_ms))

		expect(found.spans.length).toBeGreaterThan(0)
		expect(earliest_start(found)).toBeGreaterThan(sibling_ended)
	})
})

// Resuming or forking a session copies the earlier lines into a new transcript file, so one span can
// appear in several. Counted twice, a run spanning sessions reports time nobody spent.
describe('time_corpus.collect_issue_spans on a resumed transcript', () => {
	it('counts a span copied into a resumed transcript once', () => {
		write_session('one', fixture.issue_lines(0))
		write_session('resumed', [
			...fixture.issue_lines(0),
			fixture.call_line(5, BRANCH),
			fixture.result_line(6, BRANCH),
		])

		// The first session contributes two spans and the resumed one four, two of which are the
		// copies. Counted naively that is six; the run really spent four.
		expect(collect().spans).toHaveLength(4)
	})

	// A session that contributed only copies is not a session the note may count: `2 session(s)`
	// beside a span total that correctly counted those spans once is the note contradicting the
	// arithmetic printed beside it.
	it('does not count a transcript that was purely a copy of another', () => {
		write_session('one', fixture.issue_lines(0))
		write_session('copy', fixture.issue_lines(0))

		expect(collect().session_count).toBe(1)
	})
})

describe('time_corpus.collect_issue_spans on a delegated run', () => {
	// `epicrun` runs every child in a delegated unit, and the unit's transcript is written to a
	// subdirectory of the session that delegated it. Listing only the session files reported epic
	// #1272's four merged children as "CI wait only" (joshuafolkken/kit#1285).
	it('reads a delegated unit transcript, not only the session that delegated it', () => {
		write_unit('parent', 'agent-a1', fixture.issue_lines(0))

		expect(collect().spans).toHaveLength(SPANS_PER_SESSION)
	})

	// The parent holds one `Agent` span for the whole time the unit runs. Concatenated, the two
	// readings count those minutes twice and the four shares stop summing to the elapsed time.
	it('does not count the parent wait and the unit work as separate wall clock', () => {
		write_session('parent', fixture.delegating_lines())
		write_unit('parent', 'agent-a1', fixture.issue_lines(0))

		expect(fixture.total_span_ms(collect().spans)).toBe(THREE_MINUTES_MS)
	})

	// A unit's work overlaps the wait of the session that delegated it and nothing else. Two sessions
	// attributed to one issue can run at the same wall clock — a batch in the background while someone
	// works interactively — and pooling every unit's interval would delete the second session's real
	// spans without a word.
	it('does not subtract one session units from another session own spans', () => {
		write_session('parent', fixture.delegating_lines())
		write_unit('parent', 'agent-a1', fixture.issue_lines(0))
		write_session('other', fixture.concurrent_lines())

		expect(fixture.total_span_ms(collect().spans)).toBe(2 * THREE_MINUTES_MS)
	})
})

// An unread delegated unit has an unknown wait, not an empty one — so the issue scope reports it as
// `not measured`, the same answer the session scope gives, rather than withholding the block as if the
// run never delegated (joshuafolkken/kit#1881). `resolve_delegated` sees only units whose spans were
// read, so an unread one has to be recognized from the family listing instead.
describe('time_corpus.collect_issue_spans on an unread delegated unit', () => {
	it('reports the delegation as not measured rather than as a run that never delegated', () => {
		write_session('parent', fixture.delegating_lines())
		write_unit('parent', 'agent-a1', fixture.issue_lines(0, ELSEWHERE_BRANCH))
		vi.spyOn(cost_transcript, 'read_optional').mockReturnValue(undefined)

		const found = collect()

		expect(found.delegated_wait.has_delegation).toBe(true)
		expect(found.delegated_wait.is_measured).toBe(false)
	})
})

// The two overlaps that have no parent-unit relation to resolve them (joshuafolkken/kit#1287). Both
// break the guarantee the arithmetic exists for: the shares stop reconstructing the elapsed time.
describe('time_corpus.collect_issue_spans on transcripts that overlap without a parent-unit relation', () => {
	// One session running two units at once. Each unit's spans were kept whole, so the wall clock they
	// shared was counted once per unit while the parent's bracketing span was trimmed by both.
	it('counts wall clock two concurrent units of one session share once', () => {
		write_session('parent', fixture.delegating_lines())
		write_unit('parent', 'agent-a1', fixture.issue_lines(0))
		write_unit('parent', 'agent-a2', fixture.concurrent_lines())

		expect(fixture.total_span_ms(collect().spans)).toBe(THREE_MINUTES_MS)
	})

	// Resume or fork copies the earlier lines into a new transcript, and the copy has no `subagents/`
	// of its own. The original's `Agent` span is trimmed away by the units that cover it while the copy
	// survives whole, and the trim changed the key the two would have been folded by — so three minutes
	// were reported as six.
	it('counts a resumed copy of the parent wait once, beside the units that cover it', () => {
		write_session('parent', fixture.delegating_lines())
		write_unit('parent', 'agent-a1', fixture.issue_lines(0))
		write_session('resumed', fixture.delegating_lines())

		expect(fixture.total_span_ms(collect().spans)).toBe(THREE_MINUTES_MS)
	})
})

// A branch belongs to the checkout rather than to a session, so every session open in one work tree
// is attributed to whatever issue is checked out — run #1412 read as 145 round trips against a hand
// count of 56 because a second session was busy with `josh epic` across the same window
// (joshuafolkken/kit#1428).
describe('time_corpus.collect_issue_spans on sessions that only shared the checkout', () => {
	it('leaves a session no workflow marker attributes to the run out of the spans', () => {
		write_session('ran', fixture.run_lines(0))
		write_session('other', fixture.concurrent_lines())

		const found = collect()

		expect(fixture.total_span_ms(found.spans)).toBe(THREE_MINUTES_MS)
		expect(found.excluded.map((one) => one.session_id)).toStrictEqual(['other'])
	})

	// The note above the report and the spans beneath it have to be about the same set.
	it('counts only the transcripts of the sessions it kept', () => {
		write_session('ran', fixture.run_lines(0))
		write_session('other', fixture.concurrent_lines())

		expect(collect().session_count).toBe(1)
	})

	// A unit's transcript carries no marker of its own; it is kept because the session that delegated
	// it does.
	it('keeps the delegated unit of the session that ran it', () => {
		write_session('ran', fixture.run_lines(0))
		write_unit('ran', 'agent-a1', fixture.issue_lines(10))
		write_session('other', fixture.concurrent_lines())

		expect(fixture.total_span_ms(collect().spans)).toBe(2 * THREE_MINUTES_MS)
	})

	// Dropping every session would report the run as unmeasured rather than as inflated. `0` excluded
	// and "could not be separated" are different answers, and `is_separated` is what tells them apart.
	it('keeps every session when no marker names one of them, and says so', () => {
		write_session('one', fixture.issue_lines(0))
		write_session('other', fixture.concurrent_lines())

		const found = collect()

		expect(fixture.total_span_ms(found.spans)).toBe(2 * THREE_MINUTES_MS)
		expect(found.excluded).toStrictEqual([])
		expect(found.is_separated).toBe(false)
		expect(found.attributed_count).toBe(2)
	})
})

// The whole point of the module: an epic of N children reads the corpus once, not N times
// (joshuafolkken/kit#1284).
function count_reads(issue_numbers: ReadonlyArray<number>): number {
	const read = vi.spyOn(cost_transcript, 'read_raw')

	time_corpus.collect_for_issues(CWD, issue_numbers)

	return read.mock.calls.length
}

describe('time_corpus.collect_for_issues — one pass, however many issues', () => {
	beforeEach(() => {
		write_session('one', fixture.issue_lines(0))
		write_session('two', fixture.issue_lines(10, OTHER_BRANCH))
		write_session('three', fixture.issue_lines(20, ELSEWHERE_BRANCH))
	})

	it('reads each transcript once for a single issue', () => {
		expect(count_reads([ISSUE])).toBe(3)
	})

	// The regression this Issue was filed for: the read count used to be files × children.
	it('reads each transcript once for five issues, not five times', () => {
		expect(count_reads([ISSUE, OTHER_ISSUE, 1, 2, 3])).toBe(3)
	})

	it('collects an issue repeated in the epic body once', () => {
		const found = time_corpus.collect_for_issues(CWD, [ISSUE, ISSUE])

		expect(found.size).toBe(1)
		expect(found.get(ISSUE)?.session_count).toBe(1)
	})

	// An issue nobody worked on is present with an empty result: "no transcript mentions it" is an
	// answer, and a caller that had to tell it from "not asked for" would be re-deriving it. The
	// batch path relies on this being true of every number it asked about.
	it('answers for an issue no transcript mentions rather than omitting it', () => {
		const found = time_corpus.collect_for_issues(CWD, [UNWORKED_ISSUE])

		expect(found.get(UNWORKED_ISSUE)).toStrictEqual({
			spans: [],
			session_count: 0,
			excluded: [],
			narrowed: [],
			is_separated: false,
			has_other_run_markers: false,
			attributed_count: 0,
			unread_count: 0,
			delegated_wait: time_delegated_wait.build_totals([], true, false),
		})
	})

	// An epic whose task list names no issue in this repository asks for nothing, and reading 296 MB
	// to answer that would be worse than the per-child walk this replaced: that loop never ran.
	it('reads nothing at all when no issue was asked about', () => {
		expect(count_reads([])).toBe(0)
	})
})

// `--issue` must report exactly what it reported before the batch path existed, so the batch walk
// and the single walk are held to producing the same thing rather than merely similar things.
describe('time_corpus.collect_for_issues — identical to collecting one at a time', () => {
	it('gives each issue what a single-issue collection gives it', () => {
		write_session('parent', fixture.delegating_lines())
		write_unit('parent', 'agent-a1', fixture.issue_lines(0))
		write_session('two', fixture.issue_lines(10, OTHER_BRANCH))
		write_session('resumed', fixture.issue_lines(0))

		const batch = time_corpus.collect_for_issues(CWD, [ISSUE, OTHER_ISSUE])

		expect(batch.get(ISSUE)).toStrictEqual(collect(ISSUE))
		expect(batch.get(OTHER_ISSUE)).toStrictEqual(collect(OTHER_ISSUE))
	})
})
