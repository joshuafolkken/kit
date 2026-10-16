import { agent_session_environment } from '#scripts/josh/agent-session-environment'
import { z } from 'zod'
import { agent_safe_text } from './agent-safe-text'

const EMPTY_LENGTH = 0

const ROLE_SCHEMA = z.enum(['scheduler', 'worker', 'reviewer'])
const PROVIDER_SCHEMA = z.enum(['anthropic', 'openai'])
const EFFORT_SCHEMA = z.enum(['low', 'medium', 'high', 'xhigh', 'max'])
// The run phases effort may vary by. They are the cut boundaries a lane child
// resumes across — `run-cut.ts` imports these names for its own cut record, so the phase a run passes
// and the phase this table is keyed on cannot drift. A phase-less call resolves the role default, which
// is what keeps every existing caller unchanged.
const PHASE_SCHEMA = z.enum(['implementation', 'pre-gate'])
const PROFILE_SCHEMA = z.object({
	provider: PROVIDER_SCHEMA.default('anthropic'),
	role: ROLE_SCHEMA,
	model: z.string(),
	effort: EFFORT_SCHEMA,
})

type AgentRole = z.infer<typeof ROLE_SCHEMA>
type AgentProvider = z.infer<typeof PROVIDER_SCHEMA>
type AgentEffort = z.infer<typeof EFFORT_SCHEMA>
type AgentPhase = z.infer<typeof PHASE_SCHEMA>
type AgentProfile = z.infer<typeof PROFILE_SCHEMA>
type AgentEnvironment = Readonly<Record<string, string | undefined>>
type ProfileResult = { kind: 'profile'; profile: AgentProfile } | { kind: 'rejected'; note: string }
type Rejected = Extract<ProfileResult, { kind: 'rejected' }>
type EffortResult = Rejected | { kind: 'effort'; effort: AgentEffort }
type ProviderResult = Rejected | { kind: 'provider'; provider: AgentProvider; is_default?: true }
type OverrideField = 'model' | 'effort'

interface Override {
	key: string
	value: string | undefined
}

// What a resolution is keyed on beyond the role: the run phase (effort) and the review round (profile).
interface AgentStage {
	phase?: string | undefined
	round?: number
}

const SCHEDULER: AgentRole = 'scheduler'
const WORKER: AgentRole = 'worker'
const REVIEWER: AgentRole = 'reviewer'
const IMPLEMENTATION_PHASE: AgentPhase = 'implementation'
const PRE_GATE_PHASE: AgentPhase = 'pre-gate'
const ANTHROPIC_PROVIDER: AgentProvider = 'anthropic'
const OPENAI_PROVIDER: AgentProvider = 'openai'
// **Pinned model ids, never a floating alias**. An alias such as `opus` moves
// whenever the CLI moves it, so a run log could not say which model produced it and a model migration
// could not be measured apart from everything else. A new lane records the id it resolved; a lane
// created before a migration keeps the model it recorded (`with_phase_effort` leaves it untouched).
const OPENAI_MODEL = 'gpt-6.1-sol'
const ANTHROPIC_MODEL = 'claude-opus-5-5'
const CODEX_SESSION_KEY = 'CODEX_THREAD_ID'

const DEFAULT_PROFILES: Readonly<Record<AgentRole, AgentProfile>> = {
	scheduler: {
		provider: ANTHROPIC_PROVIDER,
		role: SCHEDULER,
		model: ANTHROPIC_MODEL,
		effort: 'medium',
	},
	worker: { provider: ANTHROPIC_PROVIDER, role: WORKER, model: ANTHROPIC_MODEL, effort: 'medium' },
	reviewer: {
		provider: ANTHROPIC_PROVIDER,
		role: REVIEWER,
		model: ANTHROPIC_MODEL,
		effort: 'high',
	},
}

const OPENAI_PROFILES: Readonly<Record<AgentRole, AgentProfile>> = {
	scheduler: { provider: OPENAI_PROVIDER, role: SCHEDULER, model: OPENAI_MODEL, effort: 'medium' },
	worker: { provider: OPENAI_PROVIDER, role: WORKER, model: OPENAI_MODEL, effort: 'medium' },
	reviewer: { provider: OPENAI_PROVIDER, role: REVIEWER, model: OPENAI_MODEL, effort: 'high' },
}

const PROVIDER_PROFILES = { anthropic: DEFAULT_PROFILES, openai: OPENAI_PROFILES }

