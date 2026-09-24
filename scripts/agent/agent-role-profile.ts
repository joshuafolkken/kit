import { agent_session_environment } from '#scripts/josh/agent-session-environment'
import { z } from 'zod'

const FIRST_PRINTABLE_CODE = 0x20
const DELETE_CODE = 0x7f
const FIRST_CODE_POINT = 0
const EMPTY_LENGTH = 0
const MAX_VALUE_LENGTH = 4096

const ROLE_SCHEMA = z.enum(['scheduler', 'worker', 'reviewer'])
const PROVIDER_SCHEMA = z.enum(['anthropic', 'openai'])
const EFFORT_SCHEMA = z.enum(['low', 'medium', 'high', 'xhigh', 'max'])
// The run phases effort may vary by (joshuafolkken/kit#2382). They are the cut boundaries a lane child
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
type ProviderResult = Rejected | { kind: 'provider'; provider: AgentProvider }

const SCHEDULER: AgentRole = 'scheduler'
const WORKER: AgentRole = 'worker'
const REVIEWER: AgentRole = 'reviewer'
const IMPLEMENTATION_PHASE: AgentPhase = 'implementation'
const PRE_GATE_PHASE: AgentPhase = 'pre-gate'
const ANTHROPIC_PROVIDER: AgentProvider = 'anthropic'
const OPENAI_PROVIDER: AgentProvider = 'openai'
// **Pinned model ids, never a floating alias** (joshuafolkken/kit#2415). An alias such as `opus` moves
// whenever the CLI moves it, so a run log could not say which model produced it and a model migration
// could not be measured apart from everything else. A new lane records the id it resolved; a lane
// created before a migration keeps the model it recorded (`with_phase_effort` leaves it untouched).
const OPENAI_MODEL = 'gpt-6-sol'
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

// **Effort as a function of the run phase, not the role alone** (joshuafolkken/kit#2382). For the first
// merge only the mechanical ship/bookkeeping region is lowered: the pre-gate resume drives the gate,
// commit, PR and merge, applying fixes the gate has already named — work SKILL.md §2b calls the opposite
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

function is_control_character(character: string): boolean {
	const code = character.codePointAt(FIRST_CODE_POINT) ?? FIRST_PRINTABLE_CODE

	return code < FIRST_PRINTABLE_CODE || code === DELETE_CODE
}

function is_safe_value(value: string): boolean {
	if (value.length === EMPTY_LENGTH || value.length > MAX_VALUE_LENGTH) return false

	for (const character of value) if (is_control_character(character)) return false

	return true
}

function trimmed(value: string | undefined): string | undefined {
	const result = value?.trim()

	return result === undefined || result.length === EMPTY_LENGTH ? undefined : result
}

function override_value(
	role: AgentRole,
	field: 'model' | 'effort',
	environment: AgentEnvironment,
): { key: string; value: string | undefined } {
	const key = ENV_KEYS[role][field]
	const value = trimmed(environment[key])
	if (value !== undefined) return { key, value }
	if (role !== WORKER) return { key, value: undefined }

	const legacy = LEGACY_WORKER_KEYS[field]
	const legacy_value = trimmed(environment[legacy])

	return legacy_value === undefined
		? { key, value: undefined }
		: { key: legacy, value: legacy_value }
}

function model_override(
	role: AgentRole,
	environment: AgentEnvironment,
	provider: AgentProvider,
): { key: string; value: string | undefined } {
	const key = ENV_KEYS[role].model

	return provider === OPENAI_PROVIDER
		? { key, value: undefined }
		: override_value(role, 'model', environment)
}

function rejection(key: string, value: string, expected: string): Rejected {
	return { kind: 'rejected', note: `${key}=${value} ${expected}, so the agent was not started` }
}

function resolved_effort(
	override: { key: string; value: string | undefined },
	fallback: AgentEffort,
): EffortResult {
	const parsed = EFFORT_SCHEMA.safeParse(override.value ?? fallback)

	return parsed.success
		? { kind: 'effort', effort: parsed.data }
		: rejection(override.key, override.value ?? '', 'is not an allowed effort')
}

function has_session(environment: AgentEnvironment, keys: ReadonlyArray<string>): boolean {
	return keys.some((key) => trimmed(environment[key]) !== undefined)
}

