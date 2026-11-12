import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { input_fingerprint } from '#scripts/gate/input-fingerprint'
import { base_tree } from '#scripts/git/base-tree'
import { changed_paths } from '#scripts/git/changed-paths'
import { git_spawn_sync, type GitSyncOptions } from '#scripts/git/git-spawn-sync'

const PREFIX = 'josh-pinned-snapshot-'
const CACHE_NAME = 'josh-test-pinned-verdicts.json'
const IDENTITY = ['-c', 'user.name=Snapshot', '-c', 'user.email=snapshot@localhost']

interface Snapshot {
	head: string
	tree: string
	tree_hash: string
	cache_file: string
}

function read(args: ReadonlyArray<string>, options: GitSyncOptions): string {
	const result = git_spawn_sync.run(args, options)
	if (result.exit_code !== 0) throw new Error(`Snapshot git failed: ${result.stderr}`)

	return result.stdout.trimEnd()
}

function identity(root: string, head: string, index: string): string {
	const tracked = read(['diff', '--name-only', '-z', head, '--'], { cwd: root })
	const untracked = read(['ls-files', '--others', '--exclude-standard', '-z'], { cwd: root })
	const paths = `${tracked}\0${untracked}`.split('\0').filter((file) => file !== '')
	const contents = input_fingerprint.of_files(root, paths)

	return input_fingerprint.of_entries([head, index, JSON.stringify(contents)])
}

function current_hash(root: string): string | undefined {
	try {
		return identity(
			root,
			read(['rev-parse', 'HEAD'], { cwd: root }),
			read(['ls-files', '--stage', '-z'], { cwd: root }),
		)
	} catch {
		return undefined
	}
}

async function in_tree<T>(tree: string, action: () => Promise<T>): Promise<T> {
	const original = process.cwd()

	process.chdir(tree)

	try {
		return await action()
	} finally {
		process.chdir(original)
	}
}

async function copy_changes(tree: string, head: string): Promise<void> {
	const paths = await changed_paths.read_changed_since(head)
	const present = paths.filter((file) => existsSync(file))
	const deleted = paths.filter((file) => !existsSync(file))

	await base_tree.copy_in(tree, present)
	await Promise.all(
		deleted.map(async (file) => {
			await rm(path.join(tree, file), { force: true })
		}),
	)
	if (present.length > 0) read(['add', '--force', '--', ...present], { cwd: tree })
}

// Only the disposable worktree's index and HEAD are written. Its commit freezes every probe copy;
// the original index (including partial staging or conflicts) contributes only to the identity.
function seal(root: string, head: string, index: string, cache_file: string): Snapshot {
	const tree_hash = identity(root, head, index)

	read(['add', '--all'], { cwd: root })
	const tree = read(['write-tree'], { cwd: root })
	const commit = read([...IDENTITY, 'commit-tree', tree, '-p', head, '-m', 'Pinned snapshot'], {
		cwd: root,
	})

	read(['update-ref', 'HEAD', commit], { cwd: root })

	return { head, tree, tree_hash, cache_file }
}

async function with_snapshot<T>(action: (snapshot: Snapshot) => Promise<T>): Promise<T> {
	const root = process.cwd()
	const head = read(['rev-parse', 'HEAD'], { cwd: root })
	const index = read(['ls-files', '--stage', '-z'], { cwd: root })
	const cache_file = path.resolve(
		root,
		read(['rev-parse', '--git-path', CACHE_NAME], { cwd: root }),
	)

	return await base_tree.with_tree(PREFIX, head, async (tree) => {
		await copy_changes(tree.tree, head)
		const snapshot = seal(tree.tree, head, index, cache_file)

		return await in_tree(tree.tree, async () => await action(snapshot))
	})
}

const test_pinned_snapshot = { current_hash, with_snapshot }

export type { Snapshot }
export { test_pinned_snapshot }
