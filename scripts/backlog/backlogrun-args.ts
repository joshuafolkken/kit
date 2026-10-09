import type { AgentProvider } from '#scripts/agent/agent-role-profile'
import { run_invocation } from '#scripts/run/run-invocation'

// `josh backlogrun`'s arguments. `--agent claude|codex` picks the agent the run
// is started in; everything else is the `backlogrun` invocation itself, read by `run-invocation.ts`'s
// grammar — the one the carry record and the woken session read — so the launcher accepts exactly what a
// typed `backlogrun` would carry, and the text the agent is handed is the grammar's rebuild of it.
//
// **A bare number is an issue.** A shell reads an unquoted `#3437` as a comment, so `3437` in the named
// list is taken as `#3437`; a number after the first flag is that flag's value and is left alone.

const AGENT_FLAG = '--agent'
const BACKLOG_COMMAND = 'backlogrun'
const ISSUE_PREFIX = '#'
const FLAG_PREFIX = '-'
const BARE_ISSUE = /^\d+$/u
const NOT_FOUND = -1
const FLAG_AND_VALUE = 2
const AGENTS: Readonly<Record<string, AgentProvider>> = { claude: 'anthropic', codex: 'openai' }
const DEFAULT_AGENT = 'claude'

interface BacklogrunArguments {
	provider: AgentProvider
	// The canonical `backlogrun …` text the agent is started with.
	invocation: string
	issues: ReadonlyArray<number>
}

type ArgumentsResult = { kind: 'args'; args: BacklogrunArguments } | { kind: 'refused' }

interface AgentSplit {
	agent: string | undefined
	rest: ReadonlyArray<string>
}

// `--agent` and its value out of the list; a second `--agent` stays in and the grammar refuses it.
function split_agent(argv: ReadonlyArray<string>): AgentSplit {
	const at = argv.indexOf(AGENT_FLAG)

	if (at === NOT_FOUND) return { agent: DEFAULT_AGENT, rest: argv }

	const after = at + FLAG_AND_VALUE

	return { agent: argv[at + 1], rest: [...argv.slice(0, at), ...argv.slice(after)] }
}

function issue_token(token: string): string {
	return BARE_ISSUE.test(token) ? `${ISSUE_PREFIX}${token}` : token
}

// The named list is the leading block before the first flag, as the grammar reads it.
function normalized(rest: ReadonlyArray<string>): Array<string> {
	const stop = rest.findIndex((token) => token.startsWith(FLAG_PREFIX))
	const split_at = stop === NOT_FOUND ? rest.length : stop

	return [...rest.slice(0, split_at).map((token) => issue_token(token)), ...rest.slice(split_at)]
}

function parse(argv: ReadonlyArray<string>): ArgumentsResult {
	const { agent, rest } = split_agent(argv)
	const provider = agent === undefined ? undefined : AGENTS[agent]
	const invocation = run_invocation.rebuild([BACKLOG_COMMAND, ...normalized(rest)].join(' '))

	if (provider === undefined || invocation === undefined) return { kind: 'refused' }

	const issues = run_invocation.issue_numbers(invocation) ?? []

	return { kind: 'args', args: { provider, invocation, issues } }
}

const backlogrun_args = { parse }

export type { BacklogrunArguments }
export { backlogrun_args }
