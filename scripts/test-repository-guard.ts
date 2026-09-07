import { execFileSync } from 'node:child_process'
import { git_location_environment, GIT_LOCATION_VARIABLES } from './git/git-location-environment'
import { shim_shell } from './shim-shell'

// **A unit test must not write into the repository the suite is running in**, and until
// joshuafolkken/kit#1530 nothing said so out loud.
//
// `lane-change-base.test.ts` builds a real git topology in a temp directory and hands its helper
// `{ cwd }` and nothing else. Run from the pre-push hook it inherited `GIT_DIR` and `GIT_INDEX_FILE`
// from the hook environment — both of which beat `cwd` — so the fixture's own commits landed on the
// branch being pushed. `1085-lane`'s reflog carries three of them, titled `base` and
// `another lane merged`, 26 seconds after the run's real commit; `1080-lane` took one. The same
// helper's `git config user.email` wrote a fixture identity into `--local` config, which every
// linked work tree of the repository shares, so all five checkouts on the machine started authoring
// commits as `Lane Fixture <lane@example.test>`.
//
// **This is the second instance of one class in a day.** joshuafolkken/kit#1515 fixed the first, in
// `propagate-git`'s probes, by clearing the location variables — and fixing the instance is all it
// did. The class recurred within hours, in a file written after it, arriving the same way: silently,
// with the only evidence a reflog someone had to go and read.
//
// **So the guard is built one dimension over from #1515's own network guard, on the same mechanism**
// (`test-network-guard.ts` arms the `PATH` shim, holds the record and fails the run from
// `globalSetup`'s teardown; this module contributes the `sh` that decides). Reusing it rather than
// writing a second guard is `CLAUDE.md` → "No clones", and it is also the only way the two can share
// one record: a run that both reached the network and wrote to the repository reports both.
//
// **What it refuses, and why that is narrower than "any command touching the repository".** Reads
// are the suite's business — half of it reads the repository it is running in, and refusing that
// would stop the suite rather than the defect. A read also cannot move a branch. So the arm is the
// *writing* subcommands, and it refuses one on either of two findings:
//
// 1. **Any git location variable is set.** A fixture is targeted by clearing the environment, never
//    by out-arguing it, so a writing command reaching git with `GIT_DIR` or `GIT_INDEX_FILE` still
//    in its environment is refused whatever it was aimed at. This is the exact shape of both
//    instances, and it is decided without spawning anything.
// 2. **The command resolves into the guarded repository.** The environment can be clean and the
//    write still land here, by way of an ambient `cwd` — a test that `process.chdir`s into the
//    checkout and commits. The resolution is git's own `rev-parse --absolute-git-dir`, **asked with
//    the caller's own global options in front of it**, so `-C <fixture>` is not refused for the
//    directory the shim happens to sit in and `--git-dir <checkout>` is not let through for it.
//
// The two lists below say which finding a subcommand faces: an unambiguous writer faces both, and
// one whose reading spelling this suite uses faces the first only.
//
// **It fails closed on the second finding**: a resolution that fails means the command is not inside
// any repository at all — that is an answer, not an unknown, and the first finding has already
// refused every environment that could have redirected it elsewhere.
//
// **The one deliberate fail-open** is a `PROJECT_ROOT` that is not a git repository, where there is
// no repository for a test to damage and the second finding is left out of the generated shim. The
// first finding is generated unconditionally, so an inherited environment is refused either way.
//
// **What it names.** The shim cannot see which test called it — it is a `PATH` shim, and vitest puts
// no test identity in the environment. It does not need to: it refuses **at the call**, with `exit 1`
// and the command and the finding on stderr, so `execa` throws inside the test and vitest names the
// file and the test itself. The record read at teardown is the backstop for a test that swallows the
// error, and it carries the command and the finding for the same reason — so nobody has to
// reconstruct it from a reflog the way joshuafolkken/kit#1530 was.

// The `git` subcommands that can write to a repository, an index or a config. Absent from it are the
// reads the suite lives on (`status`, `log`, `diff`, `rev-parse`, `merge-base`, `show`,
// `ls-files`, `cat-file`, `describe`) and the network subcommands, which `test-network-guard.ts`
// refuses outright before this arm is reached.
//
// **`symbolic-ref` is deliberately absent**: its writing spelling takes a second argument and its
// reading spelling does not, and splitting that inside a shell `case` fails open when it gets it
// wrong. Nothing in this suite writes a symbolic ref, and the branch-moving spellings that matter
// (`update-ref`, `checkout`, `switch`, `reset`) are all here.
const GIT_WRITING_SUBCOMMANDS: ReadonlyArray<string> = [
	'add',
	'am',
	'checkout',
	'cherry-pick',
	'clean',
	'commit',
	'gc',
	'init',
	'merge',
	'mv',
	'prune',
	'rebase',
	'reset',
	'restore',
	'revert',
	'rm',
	'switch',
	'update-index',
	'update-ref',
]

