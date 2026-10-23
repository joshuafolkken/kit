import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { process_directories } from './process-directories'

// The one reading of `lsof`'s working directories — `run:board` draws a lane's processes from it and
// `lane:close` ends what still runs from the lane's checkout (joshuafolkken/kit#4304).

const LANE = '/Users/me/Development/.kit-lanes/3423'

describe('process_directories.parse', () => {
	it('reads each process’s working directory from lsof’s fields', () => {
		const output = ['p12', 'fcwd', `n${LANE}/packages/app`, 'p13', 'fcwd', 'n/tmp'].join('\n')

		expect(process_directories.parse(output)).toStrictEqual(
			new Map([
				[12, `${LANE}/packages/app`],
				[13, '/tmp'],
			]),
		)
	})
})

describe('process_directories.lane_of', () => {
	const root = path.dirname(LANE)

	it('finds the lane a directory sits under at any depth, and none outside a lane', () => {
		expect(process_directories.lane_of(LANE, root)).toBe('3423')
		expect(process_directories.lane_of(`${LANE}/packages/app/src`, root)).toBe('3423')
		expect(process_directories.lane_of(path.dirname(root), root)).toBeUndefined()
	})

	it('finds no lane under another repository’s lanes root of the same number', () => {
		const other = '/Users/me/Development/.app-kit-lanes/3423/src'

		expect(process_directories.lane_of(other, root)).toBeUndefined()
	})
})

describe('process_directories.list_all', () => {
	it('lists nothing on a platform the board does not read', () => {
		expect(process_directories.list_all('linux')).toStrictEqual(new Map())
	})
})
