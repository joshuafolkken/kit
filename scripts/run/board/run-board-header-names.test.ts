import { stripVTControlCharacters } from 'node:util'
import { describe, expect, it } from 'vitest'
import { run_board_header_names } from './run-board-header-names'

const KIT_URL = 'https://github.com/joshuafolkken/kit'
const RELEASES_URL = `${KIT_URL}/releases`
const VERSION = 'v1.3153.0+12'
const REPO = 'joshuafolkken/kit'
const RUN_NAME = 'fullrun #7'

// Links drawn as Markdown, so a test reads what each cell links to.
function markdown_link(text: string, url: string): string {
	return `[${text}](${url})`
}

function names(
	fields: Partial<Parameters<typeof run_board_header_names.names_of>[1]> = {},
): Array<string> {
	const cells = run_board_header_names.names_of('running', {
		repo: REPO,
		repo_link: (text, page) => `[${text}](${page})`,
		comment_link: markdown_link,
		...fields,
	})

	return cells.map((cell) => stripVTControlCharacters(cell))
}

describe('run_board_header_names.names_of', () => {
	it('names the board, linked to kit, on the first line', () => {
		expect(names()[0]).toBe(`▶ [josh-board](${KIT_URL})`)
	})

	it('keeps a single run’s own name in the board’s place', () => {
		expect(names({ run_name: RUN_NAME })[0]).toBe(`▶ ${RUN_NAME}`)
	})

	// joshuafolkken/kit#8604: a themed screen names the board after its theme.
	it.each([
		['wopr', 'josh-wopr'],
		['trace', 'josh-trace'],
	] as const)('names the board %s draws %s', (theme, name) => {
		expect(names({ theme })[0]).toBe(`▶ [${name}](${KIT_URL})`)
	})

	it('keeps a single run’s own name in a themed screen too', () => {
		expect(names({ theme: 'wopr', run_name: RUN_NAME })[0]).toBe(`▶ ${RUN_NAME}`)
	})

	it('draws the recorded kit version, linked to the releases, under the name', () => {
		expect(names({ kit_version: VERSION })[1]).toBe(`  [${VERSION}](${RELEASES_URL})`)
	})

	it('draws - where no supervisor recorded a version', () => {
		expect(names()[1]).toBe('  -')
	})

	it('draws the repository’s own name, linked to its top, on the third line', () => {
		expect(names().at(-1)).toBe('  [kit](home)')
	})

	// joshuafolkken/kit#8107: the speaker moved to the end of the second line.
	it('draws no sound mark after the name', () => {
		expect(names()[0]).not.toMatch(/[🔊🔇]/u)
	})

	it('draws the names plain where the frame opens no links', () => {
		expect(names({ kit_version: VERSION, comment_link: undefined }).slice(0, -1)).toStrictEqual([
			'▶ josh-board',
			`  ${VERSION}`,
		])
	})
})
