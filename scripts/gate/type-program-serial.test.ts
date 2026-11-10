import { setTimeout as next_tick } from 'node:timers/promises'
import { describe, expect, it } from 'vitest'
import { gate_labels } from './gate-labels'
import { type_program_serial } from './type-program-serial'

const LINT = gate_labels.LINT_LABEL
const CHECK = gate_labels.TYPE_CHECK_LABEL
const SPELL = gate_labels.SPELL_CHECK_LABEL

// A step that logs its start and end, and ends a timer turn later when it is slow.
function logged_step(events: Array<string>, name: string, is_slow: boolean): () => Promise<string> {
	return async (): Promise<string> => {
		events.push(`start:${name}`)
		if (is_slow) await next_tick(0)
		events.push(`end:${name}`)

		return name
	}
}

// joshuafolkken/kit#7031: one lane held the tsc and the type-aware ESLint programs at once.
describe('serial_runner', () => {
	it('starts the type check only after the lint has ended', async () => {
		const serial = type_program_serial.serial_runner()
		const events: Array<string> = []

		const results = await Promise.all([
			serial(LINT, logged_step(events, LINT, true)),
			serial(CHECK, logged_step(events, CHECK, false)),
		])

		expect(results).toStrictEqual([LINT, CHECK])
		expect(events).toStrictEqual([`start:${LINT}`, `end:${LINT}`, `start:${CHECK}`, `end:${CHECK}`])
	})

	it('runs any other check beside a running type-program check', async () => {
		const serial = type_program_serial.serial_runner()
		const events: Array<string> = []

		await Promise.all([
			serial(LINT, logged_step(events, LINT, true)),
			serial(SPELL, logged_step(events, SPELL, false)),
		])

		expect(events.indexOf(`end:${SPELL}`)).toBeLessThan(events.indexOf(`end:${LINT}`))
	})

	it('runs the next type-program check after one that failed', async () => {
		const serial = type_program_serial.serial_runner()
		const crash = 'lint crashed'
		const failed = serial(LINT, async (): Promise<string> => {
			throw new Error(crash)
		})
		const check = serial(CHECK, async (): Promise<string> => CHECK)

		await expect(failed).rejects.toThrow(crash)
		expect(await check).toBe(CHECK)
	})
})
