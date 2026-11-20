import path from 'node:path'
import { gate_labels } from '#scripts/gate/gate-labels'
import type { GateTree } from '#scripts/gate/gate-tree'
import { input_fingerprint } from '#scripts/gate/input-fingerprint'
import { moved_paths, type MovedParts } from '#scripts/gate/moved-paths'
import { since_green } from '#scripts/gate/since-green'
import { import_graph, type ImportGraph } from '#scripts/lint/import-graph'
import { review_stamps } from '#scripts/review/review-stamps'
import { test_declared_logic } from './test-declared-logic'
import { test_pinned_reach } from './test-pinned-reach'
import type { RelatedScope } from './test-related-scope'
import { whole_suite_files } from './whole-suite-files'

interface TestReuse {
	excluded: ReadonlyArray<string>
	reused: number
	missed: number
	reason: string
	elapsed_ms: number
}

// **Each reuse miss keeps its own cause in the ledger** (joshuafolkken/kit#8283): a comparable
// green that cannot be read answers `green-` and the since-green fallback, so `reuse_reason` counts
// which cause to fix instead of one value for all.
const GREEN_MISS = 'green-'
const NO_TREE = 'no-gate-tree'
const SCOPE_MISS = 'scope-'

function digest_of(graph: ImportGraph, file: string): string | undefined {
	const inputs = graph.test_inputs?.(file)

	return inputs === undefined
		? undefined
		: input_fingerprint.of_entries(
				inputs
					.toSorted((left, right) => left.localeCompare(right))
					.map((input) => `${input}:${input_fingerprint.of_file(input)}`),
			)
}

function empty(reason: string): Omit<TestReuse, 'elapsed_ms'> {
	return { excluded: [], reused: 0, missed: 0, reason }
}

function select(
	graph: ImportGraph,
	tests: ReadonlyArray<string>,
	green: Readonly<Record<string, string>>,
): Pick<TestReuse, 'excluded' | 'reused' | 'missed' | 'reason'> {
	const excluded = tests.filter((file) => {
		const digest = digest_of(graph, file)

		return digest !== undefined && green[file] === digest
	})

	return {
		excluded,
		reused: excluded.length,
		missed: tests.length - excluded.length,
		reason: excluded.length > 0 ? 'closed-inputs-unchanged' : 'closed-inputs-changed',
	}
}

async function select_scope(
	root: string,
	scope: RelatedScope,
): Promise<Omit<TestReuse, 'elapsed_ms'>> {
	const recorded = review_stamps.test_related_stamp.read()?.blobs ?? {}
	if (Object.keys(recorded).length === 0) return empty('no-individual-green')
	const graph = await import_graph.create(root)
	if (graph === undefined) return empty('unknown-graph')

	const universe = await test_pinned_reach.code_universe()
	const tests = [...graph.runtime_importers(scope.files, universe)].filter((file) =>
		test_declared_logic.is_test_file(file),
	)
	const green = Object.fromEntries(
		Object.entries(recorded).map(([file, digest]) => [path.join(root, file), digest]),
	)

	return select(graph, tests, green)
}

function moves_whole_suite(moved: ReadonlyArray<string>): boolean {
	return moved.some((file) => whole_suite_files.WHOLE_SUITE_FILES.has(file))
}

// Base unmoved and no whole-suite input changed since the record.
function carries_over(parts: MovedParts | undefined): boolean {
	return parts?.synced.length === 0 && !moves_whole_suite(parts.changed)
}

// A comparable green is compared test by test with or without a main sync since it
// (joshuafolkken/kit#8095): the closed-input digests, not the sync, decide what still holds.
async function compare(
	root: string,
	scope: RelatedScope,
	tree: GateTree,
): Promise<Omit<TestReuse, 'elapsed_ms'>> {
	const verdict = await since_green.read_verdict(
		review_stamps.test_related_stamp,
		gate_labels.UNIT_LABEL,
		undefined,
		tree,
	)
	if ('fallback' in verdict) return empty(`${GREEN_MISS}${verdict.fallback}`)

	if (moves_whole_suite(moved_paths.union_of(verdict.parts))) return empty('whole-suite-input')

	return await select_scope(root, scope)
}

// No gate tree to compare, or a scope that is not `related`, never reaches the green record.
async function attempt(
	root: string,
	scope: RelatedScope,
	tree: GateTree | undefined,
): Promise<Omit<TestReuse, 'elapsed_ms'>> {
	if (tree === undefined) return empty(NO_TREE)
	if (scope.mode !== 'related') return empty(`${SCOPE_MISS}${scope.mode}`)

	return await compare(root, scope, tree)
}

async function blobs(root: string, files: ReadonlyArray<string>): Promise<Record<string, string>> {
	if (files.length === 0) return {}

	try {
		const graph = await import_graph.create(root)
		if (graph === undefined) return {}

		return Object.fromEntries(
			files.flatMap((file) => {
				const absolute = path.resolve(root, file)
				const digest = digest_of(graph, absolute)

				return digest === undefined ? [] : [[path.relative(root, absolute), digest]]
			}),
		)
	} catch {
		return {}
	}
}

// This reads the existing scoped green, never a new cache. A failed run cannot mint that record.
// Exclusions preserve vitest's own reach for unknown tests rather than replacing its graph with ours.
async function read(
	root: string,
	scope: RelatedScope,
	tree: GateTree | undefined,
): Promise<TestReuse> {
	const started = performance.now()

	try {
		const result = await attempt(root, scope, tree)

		return { ...result, elapsed_ms: performance.now() - started }
	} catch {
		return { ...empty('unreadable-inputs'), elapsed_ms: performance.now() - started }
	}
}

// The recorded files whose closed inputs still hash as recorded; a mark that is no digest never matches.
async function unchanged(
	root: string,
	recorded: Readonly<Record<string, string>>,
): Promise<ReadonlyArray<string>> {
	const current = await blobs(root, Object.keys(recorded))

	return Object.keys(recorded).filter((file) => current[file] === recorded[file])
}

// No-op scoped runs preserve evidence only on exactly the same tree, base and check inputs.
async function retained(root: string, tree: GateTree): Promise<ReadonlyArray<string>> {
	const parts = await since_green.read_moved_parts(
		review_stamps.test_related_stamp,
		gate_labels.UNIT_LABEL,
		undefined,
		tree,
	)
	if (parts === undefined || moved_paths.union_of(parts).length > 0) return []

	return await unchanged(root, review_stamps.test_related_stamp.read()?.blobs ?? {})
}

// **A red run's passed files join the next green record** (joshuafolkken/kit#7966): on the red
// record's own base and check inputs, with no whole-suite input moved since, each file whose closed
// inputs still hash as they did when it passed.
async function carried(root: string, tree: GateTree): Promise<ReadonlyArray<string>> {
	const stamp = review_stamps.test_related_red_stamp
	const parts = await since_green.read_moved_parts(stamp, gate_labels.UNIT_LABEL, undefined, tree)
	if (!carries_over(parts)) return []

	return await unchanged(root, stamp.read()?.blobs ?? {})
}

function flags(reuse: TestReuse | undefined): ReadonlyArray<string> {
	if (reuse === undefined || reuse.excluded.length === 0) return []

	return ['--passWithNoTests', ...reuse.excluded.flatMap((file) => ['--exclude', file])]
}

const test_related_reuse = { blobs, carried, flags, read, retained }

export type { TestReuse }
export { test_related_reuse }
