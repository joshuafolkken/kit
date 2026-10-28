import { rmSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { git_worktree } from './git-worktree'

// A throwaway tree at one commit, for a command that has to run something on a tree other than the
// caller's — `josh test:red` runs the new tests on the merge-base, `josh metrics` measures it.
//
// **It is a detached worktree, never the caller's checkout**: the caller's tree and index are neither
// read back nor written. The worktree borrows this checkout's `node_modules` through a symlink rather
// than installing its own: what is asked about is the source at that commit, and an install would add
// seconds and a network dependency to every run.

const TREE_NAME = 'tree'
const NODE_MODULES = 'node_modules'
const TERMINATE_SIGNAL = 'SIGTERM'
// 128 + SIGTERM's 15: the code the process would have exited with had no listener caught the signal.
const TERMINATED_EXIT_CODE = 143

// The temp directories of the trees this process holds now.
const live_parents = new Set<string>()

interface BaseTree {
	// The temp directory holding the tree — a file written here sits beside the tree, never in it.
	parent: string
	tree: string
}

async function prepare(tree: string, commit: string): Promise<void> {
	await git_worktree.worktree_add_detached(tree, commit)
	await symlink(path.resolve(NODE_MODULES), path.join(tree, NODE_MODULES), 'dir')
}

// Best effort: a removal that fails leaves a registration `worktree prune` drops once the directory is
// gone, so the cleanup never replaces the caller's answer with its own error.
async function remove(base_tree: BaseTree): Promise<void> {
	try {
		await git_worktree.worktree_remove(base_tree.tree)
	} catch {
		// The directory is deleted below and the prune drops the stale registration.
	}

	await rm(base_tree.parent, { force: true, recursive: true })

	try {
		await git_worktree.worktree_prune()
	} catch {
		// A failed prune leaves a stale registration the next prune drops; the answer stands.
	}
}

// **A terminated run removes its trees before it exits** (joshuafolkken/kit#4794): `josh run:review
// --join` stops a `test:pinned` that fell behind, and a `finally` never runs past a signal, so each
// tree would stay in the temp directory and in `git worktree list`. The removal is synchronous because
// the process exits right after it; the next `with_tree`'s prune drops the registrations.
function remove_live_trees(): void {
	for (const parent of live_parents) rmSync(parent, { force: true, recursive: true })

	process.exit(TERMINATED_EXIT_CODE)
}

function track(parent: string): void {
	if (live_parents.size === 0) process.on(TERMINATE_SIGNAL, remove_live_trees)
	live_parents.add(parent)
}

function untrack(parent: string): void {
	live_parents.delete(parent)
	if (live_parents.size === 0) process.off(TERMINATE_SIGNAL, remove_live_trees)
}

async function with_tree<T>(
	prefix: string,
	commit: string,
	use: (base_tree: BaseTree) => Promise<T>,
): Promise<T> {
	const parent = await mkdtemp(path.join(tmpdir(), prefix))
	const base_tree = { parent, tree: path.join(parent, TREE_NAME) }

	track(parent)

	try {
		await prepare(base_tree.tree, commit)

		return await use(base_tree)
	} finally {
		await remove(base_tree)
		untrack(parent)
	}
}

async function copy_one(tree: string, file: string): Promise<void> {
	const target = path.join(tree, file)

	await mkdir(path.dirname(target), { recursive: true })
	await copyFile(file, target)
}

// The caller's working-tree files into the tree at the same relative paths. Each file has its own
// target, and a recursive `mkdir` tolerates a sibling creating the same parent.
async function copy_in(tree: string, files: ReadonlyArray<string>): Promise<void> {
	await Promise.all(
		files.map(async (file) => {
			await copy_one(tree, file)
		}),
	)
}

const base_tree = { NODE_MODULES, copy_in, with_tree }

export type { BaseTree }
export { base_tree }
