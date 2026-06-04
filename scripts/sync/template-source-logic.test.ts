import { describe, expect, it } from 'vitest'
import { template_source_logic } from './template-source-logic'

const { hash_text, format_drift_message, COPY_PAIRS, TRIPWIRE_PAIRS } = template_source_logic

const GITIGNORE_SOURCE = '.gitignore'
const GITIGNORE_TEMPLATE = 'templates/gitignore'
const SONAR_SOURCE = 'sonar-project.properties'
const SONAR_TEMPLATE = 'templates/sonar-project.properties'

describe('template_source_logic.hash_text', () => {
	it('is deterministic for the same input', () => {
		expect(hash_text('abc')).toBe(hash_text('abc'))
	})

	it('changes when the input changes', () => {
		expect(hash_text('abc')).not.toBe(hash_text('abcd'))
	})
})

describe('template_source_logic pair classification', () => {
	it('models .gitignore as a byte-copy pair, not a tripwire', () => {
		const copy_sources = COPY_PAIRS.map((pair) => pair.source)
		const tripwire_sources = TRIPWIRE_PAIRS.map((pair) => pair.source)

		expect(copy_sources).toContain(GITIGNORE_SOURCE)
		expect(tripwire_sources).not.toContain(GITIGNORE_SOURCE)
	})

	it('keeps sonar-project.properties as a tripwire pair', () => {
		const tripwire_sources = TRIPWIRE_PAIRS.map((pair) => pair.source)

		expect(tripwire_sources).toContain(SONAR_SOURCE)
	})
})

describe('template_source_logic.format_drift_message', () => {
	it('describes a copy pair as out of date with its source', () => {
		const message = format_drift_message(
			[{ template: GITIGNORE_TEMPLATE, source: GITIGNORE_SOURCE }],
			[],
		)

		expect(message).toContain(`${GITIGNORE_TEMPLATE} is out of date with ${GITIGNORE_SOURCE}`)
		expect(message).toContain('pnpm josh reconcile-templates')
	})

	it('describes a tripwire pair as needing review', () => {
		const message = format_drift_message([], [{ template: SONAR_TEMPLATE, source: SONAR_SOURCE }])

		expect(message).toContain(`${SONAR_SOURCE} changed → review ${SONAR_TEMPLATE}`)
	})
})
