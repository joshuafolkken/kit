import type { EpicChild } from '#scripts/epic/epic-graph'
import type { EpicNextResult } from '#scripts/epic/epic-report'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { BUG_LABEL, RUN_LANE_LABEL } from '#scripts/issue/issue-labels'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { backlog_auto_triage } from './backlog-auto-triage'

// The mechanical triage (joshuafolkken/kit#5517): an untriaged candidate that is not a `bug` naming a
// verification-gate path is labelled `run:lane` with its reason, and only the rest wait for judgment.

const REPO = 'owner/repo'
const OTHER_REPO = 'owner/other'
const NUMBER = 901
const GATE_BODY = 'The hook in `scripts/hooks/` passes a red tree.'
const OUTSIDE_BODY = 'The board is slow.'

function child(labels: ReadonlyArray<string>, body?: string): EpicChild {
	return { number: NUMBER, repo: REPO, state: 'OPEN', labels, blocked_by: [], body }
}

function run_result(children: ReadonlyArray<EpicChild>, repo = REPO): EpicNextResult {
	return {
		verdict: 'run',
		candidates: [{ repo, children }],
		waiting: [],
		blocked_on_people: [],
		anomalies: [],
	}
}

const apply_label = vi.spyOn(git_gh_command, 'issue_apply_label')
const try_comment = vi.spyOn(git_gh_command, 'issue_try_comment')
const read_labels = vi.spyOn(git_gh_command, 'read_label_names')

beforeEach(() => {
	apply_label.mockResolvedValue({ is_applied: true })
	try_comment.mockResolvedValue(true)
	read_labels.mockResolvedValue([])
})

afterEach(() => {
	vi.clearAllMocks()
})

describe('backlog_auto_triage.lane_reason', () => {
	it('names the missing bug label for an issue that is not a bug', () => {
		expect(backlog_auto_triage.lane_reason(child([]))).toContain(`no \`${BUG_LABEL}\` label`)
	})

	it('names the missing gate path for a bug outside the verification gate', () => {
		const reason = backlog_auto_triage.lane_reason(child([BUG_LABEL], OUTSIDE_BODY))

		expect(reason).toContain('names no verification-gate path')
	})

	it('leaves a bug naming a verification-gate path to the judgment', () => {
		expect(backlog_auto_triage.lane_reason(child([BUG_LABEL], GATE_BODY))).toBeUndefined()
	})

	it('leaves a bug whose body was not read to the judgment', () => {
		expect(backlog_auto_triage.lane_reason(child([BUG_LABEL]))).toBeUndefined()
	})

	it('reads the bug label case-insensitively, as every label read does', () => {
		expect(backlog_auto_triage.lane_reason(child(['Bug'], GATE_BODY))).toBeUndefined()
	})

	it.each([
		'`scripts/review/review-attest.ts` passes on the wrong tree',
		'the `lefthook.yml` pre-push skips the gate',
		'the `.github/workflows/ci.yml` checks job reports green on a red tree',
		'`eslint.config.js` drops a rule',
	])('leaves a bug in the review, pre-push or merge checks to the judgment: %s', (body) => {
		expect(backlog_auto_triage.lane_reason(child([BUG_LABEL], body))).toBeUndefined()
	})
})

describe('backlog_auto_triage.untriaged_of', () => {
	it('labels a non-bug run:lane with a comment naming why, and holds nothing', async () => {
		const { result, untriaged } = await backlog_auto_triage.untriaged_of(
			run_result([child([])]),
			REPO,
		)

		expect(untriaged).toEqual([])
		expect(result.candidates[0]?.children[0]?.labels).toContain(RUN_LANE_LABEL)
		expect(apply_label).toHaveBeenCalledWith(String(NUMBER), RUN_LANE_LABEL, REPO)
		expect(try_comment).toHaveBeenCalledWith(
			String(NUMBER),
			expect.stringContaining(`no \`${BUG_LABEL}\` label`),
			REPO,
		)
	})

	it('labels a bug outside the verification gate run:lane', async () => {
		const read = run_result([child([BUG_LABEL], OUTSIDE_BODY)])
		const { untriaged } = await backlog_auto_triage.untriaged_of(read, REPO)

		expect(untriaged).toEqual([])
		expect(apply_label).toHaveBeenCalledOnce()
	})

	it('holds a bug inside the verification gate for the judgment, writing nothing', async () => {
		const gate_bug = child([BUG_LABEL], GATE_BODY)
		const { untriaged } = await backlog_auto_triage.untriaged_of(run_result([gate_bug]), REPO)

		expect(untriaged).toEqual([gate_bug])
		expect(apply_label).not.toHaveBeenCalled()
		expect(try_comment).not.toHaveBeenCalled()
	})
})

describe('backlog_auto_triage.untriaged_of — nothing written', () => {
	it('holds a candidate whose label write failed, posting no comment', async () => {
		apply_label.mockResolvedValue({ is_applied: false, reason: 'gh failed' })

		const { untriaged } = await backlog_auto_triage.untriaged_of(run_result([child([])]), REPO)

		expect(untriaged).toHaveLength(1)
		expect(try_comment).not.toHaveBeenCalled()
	})

	it('holds a candidate whose fresh label read failed, writing nothing', async () => {
		read_labels.mockResolvedValue(undefined)

		const { untriaged } = await backlog_auto_triage.untriaged_of(run_result([child([])]), REPO)

		expect(untriaged).toHaveLength(1)
		expect(apply_label).not.toHaveBeenCalled()
	})

	it('takes a racing call’s label as read fresh, posting no second comment', async () => {
		read_labels.mockResolvedValue([RUN_LANE_LABEL])

		const { untriaged } = await backlog_auto_triage.untriaged_of(run_result([child([])]), REPO)

		expect(untriaged).toEqual([])
		expect(apply_label).not.toHaveBeenCalled()
		expect(try_comment).not.toHaveBeenCalled()
	})

	it('leaves an already-triaged candidate and another repository alone', async () => {
		const triaged = run_result([child([RUN_LANE_LABEL])])
		const elsewhere = run_result([child([])], OTHER_REPO)

		await backlog_auto_triage.untriaged_of(triaged, REPO)
		await backlog_auto_triage.untriaged_of(elsewhere, REPO)

		expect(apply_label).not.toHaveBeenCalled()
	})

	it('writes nothing when the verdict is not run', async () => {
		const waiting: EpicNextResult = { ...run_result([child([])]), verdict: 'wait' }
		const { untriaged } = await backlog_auto_triage.untriaged_of(waiting, REPO)

		expect(untriaged).toEqual([])
		expect(apply_label).not.toHaveBeenCalled()
	})
})
