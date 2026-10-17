import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { changed_paths } from '#scripts/git/changed-paths'
import { git_command } from '#scripts/git/git-command'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { test_read_map } from './test-read-map'
import { test_read_recording, type RecordingEnvironment } from './test-read-recording'
import { test_read_trace } from './test-read-trace'

// joshuafolkken/kit#4065: only a green run of the whole suite may replace the map, because a map
// entry is read as "nothing else reads this file".

vi.mock('#scripts/git/git-command', () => ({ git_command: { head_commit: vi.fn() } }))
vi.mock('#scripts/git/changed-paths', () => ({ changed_paths: { read_changed_since: vi.fn() } }))

const ROOT = path.resolve('/repo')
const HEAD = 'cafe1234'
const DIRTY = 'notes.md'
const DOCUMENT = path.join('docs', 'a.md')
const READER = 'reader.ts'
const FAILED = 1

function write_worker_record(environment: RecordingEnvironment): void {
	const directory = environment[test_read_trace.RECORD_DIRECTORY_KEY] ?? ''

	writeFileSync(path.join(directory, '1-1-1.json'), JSON.stringify({ [DOCUMENT]: [READER] }))
}

beforeEach(() => {
	vi.clearAllMocks()
	vi.mocked(git_command.head_commit).mockResolvedValue(HEAD)
	vi.mocked(changed_paths.read_changed_since).mockResolvedValue([DIRTY])
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
			dirty: [DIRTY],
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
