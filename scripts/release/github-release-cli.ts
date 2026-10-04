import { fileURLToPath } from 'node:url'
import { git_spawn_sync } from '#scripts/git/git-spawn-sync'
import { github_release } from './github-release'
import { github_release_environment } from './github-release-environment'

// A release published without the tag list would pick its previous tag from nothing, so a failed
// `git tag` stops the run rather than reading as "no tags".
function local_tags(): Array<string> {
	const output = git_spawn_sync.read(['tag', '--list'])
	if (output === undefined) throw new Error('git tag --list failed')

	return output.split('\n')
}

async function main(): Promise<void> {
	const { token, tag, settings } = github_release_environment.read_release_input(process.env)

	console.info(await github_release.publish(fetch, token, tag, { ...settings, tags: local_tags() }))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()

const github_release_cli = { local_tags }
export { github_release_cli }
