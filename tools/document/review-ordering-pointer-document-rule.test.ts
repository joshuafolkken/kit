import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#5966: the review-ordering sections point at what `run:chain`, `run:review` and
// `review:round2` print instead of restating it, and keep the references the policy still needs.

const CHAIN_RULE = '.claude/skills/workflow-commands/chain-rule.md'
const CHAIN_HEADING = '## Run the review-to-merge chain'
const REVIEW = 'prompts/review.md'
const ROUND_TWO_HEADING = '### When round 2 is skipped entirely, and when it is not'

function section(path: string, heading: string): string {
	const text = readFileSync(path, 'utf8')
	const rest = text.slice(text.indexOf(`${heading}\n`) + heading.length)
	const end = rest.search(/\n#{2,3} /u)

	return end === -1 ? rest : rest.slice(0, end)
}

function chain_steps(): string {
	const body = section(CHAIN_RULE, CHAIN_HEADING)

	return body.slice(body.indexOf('1. '), body.indexOf('3. '))
}

describe('chain-rule.md steps 1–2 point at the commands', () => {
	it('names the sources of the printed steps', () => {
		const steps = chain_steps()

		expect(steps).toContain('scripts/run/review/run-chain.ts')
		expect(steps).toContain('scripts/run/review/run-chain-join.ts')
	})

	it('does not restate the stage order or the join exit codes', () => {
		const steps = chain_steps()

		expect(steps).not.toContain('runs `main:merge`, the self-check')
		expect(steps).not.toContain('`3` on an `unpinned` line')
	})

	it('keeps review:attest --check in the chain section', () => {
		expect(section(CHAIN_RULE, CHAIN_HEADING)).toContain('review:attest --check')
	})
})

describe('review.md round 2 skip section points at its definition', () => {
	it('names review-round2.ts as the definition of the arms', () => {
		expect(section(REVIEW, ROUND_TWO_HEADING)).toContain('scripts/review/review-round2.ts')
	})

	it('does not restate the arms', () => {
		expect(section(REVIEW, ROUND_TWO_HEADING)).not.toContain('A, an empty fix delta')
	})

	it('keeps the round cap', () => {
		expect(readFileSync(REVIEW, 'utf8')).toContain('## Review round cap (2 rounds)')
	})
})
