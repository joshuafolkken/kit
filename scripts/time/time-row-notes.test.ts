import { describe, expect, it } from 'vitest'
import { time_row_notes } from './time-row-notes'
import { time_run_fixture, type GhScript } from './time-run-fixture'
import { time_transcript_fixture as fixture } from './time-transcript-fixture'

// The batch rows print a child's own notes only where the GitHub half is missing, so a note about a
// *completed* child has to be named to survive that filter (joshuafolkken/kit#1352). The session
// notes are the fourth to need it (joshuafolkken/kit#1428): a row whose minutes came from two
// sessions is exactly a row a reader cannot check.
const { write_session, report_of } = time_run_fixture
const NO_PULL_SCRIPT: GhScript = { pull_body: '[]' }
const NOTE_SEPARATOR = '\n'

time_run_fixture.use_transcript_home()

async function kept_notes(): Promise<string> {
	const report = await report_of(NO_PULL_SCRIPT)

	return report.notes.filter((note) => time_row_notes.is_kept_note(note)).join(NOTE_SEPARATOR)
}

describe('time_row_notes.is_kept_note', () => {
	it('keeps the note naming the concurrent session a row left out', async () => {
		write_session('ran', fixture.run_lines(0))
		write_session('other', fixture.concurrent_lines())

		expect(await kept_notes()).toContain('concurrent session(s) left out')
	})

	it('keeps the note saying the row could not be separated from the sessions beside it', async () => {
		write_session('one', fixture.issue_lines(0))
		write_session('other', fixture.concurrent_lines())

		expect(await kept_notes()).toContain('could not be separated from them')
	})

	// The transcript count is not one of them: it says nothing a row's own columns do not, and letting
	// it through would bury the notes that do.
	it('drops the transcript count a completed row already accounts for', () => {
		expect(time_row_notes.is_kept_note('2 transcript(s)')).toBe(false)
	})
})
