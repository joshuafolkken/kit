import { readdirSync } from 'node:fs'
import path from 'node:path'
import { since_green } from '#scripts/gate/since-green'
import { changed_paths } from '#scripts/git/changed-paths'
import { git_command } from '#scripts/git/git-command'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { test_read_map } from './test-read-map'
import { test_related } from './test-related'
import { test_related_record } from './test-related-record'
import { test_related_synced } from './test-related-synced'
import { test_unit_guard } from './test-unit-guard'

// joshuafolkken/kit#5066: after a sync of 28 files, the gate stage's pair ran 669 test files for a branch
// change 17 recorded tests read — the import graph's tests shared with the synced modules, 612 of them,
// were handed to vitest by name.

vi.mock('#scripts/git/git-command', () => ({ git_command: { repository_root: vi.fn() } }))
vi.mock('#scripts/git/changed-paths', () => ({
	changed_paths: {
		read_changed_paths: vi.fn(),
		read_changed_since: vi.fn(),
		read_held_at: vi.fn(),
	},
}))
vi.mock('./related-heavy-tests', () => ({ related_heavy_tests: { exclude_flags: () => [] } }))
// The reach cap walks no import graph here; what it caps is `test-related-cap.test.ts`.
vi.mock('./test-pinned-reach')
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

const mocked_run = vi.mocked(test_unit_guard.run_guarded_vitest)
const mocked_moved = vi.mocked(since_green.read_verdict)

// Real paths, because the CLI drops a path the tree does not hold.
const REPOSITORY_ROOT = process.cwd()
const TEST_DIRECTORY = path.join('scripts', 'test')
const READER_COUNT = 17
const SYNCED_COUNT = 28
const OWN_SOURCE = path.join(TEST_DIRECTORY, 'vitest-failure-summary.ts')
const OWN_CHANGE = [
	OWN_SOURCE,
	'test-related.ts',
	'test-related-record.ts',
	'test-related-scope.ts',
	'test-related-synced.ts',
	'test-read-map.ts',
].map((file) => (file.includes(path.sep) ? file : path.join(TEST_DIRECTORY, file)))
const STATE_GUARD = path.join('tools', 'test', 'test-state-guard.ts')
const SYNCED = Array.from({ length: SYNCED_COUNT }, (_, index) =>
	path.join('scripts', 'rules', `synced-${String(index)}.ts`),
)
const TESTS = readdirSync(path.join(REPOSITORY_ROOT, TEST_DIRECTORY))
	.filter((file) => file.endsWith('.test.ts'))
	.toSorted((left, right) => left.localeCompare(right))
	.map((file) => path.join(TEST_DIRECTORY, file))
const READERS = TESTS.slice(0, READER_COUNT)
const SHARED = TESTS.slice(READER_COUNT)
const WHOLE_SUITE = ['run']

function vitest_arguments(): ReadonlyArray<string> {
	return mocked_run.mock.calls[0]?.[1] ?? []
}

function absolute(file: string): string {
	return path.join(REPOSITORY_ROOT, file)
}

const OWN_ARGUMENTS = [
	'related',
	...[...OWN_CHANGE, ...READERS].map((file) => absolute(file)),
	'--run',
]

function moved(changed: ReadonlyArray<string>, synced: ReadonlyArray<string>): void {
	mocked_moved.mockResolvedValue({ parts: { changed: [...changed], synced: [...synced] } })
}

function with_split_and_map(): void {
	vi.spyOn(test_related_synced, 'split').mockResolvedValue({
		left: SYNCED,
		shared: SHARED,
		meeting: SHARED,
	})
	vi.spyOn(test_read_map, 'read_map').mockReturnValue({
		version: test_read_map.MAP_VERSION,
		commit: 'f00dcafe',
		dirty: {},
		change: [],
		directories: [],
		readers: { [OWN_SOURCE]: READERS },
	})
}

beforeEach(() => {
	vi.clearAllMocks()
	vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
	with_split_and_map()
	vi.mocked(git_command.repository_root).mockResolvedValue(REPOSITORY_ROOT)
	vi.mocked(changed_paths.read_changed_paths).mockResolvedValue(OWN_CHANGE)
	vi.mocked(changed_paths.read_changed_since).mockResolvedValue([])
	vi.mocked(changed_paths.read_held_at).mockResolvedValue([])
	vi.mocked(test_unit_guard.is_running).mockReturnValue(true)
	moved(OWN_CHANGE, SYNCED)
	mocked_run.mockResolvedValue(0)
})

describe('test_related.run_related_tests — the tests a main sync shares with the branch change', () => {
	it('hands vitest the branch change and its readers alone, no shared test', async () => {
		await test_related.run_related_tests([])

		expect(vitest_arguments()).toEqual(OWN_ARGUMENTS)
	})

	it("counts only the branch change's readers as the ledger's readers", async () => {
		const record_run = vi.spyOn(test_related_record, 'record_run').mockResolvedValue()

		await test_related.run_related_tests([])

		const input = record_run.mock.calls[0]?.[0]
		const result = { elapsed_ms: 0, test_files: undefined }

		expect(input && test_related_record.record_of(input, result)).toMatchObject({
			readers: READER_COUNT,
		})
	})

	it('still runs the whole suite when the branch change holds a file every test depends on', async () => {
		vi.mocked(changed_paths.read_changed_paths).mockResolvedValue([...OWN_CHANGE, STATE_GUARD])
		moved([...OWN_CHANGE, STATE_GUARD], SYNCED)

		await test_related.run_related_tests([])

		expect(vitest_arguments()).toEqual(WHOLE_SUITE)
	})

	it('runs no whole suite when only the sync brought a file every test depends on', async () => {
		moved(OWN_CHANGE, [...SYNCED, STATE_GUARD])

		await test_related.run_related_tests([])

		expect(vitest_arguments()).toEqual(OWN_ARGUMENTS)
	})
})

// A green branch side the sync alone moved: the change still runs where main's modules meet it.
describe('test_related.run_related_tests — a sync that alone moved the tree', () => {
	it('hands vitest the branch change in place of the modules when only the sync moved', async () => {
		moved([], SYNCED)

		await test_related.run_related_tests([])

		expect(vitest_arguments()).toEqual(OWN_ARGUMENTS)
	})

	it('runs no test when only the sync moved and the modules meet no test of the change', async () => {
		moved([], SYNCED)
		vi.spyOn(test_related_synced, 'split').mockResolvedValue({
			left: SYNCED,
			shared: [],
			meeting: [],
		})

		await test_related.run_related_tests([])

		expect(mocked_run).not.toHaveBeenCalled()
	})
})
