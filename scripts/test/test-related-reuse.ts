import path from 'node:path'
import { gate_labels } from '#scripts/gate/gate-labels'
import type { GateTree } from '#scripts/gate/gate-tree'
import { input_fingerprint } from '#scripts/gate/input-fingerprint'
import { moved_paths, type MovedParts } from '#scripts/gate/moved-paths'
import { since_green } from '#scripts/gate/since-green'
import type { FileMapStampAccess } from '#scripts/josh/file-map-stamp'
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
// Every run compares, scoped or after a red (joshuafolkken/kit#8288), so only a missing tree misses here.
const GREEN_MISS = 'green-'
const SCOPE_MISS = 'scope-'
const NO_TREE = 'no-gate-tree'
const FAILED_LAST_RUN = 'failed-last-run'
const NO_INDIVIDUAL = 'no-individual-green'

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
	recorded: Readonly<Record<string, string>>,
): Promise<Omit<TestReuse, 'elapsed_ms'>> {
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

function individual(stamp: FileMapStampAccess): Readonly<Record<string, string>> | string {
	const recorded = stamp.read()?.blobs ?? {}

	return Object.keys(recorded).length > 0 ? recorded : NO_INDIVIDUAL
}

// A comparable green is compared test by test with or without a main sync since it
// (joshuafolkken/kit#8095): the closed-input digests, not the sync, decide what still holds.
// A string is the reason the full-reach green offers no digest.
async function full_green(tree: GateTree): Promise<Readonly<Record<string, string>> | string> {
	const stamp = review_stamps.test_related_stamp
	const verdict = await since_green.read_verdict(stamp, gate_labels.UNIT_LABEL, { tree })
	if ('fallback' in verdict) return `${GREEN_MISS}${verdict.fallback}`
	if (moves_whole_suite(moved_paths.union_of(verdict.parts))) return 'whole-suite-input'

	return individual(stamp)
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

// The recorded files whose closed inputs still hash as recorded; a mark that is no digest never matches.
async function unchanged(
	root: string,
	recorded: Readonly<Record<string, string>>,
): Promise<ReadonlyArray<string>> {
	const current = await blobs(root, Object.keys(recorded))

	return Object.keys(recorded).filter((file) => current[file] === recorded[file])
}

// On the record's own base and check inputs, with no whole-suite input moved since, each recorded
// file whose closed inputs still hash as they did when it passed.
async function still_passing(
	root: string,
	tree: GateTree,
	stamp: FileMapStampAccess,
): Promise<ReadonlyArray<string>> {
	const parts = await since_green.read_moved_parts(stamp, gate_labels.UNIT_LABEL, { tree })
	if (!carries_over(parts)) return []

	return await unchanged(root, stamp.read()?.blobs ?? {})
}

// **A touched green's still-passing files** (joshuafolkken/kit#9163): the hand run's tests, proven on
// the inputs they hash to now, which the full-reach run need not run again.
async function touched(root: string, tree: GateTree): Promise<ReadonlyArray<string>> {
	return await still_passing(root, tree, review_stamps.test_related_touched_stamp)
}

async function touched_green(root: string, tree: GateTree): Promise<Record<string, string>> {
	const recorded = review_stamps.test_related_touched_stamp.read()?.blobs ?? {}
	const files = await touched(root, tree)

	return Object.fromEntries(files.map((file) => [file, recorded[file] ?? '']))
}

// The full-reach green's digests joined by the touched green's: a test is reused when either
// recorded it on the closed inputs it hashes to now.
async function compare(
	root: string,
	scope: RelatedScope,
	tree: GateTree,
): Promise<Omit<TestReuse, 'elapsed_ms'>> {
	const full = await full_green(tree)
	const recorded = { ...(typeof full !== 'string' && full), ...(await touched_green(root, tree)) }
	if (Object.keys(recorded).length > 0) return await select_scope(root, scope, recorded)

	return empty(typeof full === 'string' ? full : NO_INDIVIDUAL)
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

// **A green keeps the last green's still-passing files** (joshuafolkken/kit#8289): a green that
// proves no test of its own after a branch edit (scope `none`) would otherwise record no digest.
async function retained(root: string, tree: GateTree): Promise<ReadonlyArray<string>> {
	return await still_passing(root, tree, review_stamps.test_related_stamp)
}

// **A red run's passed files join the next green record** (joshuafolkken/kit#7966).
async function carried(root: string, tree: GateTree): Promise<ReadonlyArray<string>> {
	return await still_passing(root, tree, review_stamps.test_related_red_stamp)
}

function flags(reuse: TestReuse | undefined): ReadonlyArray<string> {
	if (reuse === undefined || reuse.excluded.length === 0) return []

	return ['--passWithNoTests', ...reuse.excluded.flatMap((file) => ['--exclude', file])]
}

// **A file the last run failed on runs again whatever its digest** (joshuafolkken/kit#8288): its
// closed inputs may match the older green, yet that green no longer vouches for it.
function keeping(root: string, reuse: TestReuse, failed: ReadonlyArray<string>): TestReuse {
	const kept = new Set(failed.map((file) => path.resolve(root, file)))
	const excluded = reuse.excluded.filter((file) => !kept.has(file))
	if (excluded.length === reuse.excluded.length) return reuse

	return {
		...reuse,
		excluded,
		reused: excluded.length,
		missed: reuse.missed + reuse.excluded.length - excluded.length,
		reason: excluded.length > 0 ? reuse.reason : FAILED_LAST_RUN,
	}
}

const test_related_reuse = { blobs, carried, flags, keeping, read, retained, touched }

export type { TestReuse }
export { test_related_reuse }