// The subcommands whose **reading** spelling this suite actually uses — `worktree list`,
// `branch --show-current`, `config --get`, `stash list`, `tag -l`, `notes list`, `apply --check`.
// They are refused on the inherited-environment finding only.
//
// **Which is not a hole, but the line between the two findings drawn where it belongs.** An
// inherited environment is wrong for a read as surely as for a write — it is the other half of what
// joshuafolkken/kit#1530 did, where `git_command`'s readings answered about the repository being
// pushed — so finding 1 covers these whole, `config user.email <value>` and `worktree add` included.
// Finding 2 is the one that cannot tell them apart: an ambient `cwd` inside the checkout is exactly
// how a legitimate read of the real repository is spelled, and refusing that would stop the suite
// rather than the defect (`test-network-guard.ts` names the worktree machinery as a read that has to
// keep working). Splitting them on their flags instead was rejected for the reason the network list
// refuses `remote` whole: getting a flag `case` wrong in `sh` fails **open**.
const GIT_AMBIGUOUS_SUBCOMMANDS: ReadonlyArray<string> = [
	'apply',
	'branch',
	'config',
	'notes',
	'stash',
	'tag',
	'worktree',
]

// The word every recorded write violation starts with, so one shared record still says which guard
// caught which call and `describe_violations` can report each kind under its own heading.
const WRITE_MARKER = 'repository write:'
// **The headline states the rule and the detail line states the finding**, because the two findings
// have different fixes: clearing the environment is the answer to the first and gives the second a
// misleading instruction, which is what the same sentence said for both until review round 1.
const BLOCKED_WRITE_MESSAGE =
	'josh: a unit test must not run a writing git command against the repository the suite is running in'
const WRITE_VIOLATION_HEADING =
	'The unit suite ran a writing git command against the repository it is running in. Clear GIT_DIR and its siblings in the test that made it:'

// The record and the stderr detail both read as prose and both expand in `sh`: `$*` is the arguments
// the shim stood in for, `$guard_via` the finding that refused them.
const REFUSED_COMMAND = 'git $* — via $guard_via'
const RECORDED_WRITE = `${WRITE_MARKER} ${REFUSED_COMMAND}`

const GIT_DIRECTORY_ARGUMENTS = ['rev-parse', '--path-format=absolute', '--git-common-dir']

// **The one failure that is an answer rather than an unknown.** There is no repository at
// `PROJECT_ROOT`, so finding 2 has nothing to protect and is left out of the generated shim while
// finding 1 stays armed. Every other failure — an unreadable directory, a git that cannot run — is a
// guard that does not know what it is guarding, and a guard that cannot answer must not report the
// run clean (review round 1 of joshuafolkken/kit#1530).
const NOT_A_REPOSITORY = 'not a git repository'
const RESOLUTION_HEADING =
	'The unit-suite repository guard could not work out which repository it protects, so the run proves nothing:'

function text_of(value: unknown): string {
	return typeof value === 'string' ? value : ''
}

// What git said, plus what node said when git never ran — the two places the reason can be, joined
// so one `includes` decides between them.
function stderr_of(error: unknown): string {
	if (typeof error !== 'object' || error === null) return ''

	const stderr = 'stderr' in error ? text_of(error.stderr) : ''
	const message = 'message' in error ? text_of(error.message) : ''

	return `${stderr} ${message}`.trim()
}

function is_absent_repository(error: unknown): boolean {
	return stderr_of(error).includes(NOT_A_REPOSITORY)
}

// The repository this guard protects, as git itself resolves it — the **common** directory rather
// than the per-work-tree one, so a lane's shim refuses a write into any of the repository's linked
// work trees and not only into its own.
function guarded_git_directory(git_binary: string | undefined, from: string): string | undefined {
	if (git_binary === undefined) return undefined

	try {
		return execFileSync(git_binary, GIT_DIRECTORY_ARGUMENTS, {
			cwd: from,
			encoding: 'utf8',
			// **Cleared here too, and not belt-and-braces.** The guard is armed from `globalSetup`, and
			// under the pre-push hook that process has itself inherited `GIT_DIR` — so asking without
			// clearing it answers about whatever the hook was pointed at, and the shim would be built
			// to protect a repository this suite has nothing to do with.
			env: { ...process.env, ...git_location_environment.location_free_environment() },
			stdio: ['ignore', 'pipe', 'pipe'],
		}).trim()
	} catch (error) {
		if (!is_absent_repository(error)) {
			throw new Error(`${RESOLUTION_HEADING} ${stderr_of(error)}`, { cause: error })
		}

		return undefined
	}
}

