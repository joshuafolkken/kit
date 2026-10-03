import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { github_release } from './github-release'
import { github_release_environment } from './github-release-environment'

async function main(): Promise<void> {
	const { token, tag, settings } = github_release_environment.read_release_input(process.env)
	const tags = execFileSync('git', ['tag', '--list'], { encoding: 'utf8' }).trim().split('\n')

	console.info(await github_release.publish(fetch, token, tag, { ...settings, tags }))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
