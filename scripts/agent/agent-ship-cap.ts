import { agent_phase_profile } from './agent-phase-profile'
import type { AgentProfile, ProfileResult } from './agent-role-profile'
import type { WorkerResult } from './agent-worker-profile'

// **The ship phase never runs above the Issue's `josh.worker` profile** (joshuafolkken/kit#7354): a
// phase with a model of its own takes the weaker of that model and the Issue's, ranked by the order of
// `profiles`, weakest first. A ship model no profile names cannot be ranked, so it is kept: a cap never
// raises the phase above its own model. A repository without the setting, and a phase
// without a model of its own, keep the resolved profile and never read the setting or the labels.

type ResolvedWorker = Extract<WorkerResult, { kind: 'worker' }>

function has_phase_model(profile: AgentProfile, phase: string): boolean {
	return agent_phase_profile.phase_model(profile.role, profile.provider, phase, {}) !== undefined
}

function weaker(profile: AgentProfile, resolved: ResolvedWorker): AgentProfile {
	const { worker, settings } = resolved
	const rank = settings.profiles.findIndex((entry) => entry.agent.model === profile.model)
	const limit = settings.profiles.findIndex((entry) => entry.name === worker.name)

	return rank <= limit ? profile : { ...profile, model: worker.agent.model }
}

function capped_by(profile: AgentProfile, result: WorkerResult): ProfileResult {
	if (result.kind === 'unset') return { kind: 'profile', profile }

	return result.kind === 'rejected' ? result : { kind: 'profile', profile: weaker(profile, result) }
}

// `worker` is called only for a phase with a model of its own, so every other relaunch reads nothing.
async function capped(
	resolved: ProfileResult,
	phase: string,
	worker: () => Promise<WorkerResult>,
): Promise<ProfileResult> {
	if (resolved.kind === 'rejected' || !has_phase_model(resolved.profile, phase)) return resolved

	return capped_by(resolved.profile, await worker())
}

const agent_ship_cap = { capped }

export { agent_ship_cap }
