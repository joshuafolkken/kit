import path from 'node:path'
import { issue_cite } from '#scripts/issue/issue-cite'
import {
	run_board_usage,
	type ProcessFigures,
	type UsageFigure,
	type UsageMark,
} from './run-board-usage'

// Which part of the machine each process's usage is put under on `run:board`'s 💻 processes section:
// the backlogrun itself — its supervisor, the session that holds the run, its lanes — the apps outside
// it, or what a closed lane left running (joshuafolkken/kit#4171).
// **A lane's processes are found by working directory, the rest by ancestry.** A process under
// `.kit-lanes/<N>` is that lane's while the lane is open and left over once it is closed — a detached
// `eslint_d` is re-parented to launchd, so no ancestry reaches it. The supervisor and the session are
// found by walking each process's parents up to the nearest of the two; anything else is an app, named
// by its bundle or its command, so a Claude session that is not this run's is an app too.

const APP_SUFFIX = '.app'
const COMMAND_SEPARATOR = ' '
// How many apps the section names, the largest by memory first.
const APP_LIMIT = 4

// The backlogrun's own processes: its supervisor (`run-wake-cli --loop`, `backlog:drive` beneath it)
// and the session that holds the run. Either is `undefined` where it is not running.
interface ProcessRoots {
	supervisor?: number | undefined
	parent?: number | undefined
}

// What the grouping reads besides the figures: the open lanes by issue number.
interface GroupSources {
	mark: UsageMark
	figures: ProcessFigures
	open_lanes: ReadonlySet<number>
	roots: ProcessRoots
}

interface NamedFigure {
	name: string
	// How many separate runs of it there are — a process whose parent is of the same name is one of
	// that one's helpers, not another run.
	instances: number
	figure: UsageFigure
}

interface ProcessGroups {
	backlogrun: {
		total: UsageFigure
		supervisor: UsageFigure
		parent: UsageFigure
		lanes: { count: number; figure: UsageFigure }
	}
	apps: { total: UsageFigure; top: ReadonlyArray<NamedFigure> }
	leftover: { total: UsageFigure; entries: ReadonlyArray<NamedFigure> }
}

type Membership =
	{ kind: 'lane' | 'leftover'; lane: number } | { kind: 'supervisor' | 'parent' } | { kind: 'app' }

// An app's name: the outermost `.app` bundle its executable sits in, else its command's own name.
function app_of(command: string): string {
	const bundle = command.split(path.sep).find((part) => part.endsWith(APP_SUFFIX))

	if (bundle !== undefined) return bundle.slice(0, -APP_SUFFIX.length)

	const executable = command.startsWith(path.sep) ? command : command.split(COMMAND_SEPARATOR)[0]

	return path.basename(executable ?? command)
}

// A process and its ancestors, the nearest first — at most once round the parents.
function ancestry(pid: number, mark: UsageMark): Array<number> {
	const line = [pid]

	for (let ancestor = mark.parents.get(pid); ancestor !== undefined;) {
		if (line.length > mark.parents.size) break
		line.push(ancestor)
		ancestor = mark.parents.get(ancestor)
	}

	return line
}

// The nearest of the backlogrun's roots a process is, or descends from.
function root_of(pid: number, mark: UsageMark, roots: ProcessRoots): Membership | undefined {
	const root = ancestry(pid, mark).find((ancestor) =>
		[roots.supervisor, roots.parent].includes(ancestor),
	)

	if (root === undefined) return undefined

	return { kind: root === roots.supervisor ? 'supervisor' : 'parent' }
}

function membership_of(pid: number, sources: GroupSources): Membership {
	const lane = sources.mark.lanes.get(pid)

	if (lane === undefined) return root_of(pid, sources.mark, sources.roots) ?? { kind: 'app' }

	const number = Number(lane)

	return { kind: sources.open_lanes.has(number) ? 'lane' : 'leftover', lane: number }
}

function name_of(pid: number, mark: UsageMark): string {
	return app_of(mark.names.get(pid) ?? '')
}

function figures_where(
	sources: GroupSources,
	memberships: ReadonlyMap<number, Membership>,
	kind: Membership['kind'],
): Map<number, UsageFigure> {
	return new Map([...sources.figures].filter(([pid]) => memberships.get(pid)?.kind === kind))
}

// A group's members by name, each named group's instances counted, the largest by memory first.
function named_figures(
	figures: ProcessFigures,
	mark: UsageMark,
	label_of: (pid: number) => string,
): Array<NamedFigure> {
	const sums = run_board_usage.grouped_sums(figures, label_of)
	const runs = [...figures.keys()].filter((pid) => {
		const parent = mark.parents.get(pid)

		return parent === undefined || !figures.has(parent) || label_of(parent) !== label_of(pid)
	})
	const named = [...sums].map(([name, figure]) => {
		const instances = runs.filter((pid) => label_of(pid) === name).length

		return { name, instances, figure }
	})

	return named.toSorted((left, right) => right.figure.memory_bytes - left.figure.memory_bytes)
}

function leftover_label(pid: number, sources: GroupSources): string {
	return `${name_of(pid, sources.mark)} ${issue_cite.plain(sources.mark.lanes.get(pid) ?? '')}`
}

function backlogrun_of(
	sources: GroupSources,
	memberships: ReadonlyMap<number, Membership>,
): ProcessGroups['backlogrun'] {
	const [supervisor, parent, lanes] = [
		run_board_usage.sum_of(figures_where(sources, memberships, 'supervisor').values()),
		run_board_usage.sum_of(figures_where(sources, memberships, 'parent').values()),
		run_board_usage.usage_of(sources.mark, figures_where(sources, memberships, 'lane')),
	]
	const lane_figure = run_board_usage.sum_of(lanes.values())

	return {
		total: run_board_usage.sum_of([supervisor, parent, lane_figure]),
		supervisor,
		parent,
		lanes: { count: lanes.size, figure: lane_figure },
	}
}

function groups_of(sources: GroupSources): ProcessGroups {
	const { figures, mark } = sources
	const memberships = new Map([...figures.keys()].map((pid) => [pid, membership_of(pid, sources)]))
	const apps = figures_where(sources, memberships, 'app')
	const leftover = figures_where(sources, memberships, 'leftover')

	return {
		backlogrun: backlogrun_of(sources, memberships),
		apps: {
			total: run_board_usage.sum_of(apps.values()),
			top: named_figures(apps, mark, (pid) => name_of(pid, mark)).slice(0, APP_LIMIT),
		},
		leftover: {
			total: run_board_usage.sum_of(leftover.values()),
			entries: named_figures(leftover, mark, (pid) => leftover_label(pid, sources)),
		},
	}
}

const run_board_process_groups = { app_of, groups_of }

export { run_board_process_groups }
export type { GroupSources, NamedFigure, ProcessGroups, ProcessRoots }
