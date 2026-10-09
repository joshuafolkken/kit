import type { BusyRead } from '#scripts/epic/epic-busy'
import { epic_classify } from '#scripts/epic/epic-classify'
import { epic_cross_repo } from '#scripts/epic/epic-cross-repo'
import { epic_graph, type EpicChild } from '#scripts/epic/epic-graph'
import { epic_outside_blocker } from '#scripts/epic/epic-outside-blocker'
import { epic_report, type EpicNextResult } from '#scripts/epic/epic-report'
import {
	has_label_name,
	IN_PROGRESS_LABEL,
	NEEDS_DECISION_LABEL,
} from '#scripts/issue/issue-labels'
import { backlog_plan, type PlanContext } from './backlog-plan'
import { backlog_rank, type GateScope } from './backlog-rank'

// The order a `backlogrun` takes, wave by wave, before it starts.
//
// `backlog:next` answers one ask — what may start now — and `backlog:plan` shows the pool that ask is
// made from, so the order past the first answer was left for a person to work out by hand. This plays
// the asks forward under one assumption: **every issue of a wave merges before the next wave starts**.
//
// **No rule is written twice.** The first wave is `backlog_rank.select` — rank, `run:solo` gate,
// restructure separation, cap —
// over the very candidates `backlog:next` resolves, asked of an idle repository — so it is what
// `backlog:next` prints when nothing is running. Each later wave marks the earlier waves closed and re-classifies the same pool
// through `epic_classify.classify_children` with the resolver `epic:next` sorted it with the first
// time — `epic_cross_repo.resolve_cross_repo`, so a blocker in another repository still waits for its
// release rather than counting as done on close — then puts the runnable set through
// `backlog_rank.select` again.

const IDLE: BusyRead = { kind: 'idle' }
const CLOSED = 'CLOSED'
const EMPTY_SCOPE: GateScope = { standalone: new Set(), declared: new Map() }

const HEADING_ASSUMPTION =
	'Assumes every issue in a wave merges before the next wave starts. Issues a run already has are left out, and only issues of this repository are planned.'
const UNREACHED_HEADING = 'Not reached — each names what it is waiting on:'
const PARALLEL_NOTE = '(parallel)'
const NEEDS_DECISION_NOTE = `waiting on a person (\`${NEEDS_DECISION_LABEL}\`)`
const NOT_REACHED_NOTE = 'not reached by the waves above'
const WAVE_GAP_WIDTH = 2
const PARALLEL_GAP_WIDTH = 3
const WAVE_GAP = ' '.repeat(WAVE_GAP_WIDTH)
const PARALLEL_GAP = ' '.repeat(PARALLEL_GAP_WIDTH)

interface WavePlan {
	waves: ReadonlyArray<ReadonlyArray<EpicChild>>
	unreached: ReadonlyArray<EpicChild>
}

function is_running(child: EpicChild): boolean {
	return has_label_name(child.labels, IN_PROGRESS_LABEL)
}

function as_closed(child: EpicChild, done: ReadonlySet<string>): EpicChild {
	return done.has(epic_graph.key_of(child)) ? { ...child, state: CLOSED } : child
}

// The pool a wave is chosen from. A running issue is left out of it but kept in `running`, so a child
// behind it waits on it rather than being handed to a person.
interface WavePool {
	children: ReadonlyArray<EpicChild>
	running: ReadonlySet<string>
	repo: string
	scope: GateScope
}

function pool_of(result: EpicNextResult, repo: string, scope: GateScope): WavePool {
	const all = backlog_rank.everything_in(result)

	return {
		children: all.filter((child) => !is_running(child)),
		running: epic_outside_blocker.running_keys(all),
		repo,
		scope,
	}
}

function offer(
	candidates: ReadonlyArray<EpicChild>,
	children: ReadonlyArray<EpicChild>,
	pool: WavePool,
): ReadonlyArray<EpicChild> {
	const { repo, scope } = pool

	return backlog_rank.select({ candidates, pool: children, read: IDLE, repo, ...scope }).offered
}

