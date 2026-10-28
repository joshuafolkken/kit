import { changed_paths } from './changed-paths'
import { git_diff_reads } from './git-diff-reads'
import { git_location_environment } from './git-location-environment'
import { git_spawn_sync, type GitSyncOptions } from './git-spawn-sync'

// The synchronous counterpart of `changed_paths.read_changed_paths(false)` — the branch diff since
// the merge base plus the untracked files — for a `PreToolUse` hook, which cannot await. It spawns the
// argument lists `git-diff-reads.ts` spawns, so the two readings agree on what "changed" is — through
// a merge of the default branch in progress too, measured from the base `change_base.resolved_through_merge`
// answers (joshuafolkken/kit#5309). Any failure is the empty list.

// With an explicit `cwd`, the git location variables are cleared so that directory is what git
// answers for, as in `git_spawn_sync.origin_url`.
function options_of(cwd: string | undefined): GitSyncOptions {
	if (cwd === undefined) return {}

	return { cwd, env: git_location_environment.location_free_environment() }
}

function default_branch_reference(options: GitSyncOptions): string {
	const output = git_spawn_sync.read([...git_diff_reads.DEFAULT_BRANCH_ARGUMENTS], options)
	const default_branch = git_diff_reads.default_branch_of(output)
	const remote_reference = git_diff_reads.remote_reference_of(default_branch)
	const check = git_diff_reads.reference_check_arguments(remote_reference)

	return git_spawn_sync.read(check, options) === undefined ? default_branch : remote_reference
}

// While a merge is in progress, the later of the base of `HEAD` and the base of `MERGE_HEAD`.
function through_merge(base: string, reference: string, options: GitSyncOptions): string {
	const incoming = git_spawn_sync.read(git_diff_reads.incoming_base_arguments(reference), options)

	if (incoming === undefined) return base

	const kept = git_spawn_sync.read(git_diff_reads.later_base_arguments(base, incoming), options)

	return git_diff_reads.later_base_of(kept, base)
}

function change_base(options: GitSyncOptions): string {
	const reference = default_branch_reference(options)
	const base = git_spawn_sync.read(git_diff_reads.merge_base_arguments(reference), options)

	if (base === undefined) return reference

	return through_merge(base, reference, options)
}

// Repository-root-relative paths, as the asynchronous reading returns them.
function read_changed_paths(cwd?: string): ReadonlyArray<string> {
	const options = options_of(cwd)
	const tracked = git_spawn_sync.read(
		git_diff_reads.names_since_arguments(change_base(options)),
		options,
	)
	const untracked = git_spawn_sync.read(git_diff_reads.UNTRACKED_ARGUMENTS, options)

	return [tracked, untracked].flatMap((raw = '') => changed_paths.to_paths(raw))
}

const changed_paths_sync = { read_changed_paths }

export { changed_paths_sync }
