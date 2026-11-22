import { describe, expect, it } from 'vitest'
import { run_board_fit, type DetailPart } from './run-board-fit'
import { run_board_label_pair } from './run-board-label-pair'
import type { ProcessGroups } from './run-board-process-groups'
import { run_board_render_fixture } from './run-board-render-fixture'
import { run_board_render_processes } from './run-board-render-processes'
import { run_board_row_key } from './run-board-row-key'
import type { Theme } from './run-board-theme-defs'
import type { UsageFigure } from './run-board-usage'

// joshuafolkken/kit#4171: the 💻 section draws what is loading the machine by who started it — the
// backlogrun's own processes, the apps outside it and whatever a run left behind.

const { processes_part } = run_board_render_processes
const { GB, board_usage, header } = run_board_render_fixture
const { bare } = run_board_label_pair
// Groups stand at the shared row indent, parts two further in (joshuafolkken/kit#8257).
const GROUP_INDENT = run_board_fit.ROW_INDENT.length
const DETAIL_INDENT = GROUP_INDENT + 2
// The cells' column: the indent, the 22-column label and its blank — two right of the lane rows'
// cells, which the user accepted (joshuafolkken/kit#8257).
const CELLS_START = 28
// The CPU figure's columns at the cells' start: `49.0`, ` 2.8`.
const CPU_WIDTH = 4
const SPINNER = '⠋'
const RULE_START = '── 💻 processes '

function figure(cpu_cores: number, memory_gb: number, compressed_gb: number): UsageFigure {
	return { cpu_cores, memory_bytes: memory_gb * GB, compressed_bytes: compressed_gb * GB }
}

const BACKLOGRUN: ProcessGroups['backlogrun'] = {
	total: figure(4.9, 4, 3.3),
	supervisor: figure(0.1, 0.2, 0.1),
	parent: figure(0.3, 0.5, 0.4),
	lanes: { count: 3, figure: figure(4.5, 3.3, 2.8) },
}
const APPS: ProcessGroups['apps'] = {
	total: figure(3.1, 18.8, 12.4),
	top: [
		{ name: 'Google Chrome', instances: 2, figure: figure(0.2, 8.9, 8.1) },
		{ name: 'WindowServer', instances: 1, figure: figure(0.5, 0.6, 0.2) },
	],
}
const LEFTOVER: ProcessGroups['leftover'] = {
	total: figure(0.4, 0.3, 0.1),
	entries: [{ name: 'node', instances: 2, figure: figure(0.4, 0.3, 0.1) }],
}

// The part as a frame with no theme draws it, its labels' marks dropped (`run-board-label-pair.ts`).
function part_of(groups: Partial<ProcessGroups>, spinner?: string): DetailPart | undefined {
	const usages = board_usage(new Map(), groups)
	const part = processes_part(header({ spinner, usages }))

	if (part === undefined) return undefined

	return {
		...part,
		head: part.head.map((line) => bare(line)),
		lines: part.lines.map((line) => ({ ...line, text: bare(line.text) })),
	}
}

// The supervisor row's key on a theme's board; the matrix keys its rows to flash them.
function supervisor_key(supervisor_pid?: number, theme: Theme = 'matrix'): string | undefined {
	const usages = board_usage(new Map(), { backlogrun: { ...BACKLOGRUN, supervisor_pid } })
	const part = processes_part(header({ spinner: SPINNER, usages, theme }))
	const keys = part?.lines.map((line) => run_board_row_key.split_key(line.text).key)

	return keys?.find((key) => key?.includes('supervisor') === true)
}

describe('run_board_render_processes.processes_part supervisor key', () => {
	it('ac-3a46d3cd keys the supervisor row by its pid where the theme flashes', () => {
		expect(supervisor_key(123)).toMatch(/^flash:process:.*:supervisor:123$/u)
		expect(supervisor_key()).toMatch(/:supervisor$/u)
	})

	it('ac-068e8fdc leaves the wargames rows without keys and as drawn before', () => {
		const with_pid = part_of({ backlogrun: { ...BACKLOGRUN, supervisor_pid: 123 } }, SPINNER)

		expect(supervisor_key(123, 'wargames')).toBeUndefined()
		expect(with_pid).toStrictEqual(part_of({ backlogrun: BACKLOGRUN }, SPINNER))
	})
})

function texts(part: DetailPart | undefined): Array<string> {
	return part?.lines.map((line) => line.text.trimEnd()) ?? []
}

// The row's label: what stands before the cells' column — every icon drawn here two columns wide is
// two code units, so the column is the code unit.
function label_of(text: string): string {
	return text.slice(0, CELLS_START).trim()
}

function name_start(text: string, name: string): number {
	return run_board_fit.width_of(text.slice(0, text.indexOf(name)))
}

function cells_start(text: string): number {
	return run_board_fit.width_of(text.slice(0, text.search(/\d\.\d/u)))
}

describe('run_board_render_processes.processes_part on a terminal', () => {
	it('draws nothing where the frame read no usage', () => {
		expect(processes_part(header({ spinner: SPINNER }))).toBeUndefined()
	})

	it('heads the groups with a rule whose labels stand over the cells', () => {
		const rule = part_of({ backlogrun: BACKLOGRUN, apps: APPS }, SPINNER)?.head[1] ?? ''

		expect(rule.startsWith(RULE_START)).toBe(true)
		expect(rule).toContain('💪 CPU')
	})

	it('draws each group a line and its parts indented under it, the parts detail', () => {
		const lines = part_of({ backlogrun: BACKLOGRUN, apps: APPS }, SPINNER)?.lines ?? []

		expect(lines.map((line) => [label_of(line.text), line.is_detail])).toStrictEqual([
			['▶  backlogrun', false],
			['🧭 supervisor', true],
			['🎬 parent', true],
			['🧵 lanes ×3', true],
			['🌐 apps', false],
			['Google Chrome ×2', true],
			['WindowServer', true],
		])
	})

	it('starts every line cells in one column', () => {
		const lines = texts(part_of({ backlogrun: BACKLOGRUN, apps: APPS }, SPINNER))

		expect(new Set(lines.map((line) => cells_start(line))).size).toBe(1)
	})
})

