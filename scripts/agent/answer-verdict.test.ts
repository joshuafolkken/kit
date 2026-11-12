import type { IssueSource } from '#scripts/issue/issue-sources'
import { describe, expect, it } from 'vitest'
import { answer_verdict } from './answer-verdict'

const BODY_TEXT = '## 期待結果\n\n- run:park は判定を書き込み前に実行する。'
const COMMENT_ID = 'https://github.com/joshuafolkken/kit/issues/6531#issuecomment-1'
const COMMENT_TEXT = '採用: 既存の issue_sources を再利用する。'
const SOURCES: ReadonlyArray<IssueSource> = [
	{ id: 'body', order: 0, author: undefined, created_at: undefined, text: BODY_TEXT },
	{
		id: COMMENT_ID,
		order: 1,
		author: 'joshuafolkken',
		created_at: '2026-11-06T03:34:01Z',
		text: COMMENT_TEXT,
	},
]
const BODY_QUOTE = 'run:park は判定を書き込み前に実行する。'
const DECISION = 'Judge before the write'
const REASON = 'No source decides it.'
const ANSWERED = {
	verdict: 'answered',
	decision: DECISION,
	decision_kind: 'choice',
	quotes: [{ source: 'body', text: BODY_QUOTE }],
}

function validate(value: unknown): ReturnType<typeof answer_verdict.validate> {
	return answer_verdict.validate(JSON.stringify(value), SOURCES)
}

function cause_of(value: unknown): string {
	const verdict = validate(value)

	return verdict.kind === 'failed' ? verdict.cause : `not failed: ${verdict.kind}`
}

describe('answer_verdict.validate answered and unanswered', () => {
	it('returns the decision with the quote and the source it was found in', () => {
		expect(validate(ANSWERED)).toEqual({
			kind: 'answered',
			decision: DECISION,
			decision_kind: 'choice',
			evidence: [{ source: SOURCES[0], quote: BODY_QUOTE }],
		})
	})

	it('represents a decision to reuse existing code', () => {
		const reuse = {
			...ANSWERED,
			decision: 'Reuse issue_sources',
			decision_kind: 'reuse',
			quotes: [{ source: COMMENT_ID, text: '既存の issue_sources を再利用する' }],
		}

		expect(validate(reuse)).toMatchObject({ kind: 'answered', decision_kind: 'reuse' })
	})

	it('returns an unanswered verdict with its reason', () => {
		const verdict = validate({ verdict: 'unanswered', reason: REASON })

		expect(verdict).toEqual({ kind: 'unanswered', reason: REASON })
	})

	it('reads the object out of a fenced reply', () => {
		const raw = `Here it is:\n\`\`\`json\n${JSON.stringify(ANSWERED)}\n\`\`\``

		expect(answer_verdict.validate(raw, SOURCES).kind).toBe('answered')
	})
})

describe('answer_verdict.validate failures', () => {
	it.each([
		['plain prose', 'The Issue answers it.'],
		['broken JSON', '{"verdict": "answered",'],
	])('fails %s with a retry', (_case, raw) => {
		expect(answer_verdict.validate(raw, SOURCES)).toEqual({
			kind: 'failed',
			cause: 'the judgment printed no JSON object',
			retry: answer_verdict.RETRY,
		})
	})

	it.each([
		['a missing decision', { ...ANSWERED, decision: undefined }, 'decision'],
		['an empty quote list', { ...ANSWERED, quotes: [] }, 'quotes'],
		['a blank quote', { ...ANSWERED, quotes: [{ source: 'body', text: '  ' }] }, 'quotes.0.text'],
		['an unknown verdict', { verdict: 'maybe' }, 'verdict'],
		['an unknown decision kind', { ...ANSWERED, decision_kind: 'guess' }, 'decision_kind'],
		['an extra field', { ...ANSWERED, note: 'x' }, 'note'],
	])('fails %s as off the contract', (_case, value, field) => {
		expect(cause_of(value)).toContain('off the contract')
		expect(cause_of(value)).toContain(field)
	})

	// An untrusted comment is dropped by `issue_sources`, so it reaches here as an unknown id.
	it('fails a quote citing a source that was not fetched as trusted', () => {
		const quotes = [{ source: 'https://example.test/untrusted', text: BODY_QUOTE }]

		expect(cause_of({ ...ANSWERED, quotes })).toContain('not a fetched trusted source')
	})

	it('fails a quote the named source does not contain verbatim', () => {
		const quotes = [{ source: COMMENT_ID, text: BODY_QUOTE }]

		expect(cause_of({ ...ANSWERED, quotes })).toContain('verbatim')
	})
})
