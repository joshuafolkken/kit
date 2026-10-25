import { time_transcript_fixture } from '#tools/time/time-transcript-fixture'
import { describe, expect, it } from 'vitest'
import { investigation_reads } from './investigation-reads'

// joshuafolkken/kit#4946: a session resumed after the implementation cut starts a new transcript, so
// the files an earlier session wrote hold no write in it — the branch diff is what names them.

const { target_turn_lines } = time_transcript_fixture

const NEVER_REFUSED_MS = 0
const CHANGED_FILE = 'scripts/changed.ts'
const UNCHANGED_FILE = 'scripts/unchanged.ts'
const resolve = investigation_reads.resolved

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
