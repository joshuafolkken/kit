import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { time_corpus } from './time-corpus'
import { time_epic, type ChildTiming, type EpicTimeReport } from './time-epic'
import { time_pull_fixture } from './time-pull-fixture'
import type { TimeReport } from './time-report'
import { time_run } from './time-run'

const CWD = '/Users/someone/Development/kit'
const MINUTE_MS = 60_000
const EPIC = 1272

function at(minute: number): string {
	return new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString()
}

interface ReportInput {
	issue_number: number
	start_minute?: number
	model_ms?: number
	turn_count?: number
	span_count?: number
	has_ci_data?: boolean
}

const DEFAULTS = { model_ms: MINUTE_MS, turn_count: 1, span_count: 2, has_ci_data: true }

// A report shaped like the one `time_run` hands back, with only the fields the aggregation reads
// varied. Building it through `time_report.build_from_spans` would need spans this test has no use
// for.
function report_of(input: ReportInput): TimeReport {
	const { issue_number, start_minute, model_ms, turn_count, span_count, has_ci_data } = {
		...DEFAULTS,
		...input,
	}

	const is_timed = span_count > 0 || has_ci_data

	return {
		scope: `issue #${String(issue_number)}`,
		started_at: start_minute === undefined ? '' : at(start_minute),
		ended_at: start_minute === undefined ? '' : at(start_minute + 1),
		// A child nothing was read for really does elapse nothing, so the fixture cannot assert a total
		// that the aggregation could never produce.
		elapsed_ms: is_timed ? model_ms + MINUTE_MS : 0,
		span_count,
		turn_count,
		tool_call_count: 0,
		round_trip_count: 0,
		categories: { model_ms, tool_ms: MINUTE_MS, human_ms: 0, ci_ms: 0 },
		has_ci_data,
		notes: [],
		phases: [],
		by_tool: [],
		by_josh_command: [],
		by_check: [],
	}
}

function timing_of(input: ReportInput): ChildTiming {
	const report = report_of(input)

	return {
		issue_number: input.issue_number,
		status: time_epic.status_of(report),
		ms_per_turn: time_epic.ms_per_turn_of(report),
		report,
	}
}

const ROW_101 = '- [x] #101'
const ROW_102 = '- [x] #102'
const ROW_103 = '- [x] #103'
const OPEN_ROW_101 = '- [ ] #101'
const FENCE = '```'

function body_of(rows: ReadonlyArray<string>): string {
	return ['## Progress', '', ...rows].join('\n')
}

type MockedRunReport = MockInstance<typeof time_run.build_run_report>

async function unparseable(): Promise<string> {
	return '<html>403</html>'
}

async function failing(): Promise<string> {
	throw new Error('gh: not authenticated')
}

// The spy on the shared `time_run` object is undone here rather than at the end of each test body: a
// failing assertion skips whatever follows it, so a restore written inline leaks the stub into every
// test after the first real failure and turns one of them into a cascade.
afterEach(() => {
	vi.restoreAllMocks()
})

// The children are stubbed rather than measured: what is under test here is the aggregation, and a
// real report would need a transcript directory this test has no business writing.
// Returns the spy, so a case can also assert what each child was handed rather than only what came
// back from it.
function stub_children(reports: ReadonlyMap<number, TimeReport>): MockedRunReport {
	return vi
		.spyOn(time_run, 'build_run_report')
		.mockImplementation(
			async (issue_number: number) => reports.get(issue_number) ?? report_of({ issue_number }),
		)
}

// Every read the aggregation makes goes through one `GhReader`, so a test hands it a function and
// never a network. Two paths reach it: the epic body, and the pull-request listing the batch pages
// once for the whole batch (joshuafolkken/kit#1292). The listing defaults to an empty page, which
// ends the walk in one request; a case that asserts what each child was handed scripts a real page
// instead, because two children given the same empty answer cannot tell per-child routing from a
// single shared result.
const EMPTY_PAGE = '[]'

