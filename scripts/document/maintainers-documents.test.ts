import { readdirSync, readFileSync } from 'node:fs'
import { package_file } from '#scripts/claude/skill-fixture'
import { safe_chain_preinstall } from '#scripts/safe-chain/preinstall-command'
import { describe, expect, it } from 'vitest'
import { linked_paths, read_document, read_unwrapped } from './ai-document-fixture'

// Maintainer content sits apart from the user documentation (joshuafolkken/kit#2993): one index
// reaches every maintainer page, the user lists reach that index instead of the pages, and the
// user guides carry neither kit's internal script paths, verification records nor Issue links.
const MAINTAINERS_DIRECTORY = 'docs/maintainers'
const MAINTAINERS_INDEX = `${MAINTAINERS_DIRECTORY}/README.md`
const RELEASE_PAGE = `${MAINTAINERS_DIRECTORY}/release.md`
const README = 'README.md'
const OVERVIEW = 'docs/overview.md'
const HOW_TO_INDEX = 'docs/how-to.md'
const TROUBLESHOOTING = 'docs/troubleshooting.md'
const ENTRY_DOCUMENTS: ReadonlyArray<string> = [README, OVERVIEW, HOW_TO_INDEX]
const USER_DOCS_DIRECTORY = 'docs'
// Maintainer pages announce their audience with either phrase: the index-level pages say "For kit
// maintainers", the rationale pages say "maintainer-only".
const MAINTAINER_AUDIENCE_MARKERS: ReadonlyArray<string> = [
	'For kit maintainers',
	'maintainer-only',
]
const USER_GUIDE_PAGES: ReadonlyArray<string> = [
	OVERVIEW,
	'docs/tutorial.md',
	HOW_TO_INDEX,
	TROUBLESHOOTING,
]
const USER_GUIDE_DIRECTORIES: ReadonlyArray<string> = ['docs/how-to', 'docs/setup']
const ISSUE_LINK = /\[#\d+\]\(/u
const INTERNAL_SCRIPT_PATH = /`scripts\/[\w/-]+\.ts`/u
const VERIFYING_HEADING = '## Verifying this guide'
const GITHUB_PACKAGES_ERROR = '401 Unauthorized'
const FIRST_SECTION = /^## (.+)$/mu
const SECURITY = 'SECURITY.md'
const RELEASES_URL = 'https://github.com/joshuafolkken/kit/releases'
const SECRETS: ReadonlyArray<string> = [
	'TELEGRAM_BOT_TOKEN',
	'TELEGRAM_CHAT_ID',
	'SONAR_TOKEN',
	'GITHUB_TOKEN',
	'GH_TOKEN',
	'NODE_AUTH_TOKEN',
]
const HEADING_LINE = /^#{2,} (.+)$/gmu
const INSTALLER_PIN_KEYS: ReadonlyArray<string> = [
	'SAFE_CHAIN_INSTALLER_VERSION',
	'SAFE_CHAIN_INSTALLER_SHA256',
]
// A verbatim quote of a Japanese prompt heading or literal sits in a code span, a fence or double
// quotes (`docs/maintainers/README.md` → "Language"); everything else is English.
const QUOTED_SPANS = /```[\s\S]*?```|`[^`\n]*`|"[^"\n]*"/gu
const JAPANESE = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u

// GitHub's anchor for a plain-text heading: lower case, spaces as hyphens.
function heading_anchors(text: string): Array<string> {
	return [...text.matchAll(HEADING_LINE)].map((match) =>
		(match[1] ?? '').toLowerCase().replaceAll(' ', '-'),
	)
}

interface Manifest {
	files: Array<string>
}

function markdown_in(directory: string): Array<string> {
	return readdirSync(package_file(directory), { encoding: 'utf8' })
		.filter((entry) => entry.endsWith('.md'))
		.map((entry) => `${directory}/${entry}`)
}

function markdown_under(directory: string): Array<string> {
	return readdirSync(package_file(directory), { encoding: 'utf8', recursive: true })
		.filter((entry) => entry.endsWith('.md'))
		.map((entry) => `${directory}/${entry}`)
}

function user_guides(): Array<string> {
	return [
		...USER_GUIDE_PAGES,
		...USER_GUIDE_DIRECTORIES.flatMap((directory) => markdown_in(directory)),
	]
}

function published_entries(): Array<string> {
	const manifest = JSON.parse(readFileSync(package_file('package.json'), 'utf8')) as Manifest

	return manifest.files.filter((entry) => !entry.startsWith('!'))
}

describe('the maintainer documentation language', () => {
	it.each(markdown_under(MAINTAINERS_DIRECTORY))('%s carries no Japanese prose', (path) => {
		expect(read_document(path).replaceAll(QUOTED_SPANS, '')).not.toMatch(JAPANESE)
	})

	it('reads a quoted Japanese heading as a quote, not as prose', () => {
		const quoted = 'See `wip-cap.md` → "規則" and `## 背景`.'

		expect(quoted.replaceAll(QUOTED_SPANS, '')).not.toMatch(JAPANESE)
		expect('The 規則 section.'.replaceAll(QUOTED_SPANS, '')).toMatch(JAPANESE)
	})
})

