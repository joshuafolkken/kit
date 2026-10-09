import { read_spawn_stderr, read_spawn_stdout } from '#scripts/lib/spawn-exit'
import { GIT_TIMEOUT_MS } from '#scripts/lib/timeouts'
import { execaSync } from 'execa'
import { git_utilities } from './constants'

// The one place a synchronous git command is spawned from — the sync
// counterpart of `git-spawn.ts`. Every caller here wants an answer rather than an exception, so a
// non-zero exit is returned as a result, and every call is bounded: a git that never answers is an
// unknown the caller already handles, never a hang.

const SUCCESS_EXIT_CODE = 0
// git translates its messages, so a caller matching stderr would fail under any non-English locale.
const C_LOCALE: Record<string, string> = { LC_ALL: 'C', LANGUAGE: 'C' }

interface GitSyncOptions {
	cwd?: string
	timeout?: number
	env?: Record<string, string | undefined>
	// A step a person watches (`josh start`) shows git's own progress and hook output as it runs.
	stdio?: 'inherit'
}

interface GitSyncResult {
	exit_code: number | undefined
	stdout: string
	stderr: string
}

function run(args: ReadonlyArray<string>, options: GitSyncOptions = {}): GitSyncResult {
	// execa runs the binary directly with an argument array and no `shell` option; the git command and
	// args are internally controlled, never untrusted input. tssecurity:S8705 is a false positive here.
	const result = execaSync(git_utilities.get_git_command_for_spawn(), args, {
		...options,
		extendEnv: true,
		reject: false,
		timeout: options.timeout ?? GIT_TIMEOUT_MS,
	}) // NOSONAR

	return {
		exit_code: result.exitCode,
		stdout: read_spawn_stdout(result),
		stderr: read_spawn_stderr(result),
	}
}

// The trimmed output of a command that succeeded, or undefined for any failure.
function read(args: ReadonlyArray<string>, options: GitSyncOptions = {}): string | undefined {
	const result = run(args, options)

	return result.exit_code === SUCCESS_EXIT_CODE ? result.stdout.trim() : undefined
}

// The configured `origin` URL, or undefined when the repository has none.
function origin_url(cwd: string): string | undefined {
	return read(['config', '--get', 'remote.origin.url'], { cwd })
}

// The absolute repository (or worktree) root, asked under the C locale so a caller can tell "not a
// repository" apart from every other failure by its stderr.
function toplevel(timeout: number = GIT_TIMEOUT_MS): GitSyncResult {
	return run(['rev-parse', '--show-toplevel'], { env: C_LOCALE, timeout })
}

const git_spawn_sync = { GIT_TIMEOUT_MS, C_LOCALE, run, read, origin_url, toplevel }

export { git_spawn_sync }
export type { GitSyncResult }
