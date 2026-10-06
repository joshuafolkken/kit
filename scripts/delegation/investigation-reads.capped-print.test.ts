import { tmpdir } from 'node:os'
import path from 'node:path'
import { capped_print_part } from '#scripts/document/capped-print-part'
import { time_transcript_fixture } from '#scripts/time/time-transcript-fixture'
import { describe, expect, it } from 'vitest'
import { investigation_reads } from './investigation-reads'

// joshuafolkken/kit#3332. `doc:section` / `doc:read` hand an over-cap output back as part files and
// tell the run to Read them — the run's own instructions arriving by another path, so a read of one is
// not the subject either. The shape is the part's own name under the directory the command made.

const { BRANCH, josh_call_line, result_line } = time_transcript_fixture

const READ_MINUTE = 9
const BASH_ID = 'bash-call'
const PART_DIRECTORY = path.join(tmpdir(), `${capped_print_part.DIRECTORY_PREFIX}AbC123`)
const PART = path.join(PART_DIRECTORY, capped_print_part.part_name(1))

function bash_text(command: string): string {
	return [
		josh_call_line(READ_MINUTE, BRANCH, command, BASH_ID),
		result_line(READ_MINUTE + 1, BRANCH, BASH_ID),
	].join('\n')
}

describe('investigation_reads — a capped-print part is not the subject', () => {
	it('does not count a part the command wrote', () => {
		expect(investigation_reads.is_subject_file(PART)).toBe(false)
		expect(
			investigation_reads.is_refusable_call({ name: 'Read', input: { file_path: PART } }),
		).toBe(false)
		expect(investigation_reads.tally_of(bash_text(`cat ${PART}`)).pending).toEqual([])
	})

	it.each([
		path.join(PART_DIRECTORY, 'notes.md'),
		path.join(tmpdir(), 'other-directory', capped_print_part.part_name(1)),
		path.join('scripts', `${capped_print_part.DIRECTORY_PREFIX}x`, capped_print_part.part_name(0)),
	])('still counts %s, which is not a part the command wrote', (target) => {
		expect(investigation_reads.is_subject_file(target)).toBe(true)
	})
})
