import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CheckTotal } from './time-checks'
import { time_corpus } from './time-corpus'
import { time_epic_fixture } from './time-epic-fixture'
import { time_format } from './time-format'
import { time_last, type LastTimeReport } from './time-last'
import type { MergedRun, RunSelection } from './time-last-select'
import type { PhaseTotal } from './time-phases'
import { time_pull_fixture, type RawPull } from './time-pull-fixture'
import { time_report, type TimeReport } from './time-report'
import { time_run } from './time-run'

// The distribution across the last N merged runs (joshuafolkken/kit#1312).
//
// The runs are stubbed rather than measured: what is under test is the aggregation, and a real report
// would need a transcript directory this suite has no business writing. The report and listing
// fixtures are the ones the epic suites read, so neither scope has its own idea of what a run's
// report looks like.

const { MINUTE_MS, report_of } = time_epic_fixture
const { raw_pull, reader, pulls_asked } = time_pull_fixture

const CWD = '/Users/someone/Development/kit'
const FIRST = 201
const SECOND = 202
const THIRD = 203
const ISSUES = [FIRST, SECOND, THIRD]
const RUN_COUNT = ISSUES.length
const TWO = 2
const FIXTURE_YEAR = 2026
const NEWEST_HOUR = 12
const MIDDLE_HOUR = 11
const OLDEST_HOUR = 10
const GATE = 'gate'
const UNIT_CHECK = 'unit'

function at(hour: number): string {
	return new Date(Date.UTC(FIXTURE_YEAR, 8, 5, hour)).toISOString()
}

function merged_pull(pull_number: number, issue_number: number, hour: number): RawPull {
	return raw_pull(pull_number, `${String(issue_number)}-a-change`, at(hour))
}

// Newest merge first, which is the order the rows come back in.
const PAGE: Array<RawPull> = [
	merged_pull(1, FIRST, NEWEST_HOUR),
	merged_pull(2, SECOND, MIDDLE_HOUR),
	merged_pull(3, THIRD, OLDEST_HOUR),
]

// A revert of the newest run: a second merge naming an issue already kept, which is one run and not
// two. Older than every row above it, so the fold keeps the original and absorbs this one.
const REVERT_PULL = 4
const REVERT_HOUR = 9
const REVERTED_PAGE: Array<RawPull> = [...PAGE, merged_pull(REVERT_PULL, FIRST, REVERT_HOUR)]

// A selected run, for the note cases that never reach the fan-out.
function run_of(index: number): MergedRun {
	const pull = PAGE[index] ?? PAGE[0]

	return {
		issue_number: ISSUES[index] ?? FIRST,
		merged_ms: 0,
		pull: {
			number: pull?.number ?? 1,
			branch: '',
			head_sha: '',
			created_ms: 0,
			merged_ms: 0,
			updated_ms: 0,
		},
	}
}

function gate_phase(minutes: number): PhaseTotal {
	return { phase: GATE, duration_ms: minutes * MINUTE_MS, is_detected: minutes > 0 }
}

function unit_check(minutes: number): CheckTotal {
	return {
		label: UNIT_CHECK,
		duration_ms: minutes * MINUTE_MS,
		conclusion: 'success',
		merge_gap_ms: -MINUTE_MS,
	}
}

// One report per issue, varying only what the case is about. `0` minutes means the phase was never
// detected — which is the case a distribution has to leave out rather than sample as zero.
function gate_reports(minutes: ReadonlyArray<number>): Map<number, TimeReport> {
	const entries: Array<[number, TimeReport]> = ISSUES.map((issue_number, index) => [
		issue_number,
		report_of({ issue_number, phases: [gate_phase(minutes[index] ?? 0)] }),
	])

	return new Map(entries)
}

function check_reports(minutes: ReadonlyArray<number>): Map<number, TimeReport> {
	const entries: Array<[number, TimeReport]> = ISSUES.map((issue_number, index) => [
		issue_number,
		report_of({ issue_number, by_check: [unit_check(minutes[index] ?? 0)] }),
	])

	return new Map(entries)
}

