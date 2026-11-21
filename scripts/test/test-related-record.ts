import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { GateTree } from '#scripts/gate/gate-tree'
import { input_fingerprint } from '#scripts/gate/input-fingerprint'
import type { ChangedParts } from '#scripts/git/changed-paths'
import type { TestRelatedRecord } from '#scripts/lane/lane-ledger-schema'
import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'
import { lane_paths } from '#scripts/lane/lane-paths'
import type { ReachedCount } from './test-pinned-reach'
import { test_related_caller } from './test-related-caller'
import { test_related_cap } from './test-related-cap'
import type { TestReuse } from './test-related-reuse'
import { related_scope, type RelatedScope } from './test-related-scope'
import type { SelectMethod } from './test-related-select'
import { test_related_summary } from './test-related-summary'
import { unit_count_file } from './unit-count-file'

// What one `josh test:related` run leaves in the lane ledger (joshuafolkken/kit#4465): how much of its
// input was the change itself, what a main sync brought in and what the test-read map added, the
// scope it settled on, how many test files vitest ran and how long it took — so `josh lane:stats`
// can tell a run widened by its input from one vitest widened by itself.

const COUNT_FILE_NAME = 'count'

// The facts the run knew before vitest started: the scope, and the change it was resolved from.
interface RunInput {
	passed?: ReadonlyArray<string>
	reuse?: TestReuse
	scope: RelatedScope
	root: string
	// Repository-root-relative, as the change was read; `undefined` when it could not be.
	changed: ReadonlyArray<string> | undefined
	// The part of `changed` a main sync brought in, empty outside a since-green reading.
	synced: ReadonlyArray<string>
	// The part of `changed` the change since the test-read map's tree joined to the named or moved
	// files — main merges that landed after the map among them. A file of `branch` in it counts as
	// `changed`; it holds the synced non-code files as well, which the record counts as `synced` alone.
	since_map: ReadonlyArray<string>
	// This branch's own change from its merge base, where it was read.
	branch?: ReadonlyArray<string> | undefined
	// The name the run is recorded under when it is not the scope's own — `touched` for a `--touched` run.
	kind?: string
	// How many test files the cap deferred to CI (`test-related-select.ts`, joshuafolkken/kit#7976);
	// absent where the run kept the whole suite.
	deferred?: number
	// Every changed code file the selection read, each with the test files it reaches (joshuafolkken/kit#7735).
	reach?: ReadonlyArray<ReachedCount> | undefined
	// The branch change by half and base, read beside the run; `undefined` where git could not answer.
	branch_parts?: ChangedParts | undefined
	// How long selecting the tests took — the import graph and the importer index (joshuafolkken/kit#7248).
	select_elapsed_ms?: number
	// How the tests past the changed ones were chosen (`test-related-select.ts`, joshuafolkken/kit#7980).
	select_method?: SelectMethod
	// Whether a bare run read only its last red run's failed files and what moved since
	// (`test-related-red.ts`, joshuafolkken/kit#7786); `undefined` for a `--touched` run.
	red_rerun?: boolean
	// The changed-file map a bare run started on and its base — the reading the green record is written
	// from (`gate-tree.ts`) — for the ledger's tree key; `undefined` where the run read none.
	tree?: GateTree | undefined
}

const STAGE_FIELDS = ['rebuild_ms', 'core_wait_ms', 'vitest_ms'] as const

// How long each stage around the selection took (joshuafolkken/kit#7828) — a stage that did not run
// is absent.
type StageTimes = Partial<Record<(typeof STAGE_FIELDS)[number], number | undefined>>

interface RunResult {
	elapsed_ms: number
	test_files: number | undefined
	stages?: StageTimes
	exit_code?: number
	// The test files a red run failed on, where its log named them all (`test-related-red.ts`).
	failed?: ReadonlyArray<string>
}

function set_count_target(target: string | undefined): void {
	const { COUNT_FILE_ENVIRONMENT } = unit_count_file

	if (target === undefined) Reflect.deleteProperty(process.env, COUNT_FILE_ENVIRONMENT)
	else process.env[COUNT_FILE_ENVIRONMENT] = target
}

