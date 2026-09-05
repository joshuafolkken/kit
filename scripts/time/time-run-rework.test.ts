import { describe, expect, it } from 'vitest'
import { time_batch } from './time-batch'
import { time_pull_index } from './time-pull-index'
import { time_report } from './time-report'
import { time_rework } from './time-rework'
import { time_run } from './time-run'
import { time_run_fixture, type GhScript } from './time-run-fixture'
import { time_transcript_fixture as fixture } from './time-transcript-fixture'

// joshuafolkken/kit#1387, end to end: run #1379 edited `scripts/verification-gate.ts` twice and merged
// a diff that does not name it, and no scope of `josh time` could say so. Its size — 6 files, 254
// additions — was equally invisible, which is why its 27 minutes could not be compared with any other
// run's.
//
// The scripted `gh` and the temporary transcript home are `time-run-fixture.ts`'s, shared with
// `time-run.test.ts` and `time-run-ci.test.ts`: what GitHub answered is one statement, not one per
// suite.

const { CWD, BRANCH, ISSUE, prompt_line, edit_call_line, result_line } = fixture
const { write_session, reader, merged_pull, report_of, pull_file, files_body } = time_run_fixture

time_run_fixture.use_transcript_home()

const ROOT = `${CWD}/`
const DROPPED_PATH = 'scripts/verification-gate.ts'
const KEPT_PATH = 'scripts/time/time-report.ts'
const ADDITIONS = 254
const DELETIONS = 40
const EDIT_ID = 'edit-1'
const SECOND_EDIT_ID = 'edit-2'
const KEPT_EDIT_ID = 'edit-3'

// Two edits of the file that was abandoned, one of the file that landed.
function rework_lines(): Array<string> {
	return [
		prompt_line(0, BRANCH),
		edit_call_line(1, BRANCH, `${ROOT}${DROPPED_PATH}`, EDIT_ID),
		result_line(2, BRANCH, EDIT_ID),
		edit_call_line(3, BRANCH, `${ROOT}${DROPPED_PATH}`, SECOND_EDIT_ID),
		result_line(4, BRANCH, SECOND_EDIT_ID),
		edit_call_line(5, BRANCH, `${ROOT}${KEPT_PATH}`, KEPT_EDIT_ID),
		result_line(6, BRANCH, KEPT_EDIT_ID),
	]
}

const MERGED_DIFF = files_body([pull_file(KEPT_PATH, ADDITIONS, DELETIONS)])

const REWORK_SCRIPT: GhScript = { pull_body: merged_pull(2, 8), files_body: MERGED_DIFF }
const REFUSED_SCRIPT: GhScript = { pull_body: merged_pull(2, 8), is_files_refused: true }

describe('time_run.build_run_report — the edits that never reached the merged diff', () => {
	it('names the file edited twice and absent from the diff', async () => {
		write_session('one', rework_lines())

		const { rework } = await report_of(REWORK_SCRIPT)
		const dropped = rework.files.filter((file) => file.presence === time_rework.DROPPED)

		expect(dropped).toEqual([{ path: DROPPED_PATH, edit_count: 2, presence: time_rework.DROPPED }])
	})

	it('prints it in the report, with the words that say it never landed', async () => {
		write_session('one', rework_lines())

		const text = time_report.format_report(await report_of(REWORK_SCRIPT))
		const line = text.split('\n').find((row) => row.includes(DROPPED_PATH)) ?? ''

		expect(line).toContain(time_rework.DROPPED_SUFFIX)
	})

	it('reports the edit count of the file that did land', async () => {
		write_session('one', rework_lines())

		const { rework } = await report_of(REWORK_SCRIPT)

		expect(rework.files.find((file) => file.path === KEPT_PATH)?.edit_count).toBe(1)
	})

	it('reports the change size read off the merged diff', async () => {
		write_session('one', rework_lines())

		const { rework } = await report_of(REWORK_SCRIPT)

		expect(rework.size).toEqual({
			changed_file_count: 1,
			additions: ADDITIONS,
			deletions: DELETIONS,
		})
	})
})

describe('time_run.build_run_report — a diff read that was refused', () => {
	it('says the size could not be measured rather than reporting zero', async () => {
		write_session('one', rework_lines())

		const { rework } = await report_of(REFUSED_SCRIPT)

		expect(rework.state).toBe(time_rework.DIFF_REFUSED)
		expect(rework.dropped_count).toBe(0)
	})

	it('says so in a note, so the withheld rows have an explanation', async () => {
		write_session('one', rework_lines())

		const { notes } = await report_of(REFUSED_SCRIPT)

		expect(notes.some((note) => time_run.is_diff_read_note(note))).toBe(true)
	})

	it('says nothing about a diff for a run with no merged pull request', async () => {
		write_session('one', rework_lines())

		const { notes } = await report_of({ pull_body: '[]' })

		expect(notes.some((note) => time_run.is_diff_read_note(note))).toBe(false)
	})
})

describe('the batch scopes report the same values per run', () => {
	it('gives --epic and --last the reconciliation --issue gives', async () => {
		write_session('one', rework_lines())

		const read = reader(REWORK_SCRIPT)
		const searches = await time_pull_index.pulls_for_issues([ISSUE], read)
		const [timing] = await time_batch.build_timings({
			numbers: [ISSUE],
			cwd: CWD,
			read,
			searches,
		})
		const direct = await report_of(REWORK_SCRIPT)

		expect(timing?.report.rework).toEqual(direct.rework)
	})
})