// Two runs with a transcript, and one that merged with none attributed — the case measured on epic
// #1272, and the one acceptance criterion three is about.
function one_unread_reports(): Map<number, TimeReport> {
	return new Map([
		[FIRST, report_of({ issue_number: FIRST, model_ms: 2 * MINUTE_MS })],
		[SECOND, report_of({ issue_number: SECOND, model_ms: 4 * MINUTE_MS })],
		[THIRD, report_of({ issue_number: THIRD, span_count: 0 })],
	])
}

afterEach(() => {
	vi.restoreAllMocks()
})

function stub_runs(reports: ReadonlyMap<number, TimeReport>): void {
	vi.spyOn(time_corpus, 'collect_for_issues').mockReturnValue(new Map())
	vi.spyOn(time_run, 'build_run_report').mockImplementation(
		async (issue_number: number) => reports.get(issue_number) ?? report_of({ issue_number }),
	)
}

async function measure_page(
	reports: ReadonlyMap<number, TimeReport>,
	page: ReadonlyArray<RawPull>,
	asked: Array<string> = [],
): Promise<LastTimeReport> {
	stub_runs(reports)

	const report = await time_last.build_last_report(RUN_COUNT, CWD, reader([[...page]], asked))

	if (report === undefined) throw new Error('no run could be resolved')

	return report
}

async function measure(
	reports: ReadonlyMap<number, TimeReport>,
	asked: Array<string> = [],
): Promise<LastTimeReport> {
	return await measure_page(reports, PAGE, asked)
}

// The rows a case asserts on are keyed by label, and the label is what a reader looks the row up by.
function row_of(rows: ReadonlyArray<{ label: string }>, label: string): unknown {
	return rows.find((row) => row.label === label)
}

function spread(sample_count: number, min: number, median: number, max: number): unknown {
	return {
		sample_count,
		min_ms: min * MINUTE_MS,
		median_ms: median * MINUTE_MS,
		max_ms: max * MINUTE_MS,
	}
}

describe('time_last.build_last_report — the distribution across several runs', () => {
	// The acceptance criterion: a set of runs produces the expected min, median and max.
	it('reports the smallest, middle and largest reading of each phase', async () => {
		const report = await measure(gate_reports([1, 5, 3]))

		expect(row_of(report.phases, GATE)).toEqual({
			label: GATE,
			distribution: spread(RUN_COUNT, 1, 3, 5),
		})
	})

	it('reports the same three figures per CI check', async () => {
		const report = await measure(check_reports([2, 4, 6]))

		expect(row_of(report.checks, UNIT_CHECK)).toEqual({
			label: UNIT_CHECK,
			distribution: spread(RUN_COUNT, 2, 4, 6),
		})
	})

	// A phase one run never detected is two readings, not three with a zero in it — the same
	// distinction one run's own report makes when it prints `not detected`.
	it('samples a phase only from the runs that detected it', async () => {
		const report = await measure(gate_reports([2, 4, 0]))

		expect(row_of(report.phases, GATE)).toEqual({
			label: GATE,
			distribution: spread(2, 2, 3, 4),
		})
	})

	// GitHub returns a retried job as a second check-run of the same name on the same head sha, so
	// counting the rows would report four readings for a three-run set — and the sample count is the
	// one thing on the row a reader leans on.
	it('counts a retried check once per run, taking its longest attempt', async () => {
		const reports = check_reports([2, 4, 6])
		const retried = report_of({ issue_number: FIRST, by_check: [unit_check(2), unit_check(9)] })

		const report = await measure(new Map([...reports, [FIRST, retried]]))

		expect(row_of(report.checks, UNIT_CHECK)).toEqual({
			label: UNIT_CHECK,
			distribution: spread(RUN_COUNT, 4, 6, 9),
		})
	})
})

describe('time_last.build_last_report — a run whose record could not be read', () => {
	// The acceptance criterion: excluded as unmeasured, never counted as zero.
	it('leaves it out of the transcript-side figures rather than counting it as zero', async () => {
		const report = await measure(one_unread_reports())

		expect(row_of(report.categories, time_report.MODEL_LABEL)).toEqual({
			label: time_report.MODEL_LABEL,
			distribution: spread(2, 2, 3, 4),
		})
	})

	it('says that it was excluded, and counts it', async () => {
		const report = await measure(one_unread_reports())

		expect(report.measured_count).toBe(2)
		expect(report.unmeasured_count).toBe(1)
		expect(report.notes.join('\n')).toContain(
			'excluded from the elapsed and transcript-side rows as unmeasured',
		)
	})
})