// **The verification pass resolves a profile of its own** (joshuafolkken/kit#3926). A round after the
// first only checks that the first round's findings were fixed, so its model and effort are set apart:
// its own keys win, then the reviewer's, then its own default.
const FIRST_REVIEW_ROUND = 1
// Sonnet holds the verification pass by the eval criterion: on every `verification-fix-*` scenario its
// pass/fail equals Opus's (100% agreement), and Opus passes all 4.
const VERIFICATION_MODEL = 'claude-sonnet-5-5'
const VERIFICATION_PROFILES: Readonly<Record<AgentProvider, AgentProfile>> = {
	anthropic: { ...DEFAULT_PROFILES.reviewer, model: VERIFICATION_MODEL },
	openai: OPENAI_PROFILES.reviewer,
}
const VERIFICATION_KEYS = {
	model: 'JOSH_REVIEWER_VERIFICATION_MODEL',
	effort: 'JOSH_REVIEWER_VERIFICATION_EFFORT',
}

// **Effort as a function of the run phase, not the role alone**. For the first
// merge only the mechanical ship/bookkeeping region is lowered: the pre-gate resume drives the gate,
// commit, PR and merge, applying fixes the gate has already named — work delegation.md calls the opposite
// of judgement. The design-judgment implementation phases keep the role default, as does any role/phase
// with no entry, and the review's own judgement is the reviewer role's (`high`), untouched by lowering
// the worker here. The investigation phase — highest output density — is left for a later merge, once
// the delegation half of this Issue has moved its reading out.
const SHIP_EFFORT: AgentEffort = 'low'
type PhaseEffortTable = Partial<Record<AgentRole, Partial<Record<AgentPhase, AgentEffort>>>>
const PHASE_EFFORT: Readonly<PhaseEffortTable> = {
	worker: { [PRE_GATE_PHASE]: SHIP_EFFORT },
}

const ENV_KEYS: Readonly<Record<AgentRole, { model: string; effort: string }>> = {
	scheduler: { model: 'JOSH_SCHEDULER_MODEL', effort: 'JOSH_SCHEDULER_EFFORT' },
	worker: { model: 'JOSH_WORKER_MODEL', effort: 'JOSH_WORKER_EFFORT' },
	reviewer: { model: 'JOSH_REVIEWER_MODEL', effort: 'JOSH_REVIEWER_EFFORT' },
}

const LEGACY_WORKER_KEYS = { model: 'JOSH_LANE_MODEL', effort: 'JOSH_LANE_EFFORT' }

const { MAX_VALUE_LENGTH, is_safe_prompt, is_safe_value, printable } = agent_safe_text

function trimmed(value: string | undefined): string | undefined {
	const result = value?.trim()

	return result === undefined || result.length === EMPTY_LENGTH ? undefined : result
}

function is_verification(role: AgentRole, round: number | undefined): boolean {
	return role === REVIEWER && round !== undefined && round > FIRST_REVIEW_ROUND
}

// The keys an override is read from, first match wins: a worker falls back to its legacy lane keys, and
// a verification round reads its own keys ahead of the reviewer's.
function override_keys(
	role: AgentRole,
	field: OverrideField,
	round: number | undefined,
): readonly [string, ...Array<string>] {
	const key = ENV_KEYS[role][field]
	if (role === WORKER) return [key, LEGACY_WORKER_KEYS[field]]

	return is_verification(role, round) ? [VERIFICATION_KEYS[field], key] : [key]
}

function override_value(
	role: AgentRole,
	field: OverrideField,
	environment: AgentEnvironment,
	round?: number,
): Override {
	const keys = override_keys(role, field, round)
	const key = keys.find((candidate) => trimmed(environment[candidate]) !== undefined)

	return key === undefined
		? { key: keys[0], value: undefined }
		: { key, value: trimmed(environment[key]) }
}

function model_override(
	role: AgentRole,
	environment: AgentEnvironment,
	provider: AgentProvider,
	round: number | undefined,
): Override {
	return provider === OPENAI_PROVIDER
		? { key: ENV_KEYS[role].model, value: undefined }
		: override_value(role, 'model', environment, round)
}

function rejection(key: string, value: string, expected: string): Rejected {
	return { kind: 'rejected', note: `${key}=${value} ${expected}, so the agent was not started` }
}

