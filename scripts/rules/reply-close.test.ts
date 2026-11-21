import { describe, expect, it } from 'vitest'
import { reply_close } from './reply-close'

const BODY = 'The gate passed and the pull request is open.'
const SECTION_CITATION = '"concise-reply"'
const SECTION_HEADING = '## concise-reply'
const NEXT_REVIEW = 'Next: wait for the review'

function reply(...lines: ReadonlyArray<string>): string {
	return [BODY, '', ...lines].join('\n')
}

// joshuafolkken/kit#8299: a reply ends with what comes next or that nothing is left.
describe('reply_close.is_open', () => {
	it.each([
		'次の一手: レビューを待つ',
		'Next: halfrun #8299',
		'このセッションのやり残しはない',
		'Nothing left in this session.',
		'- **次の一手:** マージを待つ',
		'**Next**: wait for the review',
	])('passes a last paragraph closed with %s', (close) => {
		expect(reply_close.is_open(reply(close), '')).toBe(false)
	})

	it('passes a close followed by bare URL lines', () => {
		const message = reply(NEXT_REVIEW, '', 'https://github.com/o/r/pull/1')

		expect(reply_close.is_open(message, '')).toBe(false)
	})

	it('sends back a reply with no close line', () => {
		expect(reply_close.is_open(BODY, '')).toBe(true)
	})

	it('sends back a reply whose close sits only in an earlier paragraph', () => {
		const message = [NEXT_REVIEW, '', BODY].join('\n')

		expect(reply_close.is_open(message, '')).toBe(true)
	})

	it('sends back a reply even when the prompt asked for the detail', () => {
		expect(reply_close.is_open(BODY, '詳しく教えて')).toBe(true)
	})

	it('stays quiet on a reply that is only a code block', () => {
		expect(reply_close.is_open(['```', BODY, '```'].join('\n'), '')).toBe(false)
	})

	it('stays quiet on a reply carrying a Recommended: decision', () => {
		expect(reply_close.is_open(reply('Recommended: merge it'), '')).toBe(false)
	})

	it('stays quiet when the prompt could not be read', () => {
		expect(reply_close.is_open(BODY, undefined)).toBe(false)
	})
})

describe('reply_close.build_reason', () => {
	it('opens with the row reason and carries the section', () => {
		const reason = reply_close.build_reason('en')

		expect(reason.startsWith(reply_close.REASON_OPENING)).toBe(true)
		expect(reason).toContain(SECTION_CITATION)
		expect(reason).toContain(SECTION_HEADING)
	})

	it('names the close form of the session language', () => {
		expect(reply_close.build_reason('ja')).toContain('`次の一手: <次にすべきこと>`')
		expect(reply_close.build_reason('en')).toContain('`Next: <what to do next>`')
	})

	it('omits the section when the principles file cannot be read', () => {
		expect(reply_close.build_reason('en', '/nonexistent')).not.toContain(SECTION_HEADING)
	})
})

describe('reply_close.note_of', () => {
	it('adds the close instruction only for an open reply', () => {
		expect(reply_close.note_of(BODY, '', 'en')).toBe(reply_close.close_note('en'))
		expect(reply_close.note_of(reply(NEXT_REVIEW), '', 'en')).toBe('')
	})
})

describe('reply_close.reason_of', () => {
	it('returns the reason only for an open reply', () => {
		expect(reply_close.reason_of(BODY, '', 'en')).toBe(reply_close.build_reason('en'))
		expect(reply_close.reason_of(reply(NEXT_REVIEW), '', 'en')).toBeUndefined()
	})
})
