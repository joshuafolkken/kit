import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { pre_push_related_switch } from './pre-push-related-switch'

// joshuafolkken/kit#5067: `josh ship`'s push ahead of the gate and the hook name the same variable,
// and a person setting it by hand finds it in the environment reference.
describe('pre_push_related_switch.SWITCH_ENV_KEY', () => {
	it('is a row of the environment reference', () => {
		const reference = readFileSync('docs/environment-variables.md', 'utf8')

		expect(reference).toContain(`| \`${pre_push_related_switch.SWITCH_ENV_KEY}\``)
	})
})
