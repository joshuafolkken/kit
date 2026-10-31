import { z } from 'zod'

// The job and step durations of one GitHub Actions run, built from the jobs endpoint's answer
// (`ci-timing.ts` reads it) — the rows `josh ci:timing` prints.

const MS_PER_SECOND = 1000
const STEP_INDENT = '  '
const HEADER: [string, string, string] = ['job / step', 's', 'conclusion']
const UNMEASURED = '—'
const COLUMN_GAP = '  '

// REST answers `null` for a job or step that has not started or finished.
const timed_schema = z.looseObject({
	name: z.string(),
	conclusion: z.string().nullish(),
	started_at: z.string().nullish(),
	completed_at: z.string().nullish(),
})

const job_schema = timed_schema.extend({ steps: z.array(timed_schema).optional() })

const jobs_page_schema = z.looseObject({ jobs: z.array(job_schema) })

type Timed = z.infer<typeof timed_schema>

interface TimingRow {
	name: string
	seconds: number | undefined
	conclusion: string | undefined
}

interface JobTiming extends TimingRow {
	steps: Array<TimingRow>
}

function seconds_of(item: Timed): number | undefined {
	if (!item.started_at || !item.completed_at) return undefined

	return Math.round((Date.parse(item.completed_at) - Date.parse(item.started_at)) / MS_PER_SECOND)
}

function row_of(item: Timed): TimingRow {
	return { name: item.name, seconds: seconds_of(item), conclusion: item.conclusion ?? undefined }
}

function jobs_of(page: unknown): Array<JobTiming> {
	return jobs_page_schema
		.parse(page)
		.jobs.map((job) => ({ ...row_of(job), steps: (job.steps ?? []).map((step) => row_of(step)) }))
}

function cells_of(row: TimingRow, indent: string): [string, string, string] {
	return [
		`${indent}${row.name}`,
		row.seconds === undefined ? UNMEASURED : String(row.seconds),
		row.conclusion ?? UNMEASURED,
	]
}

function line_of(cells: [string, string, string], widths: [number, number]): string {
	const [name, seconds, conclusion] = cells

	return [name.padEnd(widths[0]), seconds.padStart(widths[1]), conclusion].join(COLUMN_GAP)
}

// One line per job, its steps indented under it, the seconds right-aligned.
function table(jobs: ReadonlyArray<JobTiming>): string {
	const cells = jobs.flatMap((job) => [
		cells_of(job, ''),
		...job.steps.map((step) => cells_of(step, STEP_INDENT)),
	])
	const all = [HEADER, ...cells]
	const widths: [number, number] = [
		Math.max(...all.map(([name]) => name.length)),
		Math.max(...all.map(([, seconds]) => seconds.length)),
	]

	return all.map((row) => line_of(row, widths)).join('\n')
}

const ci_timing_table = { jobs_of, table }

export { ci_timing_table }
export type { JobTiming, TimingRow }
