import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { gate_labels } from '#scripts/gate/gate-labels'
import type { MovedParts } from '#scripts/gate/moved-paths'
import { since_green } from '#scripts/gate/since-green'
import { import_graph, type ImportGraph } from '#scripts/lint/import-graph'
import { review_stamps } from '#scripts/review/review-stamps'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { test_pinned_reach } from './test-pinned-reach'
import { test_related_reuse } from './test-related-reuse'

const make_directory = temporary_directory('suite')
const ROOT = make_directory('josh-test-reuse-')
const SOURCE = path.join(ROOT, 'source.ts')
const CHANGED_NAME = 'changed.test.ts'
const UNCHANGED_NAME = 'unchanged.test.ts'
const CHANGED = path.join(ROOT, CHANGED_NAME)
const UNCHANGED = path.join(ROOT, UNCHANGED_NAME)
const UNKNOWN = path.join(ROOT, 'unknown.test.ts')
const TESTS = [CHANGED, UNCHANGED, UNKNOWN]
const VITEST_CONFIG = 'vitest.config.ts'
const TREE = { files: Object.fromEntries([['source.ts', 'digest']]), base: 'base' }
const SCOPE = { mode: 'related' as const, files: [SOURCE], reason: 'fixture' }
const GRAPH: ImportGraph = {
	closure: () => [],
	closure_hash: () => '',
	imports: () => [],
	importers: () => new Set(),
	runtime_importers: () => new Set(TESTS),
	strings: () => [],
	test_inputs: (file) => (file === UNKNOWN ? undefined : [file, SOURCE]),
}

// What moved since the green record, for both since-green readers the reuse module calls.
function mock_moved(parts: MovedParts): void {
	vi.spyOn(since_green, 'read_moved_parts').mockResolvedValue(parts)
	vi.spyOn(since_green, 'read_verdict').mockResolvedValue({ parts })
}

