import { run_merge_token, type MergeToken } from '#scripts/run/merge/run-merge-token'
import { describe, expect, it } from 'vitest'
import { backlog_drive, type PassResult } from './backlog-drive'
import { backlog_drive_fixture } from './backlog-drive-fixture'

const { FIRST_CHILD, harness, state } = backlog_drive_fixture
const { MERGE_TOKEN } = run_merge_token
const EVERY_TOKEN: ReadonlyArray<MergeToken> = Object.values(MERGE_TOKEN)

// What one pass does with a lone finished child whose merge answered the token.
async function pass_with(token: MergeToken): Promise<PassResult> {
	const { ports } = harness({ finished: [FIRST_CHILD], merges: new Map([[FIRST_CHILD, token]]) })

	return await backlog_drive.run_pass(state([FIRST_CHILD]), true, ports)
}

// joshuafolkken/kit#3598: the tokens are `run:merge`'s, so the loop must classify every one it prints.
describe('backlog_drive.TOKEN_HANDLING — the run:merge protocol', () => {
	it('classifies every token run:merge prints and no other', () => {
		expect(new Set(Object.keys(backlog_drive.TOKEN_HANDLING))).toStrictEqual(new Set(EVERY_TOKEN))
	})

	it('reads every token but resumed as a hand-off on a non-zero exit', () => {
		const expected = EVERY_TOKEN.filter((token) => token !== MERGE_TOKEN.RESUMED)

		expect(backlog_drive.HANDOFF_TOKENS).toStrictEqual(new Set(expected))
	})
})

describe('backlog_drive.run_pass — every run:merge token', () => {
	it.each([
		[MERGE_TOKEN.OVER, 'merge'],
		[MERGE_TOKEN.HUMAN_REVIEW, 'merge'],
		[MERGE_TOKEN.ENVIRONMENT, 'merge'],
		[MERGE_TOKEN.BUSY, 'merge'],
		[MERGE_TOKEN.RETRY, 'merge'],
		[MERGE_TOKEN.STOP, 'stop'],
	])('ends the pass on %s with the reason %s', async (token, reason) => {
		const result = await pass_with(token)

		expect(result.kind === 'end' && result.end.reason).toBe(reason)
	})

	it('awaits the same lane again on resumed', async () => {
		const result = await pass_with(MERGE_TOKEN.RESUMED)

		expect(result.kind).toBe('continue')
		expect(result.state.in_flight).toStrictEqual([FIRST_CHILD])
	})

	it.each(EVERY_TOKEN)('acts on %s as its handling says', async (token) => {
		const result = await pass_with(token)
		const is_awaited = backlog_drive.TOKEN_HANDLING[token] === 'await'

		expect(result.kind).toBe(is_awaited ? 'continue' : 'end')
	})
})
