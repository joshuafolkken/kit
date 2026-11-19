import { describe, expect, it } from 'vitest'
import { run_board_intro, type IntroPorts } from './run-board-intro'
import type { KeyReading } from './run-board-keys'

// joshuafolkken/kit#8250: the trill sounds while the opening line types and stops once the letters end —
// typed through or skipped by a key — so the hold after them is silent; ports without pauses type
// nothing and sound nothing.

const { HOLD_MS, LETTER_MS, LINE, play } = run_board_intro
const NO_KEYS: KeyReading = { folded: undefined }

function trilling(intro_sleep: ((ms: number) => Promise<void>) | undefined): {
	events: Array<string>
	ports: IntroPorts
} {
	const events: Array<string> = []
	const ports: IntroPorts = {
		write: () => {
			events.push('write')
		},
		typing_sound: {
			set: (is_on) => {
				events.push(is_on ? 'on' : 'off')
			},
			stop: () => {
				events.push('stop')
			},
		},
	}

	if (intro_sleep === undefined) return { events, ports }

	return { events, ports: { ...ports, intro_sleep } }
}

async function recorded_sleep(events: Array<string>, ms: number): Promise<void> {
	events.push(`sleep ${String(ms)}`)
	await Promise.resolve()
}

function released(): void {
	// the skip holds the keys only while the line plays
}

function pending_sleep(): Promise<void> {
	return new Promise<void>(() => {
		// never settles: only the key ends the pause
	})
}

describe('run_board_intro.play trill', () => {
	it('sounds through the letters and stops before the hold', async () => {
		const held: { events: Array<string> } = { events: [] }
		const { events, ports } = trilling(async (ms) => {
			await recorded_sleep(held.events, ms)
		})

		held.events = events
		await play(ports, NO_KEYS)
		const letters = Array.from(LINE, () => ['write', `sleep ${String(LETTER_MS)}`]).flat()

		expect(events).toStrictEqual(['on', ...letters, 'off', 'write', `sleep ${String(HOLD_MS)}`])
	})

	it('stops when a key skips the letters', async () => {
		const taken: { on_key: (() => void) | undefined } = { on_key: undefined }
		const keys: KeyReading = {
			folded: undefined,
			intercept: (on_key) => {
				taken.on_key = on_key

				return released
			},
		}
		const { events, ports } = trilling(pending_sleep)
		const pending = play(ports, keys)

		taken.on_key?.()
		await pending
		expect(events).toStrictEqual(['on', 'write', 'off'])
	})

	it('sounds nothing where the ports carry no pauses', async () => {
		const { events, ports } = trilling(undefined)

		await play(ports, NO_KEYS)
		expect(events).toStrictEqual([])
	})
})
