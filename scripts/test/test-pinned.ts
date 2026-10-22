import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { base_tree, type BaseTree } from '#scripts/git/base-tree'
import { change_base } from '#scripts/git/change-base'
import { changed_paths } from '#scripts/git/changed-paths'
import { git_spawn } from '#scripts/git/git-spawn'
import {
	test_pinned_logic,
	type Hunk,
	type PinnedReport,
	type UnpinnedHunk,
} from './test-pinned-logic'
import { test_red } from './test-red'
import type { RedVerdict } from './test-red-logic'

// `josh test:pinned` (joshuafolkken/kit#4516) — put each changed hunk of a non-test code file back to
// the merge-base's lines, one at a time, run that file's related tests, and list the hunks no test went
// red on: the "reverting it stays green" finding a review used to stop a lane on.
//
// **The reverts happen in a detached worktree at HEAD, never the caller's checkout** (`base-tree.ts`).
// The changed files are copied in from the working tree first, so what is reverted is the change as it
// stands, committed or not, and each hunk's file is restored before the next one runs.

const TREE_PREFIX = 'josh-test-pinned-'
const HEAD = 'HEAD'

// `--diff-filter=M`: an added file's one hunk is the whole file, and reverting it is a missing module
// every importer fails on, which says nothing about the tests. The prefixes are pinned: a user's
// `diff.mnemonicPrefix` writes `+++ w/<file>`, which would read as no hunk at all.
async function read_hunks(base: string, files: ReadonlyArray<string>): Promise<Array<Hunk>> {
	if (files.length === 0) return []
	const diff_args = ['diff', '-U0', '--no-color', '--no-ext-diff', '--diff-filter=M']
	const prefix_args = ['--src-prefix=a/', '--dst-prefix=b/', base, '--']

	return test_pinned_logic.parse_hunks(
		await git_spawn.read([...diff_args, ...prefix_args, ...files]),
	)
}

// The verdict with this one hunk reverted. The file is put back before the next hunk runs, or that
// hunk's tests would also see this revert.
async function verdict_of(tree: BaseTree, hunk: Hunk): Promise<RedVerdict> {
	const target = path.join(tree.tree, hunk.file)
	const content = await readFile(target, 'utf8')

	await writeFile(target, test_pinned_logic.revert(content, hunk))

	try {
		return await test_red.verdict_in(tree, ['related', hunk.file, '--run'])
	} finally {
		await writeFile(target, content)
	}
}

// One hunk at a time: two reverts in flight would share the tree, and each run is already a whole vitest.
// Green and no-test both leave a hunk unpinned: either way nothing went red when it was reverted.
async function unpinned_in(
	tree: BaseTree,
	hunks: ReadonlyArray<Hunk>,
): Promise<Array<UnpinnedHunk>> {
	const unpinned: Array<UnpinnedHunk> = []

	for (const hunk of hunks) {
		// eslint-disable-next-line no-await-in-loop -- the hunks share one tree, so each revert waits for the last restore
		const verdict = await verdict_of(tree, hunk)
		if (verdict !== 'red') unpinned.push({ ...hunk, is_green: verdict === 'green' })
	}

	return unpinned
}

async function unpinned_on(
	paths: ReadonlyArray<string>,
	hunks: ReadonlyArray<Hunk>,
): Promise<Array<UnpinnedHunk>> {
	if (hunks.length === 0) return []

	return await base_tree.with_tree(TREE_PREFIX, HEAD, async (tree) => {
		await base_tree.copy_in(tree.tree, paths)

		return await unpinned_in(tree, hunks)
	})
}

// No merge-base (not a repository, no default branch) checks nothing, as `josh test:red` does.
async function run(max_hunks: number): Promise<PinnedReport> {
	const base = await change_base.resolved()
	const changed = await changed_paths.read_changed_paths(false)
	const paths = changed.filter((file) => existsSync(file))
	const targets = paths.filter((file) => test_pinned_logic.is_target(file))
	const hunks = base === undefined ? [] : await read_hunks(base, targets)
	const { checked, unchecked } = test_pinned_logic.split(hunks, max_hunks)

	return { unpinned: await unpinned_on(paths, checked), unchecked, max_hunks }
}

const test_pinned = { run }

export { test_pinned }
