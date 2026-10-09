import { fileURLToPath } from 'node:url'
import { git_spawn_sync } from '#scripts/git/git-spawn-sync'
import { cli_flags } from '#scripts/lib/cli-flags'
import { github_release } from './github-release'
import { github_release_environment } from './github-release-environment'

const KNOWN_FLAGS: ReadonlyArray<string> = []
const COMMAND_NAME = 'release:github'
const ARGUMENT_START = 2
const SUCCESS_EXIT_CODE = 0

// A release published without the tag list would pick its previous tag from nothing, so a failed
// `git tag` stops the run rather than reading as "no tags".
function local_tags(): Array<string> {
	const output = git_spawn_sync.read(['tag', '--list'])
	if (output === undefined) throw new Error('git tag --list failed')

	return output.split('\n')
}

// **No argument reaches the publish**. The command reads only the
// environment, so a `--help` it ignored would create a real GitHub Release; a help request prints
// the usage and any other argument is refused, both before the environment is read.
async function run_argv(argv: ReadonlyArray<string>): Promise<number> {
	const answer = cli_flags.answer_help_or_unknown(
		argv.slice(ARGUMENT_START),
		KNOWN_FLAGS,
		COMMAND_NAME,
	)
	if (answer !== undefined) return answer

	const { token, tag, settings } = github_release_environment.read_release_input(process.env)

	console.info(await github_release.publish(fetch, token, tag, { ...settings, tags: local_tags() }))

	return SUCCESS_EXIT_CODE
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run_argv(argv)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv)

const github_release_cli = { local_tags, run_argv }
export { github_release_cli }