function reader_of(
	body: string,
	asked: Array<string> = [],
	pulls_body: string = EMPTY_PAGE,
): (path: string) => Promise<string> {
	return async (path: string) => {
		asked.push(path)

		if (path.includes('pulls')) return pulls_body

		expect(path).toContain(`issues/${String(EPIC)}`)

		return JSON.stringify({ body })
	}
}

// Which reads count as the pull-request listing is `time-pull-fixture.ts`'s, shared with the suites
// that assert the same count one level down.
const { pulls_asked, raw_pull, EXHAUSTED_SEARCH } = time_pull_fixture

describe('time_epic.status_of', () => {
	// The acceptance criterion: a child that never ran is not a child that took no time.
	it('calls a child with no spans and no merge "not run"', () => {
		const report = report_of({ issue_number: 1, has_ci_data: false, span_count: 0 })

		expect(time_epic.status_of(report)).toBe(time_epic.NOT_RUN)
	})

	it('separates a run that never merged from one that did', () => {
		const open = report_of({ issue_number: 1, has_ci_data: false, span_count: 4 })

		expect(time_epic.status_of(open)).toBe(time_epic.NOT_MERGED)
		expect(time_epic.status_of(report_of({ issue_number: 1 }))).toBe(time_epic.MEASURED)
	})

	// Measured on epic #1272 itself: children that merged with a real CI wait and not one line of
	// transcript attributed. Calling that `measured` would print `model 0.0 min` for a model wait
	// nobody read.
	it('separates a merge with no transcript from a fully measured run', () => {
		const merged_only = report_of({ issue_number: 1, span_count: 0 })

		expect(time_epic.status_of(merged_only)).toBe(time_epic.NO_TRANSCRIPT)
	})
})

describe('time_epic.ms_per_turn_of', () => {
	it('divides model wait by the turns it was spread over', () => {
		const report = report_of({ issue_number: 1, model_ms: 4 * MINUTE_MS, turn_count: 4 })

		expect(time_epic.ms_per_turn_of(report)).toBe(MINUTE_MS)
	})

	// Never `0`: "no turn was recorded" and "each turn was instant" are different answers.
	it('answers undefined rather than zero for a run with no turn', () => {
		expect(time_epic.ms_per_turn_of(report_of({ issue_number: 1, turn_count: 0 }))).toBeUndefined()
	})
})

describe('time_epic.in_execution_order', () => {
	it('orders children by when they ran, not by the order the body lists them', () => {
		const rows = [
			timing_of({ issue_number: 3, start_minute: 30 }),
			timing_of({ issue_number: 1, start_minute: 10 }),
			timing_of({ issue_number: 2, start_minute: 20 }),
		]

		expect(time_epic.in_execution_order(rows).map((row) => row.issue_number)).toEqual([1, 2, 3])
	})

	// A child with no measured start sorts behind every child that has one, and the ones that share
	// that answer keep the body's order rather than being shuffled against each other.
	it('keeps the children that never ran behind the rest, in body order', () => {
		const rows = [
			timing_of({ issue_number: 9, has_ci_data: false, span_count: 0 }),
			timing_of({ issue_number: 8, has_ci_data: false, span_count: 0 }),
			timing_of({ issue_number: 1, start_minute: 10 }),
		]

		expect(time_epic.in_execution_order(rows).map((row) => row.issue_number)).toEqual([1, 9, 8])
	})
})

describe('time_epic.trend_of', () => {
	it('reads the per-turn figure from the first and last child that recorded one', () => {
		const rows = [
			timing_of({ issue_number: 1, model_ms: 2 * MINUTE_MS, turn_count: 2 }),
			timing_of({ issue_number: 2, model_ms: 9 * MINUTE_MS, turn_count: 3 }),
		]

		expect(time_epic.trend_of(rows)).toEqual({
			is_comparable: true,
			first_ms_per_turn: MINUTE_MS,
			last_ms_per_turn: 3 * MINUTE_MS,
			child_count: 2,
		})
	})

	// One point has no direction, and saying it is flat would be an answer nobody measured.
	it('says it cannot compare a batch with a single measured child', () => {
		const rows = [timing_of({ issue_number: 1 })]

		expect(time_epic.trend_of(rows).is_comparable).toBe(false)
	})
})

