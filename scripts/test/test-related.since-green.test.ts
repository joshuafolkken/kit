import path from 'node:path'
import { gate_plan } from '#scripts/gate/gate-plan'
import type { MovedParts } from '#scripts/gate/moved-paths'
import { since_green } from '#scripts/gate/since-green'
import { changed_paths } from '#scripts/git/changed-paths'
import { git_command } from '#scripts/git/git-command'
import { review_stamps } from '#scripts/review/review-stamps'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { test_read_map } from './test-read-map'
import { test_related } from './test-related'
import { test_related_record } from './test-related-record'
import { test_unit_guard } from './test-unit-guard'

// joshuafolkken/kit#4393: a ship retry re-ran every test the whole branch diff reaches. A bare run now
// reads only what moved since its last green run, plus the change since the test-read map's tree.

vi.mock('#scripts/git/git-command', () => ({ git_command: { repository_root: vi.fn() } }))
vi.mock('#scripts/git/changed-paths', () => ({
	changed_paths: {
		read_changed_paths: vi.fn(),
		read_changed_since: vi.fn(),
		read_held_at: vi.fn(),
	},
}))
vi.mock('./test-unit-guard', () => ({
	test_unit_guard: { is_running: vi.fn(), run_guarded_vitest: vi.fn() },
}))
// Mocked so no case writes the record this checkout's own run relies on (joshuafolkken/kit#1511).
vi.mock('#scripts/gate/scoped-green', () => ({
	scoped_green: { read_before: vi.fn(), record_if_green: vi.fn() },
}))
// The reason is the real one, since the unmoved case below asserts the line it prints.
vi.mock('#scripts/gate/since-green', () => ({
	since_green: {
		UNMOVED_REASON: 'nothing moved since its last green run on this checkout',
		describe: vi.fn(),
		read_moved_parts: vi.fn(),
	},
}))

const mocked_moved = vi.mocked(since_green.read_moved_parts)
const mocked_changed = vi.mocked(changed_paths.read_changed_paths)
const mocked_run = vi.mocked(test_unit_guard.run_guarded_vitest)

// Real paths, because the CLI drops a path the tree does not hold.
const REPOSITORY_ROOT = process.cwd()
const FIXED_SOURCE = path.join('scripts', 'test', 'test-related.ts')
const UNTOUCHED_SOURCE = path.join('scripts', 'test', 'test-related-scope.ts')
const BRANCH_TEST = path.join('scripts', 'test', 'test-related.test.ts')
// A real source whose text names `FIXED_SOURCE`, and a real test whose text does not.
const NAMING_SOURCE = path.join('scripts', 'test', 'test-related-main.ts')
const SCOPE_TEST = path.join('scripts', 'test', 'test-related-scope-triggers.test.ts')
const NARROWING_LINE = 'since its last green run'
const MAP_TREE = 'f00dcafe'
const PRUNED_TREE = new Error('bad object')
const NOT_A_REPOSITORY = new Error('not a git repository')

function map_with(
	readers: Record<string, Array<string>>,
): ReturnType<typeof test_read_map.read_map> {
	return {
		version: test_read_map.MAP_VERSION,
		commit: MAP_TREE,
		dirty: {},
		directories: [],
		readers,
	}
}

// What moved with nothing brought in by a main sync.
function changed_only(...changed: Array<string>): MovedParts {
	return { changed, synced: [] }
}

function vitest_arguments(): ReadonlyArray<string> {
	return mocked_run.mock.calls[0]?.[1] ?? []
}

function absolute(file: string): string {
	return path.join(REPOSITORY_ROOT, file)
}

const WHOLE_BRANCH = [
	'related',
	absolute(FIXED_SOURCE),
	absolute(UNTOUCHED_SOURCE),
	absolute(BRANCH_TEST),
	'--run',
]

beforeEach(() => {
	vi.clearAllMocks()
	vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
	vi.mocked(git_command.repository_root).mockResolvedValue(REPOSITORY_ROOT)
	vi.mocked(changed_paths.read_changed_since).mockResolvedValue([BRANCH_TEST])
	vi.mocked(changed_paths.read_held_at).mockResolvedValue([])
	vi.mocked(test_unit_guard.is_running).mockReturnValue(true)
	vi.mocked(since_green.describe).mockReturnValue(NARROWING_LINE)
	vi.spyOn(test_read_map, 'read_map').mockReturnValue(map_with({}))
	mocked_changed.mockResolvedValue([FIXED_SOURCE, UNTOUCHED_SOURCE, BRANCH_TEST])
	mocked_run.mockResolvedValue(0)
})

