import { readdirSync, readFileSync } from 'node:fs'
import node_path from 'node:path'
import { package_file } from '#scripts/claude/skill-fixture'
import { describe, expect, it } from 'vitest'

// A same-page link — `[backlogrun](#backlogrun)` — has to name a heading that page carries. The
// cross-document scan resolves file links and section references but never a bare `#anchor`, which
// is how `josh-commands.md` pointed at a `backlogrun` heading it never had (joshuafolkken/kit#2992).
// The slug is GitHub's: lower-cased, punctuation dropped, each space a hyphen, and a repeated
// heading numbered from `-1`.

const DOCS_DIRECTORY = 'docs'
const ROOT_DOCUMENTS: ReadonlyArray<string> = ['README.md']
const MARKDOWN_EXTENSION = '.md'
const FENCE_PATTERN = /^\s*(?:```|~~~)/u
const HEADING_PATTERN = /^#{1,6} (.+)$/gmu
const SAME_PAGE_LINK_PATTERN = /\]\(#([^)\s]+)\)/gu
const SLUG_DROPPED_PATTERN = /[^\p{L}\p{N}\p{M}\s_-]/gu
const WHITESPACE_PATTERN = /\s/gu

function documents(): ReadonlyArray<string> {
	const entries = readdirSync(package_file(DOCS_DIRECTORY), { recursive: true, encoding: 'utf8' })
	const markdown = entries.filter((entry) => entry.endsWith(MARKDOWN_EXTENSION))

	return [...ROOT_DOCUMENTS, ...markdown.map((entry) => node_path.join(DOCS_DIRECTORY, entry))]
}

// A `#` inside a code fence is a shell comment or a sample, not a heading or a link.
function outside_fences(text: string): string {
	let is_fenced = false
	const kept: Array<string> = []

	for (const line of text.split('\n')) {
		if (FENCE_PATTERN.test(line)) is_fenced = !is_fenced
		else if (!is_fenced) kept.push(line)
	}

	return kept.join('\n')
}

function slug(heading: string): string {
	return heading
		.trim()
		.toLowerCase()
		.replaceAll(SLUG_DROPPED_PATTERN, '')
		.replaceAll(WHITESPACE_PATTERN, '-')
}

function anchors(body: string): ReadonlySet<string> {
	const seen = new Map<string, number>()
	const result = new Set<string>()

	for (const [, heading = ''] of body.matchAll(HEADING_PATTERN)) {
		const base = slug(heading)
		const count = seen.get(base) ?? 0

		result.add(count === 0 ? base : `${base}-${String(count)}`)
		seen.set(base, count + 1)
	}

	return result
}

function broken_anchors(text: string): ReadonlyArray<string> {
	const body = outside_fences(text)
	const known = anchors(body)
	const linked = [...body.matchAll(SAME_PAGE_LINK_PATTERN)].map(([, anchor = '']) => anchor)

	return linked.filter((anchor) => !known.has(anchor))
}

describe('same-page anchors resolve to a heading on that page', () => {
	it('finds no broken same-page anchor in the docs or the README', () => {
		const broken = documents().flatMap((path) =>
			broken_anchors(readFileSync(package_file(path), 'utf8')).map((anchor) => `${path}#${anchor}`),
		)

		expect(broken).toEqual([])
	})

	it('reports an anchor whose heading is missing', () => {
		const text = '## `josh release`\n\nBeside a [`backlogrun`](#backlogrun) run.\n'

		expect(broken_anchors(text)).toEqual(['backlogrun'])
	})

	it('resolves punctuated, repeated and fenced headings the way GitHub does', () => {
		const text =
			'### `josh gate`: Done? Yes.\n## Notes\n## Notes\n```bash\n# not-a-heading\n```\n[a](#josh-gate-done-yes) [b](#notes-1) [c](#not-a-heading)\n'

		expect(broken_anchors(text)).toEqual(['not-a-heading'])
	})
})

// A link into another page — `[x](josh-commands-automation.md#josh-run-step)` — has to name a
// heading that page carries. Splitting the command reference into two pages moved most sections,
// so a link written against the old page would otherwise land on its top (joshuafolkken/kit#2998).
const CROSS_PAGE_LINK_PATTERN = /\]\(([\w./-]+\.md)#([^)\s]+)\)/gu

function page_anchors(path: string): ReadonlySet<string> {
	const text = readFileSync(package_file(path), 'utf8')

	return anchors(outside_fences(text))
}

function broken_cross_page_anchors(path: string, text: string): ReadonlyArray<string> {
	const links = [...outside_fences(text).matchAll(CROSS_PAGE_LINK_PATTERN)]

	return links.flatMap(([, file = '', anchor = '']) => {
		const target = node_path.join(node_path.dirname(path), file)

		return page_anchors(target).has(anchor) ? [] : `${path} → ${target}#${anchor}`
	})
}

describe('cross-page anchors resolve to a heading on the linked page', () => {
	it('finds no broken cross-page anchor in the docs or the README', () => {
		const broken = documents().flatMap((path) =>
			broken_cross_page_anchors(path, readFileSync(package_file(path), 'utf8')),
		)

		expect(broken).toEqual([])
	})

	it('reports an anchor the linked page does not carry', () => {
		const text =
			'See [`josh gate`](josh-commands.md#josh-gate) and [x](josh-commands.md#josh-run-step).\n'

		expect(broken_cross_page_anchors('docs/how-to.md', text)).toEqual([
			'docs/how-to.md → docs/josh-commands.md#josh-run-step',
		])
	})
})
