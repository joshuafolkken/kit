import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { stamp_file } from '#scripts/josh/stamp-file'
import { test_pinned_logic, type PinnedReport } from './test-pinned-logic'

// The answer `josh test:pinned --record` leaves for `josh run:review --join` (joshuafolkken/kit#4770):
// the printed report and its unpinned count, keyed to the checkout. `run:review` starts the check in
// the background beside the gate and the brief, so the join — a later process — reads it here.

const RECORD_PREFIX = 'josh-test-pinned-record-'
const NOT_RUN_NOTE = '`josh test:pinned` could not run, so nothing was checked: '

interface PinnedSummary {
	text: string
	unpinned_count: number
}

function summary_of(report: PinnedReport): PinnedSummary {
	return { text: test_pinned_logic.report_text(report), unpinned_count: report.unpinned.length }
}

// A check that could not run checked nothing, so it names no unpinned place and the run fails open.
function not_run_summary(error: unknown): PinnedSummary {
	const message = error instanceof Error ? error.message : String(error)

	return { text: `${NOT_RUN_NOTE}${message}\n`, unpinned_count: 0 }
}

function record_path(root: string = PROJECT_ROOT): string {
	return stamp_file.stamp_path(RECORD_PREFIX, root)
}

function write(summary: PinnedSummary, root: string = PROJECT_ROOT): void {
	stamp_file.write_stamp(record_path(root), summary)
}

function to_summary(value: unknown): PinnedSummary | undefined {
	if (typeof value !== 'object' || value === null) return undefined

	const { text, unpinned_count } = value as Record<string, unknown>

	if (typeof text !== 'string' || typeof unpinned_count !== 'number') return undefined

	return { text, unpinned_count }
}

function read(root: string = PROJECT_ROOT): PinnedSummary | undefined {
	const raw = stamp_file.read_stamp_text(record_path(root))

	if (raw === undefined) return undefined

	try {
		return to_summary(JSON.parse(raw))
	} catch {
		return undefined
	}
}

function clear(root: string = PROJECT_ROOT): void {
	stamp_file.remove_stamp(record_path(root))
}

const test_pinned_record = { clear, not_run_summary, read, record_path, summary_of, write }

export type { PinnedSummary }
export { test_pinned_record }
