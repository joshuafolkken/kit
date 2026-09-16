#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { agent_role_profile, type AgentProvider } from '#scripts/agent/agent-role-profile'
import { codex_usage } from './codex-usage'
import { CONTEXT_CUT_THRESHOLD } from './context-cut-threshold'
import { cost_corpus } from './cost-corpus'
import { cost_transcript } from './cost-transcript'
import { cost_usage } from './cost-usage'
import { cost_verdict, type OverMeasurement } from './cost-verdict'
import { transcript_cwd } from './transcript-cwd'

// `josh cost` — what the next turn of a run will cost, read from the active provider's own session
// usage (joshuafolkken/kit#962).
//
// Since #2016 this is the `--over` hand-off verdict alone. The readerless report scopes
// (`--session` / `--issue` / `--all` / `--run` / `--json`) and the `--cap` counterfactual were
// retired because no rule or decision read them — leaving only the entry judgment `fullrun` /
// `backlogrun` / `halfrun` / `pre-gate-cut` ask, and the `josh time` run-timing report keeps the
// hand-off aggregates used to compare the shared context-cut threshold.

const ARGV_OFFSET = 2
const FAILURE_EXIT_CODE = 1
const USAGE = 'Usage: josh cost (--cut | --over <tokens-per-request>) [--path <dir>]'

interface Options {
	over?: number
	// The target project whose transcripts to read, or absent for this process's own working
	// directory (joshuafolkken/kit#1987). From the kit checkout, `--path <dir>` reads another
	// project's cost.
	path?: string
}

interface RawValues {
	cut?: boolean | undefined
	over?: string | undefined
	path?: string | undefined
}

type Environment = Readonly<Record<string, string | undefined>>

interface RunContext {
	over: number
	path: string | undefined
	provider: AgentProvider
}

// A threshold of 0 is a legitimate limit — "hand off after any request at all" — so it is accepted.
// Negative is refused: there is no such thing as a negative cost. An empty value is refused too, so
// `--over=` does not arrive as "hand off after any request" and stop an unattended run after its
// first child.
function to_threshold(raw: string | undefined): number | undefined {
	if (raw === undefined) return undefined
	if (raw.trim() === '') return undefined

	const parsed = Number(raw)

	return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined
}

// A flag that was given but did not parse is a refusal, not an absent flag: `--over abc` must not
// silently become "no threshold".
function is_unparsed(raw: string | undefined, parsed: number | undefined): boolean {
	return parsed === undefined && raw !== undefined
}

function selected_threshold(values: RawValues): number | undefined {
	if (values.cut === true) return CONTEXT_CUT_THRESHOLD

	return to_threshold(values.over)
}

function threshold_option(over: number | undefined): Pick<Options, 'over'> {
	return over === undefined ? {} : { over }
}

function path_option(path: string | undefined): Pick<Options, 'path'> {
	return path === undefined ? {} : { path }
}

// `exactOptionalPropertyTypes` rejects `{ over: undefined }`, so an absent flag contributes no key
// at all rather than an undefined one.
function to_options(values: RawValues): Options | undefined {
	if (values.cut === true && values.over !== undefined) return undefined

	const over = selected_threshold(values)

	if (is_unparsed(values.over, over)) return undefined

	return { ...threshold_option(over), ...path_option(values.path) }
}

const PARSE_ARGS_OPTIONS = {
	cut: { type: 'boolean' },
	over: { type: 'string' },
	path: { type: 'string' },
} as const

function parse_options(argv: ReadonlyArray<string>): Options | undefined {
	try {
		const { values } = parseArgs({ args: [...argv], options: PARSE_ARGS_OPTIONS, strict: true })

		return to_options(values)
	} catch {
		return undefined
	}
}

// An empty corpus is reported, never priced at zero. "No transcript was found" and "this run was
// free" are different answers, and only one of them is ever true. The wording is `cost_transcript`'s,
// so `josh time` says the same thing about the same directory.
function report_empty(cwd: string): number {
	const searched = cost_transcript.searched_directories(cost_transcript.transcript_directories(cwd))

	for (const line of cost_transcript.missing_message(searched, undefined)) console.error(line)

	return FAILURE_EXIT_CODE
}

function provider_of(environment: Environment): AgentProvider | undefined {
	const raw = environment[agent_role_profile.PROVIDER_ENV_KEY]?.trim()
	const parsed = agent_role_profile.PROVIDER_SCHEMA.safeParse(
		raw === undefined || raw === '' ? agent_role_profile.DEFAULT_PROVIDER : raw,
	)

	return parsed.success ? parsed.data : undefined
}

function anthropic_measurement(target: string): OverMeasurement | undefined {
	const corpus = cost_corpus.load_corpus(target)
	const session = corpus.sessions[cost_transcript.latest_own_index(corpus.files)]
	if (session === undefined) return undefined

	return {
		request_count: session.records.length,
		billed_input_tokens: cost_usage.billed_input(cost_usage.sum_totals(session.records)),
	}
}

function report_missing(target: string, provider: AgentProvider): number {
	if (provider === 'anthropic') return report_empty(target)

	console.error(`No Codex usage found for the current OpenAI thread under ${target}.`)

	return FAILURE_EXIT_CODE
}

// `--over`: what the next turn of this session will cost, read from the latest own session alone.
function run_over(
	target: string,
	limit: number,
	provider: AgentProvider,
	environment: Environment,
): number {
	const measurement =
		provider === 'openai'
			? codex_usage.measurement(target, cost_transcript.home_directory(), environment)
			: anthropic_measurement(target)
	if (measurement === undefined) return report_missing(target, provider)

	return cost_verdict.report_over(measurement, limit)
}

function run_context(
	argv: ReadonlyArray<string>,
	environment: Environment,
): RunContext | undefined {
	const options = parse_options(argv)
	if (options?.over === undefined) return undefined
	const provider = provider_of(environment)
	if (provider === undefined) return undefined

	return { over: options.over, path: options.path, provider }
}

// This process's own working directory, kept as-is: the transcript search covers both a lane's own
// slug and the main checkout that slug resolves to (joshuafolkken/kit#1825), so pre-rewriting the cwd
// here would drop the lane's own slug and hide a dispatched child's transcript
// (joshuafolkken/kit#1749). `time-cli.ts` gives the same reason.
function run(
	argv: ReadonlyArray<string>,
	cwd: string = process.cwd(),
	environment: Environment = process.env,
): number {
	const context = run_context(argv, environment)

	if (context === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	// `--path <dir>` reads the target project instead of the process cwd (joshuafolkken/kit#1987).
	return run_over(
		transcript_cwd.resolve(context.path, cwd),
		context.over,
		context.provider,
		environment,
	)
}

function main(argv: ReadonlyArray<string>): void {
	process.exitCode = run(argv)
}

const cost_cli = {
	USAGE,
	parse_options,
	to_threshold,
	load_corpus: cost_corpus.load_corpus,
	attributed: cost_corpus.attributed,
	run,
	main,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(ARGV_OFFSET))

export type { Options }
export { cost_cli }
