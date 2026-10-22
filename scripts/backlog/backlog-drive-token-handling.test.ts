import { run_merge_token, type MergeToken } from '#scripts/run/merge/run-merge-token'
import { describe, expect, it } from 'vitest'
import { backlog_drive_token_handling } from './backlog-drive-token-handling'

const { HANDOFF_TOKENS, IMMEDIATE_TOKENS, TOKEN_HANDLING } = backlog_drive_token_handling
const { MERGE_TOKEN } = run_merge_token
const EVERY_TOKEN: ReadonlyArray<MergeToken> = Object.values(MERGE_TOKEN)

// joshuafolkken/kit#3598: the tokens are `run:merge`'s, so the loop must classify every one it prints.
describe('backlog_drive_token_handling.TOKEN_HANDLING — the run:merge protocol', () => {
	it('classifies every token run:merge prints and no other', () => {
		expect(new Set(Object.keys(TOKEN_HANDLING))).toStrictEqual(new Set(EVERY_TOKEN))
	})

	it('reads every token but resumed as a hand-off on a non-zero exit', () => {
		const expected = EVERY_TOKEN.filter((token) => token !== MERGE_TOKEN.RESUMED)

		expect(HANDOFF_TOKENS).toStrictEqual(new Set(expected))
	})

	it('ends the loop at once on every token but stop and resumed', () => {
		const kept: ReadonlySet<MergeToken> = new Set([MERGE_TOKEN.STOP, MERGE_TOKEN.RESUMED])
		const expected = EVERY_TOKEN.filter((token) => !kept.has(token))

		expect(IMMEDIATE_TOKENS).toStrictEqual(new Set(expected))
	})
})
