import { git_gh_api_path } from '#scripts/gh/git-gh-api-path'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { json_value } from '#scripts/lib/json-value'
import { github_release_runs, type RunSource } from './github-release-runs'
import { release_tag } from './release-tag'

// The tag's Publish run as `pnpm josh release` sees it through `gh`, so the npm wait can end the
// moment that run fails instead of waiting out its timeout for a version that will never appear.

const PUBLISH_WORKFLOW = 'publish.yml'

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

// A repository without the workflow, or a read that fails, tells nothing about the run, so the npm
// wait goes on as it did before the run was asked about.
async function failed_run_id(version: string): Promise<number | undefined> {
	try {
		const tag = release_tag.tag_name(version)
		const run = await github_release_runs.publish_run(gh_run_source(), PUBLISH_WORKFLOW, tag)

		return run && github_release_runs.run_state(run) === 'failed' ? run.id : undefined
	} catch {
		return undefined
	}
}

const release_publish_run = { failed_run_id }

export { release_publish_run }
