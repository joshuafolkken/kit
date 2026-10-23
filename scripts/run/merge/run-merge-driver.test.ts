import { describe, expect, it } from 'vitest'
import type { MergeResult } from './run-merge-cli'
import { run_merge_driver } from './run-merge-driver'
import { run_merge_token } from './run-merge-token'

// joshuafolkken/kit#4102: `backlog:drive` runs `run:merge` as a child process and reads its result back
// from stdout, so what one side prints is exactly what the other reads.

const TRANSCRIPT = 'lane.jsonl'
const OFFER: MergeResult = { token: '2600', code: 0, is_offer: true, outcome: 'merged' }
const CONTROL: MergeResult = {
	token: run_merge_token.MERGE_TOKEN.RETRY,
	code: 1,
	is_offer: false,
	outcome: 'unresolved',
}

describe('run_merge_driver.argv_of', () => {
	it('asks run:merge for the driver result', () => {
		expect(
			run_merge_driver.argv_of({ child: '2500', owner: '42', output: undefined }),
		).toStrictEqual(['run:merge', '2500', '--owner', '42', run_merge_driver.DRIVER_FLAG])
	})

	it('forwards the lane transcript where one is recorded', () => {
		expect(run_merge_driver.argv_of({ child: '2500', owner: '42', output: TRANSCRIPT })).toContain(
			TRANSCRIPT,
		)
	})
})

describe('run_merge_driver.printed', () => {
	it('prints the whole result under --driver, so the driver can read it back', () => {
		const out = run_merge_driver.printed(['2500', run_merge_driver.DRIVER_FLAG], OFFER)

		expect(run_merge_driver.read(out)).toStrictEqual(OFFER)
	})

	it('prints only the token a person reads without --driver', () => {
		expect(run_merge_driver.printed(['2500'], OFFER)).toBe(OFFER.token)
	})
})

describe('run_merge_driver.read', () => {
	it.each([OFFER, CONTROL])('reads back what print wrote: %j', (result) => {
		expect(run_merge_driver.read(run_merge_driver.print(result))).toStrictEqual(result)
	})

	it('reads only the last line, past the progress printed before it', () => {
		expect(run_merge_driver.read(`progress\n${run_merge_driver.print(OFFER)}\n`)).toStrictEqual(
			OFFER,
		)
	})

	it.each(['', 'crashed', '{"merge":{"token":"2600"}}'])('answers nothing for %j', (out) => {
		expect(run_merge_driver.read(out)).toBeUndefined()
	})
})
