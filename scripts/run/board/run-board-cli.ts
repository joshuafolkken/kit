#!/usr/bin/env tsx
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { backlog_plan_read } from '#scripts/backlog/backlog-plan-read'
import { backlog_waves } from '#scripts/backlog/backlog-waves'
import { josh_environment_file } from '#scripts/josh/josh-environment-file'
import { session_language } from '#scripts/josh/session-language'
import { lane_registry } from '#scripts/lane/lane-registry'
import { run_carry } from '#scripts/run/carry/run-carry'
import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { run_progress } from '#scripts/run/progress/run-progress'
import { run_progress_cli } from '#scripts/run/progress/run-progress-cli'
import { run_board_header } from './run-board-header'
import { run_board_labels, type Words } from './run-board-labels'
import { run_board_layout, type BoardLayout, type BoardPlan } from './run-board-layout'
import { run_board_notes } from './run-board-notes'
import { run_board_render } from './run-board-render'
import { run_board_screen, type Screen } from './run-board-screen'
import { run_board_status } from './run-board-status'

// `josh run:board` — a full-screen board of the running `backlogrun` (joshuafolkken/kit#3430), redrawn
// every few seconds for a person to keep open beside the run. **Two speeds**: the run's own stream and
// lanes are local reads taken every tick; the plan they are laid over is a GitHub read taken no more
// often than `run:progress` re-reads after a decline, so a board left open all night costs what the
// watcher already does. A failed plan read keeps the previous plan on screen and says when it failed.
// With no run in this checkout it reads nothing from GitHub and waits for one to start.

const ARGV_OFFSET = 2
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const ONCE_FLAG = '--once'
const TICK_SECONDS = 5
const TICK_MS = TICK_SECONDS * run_progress.MS_PER_SECOND
const PLAN_RETRY_MS = run_progress_cli.DECLINE_RETRY_SECONDS * run_progress.MS_PER_SECOND
const SIGINT_EXIT_CODE = 130
const SIGTERM_EXIT_CODE = 143
const USAGE = 'Usage: josh run:board [--once]'

// What the board reads locally each tick: the run's start, its events and its open lanes.
interface LocalRead {
	started_ms: number
	events: ReadonlyArray<RunEvent>
	lanes: ReadonlyArray<string>
}

interface BoardPorts {
	read_plan: () => Promise<BoardPlan | undefined>
	// `undefined` when no run has started here.
	read_local: () => Promise<LocalRead | undefined>
	now: () => number
	write: (frame: string) => void
	// Whether stdout is a terminal — only a terminal gets the alternate screen.
	is_tty: boolean
	// Runs `leave` however the process ends: a normal exit, Ctrl+C or SIGTERM.
	on_exit: (leave: () => void) => void
	sleep: (ms: number) => Promise<void>
}

interface BoardState {
	plan: BoardPlan | undefined
	attempted_ms: number | undefined
	fetched_ms: number | undefined
	failed_ms: number | undefined
	baseline_total: number | undefined
}

const FRESH_STATE: BoardState = {
	plan: undefined,
	attempted_ms: undefined,
	fetched_ms: undefined,
	failed_ms: undefined,
	baseline_total: undefined,
}

function is_plan_due(state: BoardState, now_ms: number): boolean {
	return state.attempted_ms === undefined || now_ms - state.attempted_ms >= PLAN_RETRY_MS
}

// A title the board once knew stays known, so an issue that left the open listing keeps its name.
function with_titles(plan: BoardPlan, previous: BoardPlan | undefined): BoardPlan {
	const titles = new Map([...(previous?.context.titles ?? []), ...plan.context.titles])

	return { ...plan, context: { ...plan.context, titles } }
}

async function refresh(state: BoardState, ports: BoardPorts, now_ms: number): Promise<BoardState> {
	if (!is_plan_due(state, now_ms)) return state

	const plan = await ports.read_plan()
	const attempted = { ...state, attempted_ms: now_ms }

	if (plan === undefined) return { ...attempted, failed_ms: now_ms }

	return {
		...attempted,
		plan: with_titles(plan, state.plan),
		fetched_ms: now_ms,
		failed_ms: undefined,
	}
}

function layout_for(state: BoardState, local: LocalRead): BoardLayout | undefined {
	if (state.plan === undefined) return undefined

	return run_board_layout.layout_of(
		state.plan,
		run_board_status.statuses_of(local.events, local.lanes),
	)
}

// What one redraw draws with.
interface Redraw {
	ports: BoardPorts
	words: Words
	now_ms: number
}

function frame_of(
	state: BoardState,
	local: LocalRead,
	layout: BoardLayout | undefined,
	redraw: Redraw,
): Array<string> {
	const header = {
		now_ms: redraw.now_ms,
		words: redraw.words,
		started_ms: local.started_ms,
		activity: run_board_status.activity_of(local.events),
		layout,
		baseline_total: state.baseline_total,
		plan_fetched_ms: state.fetched_ms,
		plan_failed_ms: state.failed_ms,
	}

	return run_board_render.render({ header, notes: run_board_notes.notes_of(local.events) })
}

