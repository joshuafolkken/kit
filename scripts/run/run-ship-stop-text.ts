// The text a `josh ship` supervisor records when a stage stops, written and read in one place so the
// retrospective's per-stage count never drifts from the writer (joshuafolkken/kit#3245).
const STOP_PATTERN = /^#\d+ (\S+) failed — /u

function format(issue: string, reason: string): string {
	return `#${issue} ${reason} failed — pnpm josh ship --log ${issue}`
}

function reason_of(text: string): string | undefined {
	return STOP_PATTERN.exec(text)?.[1]
}

export const run_ship_stop_text = { format, reason_of }
