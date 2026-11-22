import { stripVTControlCharacters } from 'node:util'
import { describe, expect, it } from 'vitest'
import { run_board_exit_rain } from './run-board-exit-rain'
import type { Icons } from './run-board-icons'
import type { IntroPorts } from './run-board-intro'

// joshuafolkken/kit#8505: the exit wipe rains away the frame as the board drew it, in its icons.

const { wipe } = run_board_exit_rain
const HALF = 0.5
const RAIN = { random: (): number => HALF, is_colored: (): boolean => true }

async function instant(): Promise<void> {
	await Promise.resolve()
}

// Ports in `icons` that record each write, their rain pinned and their pauses instant.
function recorded(icons: Icons): { written: Array<string>; ports: IntroPorts } {
	const written: Array<string> = []

	return {
		written,
		ports: {
			write: (text) => {
				written.push(text)
			},
			intro_sleep: instant,
			rain: RAIN,
			icons,
		},
	}
}

describe('run_board_exit_rain.wipe in its icons', () => {
	it.each([
		['letters', 'RN', '>>'],
		['shapes', '>>', 'RN'],
	] as const)('wipes the matrix frame drawn in %s (#8505)', async (icons, drawn, other) => {
		const { written, ports } = recorded(icons)

		await wipe('🔄 run', ports, { folded: undefined }, 'matrix')
		const text = stripVTControlCharacters(written.join(''))

		expect(text).toContain(drawn)
		expect(text).not.toContain(other)
	})
})
