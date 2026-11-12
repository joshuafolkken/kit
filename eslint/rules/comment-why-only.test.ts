import { Linter } from 'eslint'
import { describe, expect, it } from 'vitest'
import { comment_why_only_plugin } from './comment-why-only.js'

const ECMA_VERSION = 2024
const HISTORY_RULE_ID = 'kit/no-history-comment'
const MEASUREMENT_RULE_ID = 'kit/no-measurement-comment'
const ISSUE_CITATION_COMMENT = '// The order matters (joshuafolkken/kit#5282).'
const HISTORY_COMMENTS = [
	'// Previously, the gate ran every check serially.',
	'// The budget used to be the core count.',
	'/* The resolvers formerly sat under `import/resolver`. */',
	'// 以前は全件を直列で検査していた',
	'/*\n * The gate\n * used to wait.\n */',
	'// A probe, used to exercise the engine, but the gate used to wait.',
	'// A probe — used to confirm the result. Previously, the gate waited.',
	'/* A probe,\n * used to exercise the engine, but the gate used to wait. */',
]
const PURPOSE_COMMENTS = [
	'// The key is used to look up the cached result.',
	'// Readers get used to the order, so it stays stable.',
	'// Used to build the cache key.',
	'// The key is per lane. Used to locate the record.',
	'/*\n * The key is per lane.\n * Used to locate the record.\n */',
	'// Only used to look up the lane.',
	'// It is not used to sort.',
	'// A previously parked lane resumes here.',
	'// A rule that flags every line, used to exercise the engine.',
	'// A package lookup — used to confirm the repository.',
	'// A package lookup – used to confirm the repository.',
	'/* A probe,\n * used to exercise the engine. */',
	'/* A package lookup —\n * used to confirm the repository. */',
	'/* A package lookup –\n * used to confirm the repository. */',
	'// Each phrasing is one a document has used to restate the cap.',
	'// Every reader used to the old output can recognize the verdict.',
	'// Readers are used to it.',
	ISSUE_CITATION_COMMENT,
]

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
	it.each(HISTORY_COMMENTS)('flags %s', (comment) => {
		expect(history_count(comment)).toBe(1)
	})

	it.each(PURPOSE_COMMENTS)('allows %s', (comment) => {
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

describe('declared values in measurement comments', () => {
	it.each([
		'// A cache read bills a 5-minute cache write.',
		'// Published pricing: 5-minute write, 1-hour write, cache read, output.',
		'// The published row is "for prompts over 100,000 tokens".',
		'// A machine of 100 MB, so the available figure is the share free.',
		'// It waits out a 10-second budget.',
		'// The timeout is 120ms.',
		'// A 64 MB limit prevents unbounded allocation.',
		'// Test input: 12k tokens.',
		'/* The fixture of 100 MB exercises the boundary. */',
	])('allows %s', (comment) => {
		expect(measurement_count(comment)).toBe(0)
	})

	it.each([
		'// A 10-second budget; the warm run takes 1.9 seconds.',
		'// The warm run takes 1.9 seconds with a 10-second budget.',
		'// Test input: 12k tokens; the preamble costs about 16,000 tokens per request.',
		'/* A machine of 100 MB.\n * A duplicate read takes ~17 seconds. */',
		'// The budget took 5 seconds to compute.',
		'// The fixture consumed 64 MB.',
	])('still flags measurements beside declared values: %s', (comment) => {
		expect(measurement_count(comment)).toBe(1)
	})
})