describe('test_related.run_related_tests — since the last green run', () => {
	it('reads the moved files from its own green record', async () => {
		mocked_moved.mockResolvedValue(changed_only(FIXED_SOURCE))

		await test_related.run_related_tests([])

		expect(mocked_moved).toHaveBeenCalledWith(
			review_stamps.test_related_stamp,
			gate_plan.UNIT_LABEL,
		)
	})

	it('narrows to the moved files and the change since the map, leaving an untouched source out', async () => {
		mocked_moved.mockResolvedValue(changed_only(FIXED_SOURCE))

		await test_related.run_related_tests([])

		expect(vitest_arguments()).toEqual([
			'related',
			absolute(FIXED_SOURCE),
			absolute(BRANCH_TEST),
			'--run',
		])
	})

	it('runs no tests when nothing moved since the green run', async () => {
		mocked_moved.mockResolvedValue(changed_only())

		await expect(test_related.run_related_tests([])).resolves.toBe(0)

		expect(mocked_run).not.toHaveBeenCalled()
		expect(vi.mocked(process.stdout.write)).toHaveBeenCalledWith(
			expect.stringContaining('nothing moved since its last green run'),
		)
	})

	it('says it narrowed since the green run before vitest starts', async () => {
		mocked_moved.mockResolvedValue(changed_only(FIXED_SOURCE))

		await test_related.run_related_tests([])

		expect(vi.mocked(process.stdout.write)).toHaveBeenCalledWith(`${NARROWING_LINE}\n`)
	})
})

describe('test_related.run_related_tests — reading the whole branch instead', () => {
	it('reads the whole branch change when there is nothing to narrow by', async () => {
		vi.mocked(test_read_map.read_map).mockReturnValue(undefined)
		mocked_moved.mockResolvedValue(undefined)

		await test_related.run_related_tests([])

		expect(vitest_arguments()).toEqual(WHOLE_BRANCH)
	})

	it('reads the whole branch change when no test-read map covers the moved files', async () => {
		vi.mocked(test_read_map.read_map).mockReturnValue(undefined)
		mocked_moved.mockResolvedValue(changed_only(FIXED_SOURCE))

		await test_related.run_related_tests([])

		expect(vitest_arguments()).toEqual(WHOLE_BRANCH)
	})

	it("reads the whole branch change when the map's tree can no longer be diffed", async () => {
		vi.mocked(changed_paths.read_changed_since).mockRejectedValue(PRUNED_TREE)
		mocked_moved.mockResolvedValue(changed_only(FIXED_SOURCE))

		await test_related.run_related_tests([])

		expect(vitest_arguments()).toEqual(WHOLE_BRANCH)
	})

	it('runs the whole suite when neither change can be read', async () => {
		vi.mocked(changed_paths.read_changed_since).mockRejectedValue(PRUNED_TREE)
		mocked_moved.mockResolvedValue(changed_only(FIXED_SOURCE))
		mocked_changed.mockRejectedValue(NOT_A_REPOSITORY)

		await test_related.run_related_tests([])

		expect(vitest_arguments()).toEqual(['run'])
	})

	it('never consults the record for explicit file arguments', async () => {
		await test_related.run_related_tests([UNTOUCHED_SOURCE])

		expect(mocked_moved).not.toHaveBeenCalled()
	})
})

