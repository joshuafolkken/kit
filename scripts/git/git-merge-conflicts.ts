import { existsSync } from 'node:fs'
import path from 'node:path'
import { changed_paths_sync } from './changed-paths-sync'
import { git_spawn_sync } from './git-spawn-sync'

// The paths merging another branch into this working tree would stop on, read without touching any
// index or ref (joshuafolkken/kit#4348). **The working tree, not `HEAD`, is ours**: `josh ship` asks
// before its commit, so the change it is about to ship is still uncommitted. Each path is merged on
// its own, as `merge-tree` would merge its content: a side left as the merge base had it, or both
// sides alike, merges cleanly; a side that deleted or added what the other changed differently
// conflicts; otherwise `git merge-file` decides. Only blob ids are compared, so no content is read.

const CLEAN_EXIT_CODE = 0
const HEAD = 'HEAD'

interface Sides {
	base: string | undefined
	ours: string | undefined
	theirs: string | undefined
}

interface Commits {
	base: string
	theirs: string
}

function blob_id(revision: string, file_path: string, cwd: string): string | undefined {
	return git_spawn_sync.read(['rev-parse', '--verify', '--quiet', `${revision}:${file_path}`], {
		cwd,
	})
}

// Written to the object store so `merge-file --object-id` can read it; no index or ref moves.
function working_blob_id(file_path: string, cwd: string): string | undefined {
	if (!existsSync(path.join(cwd, file_path))) return undefined

	return git_spawn_sync.read(['hash-object', '-w', '--', file_path], { cwd })
}

function is_one_sided(sides: Sides): boolean {
	return sides.ours === sides.theirs || sides.ours === sides.base || sides.theirs === sides.base
}

function is_complete(sides: Sides): sides is Record<keyof Sides, string> {
	return sides.base !== undefined && sides.ours !== undefined && sides.theirs !== undefined
}

function is_merged(sides: Sides, cwd: string): boolean {
	if (is_one_sided(sides)) return true
	if (!is_complete(sides)) return false

	const { base, ours, theirs } = sides
	const result = git_spawn_sync.run(['merge-file', '-p', '--object-id', ours, base, theirs], {
		cwd,
	})

	return result.exit_code === CLEAN_EXIT_CODE
}

function sides_of(file_path: string, commits: Commits, cwd: string): Sides {
	return {
		base: blob_id(commits.base, file_path, cwd),
		ours: working_blob_id(file_path, cwd),
		theirs: blob_id(commits.theirs, file_path, cwd),
	}
}

// Of `paths` (relative to `cwd`, the working tree's root), the ones merging `theirs` would stop on;
// `undefined` where the merge base with `theirs` could not be read. While a merge is in progress the
// base moves up to where `MERGE_HEAD` meets `theirs`, so a resolution left uncommitted is one side's
// change rather than a conflict against the branch's old fork point (joshuafolkken/kit#5582).
function working_tree_conflicts(
	theirs: string,
	paths: ReadonlyArray<string>,
	cwd: string,
): ReadonlyArray<string> | undefined {
	const fork = git_spawn_sync.read(['merge-base', HEAD, theirs], { cwd })

	if (fork === undefined) return undefined

	const base = changed_paths_sync.through_merge(fork, theirs, { cwd })

	return paths.filter((file_path) => !is_merged(sides_of(file_path, { base, theirs }, cwd), cwd))
}

const git_merge_conflicts = { working_tree_conflicts }

export { git_merge_conflicts }