// An unwritable temp root leaves the run uncounted rather than failing the tests it would only measure.
function count_directory(): string | undefined {
	try {
		return mkdtempSync(path.join(tmpdir(), 'josh-test-related-'))
	} catch {
		return undefined
	}
}

// Runs `run` with the unit reporter told where to write the run's test-file count, and reads it back.
// A run that started no vitest writes none, which is an absent count rather than zero.
async function with_test_count(
	run: () => Promise<number>,
): Promise<{ exit_code: number; test_files: number | undefined; passed?: ReadonlyArray<string> }> {
	const directory = count_directory()

	if (directory === undefined) return { exit_code: await run(), test_files: undefined }

	const file = path.join(directory, COUNT_FILE_NAME)
	const previous = process.env[unit_count_file.COUNT_FILE_ENVIRONMENT]

	set_count_target(file)

	try {
		const exit_code = await run()

		return {
			exit_code,
			test_files: unit_count_file.read_count(file),
			passed: unit_count_file.read_files(file),
		}
	} finally {
		set_count_target(previous)
		rmSync(directory, { recursive: true, force: true })
	}
}

// The scope's files the record counted in no part — the map's readers.
function readers_of(input: RunInput, counted: ReadonlySet<string>): number {
	if (input.scope.mode !== 'related') return 0

	return input.scope.files.filter((file) => !counted.has(path.relative(input.root, file))).length
}

// The changed files that sent a full-suite run there, repository-root-relative, or none.
function triggers_of(input: RunInput): Partial<TestRelatedRecord> {
	if (input.scope.mode !== 'all' || input.scope.files.length === 0) return {}

	return { trigger_files: input.scope.files.map((file) => path.relative(input.root, file)) }
}

type ChangeParts = Pick<RunInput, 'changed'> & Partial<Pick<RunInput, 'synced' | 'since_map'>>

// **What the run named itself**: the change neither a main sync nor the map's tree joined — the
// selection's input (joshuafolkken/kit#8090), a red run's failed test included.
function named_of(input: ChangeParts): ReadonlyArray<string> {
	const { changed = [], synced = [], since_map = [] } = input
	const joined = new Set([...synced, ...since_map])

	return changed.filter((file) => !joined.has(file))
}

// **The run's own change is the branch's, where it was read** (joshuafolkken/kit#5041): a synced file
// the split cannot vouch for is in `changed` without being this branch's change. Unread, it is what
// the run named itself.
function own_of(input: ChangeParts & Pick<RunInput, 'branch'>): ReadonlyArray<string> {
	const { changed = [], branch } = input
	const named = named_of(input)

	return changed.filter((file) => branch?.includes(file) ?? named.includes(file))
}

// The input split into its counted parts, each file in one. A synced non-code file is in `since_map`
// too (`synced_data` in `test-related.ts`), counted as synced alone.
function parts_of(input: RunInput): Record<'own' | 'synced' | 'since_map', ReadonlyArray<string>> {
	const own = own_of(input)
	const rest = (input.changed ?? []).filter((file) => !own.includes(file))

	return {
		own,
		synced: rest.filter((file) => input.synced.includes(file)),
		since_map: rest.filter(
			(file) => input.since_map.includes(file) && !input.synced.includes(file),
		),
	}
}

function reuse_record(reuse: TestReuse | undefined): Partial<TestRelatedRecord> {
	if (reuse === undefined) return {}

	return {
		reused: reuse.reused,
		reuse_missed: reuse.missed,
		reuse_reason: reuse.reason,
		reuse_elapsed_ms: Math.round(reuse.elapsed_ms),
	}
}

function select_record(select_elapsed_ms: number | undefined): Partial<TestRelatedRecord> {
	return select_elapsed_ms === undefined ? {} : { select_elapsed_ms: Math.round(select_elapsed_ms) }
}

function stage_record(stages: StageTimes = {}): StageTimes {
	const record: StageTimes = {}

	for (const field of STAGE_FIELDS) {
		const ms = stages[field]

		if (ms !== undefined) record[field] = Math.round(ms)
	}

	return record
}

