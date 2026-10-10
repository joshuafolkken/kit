import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { base_tree, type BaseTree } from '#scripts/git/base-tree'
import { change_base } from '#scripts/git/change-base'
import { changed_paths } from '#scripts/git/changed-paths'
import { git_location_environment } from '#scripts/git/git-location-environment'
import { execa } from 'execa'
import { test_red_logic, type RedVerdict } from './test-red-logic'

// `josh test:red` — run the added and changed Vitest files against the pre-fix tree and print `red`,
// `green`, `no-test` or `test-only`.
//
// **The pre-fix tree is a detached worktree at the merge-base, never the caller's checkout**
// (`base-tree.ts`). The tests are copied in from the working tree, so what runs is the new test
// against the old code.

const ARGV_OFFSET = 2
const TREE_PREFIX = 'josh-test-red-'
const REPORT_NAME = 'report.json'
const VITEST_BIN = path.join(base_tree.NODE_MODULES, '.bin', 'vitest')
const USAGE =
	'Usage: josh test:red — prints red / green / no-test / test-only for the changed tests on the merge-base'

interface RedRun {
	verdict: RedVerdict
	files: ReadonlyArray<string>
}

// The changed Vitest files that still exist — a deleted test has nothing to run.
function changed_tests(paths: ReadonlyArray<string>): Array<string> {
	return test_red_logic.unit_test_files(paths).filter((file) => existsSync(file))
}

async function copy_one(tree: string, file: string): Promise<void> {
	const target = path.join(tree, file)

	await mkdir(path.dirname(target), { recursive: true })
	await copyFile(file, target)
}

// Each file has its own target, and a recursive `mkdir` tolerates a sibling creating the same parent.
async function copy_in(tree: string, files: ReadonlyArray<string>): Promise<void> {
	await Promise.all(
		files.map(async (file) => {
			await copy_one(tree, file)
		}),
	)
}

function reporter_arguments(report: string): Array<string> {
	// The plain `--outputFile`, not `--outputFile.json`: a config that sets `test.outputFile` as a string
	// wins over the keyed form, which would send the report into the tree and read every run `no-test`.
	return ['--reporter=json', `--outputFile=${report}`]
}

async function read_report(report: string): Promise<string> {
	return existsSync(report) ? await readFile(report, 'utf8') : ''
}

// The verdict of one run. `--passWithNoTests` keeps "the filter matched nothing" from reading as a
// failure, and the JSON report — written beside the tree, never into it — says whether anything ran at
// all, so a file the old config excludes is `no-test` rather than a `green` that refuses a correct fix.
// A test that ran and broke, or a file that could not load against the old code, makes it `red`.
async function verdict_in(
	{ parent, tree }: BaseTree,
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

async function verdict_on(base: string, files: ReadonlyArray<string>): Promise<RedVerdict> {
	return await base_tree.with_tree(TREE_PREFIX, base, async (pre_fix) => {
		await copy_in(pre_fix.tree, files)

		return await verdict_in(pre_fix, files)
	})
}

// The verdict over the current checkout. No merge-base (not a repository, no default branch) reads as
// `no-test` — there is no pre-fix tree to run against, and a guard fails open. A change whose every path
// is a test file is `test-only` without a run: the merge-base runs the same code as HEAD.
async function run(): Promise<RedRun> {
	const base = await change_base.resolved()
	const paths = await changed_paths.read_changed_paths(false)
	const files = changed_tests(paths)

	if (base === undefined || files.length === 0) return { verdict: 'no-test', files }
	if (test_red_logic.is_test_only(paths)) return { verdict: 'test-only', files }

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

const test_red = { run }

export type { RedRun }
export { test_red }
