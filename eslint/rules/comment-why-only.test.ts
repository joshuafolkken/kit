import { Linter } from 'eslint'
import { describe, expect, it } from 'vitest'
import { comment_why_only_plugin } from './comment-why-only.js'

const ECMA_VERSION = 2024
const HISTORY_RULE_ID = 'kit/no-history-comment'
const MEASUREMENT_RULE_ID = 'kit/no-measurement-comment'
const ISSUE_CITATION_COMMENT = '// The order matters (joshuafolkken/kit#5282).'

// A minimal flat config with the plugin under the `kit` namespace and both rules set to error, so
// one inline source exercises each rule's comment scan without a real tsconfig.
function message_ids_for(source: string, rule_id: string): Array<string | undefined> {
	const linter = new Linter()
	const messages = linter.verify(source, [
		{ languageOptions: { ecmaVersion: ECMA_VERSION, sourceType: 'module' } },
		{
			plugins: { kit: comment_why_only_plugin },
			rules: { [HISTORY_RULE_ID]: 'error', [MEASUREMENT_RULE_ID]: 'error' },
		},
	])

	return messages
		.filter((message) => message.ruleId === rule_id)
		.map((message) => message.messageId)
}

function history_count(comment: string): number {
	return message_ids_for(`${comment}\nconst PROBE = 1\n`, HISTORY_RULE_ID).length
}

function measurement_count(comment: string): number {
	return message_ids_for(`${comment}\nconst PROBE = 1\n`, MEASUREMENT_RULE_ID).length
}

describe('no-history-comment', () => {
	it.each([
		'// Previously, the gate ran every check serially.',
		'// The budget used to be the core count.',
		'/* The resolvers formerly sat under `import/resolver`. */',
		'// 以前は全件を直列で検査していた',
	])('flags %s', (comment) => {
		expect(history_count(comment)).toBe(1)
	})

	it.each([
		'// The key is used to look up the cached result.',
		'// Readers get used to the order, so it stays stable.',
		'// Used to build the cache key.',
		'// Only used to look up the lane.',
		'// It is not used to sort.',
		'// A previously parked lane resumes here.',
		ISSUE_CITATION_COMMENT,
	])('allows %s', (comment) => {
		expect(history_count(comment)).toBe(0)
	})

	it('reports with the history message id', () => {
		expect(message_ids_for('// It used to wait.\nconst PROBE = 1\n', HISTORY_RULE_ID)).toEqual([
			'history',
		])
	})
})

describe('no-measurement-comment', () => {
	it.each([
		'// The warm run takes 1.9 seconds.',
		'// That costs ~12k tokens.',
		'// It waits out a 10-second budget.',
		'// That costs about 16,000 tokens per turn.',
		'// The ledger grows by 64 MB a second.',
		'// A cold start takes 120ms.',
		'// The lane stalled for 20 minutes.',
	])('flags %s', (comment) => {
		expect(measurement_count(comment)).toBe(1)
	})

	it.each([
		ISSUE_CITATION_COMMENT,
		'// Keep the last 3 entries.',
		'// Retry on HTTP 502.',
		'// Step 2 sets the flag.',
		'// Formats from the 1990s parse here.',
		'// HTTP 502s are retried.',
	])('allows %s', (comment) => {
		expect(measurement_count(comment)).toBe(0)
	})

	it('reports with the measurement message id', () => {
		expect(
			message_ids_for('// It took 5 seconds.\nconst PROBE = 1\n', MEASUREMENT_RULE_ID),
		).toEqual(['measurement'])
	})
})
