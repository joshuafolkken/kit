// The upstream backlink headings (`prompts/collaboration-workflow/issue-template.md`) are fixed so
// they can be found by grep — the document says so outright — yet nothing greps them, and a
// one-directional link (an origin that lists an upstream the upstream never points back at) survives
// undetected. This classifies an origin issue's filed backlinks into one of four fixed words.
// The headings are the single source's, pinned by the document test.

import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { markdown_section } from './markdown-section'

const ORIGIN_HEADING = '## Origin'
const UPSTREAM_ISSUES_HEADING = '## Upstream issues'
const UPSTREAM_CANDIDATE_HEADING = '## Upstream candidate'
const CHECKBOX_PATTERN = /^\s*-\s*\[[ xX]\]/u
const WRONG_UPSTREAM_HEADING_PATTERN = /^##\s+Upstream\b/iu
const BARE_REFERENCE_PATTERN = /^#\d+$/u
const REFERENCE_MARK = '#'
const PATH_SEPARATOR = '/'
const PATH_SEGMENT_COUNT = 2

type BacklinkVerdict = 'ok' | 'missing-origin' | 'missing-upstream' | 'wrong-heading'

const OK: BacklinkVerdict = 'ok'
const WRONG_HEADING: BacklinkVerdict = 'wrong-heading'
const MISSING_UPSTREAM: BacklinkVerdict = 'missing-upstream'

interface UpstreamEntry {
	ref: string
	body: string
}

// A heading inside a code fence is example text, so neither lookup counts one.
function has_heading(body: string, heading: string): boolean {
	return markdown_section.has_line(body, heading)
}

// The lines under the upstream heading, up to the next `##` heading; `undefined` when it is absent.
function upstream_section_lines(body: string): ReadonlyArray<string> | undefined {
	if (!has_heading(body, UPSTREAM_ISSUES_HEADING)) return undefined

	return markdown_section.section_lines(body, UPSTREAM_ISSUES_HEADING)
}

// A heading that looks like the upstream one but is not exactly it (`## Upstream`, `## Upstreams`,
// wrong case) — the grep the template promises would miss it, so it is a wrong-heading rather than a
// missing one. `## Upstream candidate` is a legitimate separate heading and is excluded.
function has_wrong_upstream_heading(body: string): boolean {
	return markdown_section.unfenced_lines(body).some((line) => {
		const heading = line.trim()
		if (heading === UPSTREAM_ISSUES_HEADING || heading === UPSTREAM_CANDIDATE_HEADING) return false

		return WRONG_UPSTREAM_HEADING_PATTERN.test(heading)
	})
}

function tokens_of(section: ReadonlyArray<string>): ReadonlyArray<string> {
	return section
		.join(' ')
		.split(/\s+/u)
		.filter((token) => token.length > 0)
}

function has_two_segments(path: string | undefined = ''): boolean {
	const segments = path.split(PATH_SEPARATOR)

	return segments.length === PATH_SEGMENT_COUNT && segments.every((segment) => segment.length > 0)
}

// `owner/repo#N` split by structure rather than a nested-quantifier regex: one `#`, and one `/`
// between two non-empty segments before it. That is the only reference form the template allows.
function is_qualified_reference(token: string): boolean {
	const [path, number, ...rest] = token.split(REFERENCE_MARK)
	if (number === undefined || rest.length > 0) return false

	return issue_number_shape.ISSUE_NUMBER_PATTERN.test(number) && has_two_segments(path)
}

function has_bare_reference(section: ReadonlyArray<string>): boolean {
	return tokens_of(section).some((token) => BARE_REFERENCE_PATTERN.test(token))
}

function has_checkbox_reference(section: ReadonlyArray<string>): boolean {
	return section.some((line) => CHECKBOX_PATTERN.test(line) && line.includes(REFERENCE_MARK))
}

function is_malformed_upstream_section(section: ReadonlyArray<string>): boolean {
	return has_bare_reference(section) || has_checkbox_reference(section)
}

// Every upstream body has to point back with `## Origin`; the first that does not makes the pair
// one-directional.
function every_upstream_cites_origin(upstreams: ReadonlyArray<UpstreamEntry>): boolean {
	return upstreams.every((upstream) => has_heading(upstream.body, ORIGIN_HEADING))
}

// A body with only `## Upstream candidate` (nothing filed yet) is a correct state and reads as `ok`;
// otherwise a body with no upstream heading at all is missing its upstream link.
function verdict_without_section(origin_body: string): BacklinkVerdict {
	return has_heading(origin_body, UPSTREAM_CANDIDATE_HEADING) ? OK : MISSING_UPSTREAM
}

function verdict_with_section(
	section: ReadonlyArray<string>,
	upstreams: ReadonlyArray<UpstreamEntry>,
): BacklinkVerdict {
	if (is_malformed_upstream_section(section)) return WRONG_HEADING
	if (upstreams.length === 0) return MISSING_UPSTREAM

	return every_upstream_cites_origin(upstreams) ? OK : 'missing-origin'
}

// The origin issue's body, plus the bodies of the upstreams it lists, classified into one word.
function classify_backlinks(
	origin_body: string,
	upstreams: ReadonlyArray<UpstreamEntry>,
): BacklinkVerdict {
	if (has_wrong_upstream_heading(origin_body)) return WRONG_HEADING

	const section = upstream_section_lines(origin_body)

	return section === undefined
		? verdict_without_section(origin_body)
		: verdict_with_section(section, upstreams)
}

// The `owner/repo#N` references the upstream section lists, so the CLI knows which upstream bodies to
// fetch and check for `## Origin`.
function upstream_references(origin_body: string): ReadonlyArray<string> {
	const section = upstream_section_lines(origin_body)
	if (section === undefined) return []

	return tokens_of(section).filter((token) => is_qualified_reference(token))
}

// Whether classifying the origin needs the upstream bodies fetched. Only the `## Origin` back-check
// does; a wrong, malformed or missing upstream heading is decided from the origin body alone. So the
// CLI can skip the network for those, and never mask a `wrong-heading` verdict behind an upstream
// that happens to be unreadable.
function needs_upstreams(origin_body: string): boolean {
	if (has_wrong_upstream_heading(origin_body)) return false

	const section = upstream_section_lines(origin_body)
	if (section === undefined) return false

	return !is_malformed_upstream_section(section)
}

const issue_backlinks = {
	classify_backlinks,
	upstream_refs: upstream_references,
	needs_upstreams,
	ORIGIN_HEADING,
	UPSTREAM_ISSUES_HEADING,
	UPSTREAM_CANDIDATE_HEADING,
}

export type { UpstreamEntry }
export { issue_backlinks }
