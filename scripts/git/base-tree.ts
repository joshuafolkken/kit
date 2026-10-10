import { mkdtemp, rm, symlink } from 'node:fs/promises'
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

async function with_tree<T>(
	prefix: string,
	commit: string,
	use: (base_tree: BaseTree) => Promise<T>,
): Promise<T> {
	const parent = await mkdtemp(path.join(tmpdir(), prefix))
	const base_tree = { parent, tree: path.join(parent, TREE_NAME) }

	try {
		await prepare(base_tree.tree, commit)

		return await use(base_tree)
	} finally {
		await remove(base_tree)
	}
}

const base_tree = { NODE_MODULES, with_tree }

export type { BaseTree }
export { base_tree }