// Finding 1, one line per variable. `${NAME-}` rather than `$NAME` so an unset name is the empty
// string under `set -u` as readily as without it.
function environment_lines(): Array<string> {
	return GIT_LOCATION_VARIABLES.map(
		(name) => `[ -z "\${${name}-}" ] || guard_env="$guard_env ${name}"`,
	)
}

// The `sh` function finding 2 resolves through, emitted once at the top of the shim.
//
// **It keeps the caller's own global options** — the words the scan counted before the subcommand —
// and asks git where *that* command would act. `cwd` alone is not that answer, in both directions:
// `git -C <fixture>` moves it away from the directory the shim was spawned in, and
// `git --git-dir <checkout>` moves it towards the guarded one. A resolution taken from `cwd` refused
// the first and let the second straight through, which is the bypass review round 1 demonstrated.
//
// The rotation is how a POSIX shell function keeps only its first `n` arguments: each of the first
// `n` is moved to the end, and everything left in front of them is then dropped. A function has its
// own positional parameters, so the shim's `$@` is untouched and still `exec`s intact.
function resolver_lines(git_binary: string): Array<string> {
	return [
		'guard_dir_of() {',
		'\tguard_kept=$1',
		'\tshift',
		'\tguard_i=0',
		'\twhile [ "$guard_i" -lt "$guard_kept" ]; do',
		'\t\tguard_head=$1',
		'\t\tshift',
		'\t\tset -- "$@" "$guard_head"',
		'\t\tguard_i=$((guard_i + 1))',
		'\tdone',
		'\twhile [ "$#" -gt "$guard_kept" ]; do shift; done',
		`\t${shim_shell.quoted(git_binary)} "$@" rev-parse --absolute-git-dir 2>/dev/null`,
		'}',
	]
}

// Finding 2, asked only when finding 1 found nothing — a contaminated environment is already a
// refusal, and asking git where it would write costs a process.
function target_lines(guarded_directory: string): Array<string> {
	const quoted_directory = shim_shell.quoted(guarded_directory)

	return [
		'if [ -z "$guard_via" ]; then',
		'\tguard_dir=$(guard_dir_of "$guard_seen" "$@")',
		'\tcase "$guard_dir" in',
		`\t\t${quoted_directory}|${quoted_directory}/*) guard_via="a working directory inside $guard_dir" ;;`,
		'\tesac',
		'fi',
	]
}

function refusal_lines(log_file: string): Array<string> {
	return [
		'if [ -n "$guard_via" ]; then',
		`\t${shim_shell.record_line(log_file, RECORDED_WRITE)}`,
		`\techo ${shim_shell.quoted(BLOCKED_WRITE_MESSAGE)} >&2`,
		`\techo "  refused: ${REFUSED_COMMAND}" >&2`,
		'\texit 1',
		'fi',
	]
}

interface WriteGuard {
	log_file: string
	guarded_directory: string | undefined
}

// Finding 1, with the two variables it answers through declared empty first.
function environment_findings(): Array<string> {
	return [
		"guard_env=''",
		...environment_lines(),
		"guard_via=''",
		'[ -z "$guard_env" ] || guard_via="an inherited git environment:$guard_env"',
	]
}

// Finding 1 on its own, which is also the whole of the ambiguous arm.
function environment_guard_lines(log_file: string): Array<string> {
	return [...environment_findings(), ...refusal_lines(log_file)]
}

// The whole `sh` body of the shim's writing-subcommand arm, unindented — the caller indents it into
// the `case` the way it does the blocking lines it already had. Finding 1 then finding 2, with the
// refusal after both, so the cheap one answers first and the process is spawned only when it must be.
function write_guard_lines(guard: WriteGuard): Array<string> {
	const { guarded_directory } = guard

	if (guarded_directory === undefined) return environment_guard_lines(guard.log_file)

	return [
		...environment_findings(),
		...target_lines(guarded_directory),
		...refusal_lines(guard.log_file),
	]
}

// The shim's prelude: the resolver, where there is a repository to resolve against.
function prelude_lines(git_binary: string, guarded_directory: string | undefined): Array<string> {
	return guarded_directory === undefined ? [] : resolver_lines(git_binary)
}

// Which heading a recorded line belongs under. The record is shared with the network guard, so the
// marker is what tells the two apart at teardown.
function is_write_violation(call: string): boolean {
	return call.startsWith(WRITE_MARKER)
}

const test_repository_guard = {
	BLOCKED_WRITE_MESSAGE,
	GIT_AMBIGUOUS_SUBCOMMANDS,
	GIT_WRITING_SUBCOMMANDS,
	RESOLUTION_HEADING,
	WRITE_MARKER,
	WRITE_VIOLATION_HEADING,
	environment_guard_lines,
	guarded_git_directory,
	is_write_violation,
	prelude_lines,
	write_guard_lines,
}

export { test_repository_guard }
export type { WriteGuard }
