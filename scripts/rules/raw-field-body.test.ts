import { describe, expect, it } from 'vitest'
import { raw_field_body } from './raw-field-body'

// joshuafolkken/kit#2304: `gh api`'s raw field flag (`-f` / `--raw-field`) sends `body=@<path>`
// verbatim, so the literal `@<path>` is posted as the comment. The file-reading flag (`-F` /
// `--field`) is one character away and genuinely safe. This suite fixes the firing/non-firing pair —
// the regression the acceptance criterion names: no path sends a `@`-prefixed body literally.

const AT_PATH = 'repos/o/r/issues/5/comments'

describe('raw_field_body.posts_at_path_literally — refuses the raw-field @path misfire', () => {
	it.each([
		['short flag, unquoted', `gh api ${AT_PATH} -f body=@/tmp/park.md`],
		['short flag, whole value quoted', `gh api ${AT_PATH} -f "body=@/tmp/park.md"`],
		['short flag, value quoted', `gh api ${AT_PATH} -f body="@/tmp/park.md"`],
		['short flag, single-quoted', `gh api ${AT_PATH} -f 'body=@/tmp/park.md'`],
		['long raw flag', `gh api ${AT_PATH} --raw-field body=@/tmp/park.md`],
		['flag with = separator', `gh api ${AT_PATH} --raw-field=body=@/tmp/park.md`],
	])('refuses the %s spelling', (_name, command) => {
		expect(raw_field_body.posts_at_path_literally(command)).toBe(true)
	})
})

describe('raw_field_body.posts_at_path_literally — is silent on the safe and unrelated forms', () => {
	it.each([
		['the file-reading -F flag', `gh api ${AT_PATH} -F body=@/tmp/park.md`],
		['the file-reading --field flag', `gh api ${AT_PATH} --field body=@/tmp/park.md`],
		['a raw body with no @', `gh api ${AT_PATH} -f body="just some plain text"`],
		['a raw label value', "gh api repos/o/r/issues/5/labels -f 'labels[]=needs-decision'"],
		['the josh command the rule asks for', 'pnpm josh issue:comment 5 --body-file /tmp/park.md'],
		['a raw title field of a filing', 'gh api repos/o/r/issues -f title="Fix" -f body="text"'],
	])('is silent on %s', (_name, command) => {
		expect(raw_field_body.posts_at_path_literally(command)).toBe(false)
	})
})

describe('raw_field_body.RAW_FIELD_BODY_REASON', () => {
	it.each([
		'literal @path body',
		'pnpm josh issue:comment <N> --body-file <path>',
		'prompts/collaboration-workflow/shell-body.md',
		'fires on every occurrence',
	])('carries %j', (marker) => {
		expect(raw_field_body.RAW_FIELD_BODY_REASON).toContain(marker)
	})
})
