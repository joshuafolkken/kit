import { describe, expect, it } from 'vitest'
import { workflow_pin_logic } from './workflow-pin-logic'

const CHECKOUT = 'actions/checkout'
const OLD_REF = 'de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2'
const NEW_REF = 'df4cb1c069e1874edd31b4311f1884172cec0e10 # v6.0.3'
const TEMPLATE = 'templates/workflows/ci.yml'
const SETUP_NODE = 'actions/setup-node'

function uses_block(action: string, reference: string): string {
	return `      - name: Checkout\n        uses: ${action}@${reference}`
}

describe('workflow_pin_logic.parse_uses_line', () => {
	it('parses an indented uses line into action name and ref', () => {
		const pin = workflow_pin_logic.parse_uses_line(`        uses: ${CHECKOUT}@${OLD_REF}`)

		expect(pin).toEqual({ name: CHECKOUT, ref: OLD_REF })
	})

	it('ignores a uses key that is not the start of the trimmed line', () => {
		expect(workflow_pin_logic.parse_uses_line('      # uses: actions/checkout@x')).toBeUndefined()
	})

	it('ignores a local action reference without an @ ref', () => {
		expect(workflow_pin_logic.parse_uses_line('        uses: ./.github/actions/x')).toBeUndefined()
	})
})

describe('workflow_pin_logic.collect_canonical', () => {
	it('builds a map of action name to ref from sources', () => {
		const pins = workflow_pin_logic.collect_canonical([
			{ file: 'ci.yml', text: uses_block(CHECKOUT, NEW_REF) },
		])

		expect(pins.get(CHECKOUT)).toBe(NEW_REF)
	})

	it('throws when the same action is pinned to conflicting refs', () => {
		const sources = [
			{ file: 'ci.yml', text: uses_block(CHECKOUT, NEW_REF) },
			{ file: 'auto-tag.yml', text: uses_block(CHECKOUT, OLD_REF) },
		]

		expect(() => workflow_pin_logic.collect_canonical(sources)).toThrow(/conflicting/u)
	})

	it('does not throw when an action repeats with an identical ref', () => {
		const text = `${uses_block(CHECKOUT, NEW_REF)}\n${uses_block(CHECKOUT, NEW_REF)}`

		expect(() => workflow_pin_logic.collect_canonical([{ file: 'ci.yml', text }])).not.toThrow()
	})
})

describe('workflow_pin_logic.find_drift_in_text', () => {
	const canonical = new Map([[CHECKOUT, NEW_REF]])

	it('reports a drift when the template ref differs from canonical', () => {
		const drift = workflow_pin_logic.find_drift_in_text(
			TEMPLATE,
			uses_block(CHECKOUT, OLD_REF),
			canonical,
		)

		expect(drift).toEqual([
			{ template: TEMPLATE, line: 2, action: CHECKOUT, from: OLD_REF, to: NEW_REF },
		])
	})

	it('reports no drift when the ref already matches canonical', () => {
		const drift = workflow_pin_logic.find_drift_in_text(
			TEMPLATE,
			uses_block(CHECKOUT, NEW_REF),
			canonical,
		)

		expect(drift).toEqual([])
	})

	it('ignores actions absent from the canonical map', () => {
		const text = uses_block(SETUP_NODE, '0000 # v6.0.0')

		expect(workflow_pin_logic.find_drift_in_text(TEMPLATE, text, canonical)).toEqual([])
	})
})

describe('workflow_pin_logic.apply_to_text', () => {
	const canonical = new Map([[CHECKOUT, NEW_REF]])

	it('rewrites a drifted pin while preserving indentation', () => {
		const result = workflow_pin_logic.apply_to_text(uses_block(CHECKOUT, OLD_REF), canonical)

		expect(result).toBe(uses_block(CHECKOUT, NEW_REF))
	})

	it('leaves non-matching actions untouched', () => {
		const text = uses_block(SETUP_NODE, 'abc # v6.0.0')

		expect(workflow_pin_logic.apply_to_text(text, canonical)).toBe(text)
	})
})

describe('workflow_pin_logic.format_drift_message', () => {
	it('lists each drift with its location and the sync hint', () => {
		const message = workflow_pin_logic.format_drift_message([
			{ template: TEMPLATE, line: 2, action: CHECKOUT, from: OLD_REF, to: NEW_REF },
		])

		expect(message).toContain(`${TEMPLATE}:2`)
		expect(message).toContain('sync-workflow-pins')
	})
})

describe('workflow_pin_logic repository guard', () => {
	it('runtime workflows pin each action to a single ref', () => {
		expect(() => workflow_pin_logic.build_canonical_pins()).not.toThrow()
	})

	it('templates/workflows is in sync with .github/workflows', () => {
		const drift = workflow_pin_logic.find_pin_drift()

		expect(drift, workflow_pin_logic.format_drift_message(drift)).toEqual([])
	})
})
