import { ci_timing, type TimingAnswer } from '#scripts/ci/ci-timing'
import type { JobTiming, TimingRow } from '#scripts/ci/ci-timing-table'
import { lane_paths } from './lane-paths'

// `josh lane:why`'s followup CI cell (joshuafolkken/kit#6124): the longest job of the lane's CI runs
// and that job's longest step, read through `ci_timing.timing_of` — blank when the timing is
// unreadable or holds no measured job.

const BLANK = ''
const UNMEASURED = -1

function seconds_of(row: TimingRow | undefined): number {
	return row?.seconds ?? UNMEASURED
}

function longest<T extends TimingRow>(rows: ReadonlyArray<T>): T | undefined {
	return rows
		.toSorted((left, right) => seconds_of(right) - seconds_of(left))
		.find((row) => row.seconds !== undefined)
}

function row_text(label: string, row: TimingRow | undefined): string {
	return row === undefined ? BLANK : `${label}: ${row.name} ${String(row.seconds)}s`
}

// The longest job and its longest step, blank when no job was measured.
function cell(answer: TimingAnswer | undefined): string {
	if (answer?.kind !== 'timed') return BLANK

	const job = longest<JobTiming>(answer.runs.flatMap((run) => run.jobs))

	if (job === undefined) return BLANK

	return [row_text('longest job', job), row_text('step', longest(job.steps))]
		.filter((part) => part !== BLANK)
		.join(', ')
}

// The lane branch's timing, `undefined` when `ci:timing` cannot read it.
async function read(issue: number): Promise<TimingAnswer | undefined> {
	try {
		return await ci_timing.timing_of(lane_paths.lane_branch(String(issue)))
	} catch {
		return undefined
	}
}

const lane_why_ci = { cell, read }

export { lane_why_ci }
