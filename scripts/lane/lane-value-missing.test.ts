import { describe, expect, it } from 'vitest'
import { lane_value_missing } from './lane-value-missing'

const SINCE = 'since 2026-11-01T00:00:00.000Z'

describe('lane_value_missing.is_unsampled', () => {
	it.each([
		`josh lane:value cell: no numeric cell ${SINCE}`,
		`Command failed\njosh lane:value merges: no sample ${SINCE}`,
	])('reads %j as no sample yet', (text) => {
		expect(lane_value_missing.is_unsampled(text)).toBe(true)
	})

	it.each([
		'exit 1',
		'josh lane:value: unknown metric',
		'no sample',
		`josh lane:value cell: several numeric cells ${SINCE}`,
	])('reads %j as some other failure', (text) => {
		expect(lane_value_missing.is_unsampled(text)).toBe(false)
	})
})
