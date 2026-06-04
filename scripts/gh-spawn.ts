import { spawnSync } from 'node:child_process'
import { PROJECT_ROOT } from './init/init-paths'

function get_repo_name_with_owner(): string | undefined {
	const result = spawnSync(
		'gh',
		['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'],
		{ encoding: 'utf8', cwd: PROJECT_ROOT },
	)
	if (result.status !== 0 || !result.stdout) return undefined

	return result.stdout.trim() || undefined
}

const gh_spawn = { get_repo_name_with_owner }

export { gh_spawn }
