import { describe, expect, it, vi } from 'vitest'
import { agent_role_profile, type AgentProfile, type ProfileResult } from './agent-role-profile'
import { agent_ship_cap } from './agent-ship-cap'
import type { WorkerProfile, WorkerResult } from './agent-worker-profile'

// joshuafolkken/kit#7354: the ship phase runs on the weaker of its own model and the Issue's profile.

const { DEFAULT_PROFILES, IMPLEMENTATION_PHASE, OPENAI_PROFILES, PRE_GATE_PHASE } =
	agent_role_profile
const HAIKU_MODEL = 'claude-haiku-5-5'
const SONNET_MODEL = 'claude-sonnet-5-5'
const OPUS_MODEL = 'claude-opus-5-5'
const SHIP: AgentProfile = { ...DEFAULT_PROFILES.worker, model: SONNET_MODEL, effort: 'low' }

function profile(name: string, model: string): WorkerProfile {
	return { name, when: name, agent: { ...DEFAULT_PROFILES.worker, model, effort: 'medium' } }
}

const HAIKU = profile('haiku', HAIKU_MODEL)
const SONNET = profile('sonnet-medium', SONNET_MODEL)
const OPUS = profile('opus-high', OPUS_MODEL)

function worker(selected: WorkerProfile, profiles = [HAIKU, SONNET, OPUS]): WorkerResult {
	return {
		kind: 'worker',
		worker: selected,
		settings: { default: SONNET.name, escalate: false, profiles },
	}
}

function capped_model(result: WorkerResult, phase = PRE_GATE_PHASE): string | undefined {
	const capped = agent_ship_cap.capped({ kind: 'profile', profile: SHIP }, phase, () => result)

	return capped.kind === 'profile' ? capped.profile.model : undefined
}

describe('agent_ship_cap.capped — a josh.worker setting', () => {
	it('lowers the ship model to the profile of an Issue weaker than it, keeping the ship effort', () => {
		const capped = agent_ship_cap.capped({ kind: 'profile', profile: SHIP }, PRE_GATE_PHASE, () =>
			worker(HAIKU),
		)

		expect(capped).toEqual({ kind: 'profile', profile: { ...SHIP, model: HAIKU_MODEL } })
	})

	it.each([SONNET, OPUS])('keeps the ship model for the %o profile at or above it', (selected) => {
		expect(capped_model(worker(selected))).toBe(SONNET_MODEL)
	})

	it.each([HAIKU, OPUS])('keeps the ship model no profile names for the %o profile', (selected) => {
		expect(capped_model(worker(selected, [HAIKU, OPUS]))).toBe(SONNET_MODEL)
	})

	it('refuses with the reason when the setting is rejected', () => {
		const rejection: WorkerResult = { kind: 'rejected', note: 'josh.worker is invalid' }

		expect(capped_model(rejection)).toBeUndefined()
	})
})

describe('agent_ship_cap.capped — left as resolved', () => {
	it('keeps the profile when the repository has no setting', () => {
		expect(capped_model({ kind: 'unset' })).toBe(SONNET_MODEL)
	})

	it.each<[string, AgentProfile, string]>([
		['a phase without a model of its own', SHIP, IMPLEMENTATION_PHASE],
		['an OpenAI session', OPENAI_PROFILES.worker, PRE_GATE_PHASE],
	])('never reads the setting for %s', (_case, resolved_profile, phase) => {
		const read = vi.fn(() => worker(HAIKU))
		const resolved: ProfileResult = { kind: 'profile', profile: resolved_profile }

		expect(agent_ship_cap.capped(resolved, phase, read)).toBe(resolved)
		expect(read).not.toHaveBeenCalled()
	})

	it('passes a rejected profile through without reading the setting', () => {
		const read = vi.fn(() => worker(HAIKU))
		const rejected: ProfileResult = { kind: 'rejected', note: 'bad model' }

		expect(agent_ship_cap.capped(rejected, PRE_GATE_PHASE, read)).toBe(rejected)
		expect(read).not.toHaveBeenCalled()
	})
})
