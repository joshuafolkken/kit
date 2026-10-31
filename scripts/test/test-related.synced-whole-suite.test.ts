import { readFileSync } from 'node:fs'
import path from 'node:path'
import { gate_labels } from '#scripts/gate/gate-labels'
import { since_green } from '#scripts/gate/since-green'
import { changed_paths } from '#scripts/git/changed-paths'
import { git_command } from '#scripts/git/git-command'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { direct_importers } from './direct-importers'
import { pure_files_entries } from './pure-files-entries'
import { test_read_map } from './test-read-map'
import { test_related } from './test-related'
import { test_unit_guard } from './test-unit-guard'

// joshuafolkken/kit#4993: a main sync brought in `tools/test/test-state-guard.ts`, which every test
// depends on, and a bare run after it went to the whole suite though this branch had not changed it.

vi.mock('#scripts/git/git-command', () => ({
	git_command: { change_base: vi.fn(), repository_root: vi.fn(), show_file: vi.fn() },
}))
vi.mock('#scripts/git/changed-paths', () => ({
	changed_paths: {
		read_changed_paths: vi.fn(),
		read_changed_since: vi.fn(),
		read_held_at: vi.fn(),
	},
}))
vi.mock('./related-heavy-tests', () => ({ related_heavy_tests: { exclude_flags: () => [] } }))
vi.mock('./test-unit-guard', () => ({
	test_unit_guard: { is_running: vi.fn(), run_guarded_vitest: vi.fn() },
}))
// Mocked so no case writes the record this checkout's own run relies on (joshuafolkken/kit#1511).
vi.mock('#scripts/gate/scoped-green', () => ({
	scoped_green: { read_before: vi.fn(), record_if_green: vi.fn() },
}))
vi.mock(import('#scripts/gate/since-green'), async (import_original) => {
	const original = await import_original()

	return {
		since_green: {
			...original.since_green,
			describe: vi.fn(() => 'since its last green run'),
			read_verdict: vi.fn(),
		},
	}
})

const mocked_moved = vi.mocked(since_green.read_verdict)
const mocked_changed = vi.mocked(changed_paths.read_changed_paths)
const mocked_run = vi.mocked(test_unit_guard.run_guarded_vitest)

// Real paths, because the CLI drops a path the tree does not hold.
const REPOSITORY_ROOT = process.cwd()
const FIXED_SOURCE = path.join('scripts', 'test', 'test-related.ts')
const STATE_GUARD = path.join('tools', 'test', 'test-state-guard.ts')
// A real whole-suite file whose text names `UNIT_GUARD`, which vitest would widen to the whole suite.
const NAMING_WORKERS = path.join('tools', 'test', 'vitest-config-workers.ts')
const UNIT_GUARD = path.join('scripts', 'test', 'test-unit-guard.ts')
const WHOLE_SUITE = ['run']
const NOT_A_REPOSITORY = new Error('not a git repository')

function vitest_arguments(): ReadonlyArray<string> {
	return mocked_run.mock.calls[0]?.[1] ?? []
}

beforeEach(() => {
	vi.clearAllMocks()
	vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
	vi.mocked(git_command.repository_root).mockResolvedValue(REPOSITORY_ROOT)
	vi.mocked(changed_paths.read_changed_since).mockResolvedValue([])
	vi.mocked(changed_paths.read_held_at).mockResolvedValue([])
	vi.mocked(test_unit_guard.is_running).mockReturnValue(true)
	vi.spyOn(test_read_map, 'read_map').mockReturnValue({
		version: test_read_map.MAP_VERSION,
		commit: 'f00dcafe',
		dirty: {},
		change: [],
		directories: [],
		readers: {},
	})
	mocked_changed.mockResolvedValue([FIXED_SOURCE])
	mocked_moved.mockResolvedValue({ parts: { changed: [FIXED_SOURCE], synced: [STATE_GUARD] } })
	mocked_run.mockResolvedValue(0)
})

