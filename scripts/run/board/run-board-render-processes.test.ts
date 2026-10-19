import { describe, expect, it } from 'vitest'
import { run_board_fit, type DetailPart } from './run-board-fit'
import type { ProcessGroups } from './run-board-process-groups'
import { run_board_render_fixture } from './run-board-render-fixture'
import { run_board_render_processes } from './run-board-render-processes'
import type { UsageFigure } from './run-board-usage'

// joshuafolkken/kit#4171: the 🖥 section draws what is loading the machine by who started it — the
// backlogrun's own processes, the apps outside it and whatever a run left behind.

const { processes_part } = run_board_render_processes
const { GB, board_usage, header } = run_board_render_fixture
const SPINNER = '⠋'
const RULE_START = '── 🖥 processes '

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

function part_of(groups: Partial<ProcessGroups>, spinner?: string): DetailPart | undefined {
	const usages = board_usage(new Map(), groups)

	return processes_part(header({ spinner, usages }))
}

function texts(part: DetailPart | undefined): Array<string> {
	return part?.lines.map((line) => line.text.trimEnd()) ?? []
}

function label_of(text: string): string {
	return text.trim().split(/ {2,}/u, 1)[0] ?? ''
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
			['▶ backlogrun', false],
			['🧭 supervisor', true],
			['🎛 parent', true],
			['🛤 lanes ×3', true],
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
			'  ▶ backlogrun 4.9/4.0G/3.3G · 🌐 apps 3.1/18.8G/12.4G: Google Chrome ×2 0.2/8.9G/8.1G, ' +
				'WindowServer 0.5/0.6G/0.2G · 👻 leftover 0.4/0.3G/0.1G: node ×2 0.4/0.3G/0.1G',
		])
	})

	it('draws a group with no parts as its figures alone', () => {
		expect(texts(part_of({}))).toStrictEqual([
			'  ▶ backlogrun 0.0/0.0G/0.0G · 🌐 apps 0.0/0.0G/0.0G',
		])
	})
})
