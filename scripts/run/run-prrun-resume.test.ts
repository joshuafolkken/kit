import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_halfrun_resume } from './run-halfrun-resume'
import { run_hold } from './run-hold'
import { run_prrun_resume } from './run-prrun-resume'

// joshuafolkken/kit#3023: `fullrun #N` after a `prrun` stop resumes from where the stop left the pull
// request — the tail only once merged, the merge alone while nothing moved, the gate again otherwise —
// and adopts nothing but a record the stop marked.

const merge_state_mock = vi.hoisted(() => vi.fn())
const head_commit_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/gh/git-gh-command', () => ({
	git_gh_command: { pr_get_merge_state: merge_state_mock },
}))
vi.mock('#scripts/git/git-branch', () => ({
	git_branch: { current: vi.fn().mockResolvedValue('3023-lane') },
}))
vi.mock('#scripts/git/git-command', () => ({ git_command: { head_commit: head_commit_mock } }))

const scratch = mkdtempSync(path.join(tmpdir(), 'run-prrun-resume-test-'))
const TARGET = run_hold.hold_path(path.join(scratch, '.git'))
const ISSUE = '3023'
const OTHER_ISSUE = '3022'
const STOP_HEAD = 'aaa111'
const MOVED_HEAD = 'bbb222'

function hold_record(): unknown {
	const read = run_hold.read_hold(TARGET)

	if (read.kind !== 'held') return read.kind

	const { issue, is_fullrun, prrun_stop_head } = read.hold

	return { issue, is_fullrun, prrun_stop_head }
}

function mark_stop(issue: string = ISSUE): void {
	run_hold.create_stop_hold(TARGET, issue, { prrun_stop_head: STOP_HEAD })
}

function pull_state(is_merged: boolean, head_sha: string | undefined = STOP_HEAD): unknown {
	return { is_merged, merged_at: undefined, head_sha }
}

beforeEach(() => {
	merge_state_mock.mockReset().mockResolvedValue(pull_state(false))
	head_commit_mock.mockReset().mockResolvedValue(STOP_HEAD)
	vi.spyOn(run_halfrun_resume, 'hold_target').mockResolvedValue(TARGET)
	vi.spyOn(run_hold, 'is_tree_dirty').mockResolvedValue(false)
})

afterEach(() => {
	run_hold.release_hold(TARGET)
	vi.restoreAllMocks()
})

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

describe('run_prrun_resume.decide — what is left after a prrun stop', () => {
	const { PRRUN_GATE, PRRUN_MERGE, PRRUN_MERGED } = run_prrun_resume

	it.each([
		['a merged pull request leaves only the tail', true, STOP_HEAD, STOP_HEAD, false, PRRUN_MERGED],
		['an unmoved, clean branch merges', false, STOP_HEAD, STOP_HEAD, false, PRRUN_MERGE],
		['a moved branch runs the gate again', false, MOVED_HEAD, STOP_HEAD, false, PRRUN_GATE],
		['a push on GitHub runs the gate again', false, STOP_HEAD, MOVED_HEAD, false, PRRUN_GATE],
		['an unread remote head runs the gate again', false, STOP_HEAD, undefined, false, PRRUN_GATE],
		['a dirty tree runs the gate again', false, STOP_HEAD, STOP_HEAD, true, PRRUN_GATE],
	])('%s', (...[, is_merged, head, pr_head, is_dirty, expected]) => {
		const facts = { is_merged, stop_head: STOP_HEAD, head, pr_head, is_dirty }

		expect(run_prrun_resume.decide(facts)).toBe(expected)
	})
})

describe('run_prrun_resume.mark_stop_at — the prrun stop records the commit it stopped on', () => {
	it('marks its own hold with the current HEAD', async () => {
		run_hold.create_hold(TARGET, ISSUE)

		await expect(run_prrun_resume.mark_stop_at(TARGET, ISSUE)).resolves.toBe(
			run_halfrun_resume.MARKED,
		)
		expect(hold_record()).toStrictEqual({
			issue: ISSUE,
			is_fullrun: undefined,
			prrun_stop_head: STOP_HEAD,
		})
	})

	it("leaves another issue's hold alone", async () => {
		run_hold.create_hold(TARGET, OTHER_ISSUE)

		await expect(run_prrun_resume.mark_stop_at(TARGET, ISSUE)).resolves.toBe(
			run_halfrun_resume.FOREIGN,
		)
		expect(hold_record()).toMatchObject({ issue: OTHER_ISSUE, prrun_stop_head: undefined })
	})
})

describe('run_prrun_resume.resume_token — only a marked record answers', () => {
	it('answers the token for a marked record of this issue', async () => {
		mark_stop()
		merge_state_mock.mockResolvedValue(pull_state(true))

		await expect(run_prrun_resume.resume_token(ISSUE)).resolves.toBe(run_prrun_resume.PRRUN_MERGED)
	})

	it('reads the pull request head, not only the local one', async () => {
		mark_stop()
		merge_state_mock.mockResolvedValue(pull_state(false, MOVED_HEAD))

		await expect(run_prrun_resume.resume_token(ISSUE)).resolves.toBe(run_prrun_resume.PRRUN_GATE)
	})

	it.each([
		['an unmarked hold', (): unknown => run_hold.create_hold(TARGET, ISSUE)],
		[
			"another issue's stop",
			(): void => {
				mark_stop(OTHER_ISSUE)
			},
		],
		['a free tree', (): undefined => undefined],
	])('answers nothing for %s', async (_name, arrange) => {
		arrange()

		await expect(run_prrun_resume.resume_token(ISSUE)).resolves.toBeUndefined()
	})

	it('answers nothing when the git directory is unreadable', async () => {
		vi.spyOn(run_halfrun_resume, 'hold_target').mockResolvedValue(undefined)

		await expect(run_prrun_resume.resume_token(ISSUE)).resolves.toBeUndefined()
	})
})

describe('run_prrun_resume.adopt — the stopped record becomes this fullrun', () => {
	it('replaces a marked record with a fullrun hold carrying no stop head', async () => {
		mark_stop()

		await expect(run_prrun_resume.adopt(ISSUE)).resolves.toBe(true)
		expect(hold_record()).toStrictEqual({
			issue: ISSUE,
			is_fullrun: true,
			prrun_stop_head: undefined,
		})
	})

	it('adopts nothing over an unmarked hold', async () => {
		run_hold.create_hold(TARGET, ISSUE)

		await expect(run_prrun_resume.adopt(ISSUE)).resolves.toBe(false)
		expect(hold_record()).toStrictEqual({
			issue: ISSUE,
			is_fullrun: undefined,
			prrun_stop_head: undefined,
		})
	})
})
