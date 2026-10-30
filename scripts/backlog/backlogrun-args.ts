import {
	agent_provider,
	type AgentEnvironment,
	type AgentProvider,
	type ProviderResult,
} from '#scripts/agent/agent-provider'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { run_invocation } from '#scripts/run/run-invocation'

// `josh backlogrun`'s arguments. `--agent claude|codex` picks the agent the run
// is started in; everything else is the `backlogrun` invocation itself, read by `run-invocation.ts`'s
// grammar — the one the carry record and the woken session read — so the launcher accepts exactly what a
// typed `backlogrun` would carry, and the text the agent is handed is the grammar's rebuild of it.
//
// **A bare number is an issue.** A shell reads an unquoted `#3437` as a comment, so `3437` in the named
// list is taken as `#3437`; a number after the first flag is that flag's value and is left alone.
//
// **`--stop` and `--restart` stand alone.** Each stops the run rather than starting one, so beside an
// issue or any other flag it is refused before anything is stopped — a mistyped start must never end a
// run.

const AGENT_FLAG = '--agent'
// A map, not an object literal: a token such as `constructor` must not read an inherited property.
const LONE_FLAGS: ReadonlyMap<string, LoneKind> = new Map([
	['--stop', 'stop'],
	['--restart', 'restart'],
])
const BACKLOG_COMMAND = 'backlogrun'
const ISSUE_PREFIX = '#'
const FLAG_PREFIX = '-'
const NOT_FOUND = -1
const FLAG_AND_VALUE = 2
const AGENTS: ReadonlyMap<string, AgentProvider> = new Map([
	['claude', 'anthropic'],
	['codex', 'openai'],
])

interface BacklogrunArguments {
	provider: AgentProvider
	// The canonical `backlogrun …` text the agent is started with.
	invocation: string
	issues: ReadonlyArray<number>
}

type LoneKind = 'stop' | 'restart'

type ArgumentsResult =
	| { kind: 'args'; args: BacklogrunArguments }
	| { kind: 'stop' }
	| { kind: 'restart' }
	| { kind: 'refused'; note?: string }

interface AgentSplit {
	agent: string | undefined
	rest: ReadonlyArray<string>
}

// `--agent` and its value out of the list; a second `--agent` stays in and the grammar refuses it.
function split_agent(argv: ReadonlyArray<string>): AgentSplit {
	const at = argv.indexOf(AGENT_FLAG)

	if (at === NOT_FOUND) return { agent: undefined, rest: argv }

	const after = at + FLAG_AND_VALUE

	return { agent: argv[at + 1] ?? '', rest: [...argv.slice(0, at), ...argv.slice(after)] }
}

// Only the configured default matters here; the invoking session does not select the new run.
function selected_provider(
	agent: string | undefined,
	environment: AgentEnvironment,
): ProviderResult {
	const { HANDED_PROVIDER_KEY } = agent_provider

	if (agent === undefined) {
		return agent_provider.resolve_provider({
			[HANDED_PROVIDER_KEY]: environment[HANDED_PROVIDER_KEY],
		})
	}

	const provider = AGENTS.get(agent)

	return provider === undefined
		? { kind: 'rejected', note: 'expected --agent claude|codex' }
		: { kind: 'provider', provider }
}

function issue_token(token: string): string {
	return issue_number_shape.ISSUE_NUMBER_PATTERN.test(token) ? `${ISSUE_PREFIX}${token}` : token
}

// The named list is the leading block before the first flag, as the grammar reads it.
function normalized(rest: ReadonlyArray<string>): Array<string> {
	const stop = rest.findIndex((token) => token.startsWith(FLAG_PREFIX))
	const split_at = stop === NOT_FOUND ? rest.length : stop

	return [...rest.slice(0, split_at).map((token) => issue_token(token)), ...rest.slice(split_at)]
}

function parse_start(argv: ReadonlyArray<string>, environment: AgentEnvironment): ArgumentsResult {
	const { agent, rest } = split_agent(argv)
	const selected = selected_provider(agent, environment)
	const invocation = run_invocation.rebuild([BACKLOG_COMMAND, ...normalized(rest)].join(' '))

	if (invocation === undefined) return { kind: 'refused' }

	if (selected.kind === 'rejected') {
		return agent === undefined ? { kind: 'refused', note: selected.note } : { kind: 'refused' }
	}

	const issues = run_invocation.issue_numbers(invocation) ?? []

	return { kind: 'args', args: { provider: selected.provider, invocation, issues } }
}

function parse(argv: ReadonlyArray<string>, environment: AgentEnvironment = {}): ArgumentsResult {
	const lone = argv.map((token) => LONE_FLAGS.get(token)).find((kind) => kind !== undefined)

	if (lone === undefined) return parse_start(argv, environment)

	return { kind: argv.length === 1 ? lone : 'refused' }
}

const backlogrun_args = { parse }

export type { ArgumentsResult, BacklogrunArguments }
export { backlogrun_args }
