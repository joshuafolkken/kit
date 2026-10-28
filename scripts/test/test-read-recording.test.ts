import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { changed_paths } from '#scripts/git/changed-paths'
import { git_command } from '#scripts/git/git-command'
import { git_spawn } from '#scripts/git/git-spawn'
import { review_tree } from '#scripts/review/review-tree'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { test_read_map } from './test-read-map'
import { test_read_recording, type RecordingEnvironment } from './test-read-recording'
import { test_read_trace } from './test-read-trace'
import { related_scope, type RelatedScope } from './test-related-scope'

// joshuafolkken/kit#4065: only a green run of the whole suite may replace the map, because a map
// entry is read as "nothing else reads this file".

vi.mock('#scripts/git/git-command', () => ({ git_command: { head_commit: vi.fn() } }))
vi.mock('#scripts/git/changed-paths', () => ({
	changed_paths: { read_changed_paths: vi.fn(), read_changed_since: vi.fn() },
}))
vi.mock('#scripts/git/git-spawn', () => ({ git_spawn: { read: vi.fn() } }))

const ROOT = path.resolve('/repo')
const HEAD = 'cafe1234'
const DIRTY = 'notes.md'
// A file the branch committed: in the change a test reads through git, not in `dirty`.
const CHANGED = path.join('.josh', 'metrics-accepted', '1.json')
const DIRECTORY = 'docs'
const DOCUMENT = path.join(DIRECTORY, 'a.md')
const READER = 'reader.ts'
const FAILED = 1

function write_worker_record(environment: RecordingEnvironment): void {
	const directory = environment[test_read_trace.RECORD_DIRECTORY_KEY] ?? ''

	writeFileSync(path.join(directory, '1-1-1.json'), JSON.stringify({ [DOCUMENT]: [READER] }))
}

async function run_recording(environment: RecordingEnvironment): Promise<number> {
	await Promise.resolve()
	write_worker_record(environment)

	return 0
}

beforeEach(() => {
	vi.clearAllMocks()
	vi.mocked(git_command.head_commit).mockResolvedValue(HEAD)
	vi.mocked(changed_paths.read_changed_since).mockResolvedValue([DIRTY])
	vi.mocked(changed_paths.read_changed_paths).mockResolvedValue([CHANGED])
	vi.mocked(git_spawn.read).mockResolvedValue(`${DIRECTORY}\0`)
	vi.spyOn(test_read_map, 'write_map').mockImplementation(() => {
		// The real map is this checkout's; the test reads what would have been written.
	})
})

describe('test_read_recording.is_recordable', () => {
	it.each([[['run']], [['run', '--maxWorkers=4']]])('records the whole suite %j', (arguments_) => {
		expect(test_read_recording.is_recordable(arguments_)).toBe(true)
	})

	it.each([
		[['related', 'a.ts', '--run']],
		[['run', '--shard=1/2']],
		[['run', 'scripts/a.test.ts']],
		[[]],
	])('records no narrowed, sharded or filtered run %j', (arguments_) => {
		expect(test_read_recording.is_recordable(arguments_)).toBe(false)
	})

	// joshuafolkken/kit#5041: a `josh test:related` run that fell back to the whole suite refreshes the map.
	it('records the whole-suite fallback of a narrowed run', () => {
		const scope: RelatedScope = { mode: 'all', files: [], reason: related_scope.NO_MAP_REASON }

		expect(
			test_read_recording.is_recordable(related_scope.vitest_arguments(scope, ['--maxWorkers=3'])),
		).toBe(true)
	})
})

describe('test_read_recording.with_read_recording', () => {
	it('hands a recordable run the directory and root, and saves the merged map on green', async () => {
		const run = vi.fn(async (environment: RecordingEnvironment) => {
			write_worker_record(environment)

			return 0
		})

		await expect(test_read_recording.with_read_recording(ROOT, ['run'], run)).resolves.toBe(0)

		expect(run.mock.calls[0]?.[0][test_read_trace.ROOT_KEY]).toBe(ROOT)
		expect(test_read_map.write_map).toHaveBeenCalledWith(ROOT, {
			version: test_read_map.MAP_VERSION,
			commit: HEAD,
			dirty: { [DIRTY]: review_tree.ABSENT_DIGEST },
			change: [CHANGED],
			directories: [DIRECTORY],
			readers: { [DOCUMENT]: [READER] },
		})
	})

	it('keeps the previous map when the run fails, and removes the record directory', async () => {
		const seen: Array<string> = []
		const run = vi.fn(async (environment: RecordingEnvironment) => {
			seen.push(environment[test_read_trace.RECORD_DIRECTORY_KEY] ?? '')

			return FAILED
		})

		await expect(test_read_recording.with_read_recording(ROOT, ['run'], run)).resolves.toBe(FAILED)

		expect(test_read_map.write_map).not.toHaveBeenCalled()
		expect(existsSync(seen[0] ?? '')).toBe(false)
	})

	it('hands a run it cannot record no environment and saves nothing', async () => {
		const run = vi.fn(async () => 0)

		await test_read_recording.with_read_recording(ROOT, ['related', 'a.ts', '--run'], run)

		expect(run).toHaveBeenCalledWith({})
		expect(test_read_map.write_map).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#4425: a dirty file's digest is what lets a later run skip it, so it must be the
// content the tests read — an edit made while they ran is a change they never saw.
describe('test_read_recording.with_read_recording — a tree that moves during the run', () => {
	it('records the map with no change when the checkout has no change base', async () => {
		vi.mocked(changed_paths.read_changed_paths).mockRejectedValue(new Error('bad revision'))

		await test_read_recording.with_read_recording(ROOT, ['run'], run_recording)

		expect(test_read_map.write_map).toHaveBeenCalledWith(
			ROOT,
			expect.objectContaining({ commit: HEAD, change: [] }),
		)
	})

	it('records the tree the run started on, not the one an edit during it left', async () => {
		const run = vi.fn(async (environment: RecordingEnvironment) => {
			write_worker_record(environment)
			vi.mocked(git_command.head_commit).mockResolvedValue('moved-head')
			vi.mocked(changed_paths.read_changed_since).mockResolvedValue([DIRTY, 'edited-mid-run.ts'])

			return 0
		})

		await test_read_recording.with_read_recording(ROOT, ['run'], run)

		expect(test_read_map.write_map).toHaveBeenCalledWith(
			ROOT,
			expect.objectContaining({ commit: HEAD, dirty: { [DIRTY]: review_tree.ABSENT_DIGEST } }),
		)
	})
})