beforeEach(() => {
	for (const file of [SOURCE, ...TESTS]) writeFileSync(file, 'before')
	vi.spyOn(import_graph, 'create').mockResolvedValue(GRAPH)
	vi.spyOn(test_pinned_reach, 'code_universe').mockResolvedValue(TESTS)
	mock_moved({ changed: [], synced: ['main.ts'] })
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('test_related_reuse', () => {
	it('reuses only unchanged individual successes in a mixed branch after main sync', async () => {
		const blobs = await test_related_reuse.blobs(ROOT, TESTS)

		writeFileSync(CHANGED, 'after')
		vi.spyOn(review_stamps.test_related_stamp, 'read').mockReturnValue({
			taken_at: '',
			files: {},
			blobs,
		})
		const result = await test_related_reuse.read(ROOT, SCOPE, TREE)

		expect(result.excluded).toEqual([UNCHANGED])
		expect(result).toMatchObject({ reused: 1, missed: 2 })
	})
	it('reruns every test when their shared dependency changes', async () => {
		const blobs = await test_related_reuse.blobs(ROOT, TESTS)

		writeFileSync(SOURCE, 'after')
		vi.spyOn(review_stamps.test_related_stamp, 'read').mockReturnValue({
			taken_at: '',
			files: {},
			blobs,
		})
		const result = await test_related_reuse.read(ROOT, SCOPE, TREE)

		expect(result.reused).toBe(0)
	})
})

// joshuafolkken/kit#8095: a green is compared test by test with no main sync since it.
describe('test_related_reuse without a main sync', () => {
	beforeEach(async () => {
		const blobs = await test_related_reuse.blobs(ROOT, TESTS)

		mock_moved({ changed: [], synced: [] })
		vi.spyOn(review_stamps.test_related_stamp, 'read').mockReturnValue({
			taken_at: '',
			files: {},
			blobs,
		})
	})
	it('reuses every selected test whose closed inputs are unchanged', async () => {
		const result = await test_related_reuse.read(ROOT, SCOPE, TREE)

		expect(result.excluded).toEqual([CHANGED, UNCHANGED])
		expect(result).toMatchObject({ reused: 2, missed: 1, reason: 'closed-inputs-unchanged' })
		expect(test_related_reuse.flags(result)).toContain('--passWithNoTests')
	})
	it('runs a test once one file of its closed inputs changed', async () => {
		writeFileSync(CHANGED, 'after')
		const result = await test_related_reuse.read(ROOT, SCOPE, TREE)

		expect(result.excluded).toEqual([UNCHANGED])
	})
	it('records the unchanged-inputs reason only when it reused a test', async () => {
		writeFileSync(SOURCE, 'after')
		const result = await test_related_reuse.read(ROOT, SCOPE, TREE)

		expect(result).toMatchObject({ reused: 0, reason: 'closed-inputs-changed' })
	})
	it('reuses nothing once a whole-suite input changed on the branch', async () => {
		mock_moved({ changed: [VITEST_CONFIG], synced: [] })
		const result = await test_related_reuse.read(ROOT, SCOPE, TREE)

		expect(result).toMatchObject({ excluded: [], reason: 'whole-suite-input' })
	})
})

describe('test_related_reuse fallbacks', () => {
	it('reuses nothing without recorded individual successes', async () => {
		vi.spyOn(review_stamps.test_related_stamp, 'read').mockReturnValue(undefined)
		const result = await test_related_reuse.read(ROOT, SCOPE, TREE)

		expect(result.excluded).toEqual([])
	})
	it.each(['pnpm-lock.yaml', 'package.json', VITEST_CONFIG, 'tools/test/unit-projects.ts'])(
		'invalidates on %s',
		async (file) => {
			mock_moved({ changed: [], synced: [file] })
			const result = await test_related_reuse.read(ROOT, SCOPE, TREE)

			expect(result.excluded).toEqual([])
		},
	)
	it('requires the comparable successful scoped record, including tools and configuration', async () => {
		vi.mocked(since_green.read_verdict).mockResolvedValue({
			fallback: since_green.FALLBACK.NO_RECORD,
		})
		const result = await test_related_reuse.read(ROOT, SCOPE, TREE)

		expect(result.excluded).toEqual([])
		expect(since_green.read_verdict).toHaveBeenCalledWith(
			review_stamps.test_related_stamp,
			gate_labels.UNIT_LABEL,
			undefined,
			TREE,
		)
	})
})

// joshuafolkken/kit#8283: each reuse miss keeps its own cause in the ledger.
describe('test_related_reuse miss reasons', () => {
	it.each([
		[since_green.FALLBACK.NO_RECORD, 'green-no-record'],
		[since_green.FALLBACK.INPUT_MISMATCH, 'green-input-mismatch'],
		[since_green.FALLBACK.NO_BASE, 'green-no-base'],
		[since_green.FALLBACK.CONFIG_FILE, 'green-config-file'],
	])('records the since-green fallback %s as %s', async (fallback, reason) => {
		vi.mocked(since_green.read_verdict).mockResolvedValue({ fallback })
		const result = await test_related_reuse.read(ROOT, SCOPE, TREE)

		expect(result).toMatchObject({ excluded: [], reason })
	})
	it('records a run with no gate tree as no-gate-tree', async () => {
		const result = await test_related_reuse.read(ROOT, SCOPE, undefined)

		expect(result).toMatchObject({ excluded: [], reason: 'no-gate-tree' })
	})
	it('records a scope that is not related under its own mode', async () => {
		const result = await test_related_reuse.read(ROOT, { ...SCOPE, mode: 'all' }, TREE)

		expect(result).toMatchObject({ excluded: [], reason: 'scope-all' })
	})
})

// joshuafolkken/kit#8288: a file the last run failed on runs again whatever its digest.
describe('test_related_reuse.keeping', () => {
	const REUSE = { excluded: [CHANGED, UNCHANGED], reused: 2, missed: 1, reason: 'r', elapsed_ms: 0 }

	it('keeps a failed file from the exclusions and counts it as missed', () => {
		const result = test_related_reuse.keeping(ROOT, REUSE, [CHANGED_NAME])

		expect(result).toMatchObject({ excluded: [UNCHANGED], reused: 1, missed: 2, reason: 'r' })
	})
	it('names the failed run once nothing is left to exclude', () => {
		const result = test_related_reuse.keeping(ROOT, REUSE, [CHANGED_NAME, UNCHANGED_NAME])

		expect(result).toMatchObject({ excluded: [], reused: 0, reason: 'failed-last-run' })
	})
	it('returns the reuse unchanged when no excluded file failed', () => {
		expect(test_related_reuse.keeping(ROOT, REUSE, [])).toBe(REUSE)
	})
})

describe('test_related_reuse unreadable inputs', () => {
	it('falls back when input discovery fails', async () => {
		vi.spyOn(review_stamps.test_related_stamp, 'read').mockReturnValue({
			taken_at: '',
			files: {},
			blobs: { [UNCHANGED]: 'digest' },
		})
		vi.mocked(import_graph.create).mockRejectedValue(new Error('unreadable'))
		const result = await test_related_reuse.read(ROOT, SCOPE, TREE)

		expect(result.reason).toBe('unreadable-inputs')
	})
})

describe('test_related_reuse.retained', () => {
	it('keeps individual success evidence through a subsequent unchanged gate invocation', async () => {
		vi.mocked(since_green.read_moved_parts).mockResolvedValue({ changed: [], synced: [] })
		const blobs = await test_related_reuse.blobs(ROOT, [UNCHANGED])

		vi.spyOn(review_stamps.test_related_stamp, 'read').mockReturnValue({
			taken_at: '',
			files: {},
			blobs,
		})
		expect(await test_related_reuse.retained(ROOT, TREE)).toEqual([path.relative(ROOT, UNCHANGED)])
	})
	it('does not carry evidence across a moved base or file', async () => {
		expect(await test_related_reuse.retained(ROOT, TREE)).toEqual([])
	})
})

// joshuafolkken/kit#7966: a red run's passed files join the next green record.
async function red_record(): Promise<void> {
	const blobs = await test_related_reuse.blobs(ROOT, [CHANGED, UNCHANGED])

	vi.spyOn(review_stamps.test_related_red_stamp, 'read').mockReturnValue({
		taken_at: '',
		files: {},
		blobs: { ...blobs, [path.relative(ROOT, UNKNOWN)]: 'failed' },
	})
}

describe('test_related_reuse.carried', () => {
	beforeEach(() => {
		vi.mocked(since_green.read_moved_parts).mockResolvedValue({
			changed: ['source.ts'],
			synced: [],
		})
	})
	it('carries the passed files whose inputs are unchanged, never a changed or failed one', async () => {
		await red_record()
		writeFileSync(CHANGED, 'after')

		expect(await test_related_reuse.carried(ROOT, TREE)).toEqual([path.relative(ROOT, UNCHANGED)])
		expect(since_green.read_moved_parts).toHaveBeenCalledWith(
			review_stamps.test_related_red_stamp,
			gate_labels.UNIT_LABEL,
			undefined,
			TREE,
		)
	})
	it('carries nothing once a shared source the tests reach changed', async () => {
		await red_record()
		writeFileSync(SOURCE, 'after')

		expect(await test_related_reuse.carried(ROOT, TREE)).toEqual([])
	})
	it.each([
		['a main merge moved the base', { changed: [], synced: ['main.ts'] }],
		['a whole-suite input changed', { changed: [VITEST_CONFIG], synced: [] }],
		['no comparable red record stands', undefined],
	])('carries nothing when %s', async (_case, parts) => {
		await red_record()
		vi.mocked(since_green.read_moved_parts).mockResolvedValue(parts)

		expect(await test_related_reuse.carried(ROOT, TREE)).toEqual([])
	})
})
