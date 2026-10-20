import {
	run_board_fit,
	type DetailPart,
	type FrameParts,
	type NotesPart,
	type PlanSection,
	type SectionKey,
	type TerminalSize,
} from './run-board-fit'
import { run_board_render_section } from './run-board-render-section'

// A live `run:board`'s sections folded and unfolded by one key each (joshuafolkken/kit#4172): every
// section starts unfolded, and what a person folds holds until the board closes — it is never saved.
// A folded section is its heading alone, led by ▸ and saying what it holds, and the rows it gave up go
// to the other sections before `run-board-fit.ts` cuts anything; an unfolded one's heading is led by ▾.

const { folded_head, open_head } = run_board_render_section
const SECTION_KEYS: ReadonlyMap<string, SectionKey> = new Map([
	['l', 'lanes'],
	['p', 'processes'],
	['f', 'findings'],
	['q', 'queued'],
	['w', 'waiting'],
	['d', 'done'],
])
const ALL_KEY = 'a'
const SECTIONS: ReadonlyArray<SectionKey> = [...SECTION_KEYS.values()]
const KEYS_LINE = ` ${[...SECTION_KEYS.keys()].join(' ')}: fold · ${ALL_KEY}: all · Ctrl-C: quit`

// The live terminal a frame is kept within, the footer the frame ends on and gives way first, and the
// sections a person folded; none for a frame that is not redrawn in place, which is drawn as it was.
interface FrameBounds {
	size?: TerminalSize | undefined
	footer?: ReadonlyArray<string> | undefined
	folded?: ReadonlySet<SectionKey> | undefined
}

interface Headed {
	head: ReadonlyArray<string>
	is_folded?: boolean | undefined
}

function flipped(folded: ReadonlySet<SectionKey>, section: SectionKey): ReadonlySet<SectionKey> {
	const rest = [...folded].filter((key) => key !== section)

	return new Set(folded.has(section) ? rest : [...rest, section])
}

// What a key leaves folded: `a` folds every section, or unfolds them all once every one is folded; a key
// that names no section leaves it as it was.
function toggled(folded: ReadonlySet<SectionKey>, key: string): ReadonlySet<SectionKey> {
	if (key === ALL_KEY) return new Set(folded.size === SECTIONS.length ? [] : SECTIONS)

	const section = SECTION_KEYS.get(key)

	return section === undefined ? folded : flipped(folded, section)
}

// A part's heading: ▾ while it is open, its one ▸ line saying `summary` once it is folded.
function headed<Part extends Headed>(part: Part, label: string, summary: string | undefined): Part {
	if (summary === undefined) return { ...part, head: open_head(part.head, label) }

	return { ...part, head: folded_head(label, summary), is_folded: true }
}

// A folded section counts its rows.
function fold_section(section: PlanSection, folded: ReadonlySet<SectionKey>): PlanSection {
	const { key, label } = section

	if (key === undefined || label === undefined) return section
	if (!folded.has(key)) return headed(section, label, undefined)

	const count = section.lines.filter((line) => line.row !== undefined).length

	return { ...headed(section, label, String(count)), lines: [] }
}

// The findings count every one there is, the ones past the section's limit too; with none there is no
// section to fold.
function fold_notes(notes: NotesPart, folded: ReadonlySet<SectionKey>): NotesPart {
	const { label } = notes

	if (label === undefined || notes.lines.length === 0) return notes
	if (!folded.has('findings')) return headed(notes, label, undefined)

	const count = String(notes.lines.length + notes.hidden)

	return { ...headed(notes, label, count), lines: [], hidden: 0 }
}

// The processes say each group's totals.
function fold_processes(
	part: DetailPart | undefined,
	folded: ReadonlySet<SectionKey>,
): DetailPart | undefined {
	if (part?.label === undefined) return part
	if (!folded.has('processes')) return headed(part, part.label, undefined)

	return { ...headed(part, part.label, part.summary ?? ''), lines: [] }
}

function fold_parts(parts: FrameParts, folded: ReadonlySet<SectionKey>): FrameParts {
	return {
		...parts,
		plan: parts.plan.map((section) => fold_section(section, folded)),
		below: parts.below?.map((section) => fold_section(section, folded)),
		processes: fold_processes(parts.processes, folded),
		notes: fold_notes(parts.notes, folded),
	}
}

// A live frame is kept within its terminal, folded as a person folded it; any other is drawn whole.
function bounded(parts: FrameParts, bounds: FrameBounds): Array<string> {
	const { size, folded } = bounds
	const shown = folded === undefined ? parts : fold_parts(parts, folded)

	return size === undefined ? run_board_fit.whole(shown) : run_board_fit.fit(shown, size)
}

const run_board_fold = { KEYS_LINE, bounded, fold_parts, toggled }

export { run_board_fold }
export type { FrameBounds }
