import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { changed_paths } from '#scripts/git/changed-paths'
import { git_command } from '#scripts/git/git-command'
import { test_read_map, type ReadMap } from './test-read-map'
import { test_read_trace } from './test-read-trace'

// When a unit run records the test-read map, and how the records become one. **Only a run of the
// whole suite records**: a map is read as "nothing else reads this file", which a narrowed, sharded
// or filtered run cannot vouch for. **Only a green run replaces the map**: a failed test may have
// stopped before the read it would have made.

type RecordingEnvironment = Record<string, string>

const RUN_SUBCOMMAND = 'run'

// The one flag a whole-suite run still carries — the gate's worker cap, which sizes the run without
// narrowing it.
const WORKER_FLAG_PREFIX = '--maxWorkers'

const RECORD_DIRECTORY_PREFIX = 'josh-test-reads-'

function is_recordable(vitest_arguments: ReadonlyArray<string>): boolean {
	const [subcommand, ...flags] = vitest_arguments

	return subcommand === RUN_SUBCOMMAND && flags.every((flag) => flag.startsWith(WORKER_FLAG_PREFIX))
}

// The tree the run read: the commit, and every file that differed from it.
async function tree_snapshot(): Promise<Pick<ReadMap, 'commit' | 'dirty'>> {
	const commit = await git_command.head_commit()

	return { commit, dirty: await changed_paths.read_changed_since(commit) }
}

// A map that cannot be written — no git, a read-only common directory — leaves the previous map in
// place, and a narrowing over a stale map is refused by the commit it names.
async function save_map(root: string, directory: string): Promise<void> {
	try {
		const snapshot = await tree_snapshot()
		const readers = test_read_map.merge_records(test_read_map.collect_records(directory))

		test_read_map.write_map(root, { version: test_read_map.MAP_VERSION, ...snapshot, readers })
	} catch {
		// The previous map stays; the run's own result is unaffected.
	}
}

async function with_read_recording(
	root: string,
	vitest_arguments: ReadonlyArray<string>,
	run: (environment: RecordingEnvironment) => Promise<number>,
): Promise<number> {
	if (!is_recordable(vitest_arguments)) return await run({})

	const directory = mkdtempSync(path.join(tmpdir(), RECORD_DIRECTORY_PREFIX))

	try {
		const exit_code = await run({
			[test_read_trace.RECORD_DIRECTORY_KEY]: directory,
			[test_read_trace.ROOT_KEY]: root,
		})

		if (exit_code === 0) await save_map(root, directory)

		return exit_code
	} finally {
		rmSync(directory, { recursive: true, force: true })
	}
}

const test_read_recording = { is_recordable, with_read_recording }

export type { RecordingEnvironment }
export { test_read_recording }
