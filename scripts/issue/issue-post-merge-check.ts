import { issue_body_keys } from '#scripts/issue/issue-body-keys'
import { markdown_section } from '#scripts/issue/markdown-section'

// joshuafolkken/kit#8502: an issue that deferred its look past the merge declares the
// `post_merge_check` key with the place to look under its background section. `run:prep` answers
// it on one line, so the completion gate (`/verify-ui`) reads that line rather than the body.

const LABEL = 'post_merge_check: '
const NONE = 'none'

const BULLET = '- '

// The template writes the declaration as a bare line, the declaration table as a bullet; both count.
function value_of(line: string): string | undefined {
	const trimmed = line.trim()
	const text = trimmed.startsWith(BULLET) ? trimmed : `${BULLET}${trimmed}`
	const prefix = issue_body_keys
		.prefix_variants('post_merge_check')
		.find((variant) => text.startsWith(variant))

	return prefix === undefined ? undefined : text.slice(prefix.length).trim()
}

// The declared place to look, in either column; `undefined` when the background declares none.
function read(body: string): string | undefined {
	const background = markdown_section.section_lines(body, issue_body_keys.heading('background'))
	const lines = markdown_section.unfenced_lines(background.join('\n'))

	return lines.map((line) => value_of(line)).find((value) => value !== undefined && value !== '')
}

// The answer line: `post_merge_check: <where to look>`, or `post_merge_check: none`.
function answer(body: string): string {
	return `${LABEL}${read(body) ?? NONE}`
}

const issue_post_merge_check = { LABEL, answer, read }

export { issue_post_merge_check }
