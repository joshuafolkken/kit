import { describe, expect, it, vi } from 'vitest'
import { run_board_intro, type IntroPorts } from './run-board-intro'
import type { KeyReading } from './run-board-keys'
import { run_board_sound_typing } from './run-board-sound-typing'
import { run_board_theme_defs } from './run-board-theme-defs'

// joshuafolkken/kit#8250: the trill sounds while the opening line types and stops once the letters end —
// typed through or skipped by a key — so the hold after them is silent; ports without pauses type
// nothing and sound nothing.

const { play } = run_board_intro
const THEME = 'wargames'
const {
	line: LINE,
	letter_ms: LETTER_MS,
	hold_ms: HOLD_MS,
} = run_board_theme_defs.THEME_DEFS[THEME].intro
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
		await play(ports, NO_KEYS, THEME)
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
		const pending = play(ports, keys, THEME)

		taken.on_key?.()
		await pending
		expect(events).toStrictEqual(['on', 'write', 'off'])
	})

	it('sounds nothing where the ports carry no pauses', async () => {
		const { events, ports } = trilling(undefined)

		await play(ports, NO_KEYS, THEME)
		expect(events).toStrictEqual([])
	})
})

describe('run_board_intro.play sound preparation', () => {
	it('finishes first-time generation and starts the player before the first letter (ac-80d8c293)', async () => {
		const { events, ports } = trilling(vi.fn().mockResolvedValue(undefined))
		const sound = run_board_sound_typing.typing_sound({
			file: () => {
				events.push('generated')

				return 'prepared.wav'
			},
			start: () => {
				events.push('started')
			},
		})

		await play({ ...ports, typing_sound: sound }, NO_KEYS, THEME)

		expect(events.slice(0, 3)).toStrictEqual(['generated', 'started', 'write'])
	})

	it('continues the opening when generation fails (ac-5f93dd5e)', async () => {
		const { events, ports } = trilling(vi.fn().mockResolvedValue(undefined))
		const sound = run_board_sound_typing.typing_sound({
			file: () => undefined,
			start: () => {
				events.push('started')
			},
		})

		await play({ ...ports, typing_sound: sound }, NO_KEYS, THEME)

		expect(events).not.toContain('started')
		expect(events).toHaveLength(LINE.length + 1)
	})
})
