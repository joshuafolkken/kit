import { issue_body_keys } from '#scripts/issue/issue-body-keys'
import { markdown_section } from '#scripts/issue/markdown-section'

// joshuafolkken/kit#8502: an issue that deferred its look past the merge declares the
// `post_merge_check` key with the place to look under its background section. `run:prep` answers
// it on one line, so the completion gate (`/verify-ui`) reads that line rather than the body.

const LABEL = 'post_merge_check: '
const NONE = 'none'
const UNKNOWN = '?'

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

// The declared place to look, in either column and as the filer wrote it (a canonical read would
// translate a fixed word it opens with); `undefined` when the background declares none.
function read(body: string): string | undefined {
	const heading = issue_body_keys.heading('background')
	const background = markdown_section.written_section_lines_matching(
		body,
		(line) => line.trim() === heading,
	)
	const lines = markdown_section.written_fence_free_lines(background.join('\n'))

	return lines.map((line) => value_of(line)).find((value) => value !== undefined && value !== '')
}

// The answer line for the issue body alone (comments excluded): `post_merge_check: <where to look>`,
// or `none`. The declaration lets a run skip a stop, so an untrusted body declares nothing and a
// failed trust lookup answers `?`, never `none` (`/verify-ui` continues on a place to look only).
function answer(body: string, is_body_trusted: boolean | undefined): string {
	if (is_body_trusted === undefined) return `${LABEL}${UNKNOWN}`
	const place = is_body_trusted ? read(body) : undefined

	return `${LABEL}${place ?? NONE}`
}

const issue_post_merge_check = { LABEL, UNKNOWN, answer, read }

export { issue_post_merge_check }