function resolved_effort(override: Override, fallback: AgentEffort): EffortResult {
	const parsed = EFFORT_SCHEMA.safeParse(override.value ?? fallback)

	return parsed.success
		? { kind: 'effort', effort: parsed.data }
		: rejection(override.key, override.value ?? '', 'is not an allowed effort')
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

function validate(profile: AgentProfile, model_key: string): ProfileResult {
	if (!is_safe_value(profile.model)) {
		return rejection(model_key, profile.model, 'is not a safe model')
	}

	return { kind: 'profile', profile }
}

// The effort a phase resolves to before any env override: the phase's own value where the table names
// one, otherwise the fallback. A phase-less or unrecognized call returns the
// fallback unchanged, which is what keeps every existing caller reading the current default.
function phase_effort(
	role: AgentRole,
	phase: string | undefined,
	fallback: AgentEffort,
): AgentEffort {
	const parsed = PHASE_SCHEMA.safeParse(phase)
	if (!parsed.success) return fallback

	return PHASE_EFFORT[role]?.[parsed.data] ?? fallback
}

// The effort a stored profile takes in a phase: an env override wins, then the phase value, then the
// profile's own effort. A cut relaunch that keeps a lane's stored model resolves
// the effort through this so a person's `JOSH_WORKER_EFFORT` is never overwritten by the phase value.
function overridden_effort(
	profile: AgentProfile,
	phase: string,
	environment: AgentEnvironment,
): AgentEffort {
	const parsed = EFFORT_SCHEMA.safeParse(override_value(profile.role, 'effort', environment).value)

	return parsed.success ? parsed.data : phase_effort(profile.role, phase, profile.effort)
}

// A stored profile with its effort resolved for the phase the run is entering, its model and provider
// left as they were.
function with_phase_effort(
	profile: AgentProfile,
	phase: string,
	environment: AgentEnvironment = process.env,
): AgentProfile {
	return { ...profile, effort: overridden_effort(profile, phase, environment) }
}

function stage_defaults(
	provider: AgentProvider,
	role: AgentRole,
	round: number | undefined,
): AgentProfile {
	return is_verification(role, round)
		? VERIFICATION_PROFILES[provider]
		: PROVIDER_PROFILES[provider][role]
}

function resolve_stage(
	role: AgentRole,
	environment: AgentEnvironment,
	stage: AgentStage,
): ProfileResult {
	const selected = resolve_provider(environment)
	if (selected.kind === 'rejected') return selected
	const defaults = stage_defaults(selected.provider, role, stage.round)
	const model = model_override(role, environment, selected.provider, stage.round)
	const effort = override_value(role, 'effort', environment, stage.round)
	const resolved = resolved_effort(effort, phase_effort(role, stage.phase, defaults.effort))

	if (resolved.kind === 'rejected') return resolved

	const profile: AgentProfile = {
		provider: selected.provider,
		role,
		model: model.value ?? defaults.model,
		effort: resolved.effort,
	}

	return validate(profile, model.key)
}

function resolve(
	role: AgentRole,
	environment: AgentEnvironment = process.env,
	phase?: string,
): ProfileResult {
	return resolve_stage(role, environment, { phase })
}

// The reviewer for one review round: round 1 as `resolve(REVIEWER)` does, any later round the
// verification pass's own profile.
function resolve_review(round: number, environment: AgentEnvironment = process.env): ProfileResult {
	return resolve_stage(REVIEWER, environment, { round })
}

function describe(profile: AgentProfile): string {
	return `provider=${profile.provider} role=${profile.role} model=${profile.model} effort=${profile.effort}`
}

// The run-log line a review launch writes, so each round's model is on record beside its round.
function describe_review(round: number, profile: AgentProfile): string {
	return `review round ${String(round)} · ${describe(profile)}`
}

function parse(value: unknown): AgentProfile | undefined {
	const parsed = PROFILE_SCHEMA.safeParse(value)

	return parsed.success && is_safe_value(parsed.data.model) ? parsed.data : undefined
}

const agent_role_profile = {
	CODEX_SESSION_KEY,
	DEFAULT_PROFILES,
	HANDED_PROVIDER_KEY,
	IMPLEMENTATION_PHASE,
	MAX_VALUE_LENGTH,
	OPENAI_PROFILES,
	PRE_GATE_PHASE,
	PROFILE_SCHEMA,
	REVIEWER,
	SCHEDULER,
	VERIFICATION_PROFILES,
	WORKER,
	default_notice,
	describe,
	describe_review,
	handoff_environment,
	has_completion_callback,
	is_safe_prompt,
	is_safe_value,
	parse,
	printable,
	resolve,
	resolve_provider,
	resolve_review,
	warn_of_default,
	with_phase_effort,
}

export type {
	AgentEffort,
	AgentEnvironment,
	AgentPhase,
	AgentProfile,
	AgentProvider,
	AgentRole,
	ProfileResult,
}
export { agent_role_profile }
