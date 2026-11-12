import { describe, expect, it } from 'vitest'
import { process_lane_marks } from './process-lane-marks'

// joshuafolkken/kit#4315: the mark a lane child's processes inherit, read from `ps -E` — the
// environment after the command line, never the command line itself.

const BOARD = 'script -q /dev/null node --import tsx scripts/josh/josh.ts run:board'
const SEARCH = 'grep JOSH_LANE_CHILD=42 notes.md'
const DOCKER = '/Applications/Docker.app/Contents/MacOS/Docker Desktop'

function listing(rows: ReadonlyArray<readonly [number, string]>): string {
	return rows.map(([pid, line]) => `${String(pid).padStart(6)} ${line}`).join('\n')
}

describe('process_lane_marks.parse', () => {
	it('reads the issue a process inherited from its environment', () => {
		const plain = listing([
			[66_330, BOARD],
			[66_331, 'node scripts/josh/josh.ts run:board'],
		])
		const with_environment = listing([
			[66_330, `${BOARD} HOME=/Users/me JOSH_LANE_CHILD=42 PATH=/bin`],
			[66_331, 'node scripts/josh/josh.ts run:board JOSH_LANE_CHILD=4315'],
		])

		expect(process_lane_marks.parse(plain, with_environment)).toStrictEqual(
			new Map([
				[66_330, '42'],
				[66_331, '4315'],
			]),
		)
	})

	it('never reads a mark from the arguments, a blank value or an unmarked environment', () => {
		const plain = listing([
			[1, SEARCH],
			[2, 'node a.js'],
			[3, 'node b.js'],
		])
		const with_environment = listing([
			[1, `${SEARCH} HOME=/Users/me`],
			[2, 'node a.js JOSH_LANE_CHILD= PATH=/bin'],
			[3, 'node b.js PATH=/bin'],
		])

		expect(process_lane_marks.parse(plain, with_environment)).toStrictEqual(new Map())
	})
})

describe('process_lane_marks.parse — what is never the lane’s', () => {
	it('never marks an application bundle, nor a process the two listings disagree on', () => {
		const plain = listing([
			[16_651, DOCKER],
			[5, 'node old.js'],
		])
		const with_environment = listing([
			[16_651, `${DOCKER} JOSH_LANE_CHILD=255`],
			[5, 'node new.js JOSH_LANE_CHILD=42'],
			[6, 'node gone.js JOSH_LANE_CHILD=42'],
		])

		expect(process_lane_marks.parse(plain, with_environment)).toStrictEqual(new Map())
	})
})

describe('process_lane_marks.list_all', () => {
	it('lists nothing on a platform the marks are not read on', () => {
		expect(process_lane_marks.list_all('win32')).toStrictEqual(new Map())
	})
})
