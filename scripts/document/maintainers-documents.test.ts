import { readdirSync, readFileSync } from 'node:fs'
import { package_file } from '#scripts/claude/skill-fixture'
import { safe_chain_preinstall } from '#scripts/safe-chain/preinstall-command'
import { describe, expect, it } from 'vitest'
import { linked_paths, read_document } from './ai-document-fixture'

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
const MAINTAINER_TOP_LEVEL_PAGES: ReadonlyArray<string> = ['docs/publishing.md', 'docs/eval.md']
const USER_GUIDE_PAGES: ReadonlyArray<string> = [
	OVERVIEW,
	'docs/tutorial.md',
	HOW_TO_INDEX,
	'docs/scripts-ai.md',
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
// The install command SECURITY.md names is the one `josh init` writes, minus the trailing warning check.
const PREINSTALL_SETUP_COMMAND = safe_chain_preinstall.SAFE_CHAIN_CMD.replace(
	` && ${safe_chain_preinstall.LOCAL_INTEGRATION_CHECK_CMD}`,
	'',
)

interface Manifest {
	files: Array<string>
}

function markdown_in(directory: string): Array<string> {
	return readdirSync(package_file(directory), { encoding: 'utf8' })
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

describe('the maintainer documentation', () => {
	it('indexes every maintainer page', () => {
		const linked = new Set(linked_paths(MAINTAINERS_INDEX))
		const pages = [...markdown_in(MAINTAINERS_DIRECTORY), ...MAINTAINER_TOP_LEVEL_PAGES]

		expect(pages.filter((path) => path !== MAINTAINERS_INDEX && !linked.has(path))).toStrictEqual(
			[],
		)
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

	it('names the preinstall command josh init writes', () => {
		expect(read_document(SECURITY)).toContain(`\`${PREINSTALL_SETUP_COMMAND}\``)
	})

	it('is reachable from the README beside the release notes', () => {
		expect(linked_paths(README)).toContain(SECURITY)
		expect(read_document(README)).toContain(RELEASES_URL)
	})
})
