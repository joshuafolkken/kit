import { styleText } from 'node:util'
import { run_board_fit } from './run-board-fit'
import type { BoardLinks, Link } from './run-board-link'

// The header's first column (`run-board-header.ts`): the board's name and the run's state over the kit
// version the run's supervisor runs, over the repository the run is in. The name links to kit and the
// version to its releases, so a board still drawing an old supervisor's version reads as one that has
// not handed over to the merged code yet.

const BOARD_NAME = 'josh-board'
const KIT_URL = 'https://github.com/joshuafolkken/kit'
const RELEASES_URL = `${KIT_URL}/releases`
const UNKNOWN = '-'
const BLANK = ' '

// `setup` is a run with no child running that is itself at work on a stage (`run-board-setup.ts`).
type RunMark = 'running' | 'setup' | 'idle' | 'human' | 'stopped'

type TextColor = Parameters<typeof styleText>[0]

// The run's state as a colored glyph before its name.
const RUN_MARKS: Readonly<Record<RunMark, { glyph: string; color: TextColor }>> = {
	running: { glyph: '▶', color: 'green' },
	setup: { glyph: '▶', color: 'green' },
	idle: { glyph: '⏸', color: 'yellow' },
	human: { glyph: '✋', color: 'magenta' },
	stopped: { glyph: '■', color: 'gray' },
}

// What the column is drawn from.
interface NameFields extends Pick<BoardLinks, 'comment_link' | 'repo_link'> {
	// A single run's name (`run-board-single.ts`); `undefined` draws the board's.
	run_name?: string | undefined
	// The kit version the supervisor recorded (`run-wake.ts`); `undefined` draws `-`.
	kit_version?: string | undefined
	// The repository as `owner/repo`; `undefined` before a plan is read.
	repo: string | undefined
}

// `text` linked to `url` where the frame opens links, plain where it does not.
function linked(text: string, url: string, link: Link | undefined): string {
	return link === undefined ? text : link(text, url)
}

// The mark stands still in every state: the spinner turns on the third line.
function run_part(mark: RunMark, fields: NameFields): string {
	const { glyph, color } = RUN_MARKS[mark]
	const name = fields.run_name ?? linked(BOARD_NAME, KIT_URL, fields.comment_link)

	return styleText(color, `${glyph} ${name}`)
}

// A cell under the run's name, past the mark's columns.
function indented(mark: RunMark, cell: string): string {
	const indent = run_board_fit.width_of(RUN_MARKS[mark].glyph) + BLANK.length

	return `${BLANK.repeat(indent)}${cell}`
}

function version_part(fields: NameFields): string {
	const { kit_version, comment_link } = fields

	return kit_version === undefined ? UNKNOWN : linked(kit_version, RELEASES_URL, comment_link)
}

// The repository's own name — `kit` of `owner/kit` — so a board open beside another repository's is
// told apart. Blank before a plan names one.
function repo_part(fields: NameFields): string {
	const name = fields.repo?.split('/').at(-1) ?? ''

	return fields.repo_link(name, 'home')
}

// The column's three cells, top to bottom, before the column pads them to one width.
function names_of(mark: RunMark, fields: NameFields): Array<string> {
	return [
		run_part(mark, fields),
		indented(mark, version_part(fields)),
		indented(mark, repo_part(fields)),
	]
}

const run_board_header_names = { BOARD_NAME, names_of }

export { run_board_header_names }
export type { RunMark }
