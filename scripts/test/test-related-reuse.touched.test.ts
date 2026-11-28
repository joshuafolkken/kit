import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { gate_labels } from '#scripts/gate/gate-labels'
import { since_green } from '#scripts/gate/since-green'
import { import_graph, type ImportGraph } from '#scripts/lint/import-graph'
import { review_stamps } from '#scripts/review/review-stamps'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { test_pinned_reach } from './test-pinned-reach'
import { test_related_reuse } from './test-related-reuse'

// joshuafolkken/kit#9163: a touched green's per-file digests answer the full-reach reuse.
const make_directory = temporary_directory('suite')
const ROOT = make_directory('josh-test-reuse-touched-')
const SOURCE = path.join(ROOT, 'source.ts')
const EDITED_NAME = 'edited.test.ts'
const KEPT_NAME = 'kept.test.ts'
const EDITED = path.join(ROOT, EDITED_NAME)
const KEPT = path.join(ROOT, KEPT_NAME)
const OTHER = path.join(ROOT, 'other.test.ts')
const TESTS = [EDITED, KEPT, OTHER]
// The full-reach miss reason, which a touched record never overwrites.
const NO_FULL_RECORD = 'green-no-record'
const TREE = { files: { 'source.ts': 'digest' }, base: 'base' }
const SCOPE = { mode: 'related' as const, files: [SOURCE], reason: 'fixture' }
const GRAPH: ImportGraph = {
	closure: () => [],
	closure_hash: () => '',
	imports: () => [],
	importers: () => new Set(),
	runtime_importers: () => new Set(TESTS),
	strings: () => [],
	test_inputs: (file) => [file, SOURCE],
}

async function touched_green(files: ReadonlyArray<string>): Promise<void> {
	const blobs = await test_related_reuse.blobs(ROOT, files)

	vi.spyOn(review_stamps.test_related_touched_stamp, 'read').mockReturnValue({
		taken_at: '',
		files: {},
		blobs,
	})
}

beforeEach(() => {
	for (const file of [SOURCE, ...TESTS]) writeFileSync(file, 'before')
	vi.spyOn(import_graph, 'create').mockResolvedValue(GRAPH)
	vi.spyOn(test_pinned_reach, 'code_universe').mockResolvedValue(TESTS)
	vi.spyOn(since_green, 'read_moved_parts').mockResolvedValue({ changed: [], synced: [] })
	vi.spyOn(since_green, 'read_verdict').mockResolvedValue({
		fallback: since_green.FALLBACK.NO_RECORD,
	})
	vi.spyOn(review_stamps.test_related_stamp, 'read').mockReturnValue(undefined)
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('test_related_reuse — a touched green before any full-reach green', () => {
	it('reuses the touched tests whose closed inputs are unchanged', async () => {
		await touched_green([EDITED, KEPT])
		const result = await test_related_reuse.read(ROOT, SCOPE, TREE)

		expect(result).toMatchObject({ excluded: [EDITED, KEPT], reused: 2, missed: 1 })
		expect(since_green.read_moved_parts).toHaveBeenCalledWith(
			review_stamps.test_related_touched_stamp,
			gate_labels.UNIT_LABEL,
			{ tree: TREE },
		)
	})
	it('reruns a touched test once one of its closed inputs changed', async () => {
		await touched_green([EDITED, KEPT])
		writeFileSync(EDITED, 'after')
		const result = await test_related_reuse.read(ROOT, SCOPE, TREE)

		expect(result.excluded).toEqual([KEPT])
	})
	it('reruns every touched test once their shared source changed', async () => {
		await touched_green([EDITED, KEPT])
		writeFileSync(SOURCE, 'after')
		const result = await test_related_reuse.read(ROOT, SCOPE, TREE)

		expect(result).toMatchObject({ excluded: [], reason: NO_FULL_RECORD })
	})
})

describe('test_related_reuse — no touched test to reuse', () => {
	it('keeps the full-reach miss reason when no touched test still passes', async () => {
		const result = await test_related_reuse.read(ROOT, SCOPE, TREE)

		expect(result).toMatchObject({ excluded: [], reason: NO_FULL_RECORD })
	})
	it.each([
		['a main merge moved the base', { changed: [], synced: ['main.ts'] }],
		['a whole-suite input changed', { changed: ['vitest.config.ts'], synced: [] }],
	])('reuses no touched test when %s', async (_case, parts) => {
		await touched_green([EDITED, KEPT])
		vi.mocked(since_green.read_moved_parts).mockResolvedValue(parts)
		const result = await test_related_reuse.read(ROOT, SCOPE, TREE)

		expect(result.excluded).toEqual([])
	})
})

describe('test_related_reuse — a touched green and a red full-reach run', () => {
	it('reruns only the failed file, keeping the unchanged touched one reused', async () => {
		await touched_green([EDITED, KEPT])
		const reuse = await test_related_reuse.read(ROOT, SCOPE, TREE)
		const result = test_related_reuse.keeping(ROOT, reuse, [EDITED_NAME])

		expect(result).toMatchObject({ excluded: [KEPT], reused: 1, missed: 2 })
	})
})

describe('test_related_reuse.touched', () => {
	it('names the touched files whose closed inputs still hash as recorded', async () => {
		await touched_green([EDITED, KEPT])
		writeFileSync(EDITED, 'after')

		expect(await test_related_reuse.touched(ROOT, TREE)).toEqual([KEPT_NAME])
	})
})
