import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { release_publish_run } from './release-publish-run'

const VERSION = '1.342.0'
const RUN_ID = 39_108_200_869
const TITLE = 'Publish v1.342.0'
const RUNS_PATH = 'repos/{owner}/{repo}/actions/workflows/publish.yml/runs?per_page=100'

function given_runs(runs: ReadonlyArray<object>): void {
	vi.spyOn(git_gh_exec, 'exec_gh_api').mockResolvedValue(JSON.stringify({ workflow_runs: runs }))
}

function run(title: string, status: string, conclusion?: string): object {
	return { id: RUN_ID, display_title: title, status, conclusion }
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('release_publish_run.failed_run_id', () => {
	it('names the Publish run of the tag once it has failed', async () => {
		given_runs([run(TITLE, 'completed', 'failure')])

		expect(await release_publish_run.failed_run_id(VERSION)).toBe(RUN_ID)
		expect(git_gh_exec.exec_gh_api).toHaveBeenCalledWith({ path: RUNS_PATH })
	})

	it.each([
		['the run of another tag failed', [run('Publish v1.341.0', 'completed', 'failure')]],
		['the run is still at work', [run(TITLE, 'in_progress')]],
		['the run succeeded', [run(TITLE, 'completed', 'success')]],
		['no run is listed yet', []],
	])('answers none when %s', async (_case, runs) => {
		given_runs(runs)

		expect(await release_publish_run.failed_run_id(VERSION)).toBeUndefined()
	})

	it('answers none when the runs cannot be read', async () => {
		vi.spyOn(git_gh_exec, 'exec_gh_api').mockRejectedValue(new Error('HTTP 404'))

		expect(await release_publish_run.failed_run_id(VERSION)).toBeUndefined()
	})
})