describe('time_epic.read_children', () => {
	it('enumerates children through the epic body parser', async () => {
		const body = body_of([ROW_101, '- [ ] #102', 'see also #999'])

		expect(await time_epic.read_children(EPIC, reader_of(body))).toEqual({
			numbers: [101, 102],
			external_count: 0,
		})
	})

	// The parser's own rules come along with it: a fenced sample row is an illustration, and a
	// cross-repository row is counted rather than measured against this repository's issue numbers.
	it('inherits the parser’s fenced-block and cross-repository rules', async () => {
		const body = body_of([
			OPEN_ROW_101,
			'- [ ] joshuafolkken/app-kit#7',
			FENCE,
			'- [ ] #999',
			FENCE,
		])

		expect(await time_epic.read_children(EPIC, reader_of(body))).toEqual({
			numbers: [101],
			external_count: 1,
		})
	})

	// A failed read is not an epic with no children — the distinction the whole module keeps. A body
	// `gh` answered with but nothing could parse is the same kind of non-answer as a refusal.
	it('answers undefined when the epic could not be read', async () => {
		expect(await time_epic.read_children(EPIC, unparseable)).toBeUndefined()
	})
})

const PAIR_BODY = body_of([ROW_101, ROW_102])

// The report, or a failure. Assertions then read `report.x` rather than `report?.x`, which is not
// only shorter: an optional chain would let every one of them pass against an `undefined` report.
async function batch_of(body: string): Promise<EpicTimeReport> {
	const report = await time_epic.build_epic_report(EPIC, CWD, reader_of(body))

	if (report === undefined) throw new Error('the epic could not be read')

	return report
}

describe('time_epic.build_epic_report — the batch', () => {
	it('reports every child, its total and its trend, in execution order', async () => {
		stub_children(
			new Map([
				[101, report_of({ issue_number: 101, start_minute: 30, model_ms: 6 * MINUTE_MS })],
				[102, report_of({ issue_number: 102, start_minute: 10, model_ms: 2 * MINUTE_MS })],
			]),
		)

		const report = await batch_of(PAIR_BODY)

		expect(report.children.map((child) => child.issue_number)).toEqual([102, 101])
		expect(report.total_ms).toBe(10 * MINUTE_MS)
		expect(report.measured_count).toBe(2)
		expect(report.trend).toMatchObject({ is_comparable: true, first_ms_per_turn: 2 * MINUTE_MS })
	})

	// The batch total is the sum of the children's shares, and a child that never ran contributes
	// nothing to it while still being listed as `not run` rather than as `0.0 min`.
	it('keeps a child that never ran out of the total and names it in a note', async () => {
		stub_children(
			new Map([
				[101, report_of({ issue_number: 101, start_minute: 10 })],
				[102, report_of({ issue_number: 102, has_ci_data: false, span_count: 0 })],
			]),
		)

		const report = await batch_of(PAIR_BODY)

		expect(report.unmeasured_count).toBe(1)
		expect(report.total_ms).toBe(2 * MINUTE_MS)
		expect(report.children.at(-1)?.status).toBe(time_epic.NOT_RUN)
		expect(report.notes.join('\n')).toContain('not run')
	})
})

