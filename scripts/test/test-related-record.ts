import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { TestRelatedRecord } from '#scripts/lane/lane-ledger-schema'
import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'
import { related_scope, type RelatedScope } from './test-related-scope'
import { unit_count_file } from './unit-count-file'

// What one `josh test:related` run leaves in the lane ledger (joshuafolkken/kit#4465): how much of its
// input was the change itself, what a main sync brought in and what the test-read map added, the
// scope it settled on, how many test files vitest ran and how long it took — so `josh lane:stats`
// can tell a run widened by its input from one vitest widened by itself.

const COUNT_FILE_NAME = 'count'

// The facts the run knew before vitest started: the scope, and the change it was resolved from.
interface RunInput {
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
}

interface RunResult {
	elapsed_ms: number
	test_files: number | undefined
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
): Promise<{ exit_code: number; test_files: number | undefined }> {
	const directory = count_directory()

	if (directory === undefined) return { exit_code: await run(), test_files: undefined }

	const file = path.join(directory, COUNT_FILE_NAME)
	const previous = process.env[unit_count_file.COUNT_FILE_ENVIRONMENT]

	set_count_target(file)

	try {
		return { exit_code: await run(), test_files: unit_count_file.read_count(file) }
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

// **The run's own change is the branch's, where it was read** (joshuafolkken/kit#5041): a synced file
// the split cannot vouch for is in `changed` without being this branch's change. Unread, it is what
// neither a main sync nor the map's tree joined.
function own_of(input: RunInput): ReadonlyArray<string> {
	const { changed = [], branch } = input
	const joined = new Set([...input.synced, ...input.since_map])

	return changed.filter((file) => branch?.includes(file) ?? !joined.has(file))
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

function record_of(input: RunInput, result: RunResult): TestRelatedRecord {
	const { own, synced, since_map } = parts_of(input)
	const record = {
		scope: related_scope.scope_kind(input.scope),
		changed: own.length,
		synced: synced.length,
		since_map: since_map.length,
		readers: readers_of(input, new Set([...own, ...synced, ...since_map])),
		...triggers_of(input),
		elapsed_ms: Math.round(result.elapsed_ms),
	}

	return result.test_files === undefined ? record : { ...record, test_files: result.test_files }
}

// Best-effort, as every ledger write is.
async function record_run(input: RunInput, result: RunResult, ledger?: string): Promise<void> {
	await lane_ledger_write.record_test_related(record_of(input, result), ledger)
}

const test_related_record = { record_of, record_run, with_test_count }

export type { RunInput, RunResult }
export { test_related_record }
