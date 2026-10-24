import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { stamp_file } from '#scripts/josh/stamp-file'
import { test_pinned_logic, type PinnedReport } from './test-pinned-logic'

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

type UnpinnedHunk = PinnedReport['unpinned'][number]

// `unpinned` holds one key per unpinned place (`site_of`).
interface PinnedSummary {
	text: string
	unpinned: ReadonlyArray<string>
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

function summary_of(report: PinnedReport): PinnedSummary {
	return {
		text: test_pinned_logic.report_text(report),
		unpinned: report.unpinned.map((hunk) => site_of(hunk)),
	}
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

function to_summary(record: Record<string, unknown>): PinnedSummary | undefined {
	const { text, unpinned } = record

	if (typeof text !== 'string' || !is_text_list(unpinned)) return undefined

	return { text, unpinned }
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

const test_pinned_record = {
	clear,
	is_text_list,
	not_run_summary,
	parsed,
	read,
	record_path,
	summary_of,
	write,
}

export type { PinnedSummary }
export { test_pinned_record }
