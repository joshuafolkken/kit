import { describe, expect, it } from 'vitest'
import { agent_phase_profile } from './agent-phase-profile'
import { agent_profile_schema } from './agent-profile-schema'

const { SONNET_MODEL, phase_effort, phase_model, phase_model_keys } = agent_phase_profile
const { IMPLEMENTATION_PHASE, PRE_GATE_PHASE, REVIEWER, WORKER } = agent_profile_schema
const SHIP_MODEL_KEY = 'JOSH_WORKER_SHIP_MODEL'
const SHIP_MODEL = 'claude-haiku-5-5'
const UNKNOWN_PHASE = 'no-such-phase'

describe('phase_model', () => {
	it('returns the ship key with its Sonnet default when the key is unset', () => {
		expect(phase_model(WORKER, 'anthropic', PRE_GATE_PHASE, {})).toStrictEqual({
			key: SHIP_MODEL_KEY,
			value: SONNET_MODEL,
		})
	})

	it('reads the trimmed ship key when it is set', () => {
		const environment = { [SHIP_MODEL_KEY]: ` ${SHIP_MODEL} ` }

		expect(phase_model(WORKER, 'anthropic', PRE_GATE_PHASE, environment)?.value).toBe(SHIP_MODEL)
	})

	it('returns undefined for an OpenAI session', () => {
		expect(phase_model(WORKER, 'openai', PRE_GATE_PHASE, {})).toBeUndefined()
	})

	it('returns undefined for a phase or role with no entry', () => {
		expect(phase_model(WORKER, 'anthropic', IMPLEMENTATION_PHASE, {})).toBeUndefined()
		expect(phase_model(REVIEWER, 'anthropic', PRE_GATE_PHASE, {})).toBeUndefined()
	})

	it('returns undefined for a missing or unrecognized phase', () => {
		expect(phase_model(WORKER, 'anthropic', undefined, {})).toBeUndefined()
		expect(phase_model(WORKER, 'anthropic', UNKNOWN_PHASE, {})).toBeUndefined()
	})
})

describe('phase_effort', () => {
	it('lowers the worker to low effort in the pre-gate phase', () => {
		expect(phase_effort(WORKER, PRE_GATE_PHASE, 'high')).toBe('low')
	})

	it('returns the fallback for a phase or role with no entry', () => {
		expect(phase_effort(WORKER, IMPLEMENTATION_PHASE, 'high')).toBe('high')
		expect(phase_effort(REVIEWER, PRE_GATE_PHASE, 'medium')).toBe('medium')
	})

	it('returns the fallback for a missing or unrecognized phase', () => {
		expect(phase_effort(WORKER, undefined, 'high')).toBe('high')
		expect(phase_effort(WORKER, UNKNOWN_PHASE, 'high')).toBe('high')
	})
})

describe('phase_model_keys', () => {
	it('lists every phase model key', () => {
		expect(phase_model_keys()).toStrictEqual([SHIP_MODEL_KEY])
	})
})
