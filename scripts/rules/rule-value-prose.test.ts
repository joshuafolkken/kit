import { describe, expect, it } from 'vitest'
import { rule_value_prose, type ProseDocument } from './rule-value-prose'

const { classify, render, ENFORCED, MEASURED, PROSE_ONLY } = rule_value_prose

const ORACLE_FILE = '.claude/skills/oracle.md'
const CITED_SECTION = '`guarded.md` → "Cited"'

const GUARDED: ProseDocument = {
	file: 'prompts/guarded.md',
	markdown: [
		'# Guarded',
		'',
		'## Cited',
		'',
		'- **Refused rule.** A guard row cites this section.',
		'',
		'## Uncited',
		'',
		'**Prose rule.** Nothing cites this paragraph.',
		'',
		'```',
		'**Quoted.** Inside a fence, never a rule.',
		'```',
	].join('\n'),
}

const ANSWERED: ProseDocument = {
	file: ORACLE_FILE,
	markdown: ['# Oracle', '', '1. **Answered rule.** A command answers it.'].join('\n'),
}

const WRAPPED: ProseDocument = {
	file: 'prompts/wrapped.md',
	markdown: ['A paragraph that wraps onto', '**bold** mid-sentence.'].join('\n'),
}

const DOCUMENTS = [GUARDED, ANSWERED]

function classes_of(guards: ReadonlyArray<string>, oracles: ReadonlyArray<string>): Array<string> {
	return classify(DOCUMENTS, { guards, oracles }).map(
		(rule) => `${rule.class} ${rule.file}:${rule.line.toString()}`,
	)
}

describe('rule_value_prose.classify', () => {
	it('classes a rule under a cited section as enforced and one outside it as prose only', () => {
		expect(classes_of([CITED_SECTION], [])).toStrictEqual([
			`${ENFORCED} prompts/guarded.md:5`,
			`${PROSE_ONLY} prompts/guarded.md:9`,
			`${PROSE_ONLY} ${ORACLE_FILE}:3`,
		])
	})

	it('does not read a wrapped line that starts with bold text as a rule', () => {
		expect(classify([WRAPPED], { guards: [], oracles: [] })).toStrictEqual([])
	})

	it('classes every rule in a file cited without a section', () => {
		expect(classes_of(['`prompts/guarded.md`'], [])).toStrictEqual([
			`${ENFORCED} prompts/guarded.md:5`,
			`${ENFORCED} prompts/guarded.md:9`,
			`${PROSE_ONLY} ${ORACLE_FILE}:3`,
		])
	})

	it('classes a rule only a decision oracle cites as measured only', () => {
		expect(classes_of([], [ORACLE_FILE])).toContain(`${MEASURED} ${ORACLE_FILE}:3`)
	})

	it('lets a guard citation win over an oracle citation of the same rule', () => {
		expect(classes_of(['`oracle.md`'], [ORACLE_FILE])).toContain(`${ENFORCED} ${ORACLE_FILE}:3`)
	})

	it('ignores a source that is not a markdown document or names an absent section', () => {
		expect(classes_of(['`decision-oracle.ts`', '`guarded.md` → "Absent"'], [])).toStrictEqual([
			`${PROSE_ONLY} prompts/guarded.md:5`,
			`${PROSE_ONLY} prompts/guarded.md:9`,
			`${PROSE_ONLY} ${ORACLE_FILE}:3`,
		])
	})
})

describe('rule_value_prose.render', () => {
	it('prints one row per rule with its source line, then the totals', () => {
		const text = render(classify([GUARDED], { guards: [CITED_SECTION], oracles: [] }))

		expect(text.split('\n')).toStrictEqual([
			`${ENFORCED}  prompts/guarded.md:5  Refused rule.`,
			`${PROSE_ONLY}  prompts/guarded.md:9  Prose rule.`,
			'',
			`${ENFORCED} 1 · ${MEASURED} 0 · ${PROSE_ONLY} 1`,
		])
	})
})

describe('rule_value_prose.audit', () => {
	it('reads this repository and resolves at least one guard row to a prose rule', () => {
		const audited = rule_value_prose.audit()

		expect(audited.some((rule) => rule.file === 'CLAUDE.md')).toBe(true)
		expect(audited.some((rule) => rule.class === ENFORCED)).toBe(true)
	})
})