// Ranked against the whole result, exactly as `backlog:next` ranks it, so the two agree.
function first_wave(result: EpicNextResult, pool: WavePool): ReadonlyArray<EpicChild> {
	const candidates = epic_report.candidates_for_repo(result, pool.repo)

	return offer(candidates, backlog_rank.everything_in(result), pool)
}

function next_wave(pool: WavePool, done: ReadonlySet<string>): ReadonlyArray<EpicChild> {
	const children = pool.children.map((child) => as_closed(child, done))
	const { runnable } = epic_classify.classify_children(
		children,
		epic_cross_repo.resolve_cross_repo,
		pool.running,
	)

	return offer(
		runnable.filter((child) => child.repo === pool.repo),
		children,
		pool,
	)
}

// Each wave is closed before the next is asked for; a wave that offers nothing ends the plan, which
// the pool's size bounds because every wave closes at least one child. `scope` names the rows the
// offer's cap bounds and the paths each issue restructures; left empty, no wave is capped or separated.
function build(result: EpicNextResult, repo: string, scope: GateScope = EMPTY_SCOPE): WavePlan {
	const pool = pool_of(result, repo, scope)
	const done = new Set<string>()
	const waves: Array<ReadonlyArray<EpicChild>> = []

	for (let wave = first_wave(result, pool); wave.length > 0; wave = next_wave(pool, done)) {
		waves.push(wave)
		for (const child of wave) done.add(epic_graph.key_of(child))
	}

	const unreached = backlog_rank
		.everything_in(result)
		.filter((child) => child.repo === repo && !done.has(epic_graph.key_of(child)))

	return { waves, unreached }
}

// The plan's own "waiting on" wording is reused, so an unreached issue names its blocker the way the
// plan's waiting section does. Its "past the offer" fallback means nothing across waves, so it reads
// as not reached instead.
function unreached_note(child: EpicChild, context: PlanContext): string {
	if (has_label_name(child.labels, NEEDS_DECISION_LABEL)) return NEEDS_DECISION_NOTE
	const note = backlog_plan.waiting_note(child, context)

	return note === backlog_plan.PAST_OFFER_NOTE ? NOT_REACHED_NOTE : note
}

function wave_line(wave: ReadonlyArray<EpicChild>, index: number, repo: string): string {
	const references = wave.map((child) => backlog_plan.marked_reference(child, repo)).join(' ')
	const suffix = wave.length > 1 ? `${PARALLEL_GAP}${PARALLEL_NOTE}` : ''

	return `Wave ${String(index + 1)}${WAVE_GAP}${references}${suffix}`
}

function unreached_lines(plan: WavePlan, context: PlanContext): Array<string> {
	return plan.unreached.map((child) =>
		backlog_plan.row_of(child, context, unreached_note(child, context)),
	)
}

function format_waves(
	result: EpicNextResult,
	context: PlanContext,
	scope: GateScope = EMPTY_SCOPE,
): string {
	if (result.verdict === 'error') return backlog_plan.format_unusable(result)

	const plan = build(result, context.repo, scope)
	const waves = plan.waves.map((wave, index) => wave_line(wave, index, context.repo))

	return [
		`Backlog waves — ${context.repo}`,
		HEADING_ASSUMPTION,
		'',
		...(waves.length === 0 ? [backlog_plan.NOTHING] : waves),
		'',
		backlog_plan.section(UNREACHED_HEADING, unreached_lines(plan, context)),
	].join('\n')
}

const backlog_waves = {
	HEADING_ASSUMPTION,
	NEEDS_DECISION_NOTE,
	PARALLEL_NOTE,
	UNREACHED_HEADING,
	build,
	format_waves,
}

export { backlog_waves }
export type { WavePlan }
