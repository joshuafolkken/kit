import { existsSync } from 'node:fs'
import path from 'node:path'
import { repo_origin } from '#scripts/discovery/repo-origin'
import { execaSync } from 'execa'

const GITHUB_RUN_COMMANDS = new Set([
	'run:entry',
	'run:prep',
	'run:next',
	'run:step',
	'run:merge',
	'run:tail',
])

function explanation(root: string, command: string): string | undefined {
	if (!GITHUB_RUN_COMMANDS.has(command)) return undefined

	if (!existsSync(path.join(root, '.git'))) {
		return `${command} requires Git and a GitHub origin. Run git init and add a GitHub origin first.`
	}

	const result = execaSync('git', ['config', '--get', 'remote.origin.url'], {
		cwd: root,
		reject: false,
	})
	if (result.exitCode === 0 && repo_origin.parse_origin_url(result.stdout)) return undefined

	return `${command} requires a GitHub origin. Add an origin pointing to GitHub first.`
}

const run_github_prerequisite = { explanation }
export { run_github_prerequisite }
