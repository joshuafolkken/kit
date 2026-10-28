import { describe, expect, it } from 'vitest'
import { reply_prose } from './reply-prose'

const REPLY = [
	'結論です。',
	'```bash',
	'pnpm josh gate',
	'```',
	'| 列 | 値 |',
	'| --- | --- |',
	'- 箇条書き',
	'1. 番号付き',
	'次は `pnpm josh ship` を https://example.com で。',
].join('\n')

describe('reply_prose.prose_of', () => {
	it('takes out fenced code, inline code and URLs', () => {
		const prose = reply_prose.prose_of(REPLY)

		expect(prose).not.toContain('pnpm josh')
		expect(prose).not.toContain('example.com')
		expect(prose).toContain('結論です。')
	})

	it('keeps table rows and list items', () => {
		expect(reply_prose.prose_of(REPLY)).toContain('箇条書き')
	})
})

describe('reply_prose.narrative_of', () => {
	it('also takes out table rows and list items', () => {
		const narrative = reply_prose.narrative_of(REPLY)

		expect(narrative).not.toContain('列')
		expect(narrative).not.toContain('箇条書き')
		expect(narrative).not.toContain('番号付き')
	})

	it('keeps the narrative lines', () => {
		const narrative = reply_prose.narrative_of(REPLY)

		expect(narrative).toContain('結論です。')
		expect(narrative).toContain('次は')
	})
})
