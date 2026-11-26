import { describe, expect, it } from 'vitest'
import { concise_reply } from './concise-reply'
import { reply_close } from './reply-close'

const BODY = 'The gate passed and the pull request is open.'
const SECTION_CITATION = '"concise-reply"'
const SECTION_HEADING = '## concise-reply'
const NEXT_REVIEW = 'Next: wait for the review'
const NOTHING_LEFT_JA = 'このセッションのやり残しはない'
const NOTHING_LEFT_EN = 'Nothing left in this session.'
const JA_NEXT_FORM = '`次の一手: <次にすべきこと>`'
const EN_NEXT_FORM = '`Next: <what to do next>`'

function reply(...lines: ReadonlyArray<string>): string {
	return [BODY, '', ...lines].join('\n')
}

// joshuafolkken/kit#8299: a reply ends with what comes next or that nothing is left.
describe('reply_close.is_open', () => {
	it.each([
		'次の一手: レビューを待つ',
		'Next: halfrun #8299',
		NOTHING_LEFT_JA,
		NOTHING_LEFT_EN,
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

// joshuafolkken/kit#9006: every decision pending on the user rides the close — the recommended one
// on the line, the rest as a list in the same paragraph.
describe('reply_close next-step close listing every pending decision', () => {
	const NEXT_APPROVE = '次の一手: マージを承認する'
	const PENDING = ['- 調査する #9100', '- wake ログの注記を確認する（起票の下書き）']
	const LONG_ITEM = `- ${'判断'.repeat(60)}`
	const LONG_ITEMS = [LONG_ITEM, LONG_ITEM, LONG_ITEM, LONG_ITEM]

	it('passes a next-step line followed by a list of the remaining decisions', () => {
		expect(reply_close.is_open(reply(NEXT_APPROVE, ...PENDING), '')).toBe(false)
	})

	it('passes a next-step line naming a single decision as before', () => {
		expect(reply_close.is_open(reply(NEXT_APPROVE), '')).toBe(false)
	})

	it('passes a listed close whose list alone is over the prose limit', () => {
		const message = reply(NEXT_APPROVE, ...LONG_ITEMS)

		expect(reply_close.is_open(message, '')).toBe(false)
		expect(concise_reply.is_over(message, '')).toBe(false)
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
		expect(reply_close.build_reason('ja')).toContain(JA_NEXT_FORM)
		expect(reply_close.build_reason('en')).toContain(EN_NEXT_FORM)
	})

	// joshuafolkken/kit#9006: the section the refusal carries tells the rewrite to list every decision
	// pending on the user, whatever the reply's topic.
	it('carries the rule that the close lists every decision pending on the user', () => {
		const reason = reply_close.build_reason('ja')

		expect(reason).toContain('ユーザーの判断を待っている件がある')
		expect(reason).toContain('返信の話題に関係なく全部を「次の一手:」に載せ')
	})

	it('omits the section when the principles file cannot be read', () => {
		expect(reply_close.build_reason('en', '/nonexistent')).not.toContain(SECTION_HEADING)
	})
})

describe('reply_close.note_of', () => {
	it('adds the close instruction only for an open reply', () => {
		expect(reply_close.note_of(BODY, '', 'en', false)).toBe(reply_close.close_note('en'))
		expect(reply_close.note_of(reply(NEXT_REVIEW), '', 'en', false)).toBe('')
	})

	it('adds the pending instruction for a nothing-left close while work is pending', () => {
		expect(reply_close.note_of(reply(NOTHING_LEFT_EN), '', 'en', true)).toBe(
			reply_close.pending_note('en'),
		)
	})
})

describe('reply_close.reason_of', () => {
	it('returns the reason only for an open reply', () => {
		expect(reply_close.reason_of(BODY, '', 'en', false)).toBe(reply_close.build_reason('en'))
		expect(reply_close.reason_of(reply(NEXT_REVIEW), '', 'en', false)).toBeUndefined()
	})
})

// joshuafolkken/kit#9004: the nothing-left close is false while a background task still runs.
describe('reply_close nothing-left close while work is pending', () => {
	it.each([NOTHING_LEFT_JA, NOTHING_LEFT_EN])('refuses %s while work is pending', (close) => {
		const reason = reply_close.reason_of(reply(close), '', 'ja', true)

		expect(reason).toBe(reply_close.build_pending_reason('ja'))
		expect(reason?.startsWith(reply_close.PENDING_OPENING)).toBe(true)
	})

	it('names what to do next in the session language', () => {
		const reason = reply_close.build_pending_reason('ja')

		expect(reason).toContain('Wait for the task')
		expect(reason).toContain('stop it')
		expect(reason).toContain(JA_NEXT_FORM)
		expect(reply_close.build_pending_reason('en')).toContain(EN_NEXT_FORM)
	})

	it('passes a nothing-left close when no work is pending', () => {
		expect(reply_close.reason_of(reply(NOTHING_LEFT_JA), '', 'ja', false)).toBeUndefined()
		expect(reply_close.reason_of(reply(NOTHING_LEFT_EN), '', 'en', false)).toBeUndefined()
	})

	it.each(['次の一手: 完了通知を待つ', NEXT_REVIEW])(
		'passes a %s close while work is pending',
		(close) => {
			expect(reply_close.reason_of(reply(close), '', 'ja', true)).toBeUndefined()
		},
	)

	it('passes a nothing-left line beside a next-step line while work is pending', () => {
		const message = reply(NOTHING_LEFT_JA, NEXT_REVIEW)

		expect(reply_close.reason_of(message, '', 'ja', true)).toBeUndefined()
	})

	it('stays quiet on a pending nothing-left close when the prompt could not be read', () => {
		expect(reply_close.is_premature(reply(NOTHING_LEFT_EN), undefined, true)).toBe(false)
	})
})
