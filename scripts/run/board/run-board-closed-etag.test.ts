import { git_gh_conditional, type ConditionalRead } from '#scripts/gh/git-gh-conditional'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { ISSUE_NUMBER, ISSUE_TITLE, rest_issue } from '#scripts/gh/git-gh-issue-rest-fixture'
import { issue_merged } from '#scripts/issue/issue-merged'
import { shared_cache_fixture } from '#scripts/josh/shared-cache-fixture'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run_board_closed } from './run-board-closed'

// joshuafolkken/kit#6696: the board re-reads a parked or human child every two minutes, so the closed
// read goes with the previous ETag — an unchanged issue answers `304` for no core request.

vi.mock('#scripts/issue/issue-merged', () => ({ issue_merged: { read_merge_state: vi.fn() } }))

const FIRST_ETAG = 'W/"first"'
const SECOND_ETAG = 'W/"second"'
const CLOSED_AT = '2026-11-07T15:00:00Z'
const CLOSED_BODY = rest_issue({ state: 'closed', state_reason: 'completed', closed_at: CLOSED_AT })

const CLOSED = {
	title: ISSUE_TITLE,
	labels: expect.any(Array) as unknown,
	closed_ms: Date.parse(CLOSED_AT),
	is_merged: true,
	is_not_planned: false,
}

function serve(...answers: Array<ConditionalRead>): void {
	const read = vi.spyOn(git_gh_conditional, 'read_conditional')

	for (const answer of answers) read.mockResolvedValueOnce(answer)
}

function sent_etags(): Array<string | undefined> {
	return vi.mocked(git_gh_conditional.read_conditional).mock.calls.map(([, etag]) => etag)
}

beforeEach(() => {
	vi.restoreAllMocks()
	shared_cache_fixture.keep_in_memory()
	vi.mocked(issue_merged.read_merge_state).mockReset().mockResolvedValue(true)
})

describe('run_board_closed.read_closed — the ETag read', () => {
	it('answers a re-read of an unchanged issue from 304, never asking unconditionally', async () => {
		serve({ kind: 'changed', etag: FIRST_ETAG, body: CLOSED_BODY }, { kind: 'unchanged' })
		const unconditional = vi.spyOn(git_gh_exec, 'exec_gh_api')

		const first = await run_board_closed.read_closed(ISSUE_NUMBER)
		const second = await run_board_closed.read_closed(ISSUE_NUMBER)

		expect(first).toStrictEqual(CLOSED)
		expect(second).toStrictEqual(first)
		expect(sent_etags()).toStrictEqual([undefined, FIRST_ETAG])
		expect(unconditional).not.toHaveBeenCalled()
	})

	it('answers the new state when the issue changed under a new ETag', async () => {
		serve(
			{ kind: 'changed', etag: FIRST_ETAG, body: rest_issue() },
			{ kind: 'changed', etag: SECOND_ETAG, body: CLOSED_BODY },
		)

		await expect(run_board_closed.read_closed(ISSUE_NUMBER)).resolves.toBe(
			run_board_closed.STILL_OPEN,
		)
		await expect(run_board_closed.read_closed(ISSUE_NUMBER)).resolves.toStrictEqual(CLOSED)
		expect(sent_etags()).toStrictEqual([undefined, FIRST_ETAG])
	})
})
