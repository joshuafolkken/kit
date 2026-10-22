import { issue_cite } from '#scripts/issue/issue-cite'

// The text a `josh ship` supervisor records when a stage stops, written and read in one place so the
// retrospective's per-stage count never drifts from the writer. The cause rides in parentheses after
// `failed` (`run-ship-stop-cause.ts`); a text written before it had one reads back with none.
const STOP_PATTERN = /^#\d+ (?<reason>\S+) failed(?: \((?<cause>\S+)\))? — /u

function format(issue: string, reason: string, cause: string): string {
	return `${issue_cite.plain(issue)} ${reason} failed (${cause}) — pnpm josh ship --log ${issue}`
}

function reason_of(text: string): string | undefined {
	return STOP_PATTERN.exec(text)?.groups?.['reason']
}

function cause_of(text: string): string | undefined {
	return STOP_PATTERN.exec(text)?.groups?.['cause']
}

export const run_ship_stop_text = { format, reason_of, cause_of }
