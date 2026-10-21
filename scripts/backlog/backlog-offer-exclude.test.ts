import { describe, expect, it } from 'vitest'
import { backlog_offer_exclude } from './backlog-offer-exclude'

describe('backlog_offer_exclude.exclude_of', () => {
	it('joins the merged and in-flight issues once each', () => {
		expect(backlog_offer_exclude.exclude_of(['1', '2'], ['2', '3'])).toStrictEqual(['1', '2', '3'])
	})
})

describe('backlog_offer_exclude.exclude_argv', () => {
	it('passes the list as one comma-separated flag', () => {
		expect(backlog_offer_exclude.exclude_argv(['1', '2'])).toStrictEqual(['--exclude', '1,2'])
	})

	it('passes no flag for an empty list', () => {
		expect(backlog_offer_exclude.exclude_argv([])).toStrictEqual([])
	})
})
