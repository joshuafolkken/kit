import { rmSync } from 'node:fs'
import path from 'node:path'
import { stamp_file } from '#scripts/josh/stamp-file'
import { lane_state, type LaneStateRecord } from '#scripts/lane/lane-state'
import { lane_state_record } from '#scripts/lane/lane-state-record'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_records } from './run-board-records'

const REPOSITORY = '/repo/.git'
const CHANGED_AT = '2026-11-19T00:00:00.000Z'
const create_folder = temporary_directory()

interface Records {
	write: (issue: string, state: LaneStateRecord['state']) => void
	remove: (issue: string) => void
	list: (...issues: Array<string>) => void
}

function record(issue: string, state: LaneStateRecord['state']): LaneStateRecord {
	return { issue, state, changed_at: CHANGED_AT, changed_by: 'lane:close' }
}

// The records listed are files in a temporary folder: never a real record from a test.
function arrange(): Records {
	const folder = create_folder('run-board-records-')

	function file_of(issue: string): string {
		return path.join(folder, lane_state_record.record_name(REPOSITORY, issue))
	}

	run_board_records.clear()
	vi.spyOn(lane_state, 'state_path').mockImplementation((_directory, issue) => file_of(issue))
	vi.spyOn(lane_state, 'recorded_issues').mockReturnValue([])
	vi.spyOn(lane_state_record, 'read_record_file')

	return {
		write: (issue, state) => {
			stamp_file.replace_stamp(file_of(issue), record(issue, state))
		},
		remove: (issue) => {
			rmSync(file_of(issue))
		},
		list: (...issues) => vi.mocked(lane_state.recorded_issues).mockReturnValue(issues),
	}
}

function read(): Array<LaneStateRecord> {
	return run_board_records.read_records(REPOSITORY)
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_board_records.read_records — re-reads only the records whose files changed', () => {
	it('does not read an unchanged record again, and returns the same records', () => {
		const records = arrange()

		records.write('1', 'ended')
		records.list('1')
		const first = read()

		vi.mocked(lane_state_record.read_record_file).mockClear()

		expect(read()).toEqual(first)
		expect(lane_state_record.read_record_file).not.toHaveBeenCalled()
	})

	it('reads a rewritten record anew', () => {
		const records = arrange()

		records.write('1', 'running')
		records.list('1')
		read()
		records.write('1', 'ended')

		expect(read()).toEqual([record('1', 'ended')])
	})

	it('adds a record that appeared since the last read', () => {
		const records = arrange()

		records.write('1', 'ended')
		records.list('1')
		read()
		records.write('2', 'running')
		records.list('1', '2')

		expect(read()).toEqual([record('1', 'ended'), record('2', 'running')])
	})
})

describe('run_board_records.read_records — holds no more than the records on disk', () => {
	it('drops a removed record from the result and from the cache', () => {
		const records = arrange()

		records.write('1', 'ended')
		records.write('2', 'ended')
		records.list('1', '2')
		read()
		records.remove('2')
		records.list('1')

		expect(read()).toEqual([record('1', 'ended')])
		expect(run_board_records.cached_count(REPOSITORY)).toBe(1)
	})

	it('drops a record listed but gone before its file was read', () => {
		const records = arrange()

		records.write('1', 'ended')
		records.list('1', '2')

		expect(read()).toEqual([record('1', 'ended')])
		expect(run_board_records.cached_count(REPOSITORY)).toBe(1)
	})
})