describe('run_board_render_processes.processes_part columns', () => {
	// joshuafolkken/kit#4292, joshuafolkken/kit#8257: groups stand at the row indent, parts two further
	// in, cells in one column whatever the names.
	it('indents groups by the row indent and parts two further, and starts the cells in one column', () => {
		const name = 'A Rather Long Application Name'
		const long: ProcessGroups['apps'] = {
			total: figure(0.5, 1, 0.1),
			top: [{ name, instances: 1, figure: figure(0.5, 1, 0.1) }],
		}
		const lines = part_of({ backlogrun: BACKLOGRUN, apps: long }, SPINNER)?.lines ?? []

		for (const line of lines) {
			expect(line.text.search(/\S/u)).toBe(line.is_detail ? DETAIL_INDENT : GROUP_INDENT)
			expect(line.text.slice(CELLS_START - 1, CELLS_START)).toBe(' ')
		}

		expect(new Set(lines.map((line) => cells_start(line.text))).size).toBe(1)
	})

	it('starts the backlogrun and apps names in one column, the cells where they were', () => {
		const lines = texts(part_of({ backlogrun: BACKLOGRUN, apps: APPS }, SPINNER))
		const backlogrun = lines.find((line) => line.includes('backlogrun')) ?? ''
		const apps = lines.find((line) => line.includes('apps')) ?? ''

		expect(name_start(backlogrun, 'backlogrun')).toBe(name_start(apps, 'apps'))

		for (const line of [backlogrun, apps]) {
			expect(line.slice(CELLS_START - 1, CELLS_START)).toBe(' ')
			expect(line.slice(CELLS_START, CELLS_START + CPU_WIDTH).trim()).toMatch(/^\d+\.\d$/u)
		}
	})
})

function icon_of(text: string): string {
	return text.trim().split(' ', 1)[0] ?? ''
}

// joshuafolkken/kit#4223: a text-default icon is counted one column wide but drawn two, so it
// overlapped the blank after it and the cells after it stood a column off on screen.
describe('run_board_render_processes.processes_part icons', () => {
	it('marks the heading and the backlogrun parts with icons two columns wide', () => {
		const part = part_of({ backlogrun: BACKLOGRUN, apps: APPS }, SPINNER)
		const rule = (part?.head[1] ?? '').replace(/^─+/u, '')
		const parts = (part?.lines.slice(1, 4) ?? []).map((line) => line.text)
		const icons = [rule, ...parts].map((text) => icon_of(text))

		expect(icons.map((icon) => run_board_fit.width_of(icon))).toStrictEqual([2, 2, 2, 2])
	})
})

describe('run_board_render_processes.processes_part leftover', () => {
	it('draws no leftover group where no run left anything behind', () => {
		const labels = texts(part_of({}, SPINNER)).map((line) => label_of(line))

		expect(labels.at(-1)).toBe('🌐 apps')
		expect(labels.some((label) => label.startsWith('👻'))).toBe(false)
	})

	it('draws the leftover group and its entries where a run left them', () => {
		const labels = texts(part_of({ leftover: LEFTOVER }, SPINNER)).map((line) => label_of(line))

		expect(labels.slice(-2)).toStrictEqual(['👻 leftover', 'node ×2'])
	})
})

describe('run_board_render_processes.processes_part off a terminal', () => {
	it('draws the groups on one line of figures', () => {
		const part = part_of({ backlogrun: BACKLOGRUN, apps: APPS, leftover: LEFTOVER })

		expect(part?.head[1]?.startsWith(RULE_START)).toBe(true)
		expect(texts(part)).toStrictEqual([
			'     ▶  backlogrun 49.0%/4.0G/3.3G · 🌐 apps 31.0%/18.8G/12.4G: Google Chrome ×2 2.0%/8.9G/8.1G, ' +
				'WindowServer 5.0%/0.6G/0.2G · 👻 leftover 4.0%/0.3G/0.1G: node ×2 4.0%/0.3G/0.1G',
		])
	})

	it('draws a group with no parts as its figures alone', () => {
		expect(texts(part_of({}))).toStrictEqual([
			'     ▶  backlogrun 0.0%/0.0G/0.0G · 🌐 apps 0.0%/0.0G/0.0G',
		])
	})
})

describe('run_board_render_processes.processes_part summary', () => {
	it('labels the section and sums each group for its folded heading', () => {
		const part = part_of({ backlogrun: BACKLOGRUN, apps: APPS, leftover: LEFTOVER }, SPINNER)

		expect(part?.label).toBe('💻 processes')
		expect(part?.summary).toBe('▶ 49.0%/4.0G/3.3G ── 🌐 31.0%/18.8G/12.4G ── 👻 4.0%/0.3G/0.1G')
	})

	it('sums the groups alone where no run left anything behind', () => {
		expect(part_of({})?.summary).toBe('▶ 0.0%/0.0G/0.0G ── 🌐 0.0%/0.0G/0.0G')
	})
})
