import path from 'node:path'
import { delegation_policy } from '#scripts/delegation/delegation-policy'
import { issue_cite } from '#scripts/issue/issue-cite'
import { run_event_scope } from '#scripts/run/event/run-event-scope'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { test_declared_logic } from '#scripts/test/test-declared-logic'
import { lane_implement_stats } from './lane-implement-stats'
import type { ToolCall } from './lane-transcript-calls'

// What a lane's implementation spent its time on (joshuafolkken/kit#6983), counted off its transcripts
// as the run reaches the gate and written as one `lane-phase` trace — `#<N> signals edits=<n> …` —
// whose step no reader draws as a phase. `lane:why` reads it back as cause keys, so an implement
// overrun names what ran long instead of standing unattributed.

interface ImplementSignals {
	edits: number
	test_related: number
	lint_related: number
	investigations: number
	unplanned: number
}

const LABEL = 'signals'
const KIND = run_event_stream.EVENT_KIND.LANE_PHASE
const PAIR_SEPARATOR = '='
const WORD_SEPARATOR = ' '
// `#<N> signals …`: the label is the second word.
const LABEL_INDEX = 1
const FIELDS = {
	edits: 'edits',
	test_related: 'test-related',
	lint_related: 'lint-related',
	investigations: 'investigations',
	unplanned: 'unplanned',
} as const satisfies Record<keyof ImplementSignals, string>
// Outside the repository, and its untracked scratch (`.josh/tmp/` bodies), are not the lane's edits.
const OUTSIDE_PREFIXES = ['..', '.josh/']
// The command run as a shell command — at its start or after a separator — not a search for its name
// (`grep 'josh test:related'`) or a longer one sharing its prefix.
const TEST_RELATED = /(?:^|[;&|(]\s*)(?:pnpm )?josh test:related(?![\w:-])/u
const LINT_RELATED = /(?:^|[;&|(]\s*)(?:pnpm )?josh lint:related(?![\w:-])/u
// The split guide's file floor (`split-assessment.md`), here counting tests too, and the reruns past
// a first run and one retry.
const EDIT_BAR = 8
const RERUN_BAR = 2
const INVESTIGATION_BAR = 1
const FIELD_ORDER: ReadonlyArray<keyof ImplementSignals> = [
	'edits',
	'test_related',
	'lint_related',
	'investigations',
	'unplanned',
]

interface CauseBar {
	field: keyof ImplementSignals
	bar: number
	key: string
}

const KEYS: ReadonlyArray<CauseBar> = [
	{ field: 'unplanned', bar: 0, key: 'plan divergence' },
	{ field: 'edits', bar: EDIT_BAR, key: 'edited files' },
	{ field: 'test_related', bar: RERUN_BAR, key: 'test:related reruns' },
	{ field: 'lint_related', bar: RERUN_BAR, key: 'lint:related reruns' },
	{ field: 'investigations', bar: INVESTIGATION_BAR, key: 'investigation units' },
]

function edited_files(calls: ReadonlyArray<ToolCall>, root: string): Array<string> {
	const files = calls
		.filter((call) => lane_implement_stats.EDIT_TOOLS.has(call.tool ?? ''))
		.map((call) => call.file_path)
		.filter((file) => file !== undefined)
		.map((file) => path.relative(root, file))

	return [...new Set(files)].filter((file) =>
		OUTSIDE_PREFIXES.every((prefix) => !file.startsWith(prefix)),
	)
}

function command_count(calls: ReadonlyArray<ToolCall>, pattern: RegExp): number {
	return calls.filter((call) => pattern.test(call.command ?? '')).length
}

function is_investigator(call: ToolCall): boolean {
	return call.subagent?.type.split(':').at(-1) === delegation_policy.INVESTIGATOR_AGENT
}

// `planned` are the repository-relative paths the lane's plan holds; a test file is never planned.
function counts_of(
	calls: ReadonlyArray<ToolCall>,
	planned: ReadonlyArray<string>,
	root: string,
): ImplementSignals {
	const edits = edited_files(calls, root)
	const plan = new Set(planned)
	const outside = edits.filter((file) => !plan.has(file) && !test_declared_logic.is_test_file(file))

	return {
		edits: edits.length,
		test_related: command_count(calls, TEST_RELATED),
		lint_related: command_count(calls, LINT_RELATED),
		investigations: calls.filter((call) => is_investigator(call)).length,
		unplanned: outside.length,
	}
}

function text_of(issue: string, signals: ImplementSignals): string {
	const pairs = FIELD_ORDER.map(
		(field) => `${FIELDS[field]}${PAIR_SEPARATOR}${String(signals[field])}`,
	)

	return [issue_cite.plain_for('program', issue), LABEL, ...pairs].join(WORD_SEPARATOR)
}

function is_signals_of(event: RunEvent, issue: number): boolean {
	const label = event.text.split(WORD_SEPARATOR)[LABEL_INDEX]

	return (
		event.kind === KIND && label === LABEL && run_event_scope.issue_named(event) === String(issue)
	)
}

function pair_of(word: string): readonly [string, string] {
	const [name = '', value = ''] = word.split(PAIR_SEPARATOR)

	return [name, value]
}

function parse(text: string): ImplementSignals {
	const pairs = new Map(text.split(WORD_SEPARATOR).map((word) => pair_of(word)))

	function read(field: keyof ImplementSignals): number {
		return Number(pairs.get(FIELDS[field]) ?? 0)
	}

	return {
		edits: read('edits'),
		test_related: read('test_related'),
		lint_related: read('lint_related'),
		investigations: read('investigations'),
		unplanned: read('unplanned'),
	}
}

// `issue`'s newest recorded signals, `undefined` for a lane that recorded none.
function signals_of(events: ReadonlyArray<RunEvent>, issue: number): ImplementSignals | undefined {
	const event = events.findLast((candidate) => is_signals_of(candidate, issue))

	return event === undefined ? undefined : parse(event.text)
}

// The cause keys of the signals past their bar, in `KEYS` order.
function keys_of(signals: ImplementSignals): Array<string> {
	return KEYS.filter(({ field, bar }) => signals[field] > bar).map(({ key }) => key)
}

const lane_implement_signals = { KIND, counts_of, is_signals_of, keys_of, signals_of, text_of }

export { lane_implement_signals }
export type { ImplementSignals }
