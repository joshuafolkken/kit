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

describe('process_directories.is_within', () => {
	it('answers the directory itself and anything under it, never a sibling sharing its prefix', () => {
		expect(process_directories.is_within(LANE, LANE)).toBe(true)
		expect(process_directories.is_within(`${LANE}/packages/app`, LANE)).toBe(true)
		expect(process_directories.is_within(`${LANE}0`, LANE)).toBe(false)
		expect(process_directories.is_within('/Users/me/Development/kit', LANE)).toBe(false)
	})
})

describe('process_directories.list_all', () => {
	it('lists nothing on a platform the board does not read', () => {
		expect(process_directories.list_all('linux')).toStrictEqual(new Map())
	})
})
