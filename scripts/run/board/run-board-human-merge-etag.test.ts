import type { EpicChild } from '#scripts/epic/epic-graph'
import { git_gh_conditional, type ConditionalRead } from '#scripts/gh/git-gh-conditional'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { IN_PROGRESS_LABEL, NEEDS_HUMAN_MERGE_LABEL } from '#scripts/issue/issue-labels'
import { shared_cache_fixture } from '#scripts/josh/shared-cache-fixture'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run_board_human_merge } from './run-board-human-merge'
import type { BoardPlan } from './run-board-layout'

// joshuafolkken/kit#6708: the board re-reads the open pull listing every two minutes while a child
// waits on a human merge, so it goes with the previous ETag — an unchanged listing is a `304`.

const REPO = 'joshuafolkken/kit'
const ISSUE = 6221
const FIRST_PR = 6225
const SECOND_PR = 6230
const FIRST_ETAG = 'W/"first"'
const SECOND_ETAG = 'W/"second"'
const LABELS = [IN_PROGRESS_LABEL, NEEDS_HUMAN_MERGE_LABEL]

const CHILD: EpicChild = {
	number: ISSUE,
	repo: REPO,
	state: 'OPEN',
	labels: LABELS,
	blocked_by: [],
}

function plan_of(): BoardPlan {
	return {
		waves: { waves: [], unreached: [], running: [CHILD] },
		tracked: new Map(),
		context: { repo: REPO, titles: new Map(), open_numbers: new Set([ISSUE]) },
		labels: new Map([[ISSUE, LABELS]]),
	}
}

function pulls_of(pr: number): string {
	return JSON.stringify([{ number: pr, body: `closes #${String(ISSUE)}` }])
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
})

describe('run_board_human_merge.read_prs — the ETag read', () => {
	it('answers an unchanged re-read from 304, never unconditionally (ac-691629a4)', async () => {
		serve({ kind: 'changed', etag: FIRST_ETAG, body: pulls_of(FIRST_PR) }, { kind: 'unchanged' })
		const unconditional = vi.spyOn(git_gh_exec, 'exec_gh_api')

		const first = await run_board_human_merge.read_prs(plan_of())
		const second = await run_board_human_merge.read_prs(plan_of())

		expect(first).toStrictEqual(new Map([[ISSUE, FIRST_PR]]))
		expect(second).toStrictEqual(first)
		expect(sent_etags()).toStrictEqual([undefined, FIRST_ETAG])
		expect(unconditional).not.toHaveBeenCalled()
	})

	it('updates the PR number when the listing changed under a new ETag (ac-bdb6b56d)', async () => {
		serve(
			{ kind: 'changed', etag: FIRST_ETAG, body: pulls_of(FIRST_PR) },
			{ kind: 'changed', etag: SECOND_ETAG, body: pulls_of(SECOND_PR) },
		)

		const before = await run_board_human_merge.read_prs(plan_of())
		const after = await run_board_human_merge.read_prs(plan_of())

		expect(before.get(ISSUE)).toBe(FIRST_PR)
		expect(after.get(ISSUE)).toBe(SECOND_PR)
		expect(sent_etags()).toStrictEqual([undefined, FIRST_ETAG])
	})
})