// The last exclusion the scope made in silence (joshuafolkken/kit#1365): a set of runs read from four
// merges reported three rows, and nothing in the text or the JSON said the fourth had been folded in.
describe('time_last.build_last_report — a duplicate merge folded into a run', () => {
	it('says a merge was collapsed, and names it', async () => {
		const report = await measure_page(gate_reports([1, 5, 3]), REVERTED_PAGE)

		expect(report.notes.join('\n')).toContain(
			`1 merged pull request(s) name the same issue as a run already kept and were collapsed into it (#${String(REVERT_PULL)})`,
		)
	})

	// `--json` is what a later reading is built from, so the fact has to survive the rendering rather
	// than living only in a sentence.
	it('carries the collapsed pull request on the report itself', async () => {
		const report = await measure_page(gate_reports([1, 5, 3]), REVERTED_PAGE)

		expect(report.collapsed_pulls).toEqual([REVERT_PULL])
	})

	it('says nothing at all where every run came from a single merge', async () => {
		const report = await measure(gate_reports([1, 5, 3]))

		expect(report.collapsed_pulls).toEqual([])
		expect(report.notes.join('\n')).not.toContain('collapsed into it')
	})

	// A revert-heavy window would otherwise print one sentence as long as the listing it walked. The
	// cap is on the line of text; `collapsed_pulls` on the report stays complete.
	it('caps the numbers it lists and says how many it withheld', () => {
		const many = Array.from({ length: time_format.MAX_ROWS + TWO }, (_, index) => index + 1)
		const note = time_last.collapsed_note(many).join('')

		expect(note).toContain(`#${String(time_format.MAX_ROWS)} and ${String(TWO)} more`)
		expect(note).not.toContain(`#${String(time_format.MAX_ROWS + 1)}`)
	})
})

function selection_of(found: number, end: RunSelection['end']): RunSelection {
	return {
		runs: Array.from({ length: found }, (_, index) => run_of(index)),
		skipped_count: 0,
		collapsed_pulls: [],
		end,
	}
}

describe('time_last.shortfall_notes', () => {
	// A failed read is reported even at the full count, because what it costs is the claim rather than
	// the count — but "5 of the 5 asked for" reads as a no-op beside the warning.
	it('drops the count clause when the request was filled despite the failed read', () => {
		const note = time_last.shortfall_notes(RUN_COUNT, selection_of(RUN_COUNT, 'failed')).join('')

		expect(note).toContain('may not be the most recent merges')
		expect(note).not.toContain('asked for')
	})

	it('keeps the count clause when the failed read also came up short', () => {
		const note = time_last.shortfall_notes(RUN_COUNT, selection_of(1, 'failed')).join('')

		expect(note).toContain(`1 of the ${String(RUN_COUNT)} asked for`)
	})

	it('says nothing at all when the request was filled and the listing was read', () => {
		expect(time_last.shortfall_notes(RUN_COUNT, selection_of(RUN_COUNT, 'settled'))).toEqual([])
	})
})

describe('time_last.build_last_report — what it reads', () => {
	// The runs were selected *from* the listing, so paging it again to look them up would spend up to
	// five more requests to learn what was just read.
	it('pages the pull-request listing once for the whole set', async () => {
		const asked: Array<string> = []

		await measure(new Map(), asked)

		expect(pulls_asked(asked)).toHaveLength(1)
	})

	it('carries the runs newest merge first', async () => {
		const report = await measure(new Map())

		expect(report.runs.map((run) => run.issue_number)).toEqual(ISSUES)
	})

	// "No merged run could be resolved" is reported in words by the caller, never as a distribution of
	// zeroes — which would read as a repository whose runs all took no time.
	it('answers undefined when no merged run could be resolved', async () => {
		stub_runs(new Map())

		expect(await time_last.build_last_report(RUN_COUNT, CWD, reader([[]]))).toBeUndefined()
	})
})
