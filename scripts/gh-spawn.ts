import { execaSync } from 'execa'
import { PROJECT_ROOT } from './init/init-paths'

function get_repo_name_with_owner(): string | undefined {
	const result = execaSync(
		'gh',
		['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'],
		{ cwd: PROJECT_ROOT, reject: false },
	)
	if (result.exitCode !== 0 || !result.stdout) return undefined

	return result.stdout.trim() || undefined
}

const gh_spawn = { get_repo_name_with_owner }

export { gh_spawn }