describe('the maintainer documentation', () => {
	it('indexes every maintainer page', () => {
		const linked = new Set(linked_paths(MAINTAINERS_INDEX))
		const pages = markdown_in(MAINTAINERS_DIRECTORY)

		expect(pages.filter((path) => path !== MAINTAINERS_INDEX && !linked.has(path))).toStrictEqual(
			[],
		)
	})

	// joshuafolkken/kit#3343: a page addressed to maintainers lives under the maintainers directory,
	// so the user documentation root holds none.
	it('keeps every maintainer-only page out of the user documentation root', () => {
		const pages = markdown_in(USER_DOCS_DIRECTORY)

		expect(
			pages.filter((path) => {
				const text = read_unwrapped(path)

				return MAINTAINER_AUDIENCE_MARKERS.some((marker) => text.includes(marker))
			}),
		).toStrictEqual([])
	})

	it.each(ENTRY_DOCUMENTS)('%s links to the maintainer index', (path) => {
		expect(linked_paths(path)).toContain(MAINTAINERS_INDEX)
	})

	it('keeps the release procedure out of the how-to index', () => {
		expect(linked_paths(HOW_TO_INDEX)).not.toContain(RELEASE_PAGE)
	})

	it.each(user_guides())('%s carries no Issue link, script path or verification record', (path) => {
		const text = read_document(path)

		expect(text).not.toMatch(ISSUE_LINK)
		expect(text).not.toMatch(INTERNAL_SCRIPT_PATH)
		expect(text).not.toContain(VERIFYING_HEADING)
	})

	it('opens troubleshooting with an error a new install can meet', () => {
		const first_section = FIRST_SECTION.exec(read_document(TROUBLESHOOTING))?.[1] ?? ''

		expect(first_section).not.toBe('')
		expect(first_section).not.toContain(GITHUB_PACKAGES_ERROR)
	})
})

describe('the security policy', () => {
	// The closing backtick or slash keeps `lefthook` from being satisfied by `lefthook install`.
	it.each(published_entries())('names the published entry %s', (entry) => {
		const text = read_document(SECURITY)

		expect([`\`${entry}\``, `\`${entry}/\``].some((form) => text.includes(form))).toBe(true)
	})

	it.each(SECRETS)('names the secret %s', (secret) => {
		expect(read_document(SECURITY)).toContain(secret)
	})

	// joshuafolkken/kit#3269: the preinstall warning links here instead of installing safe-chain.
	it('holds the install section the preinstall warning links to', () => {
		expect(heading_anchors(read_document(SECURITY))).toContain(
			safe_chain_preinstall.INSTALL_GUIDE_ANCHOR,
		)
	})

	it.each(INSTALLER_PIN_KEYS)('verifies the installer against the pinned %s', (key) => {
		expect(read_document(SECURITY)).toContain(`\`${key}\``)
	})

	it('is reachable from the README beside the release notes', () => {
		expect(linked_paths(README)).toContain(SECURITY)
		expect(read_document(README)).toContain(RELEASES_URL)
	})
})