describe('test_related.run_related_tests — a whole-suite file a main sync brought in', () => {
	it("runs only the branch change's related tests rather than the whole suite", async () => {
		await test_related.run_related_tests([])

		expect(vitest_arguments()).toEqual([
			'related',
			path.join(REPOSITORY_ROOT, FIXED_SOURCE),
			'--run',
		])
	})

	it('never hands it to vitest for naming a file the branch moved', async () => {
		mocked_changed.mockResolvedValue([UNIT_GUARD])
		mocked_moved.mockResolvedValue({ parts: { changed: [UNIT_GUARD], synced: [NAMING_WORKERS] } })

		await test_related.run_related_tests([])

		expect(vitest_arguments()).toEqual(['related', path.join(REPOSITORY_ROOT, UNIT_GUARD), '--run'])
	})

	it('still runs the whole suite when this branch changed it too', async () => {
		mocked_changed.mockResolvedValue([FIXED_SOURCE, STATE_GUARD])

		await test_related.run_related_tests([])

		expect(vitest_arguments()).toEqual(WHOLE_SUITE)
	})

	it('still runs the whole suite when the branch change cannot be read', async () => {
		mocked_changed.mockRejectedValue(NOT_A_REPOSITORY)

		await test_related.run_related_tests([])

		expect(vitest_arguments()).toEqual(WHOLE_SUITE)
	})
})

// joshuafolkken/kit#5001: rewriting one entry of the pure-files list ran the whole suite.
describe('test_related.run_related_tests — an entries-only edit of the pure-files list', () => {
	const PURE_FILES = pure_files_entries.PURE_FILES_PATH
	const LIST_OPEN = 'const PURE_FILES: ReadonlyArray<string> = [\n'
	// A real test file the list leaves out, so the base that holds it differs by that entry alone.
	const ENTRY = path.join('scripts', 'test', 'test-related.synced-whole-suite.test.ts')

	beforeEach(() => {
		const list_text = readFileSync(path.join(REPOSITORY_ROOT, PURE_FILES), 'utf8')

		mocked_changed.mockResolvedValue([PURE_FILES])
		mocked_moved.mockResolvedValue({ parts: { changed: [PURE_FILES], synced: [] } })
		vi.mocked(git_command.change_base).mockResolvedValue('b45e')
		vi.mocked(git_command.show_file).mockResolvedValue(
			list_text.replace(LIST_OPEN, () => `${LIST_OPEN}\t'${ENTRY}',\n`),
		)
	})

	it('runs the moved entry and the list’s own tests rather than the whole suite', async () => {
		await test_related.run_related_tests([])

		expect(vitest_arguments()).toEqual([
			'related',
			...pure_files_entries.tests_of([ENTRY]).map((file) => path.join(REPOSITORY_ROOT, file)),
			'--run',
		])
	})

	// joshuafolkken/kit#5122: the list is a file every test imports, so it reaches the test files
	// importing it directly — never the whole suite, which the gate and CI run.
	it('runs the test files importing the list when the change base cannot be read', async () => {
		vi.mocked(git_command.show_file).mockRejectedValue(NOT_A_REPOSITORY)
		const importers = await direct_importers.every_test_importers(REPOSITORY_ROOT, [PURE_FILES])

		await test_related.run_related_tests([])

		expect(vitest_arguments()).toEqual([
			'related',
			...(importers.get(PURE_FILES) ?? []).map((file) => path.join(REPOSITORY_ROOT, file)),
			'--run',
		])
	})
})

// joshuafolkken/kit#5122: the gate's unit leg keeps the whole suite for a file every test imports,
// and the flag never reaches vitest.
describe('test_related.run_related_tests — the gate’s whole-suite flag', () => {
	beforeEach(() => {
		mocked_changed.mockResolvedValue([pure_files_entries.PURE_FILES_PATH, FIXED_SOURCE])
		vi.mocked(git_command.show_file).mockRejectedValue(NOT_A_REPOSITORY)
	})

	it('runs the whole suite for a file every test imports', async () => {
		mocked_moved.mockResolvedValue({
			parts: { changed: [pure_files_entries.PURE_FILES_PATH], synced: [] },
		})

		await test_related.run_related_tests([gate_labels.KEEP_WHOLE_SUITE_FLAG])

		expect(vitest_arguments()).toEqual(WHOLE_SUITE)
	})

	// A bare run's green vouches only for that file's direct importers.
	it('never narrows by a green past a file every test imports the branch changed', async () => {
		await test_related.run_related_tests([gate_labels.KEEP_WHOLE_SUITE_FLAG])

		expect(vitest_arguments()).toEqual(WHOLE_SUITE)
	})

	it('never reports a file every test imports as ignored when it names one', async () => {
		await test_related.run_related_tests([pure_files_entries.PURE_FILES_PATH])

		expect(vi.mocked(process.stdout.write).mock.calls.join('\n')).not.toContain('ignored')
	})

	it('narrows by that green without the flag', async () => {
		await test_related.run_related_tests([])

		expect(vitest_arguments()).toEqual([
			'related',
			path.join(REPOSITORY_ROOT, FIXED_SOURCE),
			'--run',
		])
	})
})
