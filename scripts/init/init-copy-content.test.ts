import { workflow_pin_logic } from '#scripts/sync/workflow-pin-logic'
import { describe, expect, it } from 'vitest'
import { transform_copied_content } from './init-copy-content'
import { init_logic } from './init-logic'

const CHECKOUT = 'actions/checkout'
const STALE_REF = 'de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2'
const WORKFLOW_DESTINATION = '.github/workflows/ci.yml'
const PROMPT_LINE = 'See `prompts/refactoring.md` for the rules.'

// Read from the repository instead of hardcoded: a literal SHA here would need updating on
// every Dependabot bump, which is exactly the churn this transform exists to remove.
function canonical_reference(action: string): string {
	const reference = workflow_pin_logic.build_canonical_pins().get(action)
	if (reference === undefined) throw new Error(`No canonical pin for ${action}`)

	return reference
}

function uses_line(reference: string): string {
	return `        uses: ${CHECKOUT}@${reference}`
}

describe('transform_copied_content', () => {
	it('resolves workflow action pins from .github/workflows when writing a workflow', () => {
		expect(transform_copied_content(WORKFLOW_DESTINATION, uses_line(STALE_REF))).toBe(
			uses_line(canonical_reference(CHECKOUT)),
		)
	})

	it('leaves action pins alone when the destination is not a workflow', () => {
		const text = uses_line(STALE_REF)

		expect(transform_copied_content('README.md', text)).toBe(text)
	})

	it('still applies the prompt path rewrite', () => {
		const rewritten = transform_copied_content('CLAUDE.md', PROMPT_LINE)

		expect(rewritten).toBe(init_logic.transform_prompt_paths(PROMPT_LINE))
		expect(rewritten).not.toBe(PROMPT_LINE)
	})
})
