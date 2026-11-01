import { agent_consultation_model } from './agent-consultation-model'
import {
	agent_profile_schema,
	type AgentEffort,
	type AgentPhase,
	type AgentProfile,
	type AgentRole,
} from './agent-profile-schema'
import {
	agent_provider,
	type AgentEnvironment,
	type AgentProvider,
	type Rejected,
} from './agent-provider'
import { agent_safe_text } from './agent-safe-text'

const {
	CODEX_SESSION_KEY,
	HANDED_PROVIDER_KEY,
	OPENAI_PROVIDER,
	default_notice,
	handoff_environment,
	has_completion_callback,
	rejection,
	resolve_provider,
	trimmed,
	warn_of_default,
} = agent_provider
const { CONSULTATION_MODELS, consultation_provider } = agent_consultation_model

const {
	ANTHROPIC_MODEL,
	DEFAULT_PROFILES,
	EFFORT_SCHEMA,
	IMPLEMENTATION_PHASE,
	OPENAI_MODEL,
	OPENAI_PROFILES,
	PHASE_SCHEMA,
	PRE_GATE_PHASE,
	REVIEWER,
	SCHEDULER,
	WORKER,
	describe,
	describe_review,
} = agent_profile_schema

type ProfileResult = Rejected | { kind: 'profile'; profile: AgentProfile }
type EffortResult = Rejected | { kind: 'effort'; effort: AgentEffort }
type OverrideField = 'model' | 'effort'

interface Override {
	key: string
	value: string | undefined
}

interface PhaseModel {
	key: string
	value: string
}

type PhaseTable<Value> = Readonly<Partial<Record<AgentRole, Partial<Record<AgentPhase, Value>>>>>

// What a resolution is keyed on beyond the role: the run phase (effort) and the review round (profile).
interface AgentStage {
	phase?: string | undefined
	round?: number
}

const VERIFICATION_EFFORT: AgentEffort = 'high'

const PROVIDER_PROFILES = { anthropic: DEFAULT_PROFILES, openai: OPENAI_PROFILES }

// **The verification pass resolves a profile of its own** (joshuafolkken/kit#3926). A round after the
// first only checks that the first round's findings were fixed, so its model and effort are set apart:
// its own keys win, then the reviewer's, then its own default.
const FIRST_REVIEW_ROUND = 1
// Sonnet holds the verification pass by the eval criterion: on every `verification-fix-*` scenario its
// pass/fail equals Opus's (100% agreement), and Opus passes all 4.
const VERIFICATION_MODEL = 'claude-sonnet-5-5'
const VERIFICATION_PROFILES: Readonly<Record<AgentProvider, AgentProfile>> = {
	anthropic: {
		...DEFAULT_PROFILES.reviewer,
		model: VERIFICATION_MODEL,
		effort: VERIFICATION_EFFORT,
	},
	openai: { ...OPENAI_PROFILES.reviewer, effort: VERIFICATION_EFFORT },
}
const VERIFICATION_KEYS = {
	model: 'JOSH_REVIEWER_VERIFICATION_MODEL',
	effort: 'JOSH_REVIEWER_VERIFICATION_EFFORT',
}

// The model a consultation main line hands its investigation to (joshuafolkken/kit#5351); the
// consultation models themselves are `agent-consultation-model.ts`'s.
const INVESTIGATION_MODELS: Readonly<Record<AgentProvider, string>> = {
	anthropic: ANTHROPIC_MODEL,
	openai: OPENAI_MODEL,
}
const INVESTIGATION_MODEL_KEY = 'JOSH_INVESTIGATION_MODEL'

// **Effort as a function of the run phase, not the role alone**. For the first
// merge only the mechanical ship/bookkeeping region is lowered: the pre-gate resume drives the gate,
// commit, PR and merge, applying fixes the gate has already named — work delegation.md calls the opposite
// of judgement. The design-judgment implementation phases keep the role default, as does any role/phase
// with no entry, and the review's own judgement is the reviewer role's, untouched by lowering
// the worker here. The investigation phase — highest output density — is left for a later merge, once
// the delegation half of this Issue has moved its reading out.
const SHIP_EFFORT: AgentEffort = 'low'
const PHASE_EFFORT: PhaseTable<AgentEffort> = {
	worker: { [PRE_GATE_PHASE]: SHIP_EFFORT },
}

// **The ship phase may run on a model of its own** (joshuafolkken/kit#5343), read from its key ahead of
// the role's and applied on the same cut relaunch as `SHIP_EFFORT`. Unset, the phase keeps the role's
// model, so the default is unchanged.
const PHASE_MODEL_KEYS: PhaseTable<string> = {
	worker: { [PRE_GATE_PHASE]: 'JOSH_WORKER_SHIP_MODEL' },
}

const ENV_KEYS: Readonly<Record<AgentRole, { model: string; effort: string }>> = {
	scheduler: { model: 'JOSH_SCHEDULER_MODEL', effort: 'JOSH_SCHEDULER_EFFORT' },
	worker: { model: 'JOSH_WORKER_MODEL', effort: 'JOSH_WORKER_EFFORT' },
	reviewer: { model: 'JOSH_REVIEWER_MODEL', effort: 'JOSH_REVIEWER_EFFORT' },
}

