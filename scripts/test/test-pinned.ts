import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { base_tree, type BaseTree } from '#scripts/git/base-tree'
import { change_base } from '#scripts/git/change-base'
import { changed_paths } from '#scripts/git/changed-paths'
import { git_spawn } from '#scripts/git/git-spawn'
import { review_code_tree } from '#scripts/review/review-code-tree'
import { test_pinned_emit } from './test-pinned-emit'
import { test_pinned_functions } from './test-pinned-functions'
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

interface StubRead {
	hunks: ReadonlyArray<Hunk>
	unparsed: ReadonlyArray<string>
}

const NO_REPORT = { unpinned: [], unchecked: [], unparsed: [] } as const

// `--diff-filter=M`: an added file's one hunk is the whole file, and reverting it is a missing module
// every importer fails on, which says nothing about the tests — its functions are probed instead
// (`stub_hunks_of`). The prefixes are pinned: a user's `diff.mnemonicPrefix` writes `+++ w/<file>`,
// which would read as no hunk at all.
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

// A target the base's tree does not hold is added — committed on the branch or still untracked.
async function added_scripts(base: string, targets: ReadonlyArray<string>): Promise<Array<string>> {
	const held = new Set(await changed_paths.read_held_at(base, targets))

	return targets.filter((file) => !held.has(file) && test_pinned_functions.is_script(file))
}

// Without `typescript` (an optional peer in a consumer) no function can be read, so every added file
// is reported unchecked rather than passed as pinned.
async function stub_hunks_of(added: ReadonlyArray<string>): Promise<StubRead> {
	const api = review_code_tree.load_typescript(process.cwd())
	if (api === undefined) return { hunks: [], unparsed: added }
	const contents = await Promise.all(added.map(async (file) => await readFile(file, 'utf8')))
	const hunks = added.flatMap((file, index) =>
		test_pinned_functions.stub_hunks(api, file, contents[index] ?? ''),
	)

	return { hunks, unparsed: [] }
}

// A changed hunk whose revert emits the same JavaScript is dropped before the cap (`test-pinned-emit.ts`);
// without `typescript` every hunk is kept, so the run checks more rather than less.
async function runtime_hunks(hunks: ReadonlyArray<Hunk>): Promise<Array<Hunk>> {
	const api = review_code_tree.load_typescript(process.cwd())
	if (api === undefined) return [...hunks]
	const contents = await Promise.all(hunks.map(async (hunk) => await readFile(hunk.file, 'utf8')))

	return hunks.filter((hunk, index) =>
		test_pinned_emit.changes_runtime(api, contents[index] ?? '', hunk),
	)
}

async function read_probes(base: string, targets: ReadonlyArray<string>): Promise<StubRead> {
	const stubs = await stub_hunks_of(await added_scripts(base, targets))
	const changed = await runtime_hunks(await read_hunks(base, targets))

	return { hunks: [...changed, ...stubs.hunks], unparsed: stubs.unparsed }
}

// The work tree's files that differ from `commit`, deleted ones dropped. Read since `HEAD` they are
// what the worktree at `HEAD` needs copied in to hold the work tree — a conflicted merge's incoming
// files included; read since the change base they are this branch's own change.
async function existing_since(commit: string): Promise<Array<string>> {
	const changed = await changed_paths.read_changed_since(commit)

	return changed.filter((file) => existsSync(file))
}

async function report_on(
	base: string,
	max_hunks: number,
	has_runner: boolean,
): Promise<PinnedReport> {
	const paths = await existing_since(HEAD)
	const changed = await existing_since(base)
	const targets = changed.filter((file) => test_pinned_logic.is_target(file))
	const probes = await read_probes(base, targets)
	const cap = has_runner ? max_hunks : 0
	const { checked, unchecked } = test_pinned_logic.split(probes.hunks, cap)
	const unpinned = await unpinned_on(paths, checked)

	return { unpinned, unchecked, unparsed: probes.unparsed, max_hunks, has_runner }
}

// No merge-base (not a repository, no default branch) checks nothing, as `josh test:red` does. The cap
// is shared: changed hunks first, then the added files' functions. Without Vitest (a consumer that has
// none) no probe runs, so every one is unchecked rather than unpinned.
async function run(max_hunks: number): Promise<PinnedReport> {
	const base = await change_base.resolved_through_merge()
	const has_runner = test_red.has_runner()
	if (base === undefined) return { ...NO_REPORT, max_hunks, has_runner }

	return await report_on(base, max_hunks, has_runner)
}

const test_pinned = { run }

export { test_pinned }
