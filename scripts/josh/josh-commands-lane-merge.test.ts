import { describe, expect, it } from 'vitest'
import { COMMAND_MAP } from './josh-command-map'
import { LANE_MERGE_COMMANDS } from './josh-commands-lane-merge'

describe('LANE_MERGE_COMMANDS', () => {
	it('reaches the command map with every entry intact', () => {
		const missing = Object.entries(LANE_MERGE_COMMANDS).filter(
			([name, entry]) => COMMAND_MAP[name] !== entry,
		)

		expect(missing).toEqual([])
	})
})