const LEGACY_WORKER_KEYS = { model: 'JOSH_LANE_MODEL', effort: 'JOSH_LANE_EFFORT' }

const { MAX_VALUE_LENGTH, is_safe_prompt, is_safe_value } = agent_safe_text

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

// A role's entry in a phase table; `undefined` for a phase-less or unrecognized phase, or no entry.
function phase_entry<Value>(
	table: PhaseTable<Value>,
	role: AgentRole,
	phase: string | undefined,
): Value | undefined {
	const parsed = PHASE_SCHEMA.safeParse(phase)

	return parsed.success ? table[role]?.[parsed.data] : undefined
}

// The phase's own model key when it is set; `undefined` for a phase with no key, an unset key, or an
// OpenAI session, whose model is never read from env.
function phase_model(
	role: AgentRole,
	provider: AgentProvider,
	phase: string | undefined,
	environment: AgentEnvironment,
): PhaseModel | undefined {
	const key = provider === OPENAI_PROVIDER ? undefined : phase_entry(PHASE_MODEL_KEYS, role, phase)
	if (key === undefined) return undefined
	const value = trimmed(environment[key])

	return value === undefined ? undefined : { key, value }
}

function model_override(
	role: AgentRole,
	environment: AgentEnvironment,
	provider: AgentProvider,
	stage: AgentStage,
): Override {
	const phased = phase_model(role, provider, stage.phase, environment)
	if (phased !== undefined) return phased

	return provider === OPENAI_PROVIDER
		? { key: ENV_KEYS[role].model, value: undefined }
		: override_value(role, 'model', environment, stage.round)
}

function resolved_effort(override: Override, fallback: AgentEffort): EffortResult {
	const parsed = EFFORT_SCHEMA.safeParse(override.value ?? fallback)

	return parsed.success
		? { kind: 'effort', effort: parsed.data }
		: rejection(override.key, override.value ?? '', 'is not an allowed effort')
}

// **A launched main line never runs on a consultation model** (joshuafolkken/kit#5616): a scheduler or
// worker on one is itself a consultation main line, which `consultation-handoff` refuses its
// `run:entry` / `run:hold`, so every launcher refuses the profile here instead. A reviewer runs neither.
function validate(profile: AgentProfile, model_key: string): ProfileResult {
	if (!is_safe_value(profile.model)) {
		return rejection(model_key, profile.model, 'is not a safe model')
	}

	if (profile.role !== REVIEWER && consultation_provider(profile.model) !== undefined) {
		return rejection(model_key, profile.model, 'is a consultation model')
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
	return phase_entry(PHASE_EFFORT, role, phase) ?? fallback
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

// A stored profile resolved for the phase the run is entering: its effort, and its model only where the
// phase's own model key is set — the role's model key never moves a lane off the model it recorded.
function with_phase(
	profile: AgentProfile,
	phase: string,
	environment: AgentEnvironment = process.env,
): ProfileResult {
	const effort = overridden_effort(profile, phase, environment)
	const model = phase_model(profile.role, profile.provider, phase, environment)
	if (model === undefined) return { kind: 'profile', profile: { ...profile, effort } }

	return validate({ ...profile, model: model.value, effort }, model.key)
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
	const model = model_override(role, environment, selected.provider, stage)
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

// The model a consultation main line hands its investigation to. Its key moves the Claude model alone,
// as every model key here does: an OpenAI session's model is never read from env.
function investigation_model(
	provider: AgentProvider,
	environment: AgentEnvironment = process.env,
): string {
	const override =
		provider === OPENAI_PROVIDER ? undefined : trimmed(environment[INVESTIGATION_MODEL_KEY])

	return override ?? INVESTIGATION_MODELS[provider]
}

const agent_role_profile = {
	CODEX_SESSION_KEY,
	CONSULTATION_MODELS,
	DEFAULT_PROFILES,
	HANDED_PROVIDER_KEY,
	IMPLEMENTATION_PHASE,
	INVESTIGATION_MODEL_KEY,
	MAX_VALUE_LENGTH,
	OPENAI_PROFILES,
	PRE_GATE_PHASE,
	REVIEWER,
	SCHEDULER,
	VERIFICATION_PROFILES,
	WORKER,
	consultation_provider,
	default_notice,
	describe,
	describe_review,
	handoff_environment,
	has_completion_callback,
	investigation_model,
	is_safe_prompt,
	is_safe_value,
	resolve,
	resolve_provider,
	resolve_review,
	warn_of_default,
	with_phase,
}

export type { ProfileResult }
export { agent_role_profile }

export { type AgentEnvironment, type AgentProvider } from './agent-provider'

export {
	type AgentEffort,
	type AgentPhase,
	type AgentProfile,
	type AgentRole,
} from './agent-profile-schema'
