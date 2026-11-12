import { describe, expect, it } from 'vitest'
import { parseCLI } from 'vitest/node'
import { unit_update_arguments } from './unit-update-arguments'

const FILTER = 'run-transcript'
const SHORT_FLAG = '-u'
const LONG_FLAG = '--update'
const COVERAGE_FLAG = '--coverage'

describe('unit_update_arguments.reorder — a filter after the update flag (#5383)', () => {
	it('moves a filter after -u in front of the flag', () => {
		expect(unit_update_arguments.reorder([SHORT_FLAG, FILTER])).toStrictEqual({
			arguments: [FILTER, SHORT_FLAG],
			filter: FILTER,
		})
	})

	it('moves all consecutive filters before --update and preserves surrounding options', () => {
		const reporter = '--reporter=dot'
		const result = unit_update_arguments.reorder([
			reporter,
			LONG_FLAG,
			FILTER,
			'other',
			COVERAGE_FLAG,
		])

		expect(result).toStrictEqual({
			arguments: [reporter, FILTER, 'other', LONG_FLAG, COVERAGE_FLAG],
			filter: FILTER,
		})
		const parsed = parseCLI(['vitest', ...result.arguments])

		expect(parsed.filter).toStrictEqual([FILTER, 'other'])
		expect(parsed.options.update).toBe(true)
	})

	it('keeps the end-of-options delimiter after the update flag', () => {
		const result = unit_update_arguments.reorder([SHORT_FLAG, FILTER, '--', 'other'])

		expect(result.arguments).toStrictEqual([FILTER, SHORT_FLAG, '--', 'other'])
	})
})

describe('unit_update_arguments.reorder — arguments passed as they are', () => {
	it.each(['all', 'new', 'none', 'true', 'false'])('passes the update type %s through', (type) => {
		const vitest_arguments = [SHORT_FLAG, type, FILTER]

		expect(unit_update_arguments.reorder(vitest_arguments)).toStrictEqual({
			arguments: vitest_arguments,
		})
	})

	it.each([[[SHORT_FLAG]], [[SHORT_FLAG, COVERAGE_FLAG]], [[FILTER]], [['--update=all', FILTER]]])(
		'leaves %j unchanged',
		(vitest_arguments) => {
			expect(unit_update_arguments.reorder(vitest_arguments)).toStrictEqual({
				arguments: vitest_arguments,
			})
		},
	)
})

describe('unit_update_arguments.reorder — repeated flags and delimiters', () => {
	it.each([
		[LONG_FLAG, 'all', SHORT_FLAG, FILTER],
		[SHORT_FLAG, LONG_FLAG, FILTER],
		[SHORT_FLAG, 'first-filter', LONG_FLAG, FILTER],
	])('keeps every filter when update flags repeat: %j', (...vitest_arguments) => {
		const result = unit_update_arguments.reorder(vitest_arguments)
		const parsed = parseCLI(['vitest', ...result.arguments])

		expect(parsed.filter).toContain(FILTER)
		expect(parsed.options.update).toBeTruthy()
	})

	it('leaves words after the end-of-options delimiter untouched', () => {
		const vitest_arguments = ['--', SHORT_FLAG, FILTER]

		expect(unit_update_arguments.reorder(vitest_arguments)).toStrictEqual({
			arguments: vitest_arguments,
		})
	})
})

describe('unit_update_arguments.notice', () => {
	it('names the moved filter', () => {
		expect(unit_update_arguments.notice(FILTER)).toContain(`"${FILTER}"`)
	})
})
