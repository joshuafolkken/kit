import { globSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { cost_transcript } from './cost-transcript'
import type { OverMeasurement } from './cost-verdict'

const THREAD_ID_PATTERN = /^[A-Za-z0-9-]+$/u
const SESSION_META_SCHEMA = z.looseObject({
	type: z.literal('session_meta'),
	payload: z.looseObject({ id: z.string(), cwd: z.string() }),
})
const TOTAL_USAGE_SCHEMA = z.looseObject({ input_tokens: z.number().nonnegative() })
const TOKEN_COUNT_SCHEMA = z.looseObject({
	type: z.literal('event_msg'),
	payload: z.looseObject({
		type: z.literal('token_count'),
		info: z.looseObject({
			total_token_usage: TOTAL_USAGE_SCHEMA,
			last_token_usage: TOTAL_USAGE_SCHEMA,
		}),
	}),
})

type Environment = Readonly<Record<string, string | undefined>>

function decode(line: string): unknown {
	try {
		return JSON.parse(line)
	} catch {
		return undefined
	}
}

function same_project(cwd: string, target: string): boolean {
	return cost_transcript.session_cwd(cwd) === cost_transcript.session_cwd(target)
}

function session_input(
	usages: ReadonlyArray<z.infer<typeof TOKEN_COUNT_SCHEMA>['payload']['info']>,
): number | undefined {
	const first = usages.at(0)
	const latest = usages.at(-1)
	if (first === undefined || latest === undefined) return undefined
	const baseline = first.total_token_usage.input_tokens - first.last_token_usage.input_tokens
	const input_tokens = latest.total_token_usage.input_tokens - baseline

	return input_tokens < 0 ? undefined : input_tokens
}

function measurement_from(
	content: string,
	target: string,
	thread_id: string,
): OverMeasurement | undefined {
	const values = content.split('\n').map((line) => decode(line))
	const metadata = values.flatMap((value) => {
		const parsed = SESSION_META_SCHEMA.safeParse(value)

		return parsed.success ? [parsed.data] : []
	})
	const usages = values.flatMap((value) => {
		const parsed = TOKEN_COUNT_SCHEMA.safeParse(value)

		return parsed.success ? [parsed.data.payload.info] : []
	})
	const session = metadata.find((entry) => entry.payload.id === thread_id)
	const input_tokens = session_input(usages)
	if (session === undefined || input_tokens === undefined) return undefined
	if (!same_project(session.payload.cwd, target)) return undefined

	return { request_count: usages.length, billed_input_tokens: input_tokens }
}

function rollout_files(home: string, thread_id: string): Array<string> {
	if (!THREAD_ID_PATTERN.test(thread_id)) return []

	return globSync(`sessions/**/*${thread_id}.jsonl`, { cwd: home }).map((file) =>
		path.join(home, file),
	)
}

function read_measurement(
	file: string,
	target: string,
	thread_id: string,
): OverMeasurement | undefined {
	try {
		return measurement_from(readFileSync(file, 'utf8'), target, thread_id)
	} catch {
		return undefined
	}
}

function latest_measurement(
	files: ReadonlyArray<string>,
	target: string,
	thread_id: string,
): OverMeasurement | undefined {
	for (const file of files.toReversed()) {
		const measured = read_measurement(file, target, thread_id)
		if (measured !== undefined) return measured
	}

	return undefined
}

function measurement(
	target: string,
	default_home: string,
	environment: Environment = process.env,
): OverMeasurement | undefined {
	const thread_id = environment['CODEX_THREAD_ID']
	if (thread_id === undefined) return undefined
	const home = environment['CODEX_HOME'] ?? path.join(default_home, '.codex')

	return latest_measurement(rollout_files(home, thread_id), target, thread_id)
}

const codex_usage = { measurement }

export { codex_usage }
