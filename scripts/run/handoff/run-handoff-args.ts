// `josh run:handoff`'s arguments: the workflow keyword, the entry typed after it, and the brief the
// consultation session wrote. `backlogrun` is told apart here because it is handed to `josh backlogrun`
// whole — its arguments are that command's, and it takes no brief.
//
// **A bare number is an issue.** A shell reads an unquoted `#12` as a comment, so `12` in the entry is
// handed to the child as `#12`, as `josh backlogrun` reads it (`backlogrun-args.ts`).

import type { AgentProvider } from '#scripts/agent/agent-provider'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'

const BRIEF_FLAG = '--brief-file'
const WIP_FLAG = '--wip'
// Hands off a brief the ledger already holds — a repeat meant, never one a shared path caused.
const AGAIN_FLAG = '--again'
const WIP_PREFIX = 'wip/'
const BACKLOG_KEYWORD = 'backlogrun'
// Not a workflow keyword: it prints a fresh brief path for the session to write its brief to.
const BRIEF_PATH_COMMAND = 'brief-path'
const AGENT_FLAG = '--agent'
const LONE_FLAGS: ReadonlySet<string> = new Set(['--stop', '--restart'])
// `josh backlogrun --agent` names a provider by its CLI.
const AGENT_NAMES: Readonly<Record<AgentProvider, string>> = {
	anthropic: 'claude',
	openai: 'codex',
}
const NOT_FOUND = -1
const FLAG_AND_VALUE = 2

// `retrospective` is started by a backlogrun at its end, never typed, so it takes no entry and no brief
// file — its brief is generated (`run-handoff-retrospective.ts`).
const RETROSPECTIVE_KEYWORD = 'retrospective'
const TYPED_KEYWORDS = ['kickoff', 'fullrun', 'halfrun', 'prrun'] as const
const WORKFLOW_KEYWORDS = [...TYPED_KEYWORDS, RETROSPECTIVE_KEYWORD] as const

// Every keyword a person types to `run:handoff` — the one list the `session-lang` prompt hook matches too.
const KEYWORDS: ReadonlyArray<string> = [...TYPED_KEYWORDS, BACKLOG_KEYWORD]

type WorkflowKeyword = (typeof WORKFLOW_KEYWORDS)[number]

// Widened so `.includes()` takes any token; the guard below narrows it back.
const WORKFLOW_KEYWORD_TOKENS: ReadonlyArray<string | undefined> = WORKFLOW_KEYWORDS

interface WorkflowHandoff {
	kind: 'workflow'
	keyword: WorkflowKeyword
	// The keyword line the child is started with, as the person typed it.
	line: string
	// `undefined` for `retrospective`, whose brief is generated rather than read.
	brief_file: string | undefined
	// The `wip/<name>` branch `--wip` names for the filed Issue to adopt; `undefined` without the flag.
	wip?: string | undefined
	// `--again`: the brief is handed off even when the ledger holds it (`run-handoff-brief.ts`).
	again?: boolean
}

type Taken =
	| { kind: 'taken'; value: string | undefined; rest: ReadonlyArray<string> }
	| { kind: 'missing' }
	| { kind: 'twice' }

type HandoffArguments =
	| WorkflowHandoff
	| { kind: 'backlogrun'; rest: ReadonlyArray<string> }
	| { kind: typeof BRIEF_PATH_COMMAND }
	| { kind: 'refused'; note: string }

function is_workflow_keyword(token: string | undefined): token is WorkflowKeyword {
	return WORKFLOW_KEYWORD_TOKENS.includes(token)
}

function refused(note: string): HandoffArguments {
	return { kind: 'refused', note }
}

// `flag`'s value taken out of `rest`; `missing` when the flag has no value, `twice` when it repeats.
function take_flag(rest: ReadonlyArray<string>, flag: string): Taken {
	const at = rest.indexOf(flag)

	if (at === NOT_FOUND) return { kind: 'taken', value: undefined, rest }

	const value = rest[at + 1]

	if (value === undefined || value.startsWith('-')) return { kind: 'missing' }

	const left = [...rest.slice(0, at), ...rest.slice(at + FLAG_AND_VALUE)]

	return left.includes(flag) ? { kind: 'twice' } : { kind: 'taken', value, rest: left }
}

