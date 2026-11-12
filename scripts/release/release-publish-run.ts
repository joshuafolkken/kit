import { git_gh_api_path } from '#scripts/gh/git-gh-api-path'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { json_value } from '#scripts/lib/json-value'
import { github_release_runs, type RunSource } from './github-release-runs'
import { release_tag } from './release-tag'

// The tag's Publish run as `pnpm josh release` sees it through `gh`, so the npm wait can end the
// moment that run fails instead of waiting out its timeout for a version that will never appear.

const PUBLISH_WORKFLOW = 'publish.yml'
const NPM_JOBS = ['publish-npm']

// `failed_jobs` is empty when the jobs could not be read; `npm_job_failed` then holds, since
// nothing shows that npm took the version.
interface FailedRun {
	run_id: number
	failed_jobs: ReadonlyArray<string>
	npm_job_failed: boolean
}

function gh_run_source(): RunSource {
	return {
		read: async (api_path) =>
			json_value.parse_or_undefined(
				await git_gh_exec.exec_gh_api({ path: `${git_gh_api_path.repo_api_path()}${api_path}` }),
			),
		workflow: PUBLISH_WORKFLOW,
		jobs: [],
		release_run_workflow: undefined,
	}
}

async function read_failed_jobs(source: RunSource, run_id: number): Promise<ReadonlyArray<string>> {
	try {
		return await github_release_runs.failed_job_names(source, run_id)
	} catch {
		return []
	}
}

async function describe_failure(source: RunSource, run_id: number): Promise<FailedRun> {
	const failed_jobs = await read_failed_jobs(source, run_id)
	const npm_job_failed =
		failed_jobs.length === 0 ||
		failed_jobs.some((name) => github_release_runs.is_named_job(name, NPM_JOBS))

	return { run_id, failed_jobs, npm_job_failed }
}

// A repository without the workflow, or a read that fails, tells nothing about the run, so the npm
// wait goes on as it did before the run was asked about.
async function failed_run(version: string): Promise<FailedRun | undefined> {
	try {
		const source = gh_run_source()
		const run = await github_release_runs.publish_run(
			source,
			PUBLISH_WORKFLOW,
			release_tag.tag_name(version),
		)
		if (!run || github_release_runs.run_state(run) !== 'failed') return undefined

		return await describe_failure(source, run.id)
	} catch {
		return undefined
	}
}

const release_publish_run = { failed_run }

export type { FailedRun }
export { release_publish_run }
