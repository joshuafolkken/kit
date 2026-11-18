import type { GateTree } from '#scripts/gate/gate-tree'
import { scoped_green } from '#scripts/gate/scoped-green'
import { changed_file_scope } from '#scripts/git/changed-file-scope'
import { launch_timing } from '#scripts/lane/launch-timing'
import { review_stamps } from '#scripts/review/review-stamps'
import { related_heavy_tests } from './related-heavy-tests'
import { test_no_base } from './test-no-base'
import { test_related_claim } from './test-related-claim'
import {
	test_related_record,
	type RunInput,
	type RunResult,
	type StageTimes,
} from './test-related-record'
import { test_related_red, type RelatedInput } from './test-related-red'
import { test_related_reuse } from './test-related-reuse'
import { related_scope, type RelatedScope } from './test-related-scope'
import { test_related_summary } from './test-related-summary'
import { test_unit_guard } from './test-unit-guard'

function conclusive_tree(before: GateTree | undefined): GateTree | undefined {
	if (before === undefined) return undefined

	return test_unit_guard.is_running(process.cwd()) ? before : undefined
}

// Times the claim's wait and vitest from start to end into `stages` (joshuafolkken/kit#7828).
async function timed_vitest(
	args: ReadonlyArray<string>,
	description: string,
	stages: StageTimes,
	wait_ms: number | undefined,
): Promise<number> {
	const started = performance.now()

	if (wait_ms !== undefined) stages.core_wait_ms = wait_ms

	try {
		return await test_unit_guard.run_guarded_vitest(
			process.cwd(),
			args,
			related_scope.COMMAND_NAME,
			description,
		)
	} finally {
		stages.vitest_ms = performance.now() - started
	}
}

async function run_vitest(
	scope: RelatedScope,
	args: ReadonlyArray<string>,
	description: string,
	stages: StageTimes,
): Promise<number> {
	return await test_related_claim.with_unit_claim(
		scope.mode === 'related' ? scope.files : undefined,
		async (wait_ms) => await timed_vitest(args, description, stages, wait_ms),
	)
}

async function run_scope(
	{ scope, root, reuse }: RunInput,
	command_arguments: ReadonlyArray<string>,
	stages: StageTimes,
): Promise<number> {
	const description = related_scope.describe_scope(scope, root)

	if (scope.mode === 'none') {
		process.stdout.write(`${description}\n`)

		return 0
	}

	const vitest_arguments = related_scope.vitest_arguments(scope, [
		...changed_file_scope.flags_of(command_arguments),
		...related_heavy_tests.exclude_flags(scope, root),
		...test_related_reuse.flags(reuse),
	])

	return await run_vitest(scope, vitest_arguments, description, stages)
}

// How the run ended, for its ledger row: a red one with the test files its log named (joshuafolkken/kit#7965).
function outcome_of(
	scope: RelatedScope,
	exit_code: number,
	started_ms: number,
): Pick<RunResult, 'exit_code' | 'failed'> {
	if (exit_code === 0) return { exit_code }

	return { exit_code, failed: test_related_red.failed_of(scope, started_ms) }
}

async function run_and_record(
	input: RunInput,
	command_arguments: ReadonlyArray<string>,
): Promise<number> {
	const started_ms = Date.now()
	const started = performance.now()
	const stages: StageTimes = { rebuild_ms: launch_timing.rebuild_ms() }
	const { exit_code, test_files, passed } = await test_related_record.with_test_count(
		async () => await run_scope(input, command_arguments, stages),
	)

	input.passed = passed ?? []
	process.stdout.write(
		`${test_related_summary.summary_line(input.scope, test_files, input.reach)}\n`,
	)

	await test_related_record.record_run(input, {
		elapsed_ms: performance.now() - started,
		test_files,
		stages,
		...outcome_of(input.scope, exit_code, started_ms),
	})

	return exit_code
}

async function with_no_base_pass(
	input: RelatedInput,
	command_arguments: ReadonlyArray<string>,
	exit_code: number,
): Promise<number> {
	if (exit_code !== 0) return exit_code

	const flags = changed_file_scope.flags_of(command_arguments)

	return await test_no_base.run_if_touched(input.root, test_related_red.no_base_files(input), flags)
}

function proven_files(input: RunInput): ReadonlyArray<string> {
	return [...(input.passed ?? []), ...(input.reuse?.excluded ?? [])]
}

async function record_green(
	input: RunInput,
	tree: GateTree | undefined,
	exit_code: number,
): Promise<void> {
	if (exit_code !== 0 || tree === undefined) {
		await scoped_green.record_if_green(review_stamps.test_related_stamp, {
			before: tree,
			exit_code,
		})

		return
	}

	const files = [...proven_files(input), ...(await test_related_reuse.retained(input.root, tree))]
	const blobs = await test_related_reuse.blobs(input.root, files)

	await scoped_green.record_if_green(review_stamps.test_related_stamp, {
		before: tree,
		exit_code,
		...(Object.keys(blobs).length > 0 && { blobs }),
	})
}

async function run_and_vouch(
	input: RelatedInput,
	command_arguments: ReadonlyArray<string>,
	before: GateTree | undefined,
): Promise<number> {
	const started_ms = Date.now()
	const first_exit = await run_and_record(input, command_arguments)
	const exit_code = await with_no_base_pass(input, command_arguments, first_exit)
	const tree = conclusive_tree(before)

	await record_green(input, tree, exit_code)

	await test_related_red.record_red({
		before: tree,
		scope: input.scope,
		first_exit,
		started_ms,
		owed: test_related_red.no_base_files(input),
	})

	return exit_code
}

const test_related_run = { run_and_record, run_and_vouch }

export { test_related_run }
