import { issue_cite } from '#scripts/issue/issue-cite'

// The text a `josh ship` supervisor records when a stage stops, written and read in one place so the
// retrospective's per-stage count never drifts from the writer.
const STOP_PATTERN = /^#\d+ (\S+) failed — /u

function format(issue: string, reason: string): string {
	return `${issue_cite.plain(issue)} ${reason} failed — pnpm josh ship --log ${issue}`
}

function reason_of(text: string): string | undefined {
	return STOP_PATTERN.exec(text)?.[1]
}

export const run_ship_stop_text = { format, reason_of }
