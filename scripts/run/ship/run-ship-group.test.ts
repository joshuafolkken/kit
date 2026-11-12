import { deferred_answer } from '#scripts/git/deferred-answer-fixture'
import { expect, it, vi } from 'vitest'
import type { ShipSection } from './run-ship'
import { run_ship_group } from './run-ship-group'
import { run_ship_stage } from './run-ship-stage'
import type { Step } from './run-ship-steps'

const { STAGE } = run_ship_stage
const CLEAN: ShipSection = { header: 'review', body: 'clean', code: 0 }
const REVIEW: Step = {
	stage: STAGE.ROUND_TWO,
	header: CLEAN.header,
	run: async () => ({ code: 0, out: '' }),
}
const GATE: Step = { ...REVIEW, stage: STAGE.GATE, beside: REVIEW }

it.each([0, 1])('drains the reviewer after a gate with code %s finishes', async (code) => {
	const review = deferred_answer<ShipSection>()
	const gate = deferred_answer<boolean>()
	const sections: Array<ShipSection> = []
	const execute = vi.fn(async (step: Step) => {
		if (step === REVIEW) return await review.promise
		gate.answer(true)

		return { ...CLEAN, header: 'gate', code }
	})
	const shipping = run_ship_group.run(GATE, execute, sections)

	await gate.promise
	expect([execute.mock.calls.length, sections]).toStrictEqual([2, []])
	review.answer(CLEAN)
	const stopped = await shipping

	expect([stopped?.step, sections.at(-1)?.code]).toStrictEqual([
		code === 0 ? undefined : GATE,
		code,
	])
})

it('keeps the round-2 failure and its attribution before the next ship stage', async () => {
	const sections: Array<ShipSection> = []
	const failed = { ...CLEAN, code: 1 }
	const execute = vi.fn(async (step: Step) => (step === REVIEW ? failed : CLEAN))

	expect(await run_ship_group.run(GATE, execute, sections)).toStrictEqual({
		step: REVIEW,
		sections,
	})
	expect(sections).toStrictEqual([CLEAN, failed])
})

it('runs a stage without a companion once', async () => {
	const sections: Array<ShipSection> = []
	const execute = vi.fn(async () => CLEAN)

	expect(await run_ship_group.run(REVIEW, execute, sections)).toBeUndefined()
	expect(execute).toHaveBeenCalledOnce()
	expect(sections).toStrictEqual([CLEAN])
})

it('keeps both failures and attributes the stop to the final review', async () => {
	const sections: Array<ShipSection> = []
	const gate = { ...CLEAN, header: 'gate', code: 1 }
	const review = { ...CLEAN, body: 'review finding', code: 1 }
	const execute = vi.fn(async (step: Step) => (step === REVIEW ? review : gate))

	expect(await run_ship_group.run(GATE, execute, sections)).toStrictEqual({
		step: REVIEW,
		sections,
	})
	expect(sections).toStrictEqual([gate, review])
})

it.each([
	[CLEAN, run_ship_stage.PHASE.DONE],
	[{ ...CLEAN, is_skipped: true }, run_ship_stage.PHASE.SKIPPED],
	[{ ...CLEAN, code: 1, is_skipped: true }, run_ship_stage.PHASE.FAILED],
])('settles a stage by its result: %j', (section, phase) => {
	expect(run_ship_group.settled_phase(section)).toBe(phase)
})
