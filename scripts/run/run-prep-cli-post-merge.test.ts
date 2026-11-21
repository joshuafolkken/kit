import { describe, expect, it } from 'vitest'
import { run_prep_cli, type PrepReads } from './run-prep-cli'

// joshuafolkken/kit#8502: `to_parts` answers the post-merge check off the issue body alone, under its
// trust — a comment that writes the declaration is not the body's.
const DECLARED_BODY = ['## 背景', '', '- マージ後の確認: matrix の TRACE 行', ''].join('\n')
const COMMENT_ONLY_BLOCK = ['## 背景', '', 'comment by someone', '- マージ後の確認: 別の所'].join(
	'\n',
)

function reads(body: string, is_body_trusted: boolean | undefined): PrepReads {
	return {
		content: {
			kind: 'ok',
			block: COMMENT_ONLY_BLOCK,
			body,
			trust: { is_body_trusted, has_trusted_comment: true },
		},
		state: { kind: 'missing' },
		latest: { scope: 'skip', reason: 'not asked' },
		has_changes: false,
		locations: '',
		ship_problems: [],
		investigation: undefined,
	}
}

describe('run_prep_cli.to_parts — post_merge_check', () => {
	it('reads the trusted body, not the block its comments are in', () => {
		const parts = run_prep_cli.to_parts('8502', reads(DECLARED_BODY, true))

		expect(parts.post_merge_check).toBe('post_merge_check: matrix の TRACE 行')
	})

	it('answers none where only a comment declares it', () => {
		const parts = run_prep_cli.to_parts('8502', reads('## 背景', true))

		expect(parts.post_merge_check).toBe('post_merge_check: none')
	})

	it('leaves the answer unset when the body read failed', () => {
		const parts = run_prep_cli.to_parts('8502', {
			...reads('', true),
			content: { kind: 'missing' },
		})

		expect(parts.post_merge_check).toBeUndefined()
	})
})
