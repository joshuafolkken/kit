import { styleText } from 'node:util'
import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { describe, expect, it } from 'vitest'
import { run_board_header_time } from './run-board-header-time'
import { run_board_row_key } from './run-board-row-key'

const { aged, now_text } = run_board_header_time
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

// joshuafolkken/kit#8103: where the board types rows, the third line's words carry their own key after
// the icon, so they type when they change and not when the time alone does.
describe('run_board_header_time.now_text', () => {
	const NOW_MS = Date.parse('2026-11-19T09:00:00.000Z')
	const NOW = { icon: '>', age_ms: 5000, text: '#8093 · WRITE' }

	function header_of(is_keyed?: boolean): Parameters<typeof now_text>[1] {
		const activity = { last_event_ms: NOW_MS, outage: undefined, is_stopped: false }

		return {
			now_ms: NOW_MS,
			started_ms: NOW_MS,
			ended_ms: undefined,
			activity,
			spinner: undefined,
			form: 'screen',
			is_keyed,
		}
	}

	it('keys the words, not the icon, where the board types rows', () => {
		const split = run_board_row_key.split_key(now_text(NOW, header_of(true)))

		expect(split.key).toBe(`now:${NOW.text}`)
		expect(split.prefix).toBe('> ')
		expect(split.text).toBe(now_text(NOW, header_of()))
	})

	it('draws the words as before, with no key, where the board types no rows', () => {
		expect(now_text(NOW, header_of())).toBe(`> ${NOW.text}`)
		expect(now_text(NOW, header_of(false))).toBe(now_text(NOW, header_of()))
	})
})