function draw(ports: BoardPorts, lines: ReadonlyArray<string>): void {
	ports.write(`${lines.join('\n')}\n`)
}

// The first total the board sees is the baseline every later arrival is counted against.
function draw_run(state: BoardState, local: LocalRead, redraw: Redraw): BoardState {
	const layout = layout_for(state, local)
	const first_total = layout === undefined ? undefined : run_board_header.counts_of(layout).total
	const settled = { ...state, baseline_total: state.baseline_total ?? first_total }

	draw(redraw.ports, frame_of(settled, local, layout, redraw))

	return settled
}

// One redraw. No run reads nothing from GitHub and keeps the plan it had for when one starts.
async function tick(state: BoardState, ports: BoardPorts, words: Words): Promise<BoardState> {
	const now_ms = ports.now()
	const local = await ports.read_local()

	if (local === undefined) {
		draw(ports, run_board_render.render_no_run(now_ms, words))

		return state
	}

	return draw_run(await refresh(state, ports, now_ms), local, { ports, words, now_ms })
}

async function read_plan(): Promise<BoardPlan | undefined> {
	const read = await backlog_plan_read.read_plan()

	if (read === undefined) return undefined

	const { plan, listing } = read

	return {
		waves: backlog_waves.build(plan.result, plan.repo, plan.scope),
		tracked: plan.tracked,
		context: backlog_plan_read.context_of(plan, listing),
	}
}

async function read_local(): Promise<LocalRead | undefined> {
	const repository = await run_carry.repository_directory()
	const read =
		repository === undefined ? undefined : run_carry.read_carry(run_carry.carry_path(repository))

	if (read?.kind !== 'carried') return undefined

	const [events, lanes] = await Promise.all([
		run_event_stream_emit.current_events(),
		lane_registry.list_lanes(),
	])

	return {
		started_ms: Date.parse(read.carry.started_at),
		events,
		lanes: lanes.map((lane) => lane.issue),
	}
}

// A signal exits with its conventional code, so the `exit` handler restores the screen on every path.
function on_exit(leave: () => void): void {
	process.once('exit', leave)
	process.once('SIGINT', () => process.exit(SIGINT_EXIT_CODE))
	process.once('SIGTERM', () => process.exit(SIGTERM_EXIT_CODE))
}

const LIVE_PORTS: BoardPorts = {
	read_plan,
	read_local,
	now: () => Date.now(),
	write: (frame) => process.stdout.write(frame),
	is_tty: process.stdout.isTTY,
	on_exit,
	sleep: async (ms) => {
		await sleep(ms)
	},
}

// Every frame starts from the top of the alternate screen, erasing what the last one left below it.
function framed(ports: BoardPorts, screen: Screen): BoardPorts {
	return {
		...ports,
		write: (frame) => {
			ports.write(`${screen.frame}${frame}`)
		},
	}
}

// Leaves the alternate screen once, whichever path gets there first: a second leave would restore the
// cursor saved on entering and draw over whatever was printed after the first.
function leaver(ports: BoardPorts, screen: Screen): () => void {
	let has_left = false

	return () => {
		if (has_left) return
		has_left = true
		ports.write(screen.leave)
	}
}

async function redraw_forever(ports: BoardPorts, words: Words): Promise<void> {
	let state = await tick(FRESH_STATE, ports, words)

	for (;;) {
		// eslint-disable-next-line no-await-in-loop -- polling: each redraw waits out the tick before it
		await ports.sleep(TICK_MS)
		// eslint-disable-next-line no-await-in-loop -- polling: each redraw folds the state the last one left
		state = await tick(state, ports, words)
	}
}

// A signal leaves through `on_exit`; a failed redraw leaves before its error is printed, so the error
// lands on the normal screen rather than vanishing with the alternate one.
async function watch(ports: BoardPorts, words: Words): Promise<void> {
	const screen = run_board_screen.screen_of('live')
	const leave = leaver(ports, screen)

	ports.write(screen.enter)
	ports.on_exit(leave)

	try {
		await redraw_forever(framed(ports, screen), words)
	} finally {
		leave()
	}
}

async function run(argv: ReadonlyArray<string>, ports: BoardPorts = LIVE_PORTS): Promise<number> {
	const is_once = argv[0] === ONCE_FLAG

	if (argv.length > (is_once ? 1 : 0)) {
		process.stderr.write(`${USAGE}\n`)

		return FAILURE_EXIT_CODE
	}

	const words = run_board_labels.words_of(session_language.resolve_session_lang().lang)

	const mode = run_board_screen.mode_of({ is_tty: ports.is_tty, is_once })

	await (mode === 'live' ? watch(ports, words) : tick(FRESH_STATE, ports, words))

	return SUCCESS_EXIT_CODE
}

const run_board_cli = { FRESH_STATE, PLAN_RETRY_MS, run, tick }

// `.env` is read inside the guard, as `run:event --watch` reads it, so the board draws in the
// `JOSH_SESSION_LANG` a person keeps there while the unit tests see no developer's `.env`.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	josh_environment_file.load_environment_file()
	process.exitCode = await run(process.argv.slice(ARGV_OFFSET))
}

export { run_board_cli }
export type { BoardPorts, BoardState, LocalRead }
