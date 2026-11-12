import { describe, expect, it } from 'vitest'
import { REVIEW_COMMANDS } from './josh-commands-review'

describe('REVIEW_COMMANDS', () => {
	it('carries the usage of `review:brief` on its entry', () => {
		expect(REVIEW_COMMANDS['review:brief']?.usage.examples.length).toBeGreaterThan(0)
	})
})
