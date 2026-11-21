import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'

// joshuafolkken/kit#8128: an observation that samples a process hours apart lives in hidden-marked Issue
// comments — the one place that outlasts the lane, its worktree and the child that wrote it. Each
// step posts a new comment, so the newest marked one is the state and the older ones are its history.

const MARKER = 'josh:observe'
const MARKER_PATTERN = /<!-- josh:observe (?<json>\{.*\}) -->/u
const OFFSET_PATTERN = /^(?<amount>\d+)(?<unit>[mh])$/u
const UNIT_MS: Readonly<Record<string, number>> = { m: 60_000, h: 3_600_000 }
// One retake after the observed process is gone; a second loss is a failure for a person to read.
const MAX_RETAKES = 1

const SAMPLE_SCHEMA = z.object({ at: z.string(), value: z.string() })
const RECORD_SCHEMA = z.object({
	// The argv as typed after `--`, started without a shell so no argument is split again.
	command: z.array(z.string()).nonempty(),
	sample: z.string(),
	// A failed observation keeps only the offsets it sampled, so it reads as finished.
	offsets_ms: z.array(z.number().int().positive()),
	pid: z.number().int().positive(),
	process_start: z.string(),
	started_at: z.string(),
	samples: z.array(SAMPLE_SCHEMA),
	retakes: z.number().int().nonnegative(),
})

type ObserveRecord = z.infer<typeof RECORD_SCHEMA>
type ObserveSample = z.infer<typeof SAMPLE_SCHEMA>

// `30m` / `2h` as milliseconds, or `undefined` for any other spelling.
function offset_ms(text: string): number | undefined {
	const groups = OFFSET_PATTERN.exec(text)?.groups
	const ms = Number(groups?.['amount']) * Number(UNIT_MS[String(groups?.['unit'])])

	return ms > 0 ? ms : undefined
}

// The record a comment carries, or `undefined` for a comment with no marker or a broken one.
function record_of(body: string): ObserveRecord | undefined {
	const json = MARKER_PATTERN.exec(body)?.groups?.['json']

	return json === undefined ? undefined : json_value.parse_with(json, RECORD_SCHEMA)
}

// The newest record among the issue's comments, oldest first as GitHub lists them.
function latest(bodies: ReadonlyArray<string>): ObserveRecord | undefined {
	return bodies.map((body) => record_of(body)).findLast((record) => record !== undefined)
}

// When the next sample is due, or `undefined` once every sample is taken.
function next_at_ms(record: ObserveRecord): number | undefined {
	const offset = record.offsets_ms[record.samples.length]

	return offset === undefined ? undefined : Date.parse(record.started_at) + offset
}

function can_retake(record: ObserveRecord): boolean {
	return record.retakes < MAX_RETAKES
}

function sample_lines(samples: ReadonlyArray<ObserveSample>): ReadonlyArray<string> {
	return samples.map(
		(sample, index) => `- ${String(index + 1)}: ${sample.at} — \`${sample.value}\``,
	)
}

// A comment a person reads first, the record a resumed child reads after.
function comment_of(record: ObserveRecord, note: string): string {
	return [
		`## Observation: ${note}`,
		'',
		`- Observed: \`${record.command.join(' ')}\` (pid ${String(record.pid)}, started ${record.started_at})`,
		`- Sample: \`${record.sample}\``,
		...sample_lines(record.samples),
		'',
		`<!-- ${MARKER} ${JSON.stringify(record)} -->`,
	].join('\n')
}

const run_observe_state = { can_retake, comment_of, latest, next_at_ms, offset_ms, record_of }

export type { ObserveRecord }
export { run_observe_state }