function session_rejection(is_conflicting: boolean): Rejected {
	const note = is_conflicting
		? 'both Codex and Claude Code sessions were detected'
		: 'no Codex or Claude Code session was detected'

	return { kind: 'rejected', note }
}

// The provider a detached launcher hands a process that is not itself an agent session
// (joshuafolkken/kit#2456). `detached_launch` strips the parent-session keys — the very keys the
// detection below reads — so a `josh ship --detach --review` supervisor could never resolve its reviewer.
// **It is a fallback, read only when no session is detected**: the mark is inherited by everything the
// supervisor starts, and a real session's own keys must keep deciding for that session.
const HANDED_PROVIDER_KEY = 'JOSH_AGENT_PROVIDER'

function handed_provider(environment: AgentEnvironment): ProviderResult {
	const value = trimmed(environment[HANDED_PROVIDER_KEY])
	if (value === undefined) return session_rejection(false)
	const parsed = PROVIDER_SCHEMA.safeParse(value)

	return parsed.success
		? { kind: 'provider', provider: parsed.data }
		: rejection(HANDED_PROVIDER_KEY, value, 'is not an allowed provider')
}

// The session this process runs in, read from its own keys: `undefined` when none is detected.
function detected_provider(environment: AgentEnvironment): ProviderResult | undefined {
	const has_codex = has_session(environment, [CODEX_SESSION_KEY])
	const has_claude = has_session(environment, agent_session_environment.PARENT_SESSION_KEYS)

	if (has_codex === has_claude) return has_codex ? session_rejection(true) : undefined

	return { kind: 'provider', provider: has_codex ? OPENAI_PROVIDER : ANTHROPIC_PROVIDER }
}

function resolve_provider(environment: AgentEnvironment = process.env): ProviderResult {
	return detected_provider(environment) ?? handed_provider(environment)
}

// The mark a detached launch sets on its child: the provider this session resolved, or nothing when it
// resolved none — the child then fails the same way this session would have.
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
// one, otherwise the fallback (joshuafolkken/kit#2382). A phase-less or unrecognized call returns the
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
// profile's own effort (joshuafolkken/kit#2382). A cut relaunch that keeps a lane's stored model resolves
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
// left as they were (joshuafolkken/kit#2382).
function with_phase_effort(
	profile: AgentProfile,
	phase: string,
	environment: AgentEnvironment = process.env,
): AgentProfile {
	return { ...profile, effort: overridden_effort(profile, phase, environment) }
}

function resolve(
	role: AgentRole,
	environment: AgentEnvironment = process.env,
	phase?: string,
): ProfileResult {
	const selected = resolve_provider(environment)
	if (selected.kind === 'rejected') return selected
	const defaults = PROVIDER_PROFILES[selected.provider][role]
	const model = model_override(role, environment, selected.provider)
	const effort = override_value(role, 'effort', environment)
	const resolved = resolved_effort(effort, phase_effort(role, phase, defaults.effort))

	if (resolved.kind === 'rejected') return resolved

	const profile: AgentProfile = {
		provider: selected.provider,
		role,
		model: model.value ?? defaults.model,
		effort: resolved.effort,
	}

	return validate(profile, model.key)
}

function describe(profile: AgentProfile): string {
	return `provider=${profile.provider} role=${profile.role} model=${profile.model} effort=${profile.effort}`
}

function parse(value: unknown): AgentProfile | undefined {
	const parsed = PROFILE_SCHEMA.safeParse(value)

	return parsed.success && is_safe_value(parsed.data.model) ? parsed.data : undefined
}

const agent_role_profile = {
	DEFAULT_PROFILES,
	EFFORT_SCHEMA,
	ENV_KEYS,
	HANDED_PROVIDER_KEY,
	IMPLEMENTATION_PHASE,
	LEGACY_WORKER_KEYS,
	MAX_VALUE_LENGTH,
	OPENAI_PROFILES,
	PHASE_EFFORT,
	PHASE_SCHEMA,
	PRE_GATE_PHASE,
	PROVIDER_SCHEMA,
	PROFILE_SCHEMA,
	REVIEWER,
	SCHEDULER,
	WORKER,
	describe,
	handoff_environment,
	is_safe_value,
	parse,
	phase_effort,
	resolve,
	resolve_provider,
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