// A source that started reading a moved file as data after the map's tree is in no map entry, so an
// untouched test reaching the file through that source is reached only by the source itself.
describe('test_related.run_related_tests — a moved file read through a newer source', () => {
	const document = 'docs/josh-commands.md'
	const document_reader = path.join('scripts', 'test', 'test-related-scope.test.ts')
	// A real source whose text names the document, as a file-system read of it does.
	const document_source = path.join('scripts', 'doctor', 'doctor-logic.ts')

	it('runs the map readers of a moved non-code file and the source changed since the map', async () => {
		vi.mocked(test_read_map.read_map).mockReturnValue(map_with({ [document]: [document_reader] }))
		vi.mocked(changed_paths.read_changed_since).mockResolvedValue([document_source, document])
		mocked_moved.mockResolvedValue(changed_only(document))

		await test_related.run_related_tests([])

		expect(vitest_arguments()).toEqual(
			expect.arrayContaining([absolute(document_source), absolute(document_reader)]),
		)
	})

	// joshuafolkken/kit#4532: `NAMING_SOURCE` names the moved `test-related.ts`; `UNTOUCHED_SOURCE` does not.
	it('runs only the source changed since the map that names a moved code file', async () => {
		vi.mocked(changed_paths.read_changed_since).mockResolvedValue([UNTOUCHED_SOURCE, NAMING_SOURCE])
		mocked_moved.mockResolvedValue(changed_only(FIXED_SOURCE))

		await test_related.run_related_tests([])

		expect(vitest_arguments()).toEqual([
			'related',
			absolute(FIXED_SOURCE),
			absolute(NAMING_SOURCE),
			'--run',
		])
	})

	it('leaves out the source changed since the map that names no moved file', async () => {
		vi.mocked(changed_paths.read_changed_since).mockResolvedValue([UNTOUCHED_SOURCE])
		mocked_moved.mockResolvedValue(changed_only(FIXED_SOURCE))

		await test_related.run_related_tests([])

		expect(vitest_arguments()).toEqual(['related', absolute(FIXED_SOURCE), '--run'])
	})
})

// joshuafolkken/kit#4532: a test the map holds no entry for may reach a moved file through a helper.
describe('test_related.run_related_tests — a test changed since the map', () => {
	it('runs it though it names no moved file', async () => {
		vi.mocked(changed_paths.read_changed_since).mockResolvedValue([UNTOUCHED_SOURCE, SCOPE_TEST])
		mocked_moved.mockResolvedValue(changed_only(FIXED_SOURCE))

		await test_related.run_related_tests([])

		expect(vitest_arguments()).toEqual([
			'related',
			absolute(FIXED_SOURCE),
			absolute(SCOPE_TEST),
			'--run',
		])
	})
})

// joshuafolkken/kit#4572: a sync brought in `.josh/metrics-accepted/<N>.json`, which no recorded test
// read, and the run went to the whole suite as if this branch had added it.
describe('test_related.run_related_tests — a non-code file a main sync brought in', () => {
	const accepted = path.join('.josh', 'metrics-accepted', '4527.json')

	it('runs no test for it rather than the whole suite', async () => {
		vi.mocked(changed_paths.read_changed_since).mockResolvedValue([accepted])
		mocked_moved.mockResolvedValue({ changed: [], synced: [accepted] })

		await test_related.run_related_tests([])

		expect(mocked_run).not.toHaveBeenCalled()
	})

	it('still runs the whole suite when this branch changed it too', async () => {
		mocked_changed.mockResolvedValue([accepted])
		mocked_moved.mockResolvedValue({ changed: [accepted], synced: [accepted] })

		await test_related.run_related_tests([])

		expect(vitest_arguments()).toEqual(['run'])
	})

	it('still runs the whole suite when the branch change cannot be read', async () => {
		mocked_changed.mockRejectedValue(NOT_A_REPOSITORY)
		mocked_moved.mockResolvedValue({ changed: [], synced: [accepted] })

		await test_related.run_related_tests([])

		expect(vitest_arguments()).toEqual(['run'])
	})
})

// joshuafolkken/kit#4465: the run's ledger record tells the main sync's part of its input apart.
describe('test_related.run_related_tests — the ledger record', () => {
	it('records the moved files a main sync brought in apart from the change itself', async () => {
		const record_run = vi.spyOn(test_related_record, 'record_run').mockResolvedValue()

		mocked_moved.mockResolvedValue({ changed: [FIXED_SOURCE], synced: [UNTOUCHED_SOURCE] })

		await test_related.run_related_tests([])

		expect(record_run.mock.calls[0]?.[0].synced).toEqual([UNTOUCHED_SOURCE])
	})

	it('records the change since the map that nothing moved apart from the change itself', async () => {
		const record_run = vi.spyOn(test_related_record, 'record_run').mockResolvedValue()

		vi.mocked(changed_paths.read_changed_since).mockResolvedValue([FIXED_SOURCE, UNTOUCHED_SOURCE])
		mocked_moved.mockResolvedValue(changed_only(FIXED_SOURCE))

		await test_related.run_related_tests([])

		expect(record_run.mock.calls[0]?.[0]).toMatchObject({
			changed: [FIXED_SOURCE, UNTOUCHED_SOURCE],
			since_map: [UNTOUCHED_SOURCE],
		})
	})
})