function flag_note(
	taken: Exclude<Taken, { kind: 'taken' }>,
	flag: string,
	missing: string,
): string {
	return taken.kind === 'twice' ? `${flag} is given more than once` : missing
}

// `--wip <name>` names the consultation's `wip/<name>` branch; the `wip/` prefix may be typed or not.
function wip_branch(name: string | undefined): string | undefined {
	if (name === undefined || name.startsWith(WIP_PREFIX)) return name

	return `${WIP_PREFIX}${name}`
}

function workflow_of(keyword: WorkflowKeyword, rest: ReadonlyArray<string>): HandoffArguments {
	const brief = take_flag(rest, BRIEF_FLAG)
	const brief_missing = `${keyword} needs ${BRIEF_FLAG} <path>`

	if (brief.kind !== 'taken') return refused(flag_note(brief, BRIEF_FLAG, brief_missing))

	if (brief.value === undefined) return refused(brief_missing)

	const wip = take_flag(brief.rest, WIP_FLAG)

	if (wip.kind !== 'taken') return refused(flag_note(wip, WIP_FLAG, `${WIP_FLAG} needs <name>`))

	const entry = wip.rest.filter((token) => token !== AGAIN_FLAG)
	const line = [keyword, ...entry.map((token) => issue_number_shape.issue_token(token))].join(' ')
	const is_again = entry.length < wip.rest.length

	return {
		kind: 'workflow',
		keyword,
		line,
		brief_file: brief.value,
		wip: wip_branch(wip.value),
		again: is_again,
	}
}

function retrospective_of(rest: ReadonlyArray<string>): HandoffArguments {
	if (rest.length > 0) return refused(`${RETROSPECTIVE_KEYWORD} takes no other argument`)

	const keyword = RETROSPECTIVE_KEYWORD

	return { kind: 'workflow', keyword, line: keyword, brief_file: undefined }
}

function brief_path_of(rest: ReadonlyArray<string>): HandoffArguments {
	if (rest.length > 0) return refused(`${BRIEF_PATH_COMMAND} takes no other argument`)

	return { kind: BRIEF_PATH_COMMAND }
}

// The commands read apart from a typed workflow keyword; `undefined` for any other.
function untyped_of(
	keyword: string | undefined,
	rest: ReadonlyArray<string>,
): HandoffArguments | undefined {
	if (keyword === BACKLOG_KEYWORD) return { kind: 'backlogrun', rest }

	if (keyword === RETROSPECTIVE_KEYWORD) return retrospective_of(rest)

	return keyword === BRIEF_PATH_COMMAND ? brief_path_of(rest) : undefined
}

function parse(argv: ReadonlyArray<string>): HandoffArguments {
	const [keyword, ...rest] = argv
	const untyped = untyped_of(keyword, rest)

	if (untyped !== undefined) return untyped

	if (!is_workflow_keyword(keyword)) {
		return refused(`expected one of ${WORKFLOW_KEYWORDS.join(', ')}, ${BACKLOG_KEYWORD}`)
	}

	return workflow_of(keyword, rest)
}

// `backlogrun`'s arguments with the main session's provider as `--agent`, unless one is typed;
// `--stop` / `--restart` stand alone in `josh backlogrun` (`backlogrun-args.ts`), so they take none.
function with_agent(rest: ReadonlyArray<string>, provider: AgentProvider): ReadonlyArray<string> {
	const is_kept = rest.includes(AGENT_FLAG) || rest.some((token) => LONE_FLAGS.has(token))

	return is_kept ? rest : [...rest, AGENT_FLAG, AGENT_NAMES[provider]]
}

const run_handoff_args = {
	AGAIN_FLAG,
	BACKLOG_KEYWORD,
	KEYWORDS,
	RETROSPECTIVE_KEYWORD,
	WORKFLOW_KEYWORDS,
	parse,
	wip_branch,
	with_agent,
}

export type { HandoffArguments, WorkflowHandoff, WorkflowKeyword }
export { run_handoff_args }
