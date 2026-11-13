import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { DrivePorts } from '#scripts/backlog/backlog-drive'
import type { DriveLaunch } from '#scripts/backlog/backlog-drive-launch-pass'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { run_startup } from '#scripts/run/startup/run-startup'
import type { MeasureBoundary, MeasureScenario } from './backlog-measure-schema'

function unexpected(): never {
	throw new Error('Measurement reached an unspecified lifecycle boundary')
}

async function ignored(): Promise<void> {
	return undefined
}

function replacement(
	issue: string,
	context: {
		scenario: MeasureScenario
		workers: string
		records: Array<MeasureBoundary>
	},
): DriveLaunch {
	const outcome = context.scenario.outcomes[issue] ?? 'launched'

	mkdirSync(context.workers, { recursive: true })
	writeFileSync(path.join(context.workers, issue), outcome, { flag: 'wx' })
	context.records.push({
		attempt: '',
		source: 'replacement',
		operation: `worker ${issue}: ${outcome}`,
	})

	return outcome
}

function replacement_edge(outcome: DriveLaunch): 'done' | 'failed' | 'waiting' {
	if (outcome === 'waiting') return 'waiting'

	return outcome === 'launched' ? 'done' : 'failed'
}

function launch_of(
	scenario: MeasureScenario,
	workers: string,
	records: Array<MeasureBoundary>,
): DrivePorts['launch'] {
	const started = new Set(scenario.in_flight)

	return async function launch(issue: string): Promise<DriveLaunch> {
		if (!issue_number_shape.is_issue_number(issue)) throw new Error('Invalid worker issue')
		if (started.has(issue)) throw new Error(`Duplicate worker: ${issue}`)
		started.add(issue)

		return await run_startup.phase(
			'simulated worker',
			async () => replacement(issue, { scenario, workers, records }),
			{ issue, edge_of: replacement_edge },
		)
	}
}

function capacity(
	scenario: MeasureScenario,
): Pick<DrivePorts, 'free_lanes' | 'limit_room' | 'has_lane' | 'memory_held' | 'usage_limited'> {
	return {
		free_lanes: async function free_lanes(): Promise<number> {
			return scenario.free_lanes
		},
		limit_room: async function limit_room(): Promise<number> {
			return scenario.free_lanes
		},
		has_lane: async function has_lane(): Promise<boolean> {
			return false
		},
		memory_held: async function memory_held(): Promise<boolean> {
			return scenario.memory_held
		},
		usage_limited: async function usage_limited(): Promise<boolean> {
			return scenario.usage_limited
		},
	}
}

type Lifecycle = Pick<
	DrivePorts,
	| 'now'
	| 'adoptable'
	| 'is_finished'
	| 'judgement_owed'
	| 'yields'
	| 'hold'
	| 'idle'
	| 'paused'
	| 'merge'
	| 'offer'
	| 'park'
	| 'retrospective'
>

async function empty_issues(): Promise<Array<string>> {
	return []
}

function lifecycle(): Lifecycle {
	return {
		now: function now(): Date {
			return new Date()
		},
		adoptable: empty_issues,
		is_finished: function is_finished(): boolean {
			return false
		},
		judgement_owed: async function judgement_owed(): Promise<number> {
			return 0
		},
		yields: empty_issues,
		hold: ignored,
		idle: ignored,
		paused: ignored,
		merge: unexpected,
		offer: unexpected,
		park: unexpected,
		retrospective: unexpected,
	}
}

function ports_of(
	scenario: MeasureScenario,
	workers: string,
	records: Array<MeasureBoundary>,
): DrivePorts {
	return {
		...capacity(scenario),
		...lifecycle(),
		launch: launch_of(scenario, workers, records),
		stall: async function stall(issue: string, outcome: DriveLaunch): Promise<void> {
			records.push({ attempt: '', source: 'replacement', operation: `stall ${issue}: ${outcome}` })
		},
	}
}

const backlog_measure_ports = { ports_of }
export { backlog_measure_ports }
