import { styleText } from 'node:util'
import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { describe, expect, it } from 'vitest'
import { run_board_header_time } from './run-board-header-time'

const { aged } = run_board_header_time
const PART = '💓 0:16:00'
const STALE_MINUTES = 15
const ALARM_MINUTES = 30

describe('run_board_header_time.aged', () => {
	it('leaves a part plain up to fifteen minutes old', () => {
		expect(aged(PART, STALE_MINUTES * MS_PER_MINUTE)).toBe(PART)
	})

	it('draws a part past fifteen minutes old in yellow', () => {
		expect(aged(PART, STALE_MINUTES * MS_PER_MINUTE + 1)).toBe(styleText('yellow', PART))
		expect(aged(PART, ALARM_MINUTES * MS_PER_MINUTE)).toBe(styleText('yellow', PART))
	})

	it('draws a part past thirty minutes old in red', () => {
		expect(aged(PART, ALARM_MINUTES * MS_PER_MINUTE + 1)).toBe(styleText('red', PART))
	})
})
