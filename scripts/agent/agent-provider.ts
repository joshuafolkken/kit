import { agent_session_environment } from '#scripts/josh/agent-session-environment'
import { z } from 'zod'

// Which provider an agent session runs on, read from the session's own keys or the mark a detached
// launch hands its child. `agent-role-profile.ts` resolves a role's profile on top of it.

const EMPTY_LENGTH = 0

const PROVIDER_SCHEMA = z.enum(['anthropic', 'openai'])

type AgentProvider = z.infer<typeof PROVIDER_SCHEMA>
type AgentEnvironment = Readonly<Record<string, string | undefined>>

interface Rejected {
	kind: 'rejected'
	note: string
}

type ProviderResult = Rejected | { kind: 'provider'; provider: AgentProvider; is_default?: true }

const ANTHROPIC_PROVIDER: AgentProvider = 'anthropic'
const OPENAI_PROVIDER: AgentProvider = 'openai'
const CODEX_SESSION_KEY = 'CODEX_THREAD_ID'

function trimmed(value: string | undefined): string | undefined {
	const result = value?.trim()

	return result === undefined || result.length === EMPTY_LENGTH ? undefined : result
}

function rejection(key: string, value: string, expected: string): Rejected {
	return { kind: 'rejected', note: `${key}=${value} ${expected}, so the agent was not started` }
}

function has_session(environment: AgentEnvironment, keys: ReadonlyArray<string>): boolean {
	return keys.some((key) => trimmed(environment[key]) !== undefined)
}

const CONFLICTING_SESSIONS: Rejected = {
	kind: 'rejected',
	note: 'both Codex and Claude Code sessions were detected',
}

// The provider a detached launcher hands a process that is not itself an agent session.
// `detached_launch` strips the parent-session keys — the very keys the
// detection below reads — so a `josh ship --detach --review` supervisor could never resolve its reviewer.
// **It is a fallback, read only when no session is detected**: the mark is inherited by everything the
// supervisor starts, and a real session's own keys must keep deciding for that session.
const HANDED_PROVIDER_KEY = 'JOSH_AGENT_PROVIDER'

// **Nothing named a provider, so Claude Code is the default** — a person typing `josh lane:launch` in a
// plain terminal has no session and no mark. Only silence defaults: two detected sessions and a mark
// naming no allowed provider still refuse. `is_default` lets a launch say so, and lets `josh cost` keep
// reading "no session of its own" rather than pricing another session's transcript.
const DEFAULT_PROVIDER: ProviderResult = {
	kind: 'provider',
	provider: ANTHROPIC_PROVIDER,
	is_default: true,
}
const DEFAULT_NOTICE = ` No agent session or ${HANDED_PROVIDER_KEY} was found, so the provider defaulted to ${ANTHROPIC_PROVIDER} (Claude Code).`

function handed_provider(environment: AgentEnvironment): ProviderResult {
	const value = trimmed(environment[HANDED_PROVIDER_KEY])
	if (value === undefined) return DEFAULT_PROVIDER
	const parsed = PROVIDER_SCHEMA.safeParse(value)

	return parsed.success
		? { kind: 'provider', provider: parsed.data }
		: rejection(HANDED_PROVIDER_KEY, value, 'is not an allowed provider')
}

// The session this process runs in, read from its own keys: `undefined` when none is detected.
function detected_provider(environment: AgentEnvironment): ProviderResult | undefined {
	const has_codex = has_session(environment, [CODEX_SESSION_KEY])
	const has_claude = has_session(environment, agent_session_environment.PARENT_SESSION_KEYS)

	if (has_codex === has_claude) return has_codex ? CONFLICTING_SESSIONS : undefined

	return { kind: 'provider', provider: has_codex ? OPENAI_PROVIDER : ANTHROPIC_PROVIDER }
}

function resolve_provider(environment: AgentEnvironment = process.env): ProviderResult {
	return detected_provider(environment) ?? handed_provider(environment)
}

// The sentence a launch appends when it ran on the default, so falling back is never silent; empty when
// a session or a mark decided.
function default_notice(environment: AgentEnvironment = process.env): string {
	const selected = resolve_provider(environment)

	return selected.kind === 'provider' && selected.is_default === true ? DEFAULT_NOTICE : ''
}

// The same sentence on stderr, for a launcher whose own line is a verdict or a brief another process
// reads: `run:wake --start`, `review:brief` and `ship --detach` default exactly as a dispatch does.
function warn_of_default(environment: AgentEnvironment = process.env): void {
	const notice = default_notice(environment).trim()

	if (notice !== '') console.error(notice)
}

// Whether this session is woken when a background command it started completes.
// Claude Code re-invokes the session at the completion; a Codex session is not
// re-invoked, so a parent there can only wait by polling, each poll a model call over its whole context.
// Only a resolved Codex session answers no — a defaulted or conflicting one keeps the callback.
function has_completion_callback(environment: AgentEnvironment = process.env): boolean {
	const selected = resolve_provider(environment)

	return selected.kind !== 'provider' || selected.provider !== OPENAI_PROVIDER
}

// The mark a detached launch sets on its child: the provider this session resolved, the default
// included, or nothing when it was refused — the child then fails the same way this session would have.
function handoff_environment(
	environment: AgentEnvironment = process.env,
): Readonly<Record<string, string>> {
	const selected = resolve_provider(environment)

	return selected.kind === 'provider' ? { [HANDED_PROVIDER_KEY]: selected.provider } : {}
}

const agent_provider = {
	ANTHROPIC_PROVIDER,
	CODEX_SESSION_KEY,
	HANDED_PROVIDER_KEY,
	OPENAI_PROVIDER,
	PROVIDER_SCHEMA,
	default_notice,
	handoff_environment,
	has_completion_callback,
	rejection,
	resolve_provider,
	trimmed,
	warn_of_default,
}

export type { AgentEnvironment, AgentProvider, ProviderResult, Rejected }
export { agent_provider }
