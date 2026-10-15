import { describe, expect, it } from 'vitest'
import { backlog_drive } from './backlog-drive'
import { backlog_drive_fixture } from './backlog-drive-fixture'

// joshuafolkken/kit#3854: a free lane with nothing opted in hands the open backlog back to be judged.
const { FIRST_CHILD, harness, offer, state } = backlog_drive_fixture
const EXHAUSTED_WATCH = { ...offer('watch'), answer: 'exhausted' }
const OWED = 3
const ONE_FREE_LANE = 1
const NO_FREE_LANES = 0

describe('backlog_drive.run_pass — the auto-ok judgement', () => {
	it('hands judge back when an exhausted watch has a free lane and a judgement is owed', async () => {
		const { ports } = harness({ offers: [EXHAUSTED_WATCH], judgement_owed: OWED })
		const result = await backlog_drive.run_pass(state(), true, ports)

		expect(result.kind === 'end' && result.end).toStrictEqual({
			reason: 'judge',
			token: 'judge',
			issue: undefined,
		})
	})

	it('keeps the watch when nothing is owed', async () => {
		const { ports } = harness({ offers: [EXHAUSTED_WATCH], judgement_owed: 0 })
		const result = await backlog_drive.run_pass(state([FIRST_CHILD]), true, ports)

		expect(result.kind).toBe('continue')
	})

	it('drains as before when nothing is owed and the retrospective is', async () => {
		const owed_retrospective = { ...EXHAUSTED_WATCH, is_retrospective_owed: true }
		const { ports } = harness({ offers: [owed_retrospective], judgement_owed: 0 })
		const result = await backlog_drive.run_pass(state(), true, ports)

		expect(result.kind === 'end' && result.end.reason).toBe('watch')
	})
})

describe('backlog_drive.run_pass — when the judgement count is not asked', () => {
	it('does not ask for the judgement count when no lane is free', async () => {
		const { ports, calls } = harness({
			offers: [EXHAUSTED_WATCH],
			free_lanes: [NO_FREE_LANES],
			judgement_owed: OWED,
		})
		const result = await backlog_drive.run_pass(state([FIRST_CHILD]), true, ports)

		expect(calls).not.toContain('judgement')
		expect(result.kind).toBe('continue')
	})

	it('does not ask while the pool still has candidates to wait for', async () => {
		const { ports, calls } = harness({
			offers: [{ ...offer('watch'), answer: 'candidates' }],
			free_lanes: [ONE_FREE_LANE],
			judgement_owed: OWED,
		})

		await backlog_drive.run_pass(state([FIRST_CHILD]), true, ports)

		expect(calls).not.toContain('judgement')
	})
})
