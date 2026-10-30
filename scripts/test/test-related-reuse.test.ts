import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { gate_labels } from '#scripts/gate/gate-labels'
import { since_green } from '#scripts/gate/since-green'
import { import_graph, type ImportGraph } from '#scripts/lint/import-graph'
import { review_stamps } from '#scripts/review/review-stamps'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { test_pinned_reach } from './test-pinned-reach'
import { test_related_reuse } from './test-related-reuse'

const ROOT = mkdtempSync(path.join(tmpdir(), 'josh-test-reuse-'))
const SOURCE = path.join(ROOT, 'source.ts')
const CHANGED = path.join(ROOT, 'changed.test.ts')
const UNCHANGED = path.join(ROOT, 'unchanged.test.ts')
const UNKNOWN = path.join(ROOT, 'unknown.test.ts')
const TESTS = [CHANGED, UNCHANGED, UNKNOWN]
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

beforeEach(() => {
	for (const file of [SOURCE, ...TESTS]) writeFileSync(file, 'before')
	vi.spyOn(import_graph, 'create').mockResolvedValue(GRAPH)
	vi.spyOn(test_pinned_reach, 'code_universe').mockResolvedValue(TESTS)
	vi.spyOn(since_green, 'read_moved_parts').mockResolvedValue({ changed: [], synced: ['main.ts'] })
})

afterEach(() => {
	vi.restoreAllMocks()
})
afterAll(() => {
	rmSync(ROOT, { recursive: true, force: true })
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

describe('test_related_reuse fallbacks', () => {
	it('reuses nothing without recorded individual successes', async () => {
		vi.spyOn(review_stamps.test_related_stamp, 'read').mockReturnValue(undefined)
		const result = await test_related_reuse.read(ROOT, SCOPE, TREE)

		expect(result.excluded).toEqual([])
	})
	it.each(['pnpm-lock.yaml', 'package.json', 'vitest.config.ts', 'tools/test/unit-projects.ts'])(
		'invalidates on %s',
		async (file) => {
			vi.mocked(since_green.read_moved_parts).mockResolvedValue({ changed: [], synced: [file] })
			const result = await test_related_reuse.read(ROOT, SCOPE, TREE)

			expect(result.excluded).toEqual([])
		},
	)
	it('requires the comparable successful scoped record, including tools and configuration', async () => {
		vi.mocked(since_green.read_moved_parts).mockResolvedValue(undefined)
		const result = await test_related_reuse.read(ROOT, SCOPE, TREE)

		expect(result.excluded).toEqual([])
		expect(since_green.read_moved_parts).toHaveBeenCalledWith(
			review_stamps.test_related_stamp,
			gate_labels.UNIT_LABEL,
			undefined,
			TREE,
		)
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
