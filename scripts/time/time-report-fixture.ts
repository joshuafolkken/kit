import type { CiFacts } from './time-ci'
import { time_report, type TimeReport } from './time-report'
import { time_rework, type DiffFacts } from './time-rework'
import { time_span_fixture } from './time-span-fixture'
import { time_spans, type Span, type Timeline } from './time-spans'

// The report a suite measures the rendering of, for the suites that read what `format_report` prints
// (joshuafolkken/kit#1311).
//
// It moved out of `time-report.test.ts` when the segment and per-invocation blocks joined it and the
// file passed its length limit — the same seam `time-phase-fixture.ts` was cut along, and for the
// same reason: a second copy of the run beside the second suite is the clone `CLAUDE.md` prohibits,
// in the one place a drift would make two suites disagree about what the report was built from.
//
// **`time-span-fixture.ts` stays where it is and is used here.** That one builds *a span*; this one
// builds *a report* out of several, which is the question these suites ask.

const { MINUTE_MS, span } = time_span_fixture
const SESSION = 'abcd1234'
const PNPM_LABEL = 'Bash: pnpm'
const RUN_SCOPE = 'issue #1268'
const SESSION_NOTE = '2 session(s)'

// The lengths `MIXED` is made of, named because a fixture is not a test file and the magic-number
// rule applies to it — the reason `time-phase-fixture.ts` left its own whole-run timeline behind
// rather than moving positions that have no names to give.
const MODEL_MINUTES = 4
const GATE_MINUTES = 3
const READ_MINUTES = 2
const LINT_MINUTES = 1
const WAIT_MINUTES = 10
// The run window `run_report` reports inside, and how long its one CI check took.
const WINDOW_MINUTES = 30
const CHECK_MINUTES = 2

// The merged diff `run_report` was measured against (joshuafolkken/kit#1387). One file rather than
// none, so the change-size rows carry a number a suite can tell apart from the withheld answer — and
// so the reconciliation has a path to match against.
const DIFF_ADDITIONS = 12
const DIFF_DELETIONS = 3
const DIFF_PATH = 'scripts/time/time-report.ts'
const DIFF_ROOT = '/Users/someone/Development/kit/'
const DIFF: DiffFacts = {
	files: [{ path: DIFF_PATH, additions: DIFF_ADDITIONS, deletions: DIFF_DELETIONS }],
	state: time_rework.DIFF_READ,
	root: DIFF_ROOT,
}

// One turn issuing three calls at once, with a person waited on at the end: every category present,
// and two different `josh` commands so the per-command table has more than one row.
const MIXED: ReadonlyArray<Span> = [
	span(time_spans.MODEL_CATEGORY, MODEL_MINUTES),
	span(time_spans.TOOL_CATEGORY, GATE_MINUTES, PNPM_LABEL, 'josh gate'),
	span(time_spans.TOOL_CATEGORY, READ_MINUTES, 'Read'),
	span(time_spans.TOOL_CATEGORY, LINT_MINUTES, PNPM_LABEL, 'josh lint'),
	span(time_spans.HUMAN_CATEGORY, WAIT_MINUTES),
]

function timeline(spans: ReadonlyArray<Span>): Timeline {
	const elapsed = spans.reduce((sum, entry) => sum + entry.duration_ms, 0)

	return { started_ms: MINUTE_MS, ended_ms: MINUTE_MS + elapsed, spans: [...spans] }
}

// One session, which is what `--session` reports: no pull request, so no CI share.
function build(spans: ReadonlyArray<Span>): TimeReport {
	return time_report.build_report(SESSION, timeline(spans))
}

// One run, which is what `--issue` reports, with the GitHub half handed over whole so a suite about a
// reading that *failed* builds the same run as one about a reading that succeeded
// (joshuafolkken/kit#1392). A second builder beside the second suite is the clone `CLAUDE.md`
// prohibits, in the one place a drift would have two suites disagreeing about the run underneath.
function run_report_of(spans: ReadonlyArray<Span>, ci: CiFacts): TimeReport {
	return time_report.build_from_spans({
		scope: RUN_SCOPE,
		spans,
		started_ms: 0,
		ended_ms: WINDOW_MINUTES * MINUTE_MS,
		ci,
		diff: DIFF,
		notes: [SESSION_NOTE],
		by_check: [
			{
				label: 'unit',
				duration_ms: CHECK_MINUTES * MINUTE_MS,
				conclusion: 'success',
				merge_gap_ms: -MINUTE_MS,
			},
		],
	})
}

// The cycles read, which is what every suite that is not about a failed reading wants: the CI share
// and the check table are present, and the fourth row is printed rather than withheld.
function run_report(spans: ReadonlyArray<Span>, ci_ms: number): TimeReport {
	return run_report_of(spans, { ci_ms, has_ci_data: true, windows: [], has_windows: true })
}

// The one row a case is about, so an assertion cannot pass on a word another row happens to carry —
// `no tool call to divide` is printed by the trips row and the cost row alike. Here rather than in
// each suite since joshuafolkken/kit#1385, when a second one needed it: a private copy beside the
// second suite is the clone `CLAUDE.md` prohibits.
function line_of(text: string, label: string): string {
	return text.split('\n').find((row) => row.includes(label)) ?? ''
}

const time_report_fixture = {
	MINUTE_MS,
	DIFF,
	DIFF_ADDITIONS,
	DIFF_DELETIONS,
	DIFF_PATH,
	DIFF_ROOT,
	MIXED,
	PNPM_LABEL,
	RUN_SCOPE,
	SESSION,
	SESSION_NOTE,
	build,
	line_of,
	run_report,
	run_report_of,
	timeline,
}

export { time_report_fixture }
