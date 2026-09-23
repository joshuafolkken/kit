#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { agent_role_profile, type AgentProvider } from '#scripts/agent/agent-role-profile'
import { codex_usage } from './codex-usage'
import { CONTEXT_CUT_THRESHOLD } from './context-cut-threshold'
import { cost_corpus } from './cost-corpus'
import { cost_transcript, type SessionUsage } from './cost-transcript'
import { cost_usage } from './cost-usage'
import { cost_verdict, type OverMeasurement } from './cost-verdict'
import { own_session } from './own-session'
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
// The read-only verdict's third answer, beside `cost_verdict`'s over/under: a session that cannot be
// priced at all. Kept here rather than in `cost_verdict`, which only ever decides over vs under.
const UNMEASURABLE_VERDICT = 'unmeasurable'

type CostVerdict = ReturnType<typeof cost_verdict.classify> | typeof UNMEASURABLE_VERDICT

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
// free" are different answers, and only one of them is ever true. `session_id` names the session the
// environment pointed at when its transcript is the one absent (joshuafolkken/kit#2403), so the
// message says "No transcript named <id>" rather than the whole-corpus "No transcripts found". The
// wording is `cost_transcript`'s, so `josh time` says the same thing about the same directory.
function report_empty(cwd: string, session_id: string | undefined): number {
	const searched = cost_transcript.searched_directories(cost_transcript.transcript_directories(cwd))

	for (const line of cost_transcript.missing_message(searched, session_id)) console.error(line)

	return FAILURE_EXIT_CODE
}

function provider_of(environment: Environment): AgentProvider | undefined {
	const resolved = agent_role_profile.resolve_provider(environment)

	return resolved.kind === 'provider' ? resolved.provider : undefined
}

// The own-session measurement, and — when there is none — which of the two "nothing to measure"
// answers it is (joshuafolkken/kit#2403). `absent`: the environment named a session whose transcript
// is not in this corpus, reported by that name and never measured as another session's newest file.
// `empty`: no transcript at all. `measured` still carries a session that exists but billed nothing,
// which `report_over` reports as "no requests" — a third, distinct answer.
type OwnMeasurement =
	| { kind: 'measured'; measurement: OverMeasurement }
	| { kind: 'absent'; session_id: string }
	| { kind: 'empty' }

function measurement_of(session: SessionUsage): OverMeasurement {
	return {
		billed_input_per_request: session.records.map((record) =>
			cost_usage.billed_input(record.totals),
		),
	}
}

function anthropic_own(target: string, environment: Environment): OwnMeasurement {
	const corpus = cost_corpus.load_corpus(target)
	const selection = own_session.select_own_session(corpus.files, environment)
	if (selection.kind === 'absent') return { kind: 'absent', session_id: selection.session_id }

	const session = corpus.sessions[selection.index]
	if (session === undefined) return { kind: 'empty' }

	return { kind: 'measured', measurement: measurement_of(session) }
}

function anthropic_measurement(
	target: string,
	environment: Environment,
): OverMeasurement | undefined {
	const own = anthropic_own(target, environment)

	return own.kind === 'measured' ? own.measurement : undefined
}

function same_openai_project(target: string, cwd: string): boolean {
	return cost_transcript.session_cwd(target) === cost_transcript.session_cwd(cwd)
}

function reject_openai_cross_project(context: RunContext, target: string, cwd: string): boolean {
	if (
		context.provider !== 'openai' ||
		context.path === undefined ||
		same_openai_project(target, cwd)
	) {
		return false
	}

	console.error(
		'OpenAI --path cannot select a thread from another project; run josh cost in that project.',
	)

	return true
}

// The active provider's own-session measurement, read the same way for `--over` and for the
// read-only `session_verdict` below, so the two never drift on which session they price.
function measure(
	target: string,
	provider: AgentProvider,
	environment: Environment,
): OverMeasurement | undefined {
	return provider === 'openai'
		? codex_usage.measurement(target, cost_transcript.home_directory(), environment)
		: anthropic_measurement(target, environment)
}

// `--over` for the anthropic provider: measured → the verdict; `absent` → the named session's
// missing message; `empty` → the whole-corpus missing message. A measured session that billed
// nothing falls to `report_over`'s "no requests", which keeps a 0-request transcript distinct from a
// transcript that is not there at all (joshuafolkken/kit#2403).
function run_over_anthropic(own: OwnMeasurement, target: string, limit: number): number {
	if (own.kind === 'measured') return cost_verdict.report_over(own.measurement, limit)

	return report_empty(target, own.kind === 'absent' ? own.session_id : undefined)
}

function run_over_codex(target: string, limit: number, environment: Environment): number {
	const measurement = measure(target, 'openai', environment)
	if (measurement !== undefined) return cost_verdict.report_over(measurement, limit)

	console.error(`No Codex usage found for the current OpenAI thread under ${target}.`)

	return FAILURE_EXIT_CODE
}

// `--over`: what the next turn of this session will cost, read from the session's own transcript
// alone — identified by id, not by mtime (joshuafolkken/kit#2403).
function run_over(
	target: string,
	limit: number,
	provider: AgentProvider,
	environment: Environment,
): number {
	if (provider === 'anthropic') {
		return run_over_anthropic(anthropic_own(target, environment), target, limit)
	}

	return run_over_codex(target, limit, environment)
}

// A measurement priced against the shared cut threshold, or `unmeasurable` for the empty session a
// `report_over` would refuse. Split from `session_verdict` so neither carries more than one decision.
function verdict_of(measurement: OverMeasurement | undefined): CostVerdict {
	if (measurement === undefined || measurement.billed_input_per_request.length === 0) {
		return UNMEASURABLE_VERDICT
	}

	return cost_verdict.classify(measurement, CONTEXT_CUT_THRESHOLD)
}

// The `--cut` verdict as a value, printing nothing (joshuafolkken/kit#2165). `run:status` bundles
// this beside the issue state and the carry record, so it needs the token rather than the exit code
// `run` returns. `unmeasurable` is the read-only counterpart of `report_empty` / the empty-session
// error: a session with no provider, no transcript of its own, or no request cannot be priced, and
// saying so is not the same as `under`.
function session_verdict(
	cwd: string = process.cwd(),
	environment: Environment = process.env,
): CostVerdict {
	const provider = provider_of(environment)
	if (provider === undefined) return UNMEASURABLE_VERDICT

	return verdict_of(measure(cwd, provider, environment))
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

// This process's own working directory, kept as-is: from a lane the transcript search covers the
// lane's own slug alone (joshuafolkken/kit#2236), so pre-rewriting the cwd to the main checkout here
// would drop the lane's own slug and hide a dispatched child's transcript (joshuafolkken/kit#1749).
// `time-cli.ts` gives the same reason.
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
	const target = transcript_cwd.resolve(context.path, cwd)
	if (reject_openai_cross_project(context, target, cwd)) return FAILURE_EXIT_CODE

	return run_over(target, context.over, context.provider, environment)
}

function main(argv: ReadonlyArray<string>): void {
	process.exitCode = run(argv)
}

const cost_cli = {
	UNMEASURABLE_VERDICT,
	USAGE,
	parse_options,
	to_threshold,
	load_corpus: cost_corpus.load_corpus,
	attributed: cost_corpus.attributed,
	run,
	session_verdict,
	main,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(ARGV_OFFSET))

export type { CostVerdict, Options }
export { cost_cli }