// How many test files the cap deferred to CI, and the hub of the run's own change that put it there
// (joshuafolkken/kit#5699) — the one the run's summary line names (`test_related_cap.hub_of`).
function deferred_record(
	input: Pick<RunInput, 'deferred' | 'reach'>,
	own: ReadonlyArray<string>,
): Pick<TestRelatedRecord, 'deferred' | 'over_cap_hub'> {
	const { deferred, reach = [] } = input
	if (deferred === undefined) return {}
	const hub = test_related_cap.hub_of({ deferred, reach }, own)

	return hub === undefined ? { deferred } : { deferred, over_cap_hub: hub }
}

// The changed file that added the most test files and that number — the run's closing line names it
// (`test-related-summary.ts`) — none written where no reach was read.
function widest_record(
	reach: ReadonlyArray<ReachedCount> | undefined,
): Pick<TestRelatedRecord, 'widest_file' | 'widest_tests'> {
	const widest = test_related_summary.widest_of(reach)

	return widest === undefined ? {} : { widest_file: widest.file, widest_tests: widest.count }
}

// joshuafolkken/kit#6982: a run whose `changed` swelled to ~1,500 left nothing that told an untracked
// flood from a base that fell back to the default branch — nor (joshuafolkken/kit#7066) the branch
// change from named files or moves since the last green.
function branch_parts_record(
	parts: ChangedParts | undefined,
	own: ReadonlyArray<string>,
): Partial<TestRelatedRecord> {
	if (parts === undefined) return {}
	const branch = new Set([...parts.tracked, ...parts.untracked])
	const in_branch = own.filter((file) => branch.has(file)).length

	return {
		branch_tracked: parts.tracked.length,
		branch_untracked: parts.untracked.length,
		branch_base: parts.base,
		changed_in_branch: in_branch,
		changed_off_branch: own.length - in_branch,
	}
}

// One key per changed-file map, so two rows tell whether they ran on the same tree (joshuafolkken/kit#7965).
function tree_record(tree: GateTree | undefined): Pick<TestRelatedRecord, 'tree' | 'base'> {
	if (tree === undefined) return {}
	const key = input_fingerprint.of_entries(
		Object.entries(tree.files).map(([file, digest]) => `${file}\0${digest}`),
	)

	return tree.base === undefined ? { tree: key } : { tree: key, base: tree.base }
}

function outcome_record(result: RunResult): Pick<TestRelatedRecord, 'exit_code' | 'failed'> {
	const { exit_code, failed = [] } = result

	return {
		...(exit_code !== undefined && { exit_code }),
		...(failed.length > 0 && { failed: [...failed] }),
	}
}

function record_of(input: RunInput, result: RunResult): TestRelatedRecord {
	const { own, synced, since_map } = parts_of(input)
	const record = {
		...reuse_record(input.reuse),
		...branch_parts_record(input.branch_parts, own),
		scope: input.kind ?? related_scope.scope_kind(input.scope),
		changed: own.length,
		synced: synced.length,
		since_map: since_map.length,
		readers: readers_of(input, new Set([...own, ...synced, ...since_map])),
		...triggers_of(input),
		...deferred_record(input, own),
		...widest_record(input.reach),
		...select_record(input.select_elapsed_ms),
		...(input.select_method !== undefined && { select_method: input.select_method }),
		...(input.red_rerun !== undefined && { red_rerun: input.red_rerun }),
		...stage_record(result.stages),
		...tree_record(input.tree),
		...outcome_record(result),
		caller: test_related_caller.read(),
		elapsed_ms: Math.round(result.elapsed_ms),
	}

	return result.test_files === undefined ? record : { ...record, test_files: result.test_files }
}

// Best-effort, as every ledger write is. `issue` is the lane it ran in, which `josh lane:breakdown`
// reads its rows by (joshuafolkken/kit#5532).
async function record_run(input: RunInput, result: RunResult, ledger?: string): Promise<void> {
	const issue = lane_paths.issue_here()

	await lane_ledger_write.record_test_related({ ...record_of(input, result), issue }, ledger)
}

const test_related_record = { named_of, own_of, record_of, record_run, with_test_count }

export type { RunInput, RunResult, StageTimes }
export { test_related_record }
