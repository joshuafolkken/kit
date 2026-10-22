import { describe, expect, it } from 'vitest'
import { COMMAND_MAP } from './josh-command-map'
import { REVIEW_COMMANDS } from './josh-commands-review'

describe('REVIEW_COMMANDS', () => {
	it('reaches the command map with every entry intact', () => {
		const missing = Object.entries(REVIEW_COMMANDS).filter(
			([name, entry]) => COMMAND_MAP[name] !== entry,
		)

		expect(missing).toEqual([])
	})

	it('carries the usage of `review:brief` on its entry', () => {
		expect(REVIEW_COMMANDS['review:brief']?.usage.examples.length).toBeGreaterThan(0)
	})
})
