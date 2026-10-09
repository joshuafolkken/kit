import { execFileSync } from 'node:child_process'
import { git_utilities } from './constants'
import { git_command } from './git-command'
import { git_location_environment, GIT_LOCATION_VARIABLES } from './git-location-environment'

// The one synchronous read of a checkout's two git directories — the same
// `GIT_DIRECTORY_ARGUMENTS` `git_command.git_directories` asks asynchronously, so the two spellings
// cannot name different directories. It had been run in three places with three timeouts and no
// memory of the answer, though a `PreToolUse` hook may ask it several times in one call.

const OWN_GIT_DIRECTORY = 0
const COMMON_GIT_DIRECTORY = 1
// The read runs inside `PreToolUse` hooks, which hold the tool call for as long as it takes;
// `rev-parse` takes no lock, so anything past a few seconds is a fault rather than slow work.
const PROBE_TIMEOUT_MS = 5000

// **Only an answer is remembered, never a failure** — a timeout or a directory that is not yet a
// repository is asked again next time. The key carries every input git resolves from: the directory
// asked about and, where the environment is inherited, the git location variables it holds.
const answers = new Map<string, ReadonlyArray<string>>()

// With an explicit `cwd`, the git location variables are cleared so that directory is what git answers
// for: a hook exports `GIT_DIR`, which beats `cwd` and would name the hook's checkout instead.
// Without one the environment is kept, so the read resolves the same
// checkout as the asynchronous `git_directories`.
function probe_environment(cwd: string | undefined): NodeJS.ProcessEnv {
	if (cwd === undefined) return process.env

	return { ...process.env, ...git_location_environment.location_free_environment() }
}

function cache_key(cwd: string | undefined): string {
	if (cwd !== undefined) return `explicit\0${cwd}`

	const locations = GIT_LOCATION_VARIABLES.map((name) => process.env[name] ?? '')

	return ['inherited', process.cwd(), ...locations].join('\0')
}

// git's own diagnostics are discarded: a checkout it cannot describe is already the empty answer, and
// a hook that let `fatal: not a git repository` through would print it in front of a tool call. The
// binary is resolved through `git_utilities` exactly as `git-spawn.ts` resolves it and run with an
// argument array and no `shell`; both are internally controlled, never untrusted input.
function read_directories(cwd: string | undefined): ReadonlyArray<string> {
	try {
		const output = execFileSync(
			git_utilities.get_git_command_for_spawn(),
			[...git_command.GIT_DIRECTORY_ARGUMENTS],
			{
				cwd,
				env: probe_environment(cwd),
				encoding: 'utf8',
				stdio: ['ignore', 'pipe', 'ignore'],
				timeout: PROBE_TIMEOUT_MS,
			},
		) // NOSONAR

		return output.split('\n').filter((line) => line !== '')
	} catch {
		return []
	}
}

// The work tree's own git directory, then the common one every work tree of the repository shares —
// or nothing, where git cannot describe the checkout.
function directories(cwd?: string): ReadonlyArray<string> {
	const key = cache_key(cwd)
	const known = answers.get(key)

	if (known !== undefined) return known

	const read = read_directories(cwd)

	if (read.length > 0) answers.set(key, read)

	return read
}

function own(cwd?: string): string | undefined {
	return directories(cwd)[OWN_GIT_DIRECTORY]
}

function repository(cwd?: string): string | undefined {
	return directories(cwd)[COMMON_GIT_DIRECTORY]
}

function select_linked(found: ReadonlyArray<string>): string | undefined {
	const own_directory = found[OWN_GIT_DIRECTORY]
	const common = found[COMMON_GIT_DIRECTORY]

	return own_directory !== undefined && common !== undefined && own_directory !== common
		? common
		: undefined
}

function resolve(cwd: string): string | undefined {
	return select_linked(directories(cwd))
}

const git_common_directory = { directories, own, repository, resolve, select_linked }

export { git_common_directory }
