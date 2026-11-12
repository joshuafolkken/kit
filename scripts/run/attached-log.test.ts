import { describe, expect, it } from 'vitest'
import { attached_log } from './attached-log'

const AT = '2026-10-30T14:00:00.000Z'
const LATER = '2026-10-30T14:00:05.000Z'

describe('attached_log.stamped_line', () => {
	it('records an undated Codex event without changing its payload', () => {
		const event = { type: 'item.started', item: { type: 'command_execution', command: 'ls' } }
		const line = attached_log.stamped_line(JSON.stringify(event), AT)

		expect(JSON.parse(line)).toStrictEqual({
			...event,
			timestamp: AT,
		})
	})

	it('preserves the original event time on a dated log', () => {
		const event = { type: 'assistant', timestamp: AT, message: { content: [] } }
		const line = attached_log.stamped_line(JSON.stringify(event), LATER)

		expect(JSON.parse(line)).toStrictEqual(event)
	})

	it.each(['plain stderr', '{"type":', 'null'])('preserves non-event output %s', (line) => {
		expect(attached_log.stamped_line(line, AT)).toBe(line)
	})
})