// The batch reads the transcript corpus once and attributes that one pass to every child. It used
// to read it inside each child's report, so an eleven-child epic walked 669 files eleven times
// (joshuafolkken/kit#1284).
describe('time_epic.build_epic_report — one transcript pass for the whole batch', () => {
	it('collects the corpus once however many children the epic tracks', async () => {
		// Stubbed rather than called through: the real walk resolves against `homedir()`, and this
		// suite never redirects that — on a machine that happens to have a transcript directory for
		// `CWD`, calling through would read that person's own sessions.
		const collect = vi.spyOn(time_corpus, 'collect_for_issues').mockReturnValue(new Map())

		stub_children(new Map())
		await batch_of(body_of([ROW_101, ROW_102, ROW_103]))

		expect(collect).toHaveBeenCalledTimes(1)
		expect(collect).toHaveBeenCalledWith(CWD, [101, 102, 103])
	})

	// Each child is still measured against its own slice: one pass must not become one shared answer.
	it('hands each child the slice collected for its own issue', async () => {
		const spans = new Map([
			[101, { spans: [], session_count: 1 }],
			[102, { spans: [], session_count: 2 }],
		])

		vi.spyOn(time_corpus, 'collect_for_issues').mockReturnValue(spans)
		const build = stub_children(new Map())

		await batch_of(PAIR_BODY)

		expect(build.mock.calls.map((call) => call[3]?.found)).toEqual([spans.get(101), spans.get(102)])
	})
})

// The same duplication, one data source over: the listing was paged once per child, and the two
// children of epic #1272 with no pull request read all five pages each to establish it
// (joshuafolkken/kit#1292).
async function pulls_asked_for(rows: ReadonlyArray<string>): Promise<Array<string>> {
	const asked: Array<string> = []

	vi.spyOn(time_corpus, 'collect_for_issues').mockReturnValue(new Map())
	stub_children(new Map())
	await time_epic.build_epic_report(EPIC, CWD, reader_of(body_of(rows), asked))

	return pulls_asked(asked)
}

describe('time_epic.build_epic_report — one pull-request walk for the whole batch', () => {
	it('costs the same listing requests for three children as for one', async () => {
		const three = await pulls_asked_for([ROW_101, ROW_102, ROW_103])

		vi.restoreAllMocks()

		const one = await pulls_asked_for([ROW_101])

		expect(three).toHaveLength(one.length)
		expect(three).toHaveLength(1)
	})

	// One walk must not become one shared answer: each child is still handed the result found for its
	// own issue number. **The page holds a different pull request for each child on purpose** — given
	// two children the same empty answer, handing every child `searches.get(numbers[0])` would pass
	// this too, which is the regression it exists to catch.
	it('hands each child the pull request found for its own issue', async () => {
		vi.spyOn(time_corpus, 'collect_for_issues').mockReturnValue(new Map())
		const build = stub_children(new Map())
		const page = JSON.stringify([raw_pull(11, '101-a'), raw_pull(22, '102-b')])

		await time_epic.build_epic_report(EPIC, CWD, reader_of(PAIR_BODY, [], page))

		expect(build.mock.calls.map((call) => call[3]?.search?.pull?.number)).toEqual([11, 22])
	})

	// And a child the walk found nothing for is told so, rather than inheriting a sibling's answer.
	it('tells a child with no pull request that the listing held none', async () => {
		vi.spyOn(time_corpus, 'collect_for_issues').mockReturnValue(new Map())
		const build = stub_children(new Map())

		await batch_of(PAIR_BODY)

		expect(build.mock.calls.map((call) => call[3]?.search)).toEqual([
			EXHAUSTED_SEARCH,
			EXHAUSTED_SEARCH,
		])
	})
})

describe('time_epic.build_epic_report — what is not an answer', () => {
	it('fails as a whole only when the epic itself could not be read', async () => {
		expect(await time_epic.build_epic_report(EPIC, CWD, failing)).toBeUndefined()
	})

	// An epic that tracks nothing is a real, empty answer rather than a failure.
	it('answers with an empty batch when the body tracks no children', async () => {
		const report = await batch_of('no task list here')

		expect(report.children).toEqual([])
		expect(report.total_ms).toBe(0)
	})
})
