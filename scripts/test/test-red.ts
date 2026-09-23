import { existsSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { change_base } from '#scripts/git/change-base'
import { changed_paths } from '#scripts/git/changed-paths'
import { git_location_environment } from '#scripts/git/git-location-environment'
import { git_worktree } from '#scripts/git/git-worktree'
import { execa } from 'execa'
import { test_red_logic, type RedVerdict } from './test-red-logic'

// `josh test:red` — run the added and changed Vitest files against the pre-fix tree and print `red`,
// `green` or `no-test` (joshuafolkken/kit#2448).
//
// **The pre-fix tree is a detached worktree at the merge-base, never the caller's checkout.** The tests
// are copied in from the working tree, so what runs is the new test against the old code, and the
// caller's tree and index are never read back or written. The worktree borrows this checkout's
// `node_modules` through a symlink rather than installing its own: what is being asked about is the
// source the fix changed, and an install would add seconds and a network dependency to every commit.

const ARGV_OFFSET = 2
const TREE_PREFIX = 'josh-test-red-'
const TREE_NAME = 'tree'
const REPORT_NAME = 'report.json'
const NODE_MODULES = 'node_modules'
const VITEST_BIN = path.join(NODE_MODULES, '.bin', 'vitest')
const USAGE =
	'Usage: josh test:red — prints red / green / no-test for the changed tests on the merge-base'

interface RedRun {
	verdict: RedVerdict
	files: ReadonlyArray<string>
}

// The changed Vitest files that still exist — a deleted test has nothing to run.
async function changed_tests(): Promise<Array<string>> {
	const paths = await changed_paths.read_changed_paths(false)

	return test_red_logic.unit_test_files(paths).filter((file) => existsSync(file))
}

async function copy_in(tree: string, files: ReadonlyArray<string>): Promise<void> {
	for (const file of files) {
		const target = path.join(tree, file)

		await mkdir(path.dirname(target), { recursive: true })
		await copyFile(file, target)
	}
}

async function prepare(tree: string, base: string, files: ReadonlyArray<string>): Promise<void> {
	await git_worktree.worktree_add_detached(tree, base)
	await symlink(path.resolve(NODE_MODULES), path.join(tree, NODE_MODULES), 'dir')
	await copy_in(tree, files)
}

function reporter_arguments(report: string): Array<string> {
	return ['--reporter=json', `--outputFile.json=${report}`]
}

async function read_report(report: string): Promise<string> {
	return existsSync(report) ? await readFile(report, 'utf8') : ''
}

// The verdict of one run. `--passWithNoTests` keeps "the filter matched nothing" from reading as a
// failure, and the JSON report — written beside the tree, never into it — says whether anything ran at
// all, so a file the old config excludes is `no-test` rather than a `green` that refuses a correct fix.
// A test that ran and broke, or a file that could not load against the old code, makes it `red`.
async function verdict_in(
	parent: string,
	tree: string,
	files: ReadonlyArray<string>,
): Promise<RedVerdict> {
	const report = path.join(parent, REPORT_NAME)
	const vitest_args = ['run', '--passWithNoTests', ...reporter_arguments(report), ...files]
	const result = await execa(path.join(tree, VITEST_BIN), vitest_args, {
		cwd: tree,
		env: git_location_environment.location_free_environment(),
		extendEnv: true,
		reject: false,
	})
	const ran = test_red_logic.ran_file_count(await read_report(report))

	return test_red_logic.verdict_for(ran, result.exitCode !== 0)
}

// Best effort: a removal that fails leaves a registration `worktree prune` drops once the directory is
// gone, so the cleanup never replaces the verdict with its own error.
async function remove_tree(parent: string, tree: string): Promise<void> {
	try {
		await git_worktree.worktree_remove(tree)
	} catch {
		// The directory is deleted below and the prune drops the stale registration.
	}

	await rm(parent, { force: true, recursive: true })

	try {
		await git_worktree.worktree_prune()
	} catch {
		// A failed prune leaves a stale registration the next prune drops; the verdict stands.
	}
}

async function verdict_on(base: string, files: ReadonlyArray<string>): Promise<RedVerdict> {
	const parent = await mkdtemp(path.join(tmpdir(), TREE_PREFIX))
	const tree = path.join(parent, TREE_NAME)

	try {
		await prepare(tree, base, files)

		return await verdict_in(parent, tree, files)
	} finally {
		await remove_tree(parent, tree)
	}
}

// The verdict over the current checkout. No merge-base (not a repository, no default branch) reads as
// `no-test` — there is no pre-fix tree to run against, and a guard fails open.
async function run(): Promise<RedRun> {
	const base = await change_base.resolved()
	const files = await changed_tests()

	if (base === undefined || files.length === 0) return { verdict: 'no-test', files }

	return { verdict: await verdict_on(base, files), files }
}

async function main(argv: ReadonlyArray<string>): Promise<number> {
	if (argv.length > 0) {
		process.stderr.write(`${USAGE}\n`)

		return argv.includes('--help') ? 0 : 1
	}

	const { verdict, files } = await run()

	process.stdout.write(`${verdict}\n`)
	if (files.length > 0) process.stderr.write(`${files.join('\n')}\n`)

	return 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = await main(process.argv.slice(ARGV_OFFSET))
}

const test_red = { USAGE, run }

export type { RedRun }
export { test_red }
