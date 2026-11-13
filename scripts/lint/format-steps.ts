import { direct_launch } from '#scripts/build/local-bin'
import { project_checks } from '#scripts/gate/project-checks'
import type { ChangedFileScope } from '#scripts/git/changed-file-scope'
import { execa } from 'execa'
import { eslint_cache_dependencies } from './eslint-cache-dependencies'
import { eslint_heap } from './eslint-heap'
import { lint_related_scope } from './lint-related-scope'
import { lint_shard } from './lint-shard'

interface FormatStep {
	check: string
	args: ReadonlyArray<string>
}

// Every formatter finishes before the next starts, even when it reports unfixed problems.
async function in_order<T, R>(
	steps: ReadonlyArray<T>,
	execute: (step: T) => Promise<R>,
): Promise<Array<R>> {
	const results: Array<R> = []

	for (const step of steps) {
		// eslint-disable-next-line no-await-in-loop -- formatters rewrite the same files in order
		results.push(await execute(step))
	}

	return results
}

async function run_step(step: FormatStep, directory: string): Promise<number> {
	const environment =
		step.check === 'eslint' ? { env: eslint_heap.environment(), extendEnv: false } : {}
	const launch = direct_launch(directory, step.args)
	const result = await execa(launch.file, [...launch.args], {
		cwd: directory,
		stdio: 'inherit',
		reject: false,
		...environment,
	})

	return result.exitCode ?? 1
}

async function run_unless_skipped(step: FormatStep, directory: string): Promise<number> {
	const reason =
		step.check === 'eslint'
			? project_checks.eslint_skip_reason(directory)
			: project_checks.prettier_skip_reason(directory)
	if (reason === undefined) return await run_step(step, directory)
	console.info(project_checks.skip_notice(step.check, reason))

	return 0
}

async function run(
	steps: ReadonlyArray<FormatStep>,
	cache_file: string,
	directory: string,
): Promise<number> {
	const results = await in_order(steps, async (step) => {
		if (step.check !== 'eslint') return await run_unless_skipped(step, directory)

		return await eslint_cache_dependencies.guard(
			cache_file,
			async () => await run_unless_skipped(step, directory),
			directory,
		)
	})

	return results.find((code) => code !== 0) ?? 0
}

// The resolved lint scope is authoritative; never replace a file list with the whole tree.
async function run_scoped(scope: ChangedFileScope, directory: string): Promise<number> {
	const files = scope.mode === 'all' ? [lint_shard.WHOLE_TREE] : scope.files
	const eslint = [...lint_related_scope.eslint_arguments(files), '--fix']
	const prettier = lint_related_scope.prettier_arguments(files, undefined, directory)
	const steps: Array<FormatStep> = [{ check: 'eslint', args: eslint }]

	// Basic read-only lint expands a non-Web list; scoped writers must omit that fallback.
	if (scope.mode === 'all' || !prettier.includes(project_checks.WEB_FILES)) {
		steps.push({
			check: 'prettier',
			args: prettier.map((argument) => (argument === '--check' ? '--write' : argument)),
		})
	}

	return await run(steps, lint_related_scope.RELATED_CACHES.eslint_file, directory)
}

const format_steps = { in_order, run, run_scoped }

export { format_steps }
