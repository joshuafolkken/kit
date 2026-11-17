import { describe, expect, it } from 'vitest'
import { run_chain, type ChainStage } from './run-chain'

const SELFCHECK = 'review:selfcheck'
const CHECK_RELATED = 'check:related'
const ACCEPTANCE_CHECK = 'acceptance:check'
const RUN_REVIEW = 'run:review'
const RUN_CUT = 'run:cut'
const ISSUE = '5630'
const STOP_EXIT = 2

function stage_named(name: string): ChainStage {
	const stage = run_chain.main_line_stages([]).find((candidate) => candidate.name === name)

	if (stage === undefined) throw new Error(`no stage ${name}`)

	return stage
}

describe('run_chain', () => {
	it('keeps main:merge out of the review stages a lane child runs', () => {
		expect(run_chain.review_stages([]).map((stage) => stage.name)).toStrictEqual([
			SELFCHECK,
			CHECK_RELATED,
			ACCEPTANCE_CHECK,
			RUN_REVIEW,
		])
	})

	it('asks the acceptance map before run:review in the lane child and main line lists', () => {
		for (const stages of [run_chain.review_stages([]), run_chain.main_line_stages([])]) {
			const names = stages.map((stage) => stage.name)

			expect(names.indexOf(ACCEPTANCE_CHECK)).toBe(names.indexOf(RUN_REVIEW) - 1)
		}
	})

	it('resumes a stop at acceptance:check from that stage', () => {
		const stage = stage_named(ACCEPTANCE_CHECK)
		const stop = { stage, code: STOP_EXIT, next: stage.next }

		expect(run_chain.stop_report(stop, ISSUE)).toContain(
			'`pnpm josh run:chain 5630 --from acceptance:check`',
		)
	})

	it('never carries run:cut, which is issued alone', () => {
		expect(run_chain.main_line_stages([]).flatMap((stage) => stage.argv)).not.toContain(RUN_CUT)
	})

	it('answers undefined for a --from no stage carries', () => {
		expect(run_chain.stages_from(run_chain.main_line_stages([]), RUN_CUT)).toBeUndefined()
	})

	it('opens the stop report with the invocation, not an Issue citation', () => {
		const stage = stage_named(RUN_REVIEW)
		const stop = { stage, code: STOP_EXIT, next: stage.next }

		expect(run_chain.stop_report(stop, ISSUE)).toMatch(/^run:chain 5630 — stopped at run:review/u)
	})
})
