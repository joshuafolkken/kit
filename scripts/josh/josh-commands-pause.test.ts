import { describe, expect, it } from 'vitest'
import { COMMAND_MAP } from './josh-command-map'
import { PAUSE_COMMANDS } from './josh-commands-pause'

describe('PAUSE_COMMANDS', () => {
	it('reaches the command map with every entry intact', () => {
		const missing = Object.entries(PAUSE_COMMANDS).filter(
			([name, entry]) => COMMAND_MAP[name] !== entry,
		)

		expect(missing).toEqual([])
	})
})
