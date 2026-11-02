import { git_command } from '#scripts/git/git-command'
import { josh_command } from '#scripts/josh/josh-run'
import { lane_registry } from '#scripts/lane/lane-registry'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_followup_cleanup, type CleanupStep } from './git-followup-cleanup'
import { git_followup_finish } from './git-followup-finish'

// joshuafolkken/kit#5941: a merged run pulls the default branch into the main checkout, so no caller
// runs `main:sync` as a step of its own after `followup`. A separate suite from
// `git-followup-finish.test.ts`, which is near its length limit.
const ROOT = '/scratch/main'
const SYNC = 'main:sync'
const LABEL = 'The main checkout sync'
const DEFAULT_BRANCH = 'main'

function sync_step(should_merge: boolean): CleanupStep {
	const step = git_followup_finish
		.build_finish_steps('#42', should_merge)
		.find((candidate) => candidate.label === LABEL)

	if (step === undefined) throw new Error(`no ${LABEL} step`)

	return step
}

beforeEach(() => {
	vi.restoreAllMocks()
	vi.spyOn(lane_registry, 'main_repository_root').mockResolvedValue(ROOT)
	vi.spyOn(josh_command, 'josh_run_at').mockResolvedValue({ code: 0, out: '' })
	vi.spyOn(git_command, 'branch_at').mockResolvedValue(DEFAULT_BRANCH)
	vi.spyOn(git_command, 'get_default_branch').mockResolvedValue(DEFAULT_BRANCH)
	vi.spyOn(console, 'warn').mockImplementation(() => undefined)
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
})

describe('sync_main_checkout — another session on the main checkout', () => {
	it('leaves a main checkout on another branch where it is', async () => {
		vi.mocked(git_command.branch_at).mockResolvedValue('6001-foo')

		await git_followup_finish.sync_main_checkout(true)

		expect(josh_command.josh_run_at).not.toHaveBeenCalled()
	})

	it('reads the branch of the main checkout, not of this one', async () => {
		await git_followup_finish.sync_main_checkout(true)

		expect(git_command.branch_at).toHaveBeenCalledWith(ROOT)
	})
})

describe('sync_main_checkout', () => {
	it('runs main:sync at the main repository root after a merge', async () => {
		await git_followup_finish.sync_main_checkout(true)

		expect(josh_command.josh_run_at).toHaveBeenCalledExactlyOnceWith([SYNC], ROOT)
	})

	it('runs nothing when the run merged nothing', async () => {
		await git_followup_finish.sync_main_checkout(false)

		expect(josh_command.josh_run_at).not.toHaveBeenCalled()
	})

	it('rejects with the step output when main:sync fails', async () => {
		vi.mocked(josh_command.josh_run_at).mockResolvedValue({ code: 1, out: '', err: 'dirty' })

		await expect(git_followup_finish.sync_main_checkout(true)).rejects.toThrow('dirty')
	})
})

describe('the main checkout sync in the tail', () => {
	it('is the last step, after the hold release', () => {
		const labels = git_followup_finish.build_finish_steps('#42', true).map((step) => step.label)

		expect(labels.at(-1)).toBe(LABEL)
	})

	it('reports a failed sync without failing the merged run', async () => {
		vi.mocked(josh_command.josh_run_at).mockResolvedValue({ code: 1, out: '', err: 'dirty' })

		await expect(git_followup_cleanup.run_guarded_steps(true, [sync_step(true)])).resolves.toBe(
			false,
		)
		expect(vi.mocked(console.warn).mock.calls.flat().join('\n')).toContain(LABEL)
	})

	it('names the primary-checkout command as its recovery', () => {
		expect(sync_step(true).recovery).toContain(SYNC)
	})
})
