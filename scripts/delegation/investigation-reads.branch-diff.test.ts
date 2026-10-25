import { changed_paths_sync } from '#scripts/git/changed-paths-sync'
import { time_transcript_fixture } from '#tools/time/time-transcript-fixture'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { delegation_policy } from './delegation-policy'
import { investigation_reads } from './investigation-reads'

// joshuafolkken/kit#4946: a session resumed after the implementation cut starts a new transcript, so
// the files an earlier session wrote hold no write in it — the branch diff is what names them.

const { target_turn_lines } = time_transcript_fixture

const NEVER_REFUSED_MS = 0
const CHANGED_FILE = 'scripts/changed.ts'
const UNCHANGED_FILE = 'scripts/unchanged.ts'
const NEXT_FILE = 'scripts/next.ts'
const resolve = investigation_reads.resolved
// One read short of the threshold, the changed file among them, so the next fresh read is the boundary.
const AT_THRESHOLD_FILES = [
	CHANGED_FILE,
	...Array.from(
		{ length: delegation_policy.INVESTIGATION_FILE_THRESHOLD - 2 },
		(_unused, index) => `scripts/read-${String(index)}.ts`,
	),
]
const AT_THRESHOLD_TEXT = target_turn_lines(0, AT_THRESHOLD_FILES).join('\n')
const NEXT_READ = { name: 'Read', input: { file_path: NEXT_FILE } }

afterEach(() => {
	vi.restoreAllMocks()
})

describe('investigation_reads.should_block — the branch’s own change', () => {
	it('refuses at the threshold where the branch changed none of the reads', () => {
		vi.spyOn(changed_paths_sync, 'read_changed_paths').mockReturnValue([])

		expect(investigation_reads.should_block(AT_THRESHOLD_TEXT, NEXT_READ, NEVER_REFUSED_MS)).toBe(
			true,
		)
	})

	it('lets the read through where the branch changed one of them', () => {
		vi.spyOn(changed_paths_sync, 'read_changed_paths').mockReturnValue([CHANGED_FILE])

		expect(investigation_reads.should_block(AT_THRESHOLD_TEXT, NEXT_READ, NEVER_REFUSED_MS)).toBe(
			false,
		)
	})

	it('asks git nothing where the transcript alone lets the call through', () => {
		const read = vi.spyOn(changed_paths_sync, 'read_changed_paths')

		expect(investigation_reads.should_block('', NEXT_READ, NEVER_REFUSED_MS)).toBe(false)
		expect(read).not.toHaveBeenCalled()
	})
})

describe('investigation_reads.tally_of — the branch’s own change', () => {
	it('does not count a re-read of a file the branch already changed', () => {
		const text = target_turn_lines(0, [CHANGED_FILE, UNCHANGED_FILE]).join('\n')
		const tally = investigation_reads.tally_of(text, NEVER_REFUSED_MS, [CHANGED_FILE])

		expect(tally.pending).toEqual([resolve(UNCHANGED_FILE)])
		expect(tally.edited.has(resolve(CHANGED_FILE))).toBe(true)
	})

	it('counts every read where the branch changed nothing', () => {
		const text = target_turn_lines(0, [CHANGED_FILE, UNCHANGED_FILE]).join('\n')

		expect(investigation_reads.tally_of(text, NEVER_REFUSED_MS, []).pending).toEqual([
			resolve(CHANGED_FILE),
			resolve(UNCHANGED_FILE),
		])
	})
})
