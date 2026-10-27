import { gate_log } from '#scripts/gate/gate-log'
import type { KeptLog } from '#scripts/gate/verification-tail'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { stamp_file } from '#scripts/josh/stamp-file'
import { test_pinned_cache_logic } from './test-pinned-cache-logic'
import type { PinnedOrigin } from './test-pinned-ledger'
import { test_pinned_logic, type PinnedReport, type ReportParts } from './test-pinned-logic'

// The answer `josh test:pinned --record` leaves for `josh run:review --join` (joshuafolkken/kit#4770):
// the printed report and its unpinned count, keyed to the checkout. `run:review` starts the check in
// the background beside the gate and the brief, so the join — a later process — reads it here.
//
// **Each answer is filed under its launch's token**, so a read answers only for the token it asks
// with: a check an earlier start left running can still write after the next start cleared the record,
// and its answer — about a tree the join never asked about — lands in its own file rather than over
// this launch's. The token comes from the command line, so the file name carries its digest.

const RECORD_PREFIX = 'josh-test-pinned-record-'
const TOKEN_KEY_LENGTH = 16
const SITE_KEY_LENGTH = 16
const NOT_RUN_NOTE = '`josh test:pinned` could not run, so nothing was checked: '
const FIRST_UNPINNED_FLAG = '--first-unpinned'
const LIST_PREFIX = 'josh-test-pinned-list-'
const LIST_SUFFIX = '.log'
const LIST_HEADER = 'josh test:pinned — every unpinned and unchecked place'

type UnpinnedHunk = PinnedReport['unpinned'][number]

// `unpinned` holds one key per unpinned place (`site_of`); an identical place in the same file takes its
// occurrence number, so a copy added later is a place no record holds.
// `text`, `counts` and `log` are the printed report's parts (`test_pinned_logic.report_text`).
interface PinnedSummary extends ReportParts {
	unpinned: ReadonlyArray<string>
	// What a check still running reached so far; it is shown, never judged or remembered as the answer.
	is_partial?: boolean
	// A `--first-unpinned` check that stopped before some hunks (joshuafolkken/kit#5153): its unpinned
	// places are not every one, so no reason accepts it as the whole answer.
	is_cut?: boolean
}

// A place's key leaves out its line, so merging the default branch in, which moves the line, keeps the
// key (joshuafolkken/kit#4775): the file, the function, and a digest of the lines the change replaced
// and the lines it put in their place.
function site_of(hunk: UnpinnedHunk): string {
	const body = JSON.stringify([hunk.new_count, hunk.old_lines, hunk.new_lines ?? []])
	const key = stamp_file.digest(body).slice(0, SITE_KEY_LENGTH)
	const place = hunk.function_name === undefined ? hunk.file : `${hunk.file} ${hunk.function_name}`

	return `${place} ${key}`
}

// **The full list goes to a log once any place is folded** (joshuafolkken/kit#5188): the printed report
// counts the unchecked places by reason, so the list is kept where a `tail` cannot cut it.
function kept_log(report: PinnedReport, root: string): KeptLog | undefined {
	if (!test_pinned_logic.has_unchecked(report)) return undefined
	const output = test_pinned_logic.format(report)
	const target = stamp_file.stamp_path(LIST_PREFIX, root, LIST_SUFFIX)

	return { path: gate_log.write_gate_log([{ header: LIST_HEADER, output }], target) }
}

function summary_with(report: PinnedReport, log: KeptLog | undefined): PinnedSummary {
	const summary = {
		...test_pinned_logic.report_parts(report),
		log,
		unpinned: test_pinned_cache_logic.distinct(report.unpinned.map((hunk) => site_of(hunk))),
	}

	return report.cut === undefined ? summary : { ...summary, is_cut: true }
}

function summary_of(report: PinnedReport, root: string = PROJECT_ROOT): PinnedSummary {
	return summary_with(report, kept_log(report, root))
}

// What a check still running has reached so far (joshuafolkken/kit#4936): `note` says the rest is to
// come. It keeps no list: the per-checkout list log is the finished check's, which its record names.
function partial_summary(report: PinnedReport, note: string): PinnedSummary {
	const summary = summary_with(report, undefined)

	return { ...summary, text: `${note}\n${summary.text}`, is_partial: true }
}

// A check that could not run checked nothing, so it names no unpinned place and the run fails open.
function not_run_summary(error: unknown): PinnedSummary {
	const message = error instanceof Error ? error.message : String(error)

	return { text: `${NOT_RUN_NOTE}${message}\n`, unpinned: [] }
}

function record_path(token: string, root: string = PROJECT_ROOT): string {
	const key = stamp_file.digest(token).slice(0, TOKEN_KEY_LENGTH)

	return stamp_file.stamp_path(`${RECORD_PREFIX}${key}-`, root)
}

function write(token: string, summary: PinnedSummary, root: string = PROJECT_ROOT): void {
	stamp_file.write_stamp(record_path(token, root), { token, ...summary })
}

function is_text_list(value: unknown): value is Array<string> {
	return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

// A kept log's path, absent from the record when its write failed.
function log_of(value: unknown): KeptLog | undefined {
	if (typeof value !== 'object' || value === null) return undefined
	const kept = value as Record<string, unknown>

	return { path: typeof kept['path'] === 'string' ? kept['path'] : undefined }
}

// The counts line and the log: absent from a check that could not run.
function tail_of(record: Record<string, unknown>): Pick<PinnedSummary, 'counts' | 'log'> {
	const { counts, log } = record

	return typeof counts === 'string' ? { counts, log: log_of(log) } : {}
}

function to_summary(record: Record<string, unknown>): PinnedSummary | undefined {
	const { text, unpinned, is_cut } = record

	if (typeof text !== 'string' || !is_text_list(unpinned)) return undefined
	const summary = { text, unpinned, ...tail_of(record) }

	return is_cut === true ? { ...summary, is_cut } : summary
}

function parsed(raw: string): Record<string, unknown> | undefined {
	try {
		const value: unknown = JSON.parse(raw)

		return typeof value === 'object' && value !== null
			? (value as Record<string, unknown>)
			: undefined
	} catch {
		return undefined
	}
}

function read(token: string, root: string = PROJECT_ROOT): PinnedSummary | undefined {
	const raw = stamp_file.read_stamp_text(record_path(token, root))
	const record = raw === undefined ? undefined : parsed(raw)

	if (record?.['token'] !== token) return undefined

	return to_summary(record)
}

function clear(token: string, root: string = PROJECT_ROOT): void {
	stamp_file.remove_stamp(record_path(token, root))
}

// A recorded launch's `josh test:pinned` arguments, the token last. **With no `--unpinned-ok` reason it
// stops at the first unpinned hunk** (joshuafolkken/kit#5153): the launcher stops on it whatever the
// rest say. Under a reason every hunk is probed, since a reason accepts the list as the whole answer.
// `origin` names the launcher on the run's ledger row (joshuafolkken/kit#5262).
function launch_argv(
	token: string,
	reason: string | undefined,
	origin: PinnedOrigin,
): Array<string> {
	const cut = reason === undefined ? [FIRST_UNPINNED_FLAG] : []

	return ['test:pinned', ...cut, '--origin', origin, '--record', token]
}

const test_pinned_record = {
	clear,
	launch_argv,
	is_text_list,
	not_run_summary,
	parsed,
	partial_summary,
	read,
	record_path,
	summary_of,
	write,
}

export type { PinnedSummary }
export { test_pinned_record }
