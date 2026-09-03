import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { cost_transcript } from '#scripts/cost/cost-transcript'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { time_corpus, type IssueSpans } from './time-corpus'
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
	vi.spyOn(cost_transcript, 'transcript_directory').mockImplementation((cwd: string) =>
		path.join(state.home, cost_transcript.project_slug(cwd)),
	)
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

		expect(found.get(UNWORKED_ISSUE)).toStrictEqual({ spans: [], session_count: 0 })
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
