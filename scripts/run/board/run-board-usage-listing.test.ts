import { lane_process_table } from '#scripts/lane/lane-process-table'
import { describe, expect, it } from 'vitest'
import { run_board_usage_listing } from './run-board-usage-listing'

// joshuafolkken/kit#4246: the usage columns read the snapshot the lane count reads, so each process's
// executable is cut from its full command line rather than read from a `comm` column of their own.

const { executable_of, listings_of } = run_board_usage_listing
const KB = 1024
// Rooted where nothing exists, so the cut falls to the text rather than to an installed app.
const ABSENT = '/kit-absent-4246'
const CHROME = `${ABSENT}/Applications/Google Chrome.app/Contents/MacOS`
const CODE = `${ABSENT}/Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper.app/Contents/MacOS`

describe('run_board_usage_listing.executable_of', () => {
	it('reads a relative command as its first word', () => {
		expect(executable_of('eslint_d - /tmp')).toBe('eslint_d')
		expect(executable_of('node')).toBe('node')
	})

	it('reads an absolute path up to its arguments', () => {
		expect(executable_of('/bin/sh -c pnpm josh gate')).toBe('/bin/sh')
		expect(executable_of('/usr/local/bin/node script.js')).toBe('/usr/local/bin/node')
	})

	it('ends an existing absolute executable before a relative path argument', () => {
		const node = process.execPath

		expect(executable_of(`${node} scripts/foo.ts`)).toBe(node)
		expect(executable_of(`${node} scripts/foo.ts lib/bar`)).toBe(node)
	})

	it('keeps the spaces of a directory the path runs through', () => {
		const support = `${ABSENT}/Library/Application Support/app/bin/helper`

		expect(executable_of(`${support} serve`)).toBe(support)
	})

	it('cuts a file name with a space of its own at it, the bundle that names the app kept whole', () => {
		expect(executable_of(`${CHROME}/Google Chrome --type=renderer`)).toBe(`${CHROME}/Google`)
		expect(executable_of(`${CODE}/Code Helper --type=gpu`)).toBe(`${CODE}/Code`)
		expect(executable_of(`${CODE}/Code Helper /Users/me/project`)).toBe(`${CODE}/Code`)
	})
})

describe('run_board_usage_listing.listings_of', () => {
	it('reads each row’s parent, CPU time, resident memory, state and executable', () => {
		const table = lane_process_table.parse(
			[
				`12 1 1-02:03:04 2048 S ${CHROME} --type=gpu`,
				'13 12 12:34.50 100 TN+ node',
				'14 12 0:00.01 4 S eslint_d - /tmp',
			].join('\n'),
		)
		const listings = listings_of(table)

		expect(listings.get(12)).toStrictEqual({
			parent: 1,
			command: CHROME,
			cpu_ms: 93_784_000,
			rss_bytes: 2048 * KB,
			stat: 'S',
		})
		expect(listings.get(13)).toMatchObject({ cpu_ms: 754_500, stat: 'TN+' })
		expect(listings.get(14)?.command).toBe('eslint_d')
	})

	it('leaves out a row whose CPU time does not read', () => {
		const table = lane_process_table.parse('12 1 never 4 S node\n13 1 0:01 4 S node')

		expect([...listings_of(table).keys()]).toStrictEqual([13])
	})
})
