import { execFileSync } from 'node:child_process'
import { git_utilities } from './constants'
import { git_command } from './git-command'

const OWN_GIT_DIRECTORY = 0
const COMMON_GIT_DIRECTORY = 1
const PROBE_TIMEOUT_MS = 2000

function read_directories(cwd: string): Array<string> {
	const git = git_utilities.get_git_command_for_spawn()
	const output = execFileSync(git, [...git_command.GIT_DIRECTORY_ARGUMENTS], {
		cwd,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'ignore'],
		timeout: PROBE_TIMEOUT_MS,
	})

	return output.trim().split('\n')
}

function select_linked(directories: ReadonlyArray<string>): string | undefined {
	const own = directories[OWN_GIT_DIRECTORY]
	const common = directories[COMMON_GIT_DIRECTORY]

	return own !== undefined && common !== undefined && own !== common ? common : undefined
}

function resolve(cwd: string): string | undefined {
	try {
		return select_linked(read_directories(cwd))
	} catch {
		return undefined
	}
}

function repository(cwd: string): string | undefined {
	try {
		return read_directories(cwd)[COMMON_GIT_DIRECTORY]
	} catch {
		return undefined
	}
}

const git_common_directory = { repository, resolve, select_linked }

export { git_common_directory }
