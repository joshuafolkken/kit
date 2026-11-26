import type { KeyTaker } from './run-board-keys'
import type { EventKind } from './run-board-sound-typing'
import { run_board_theme_defs, type Theme } from './run-board-theme-defs'
import { run_board_theme_events, type BoardEvent, type Lasts } from './run-board-theme-events'
import { run_board_theme_host_frame } from './run-board-theme-host-frame'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type {
	PartName,
	ThemeApi,
	ThemeFactory,
	ThemeLayout,
	ThemeModule,
	ThemeTimeline,
} from './run-board-theme-host-types'
import { run_board_theme_sound, type OpeningSound } from './run-board-theme-sound'
import type { TypingLine } from './run-board-type-rows'

// A live board's theme run (joshuafolkken/kit#8917): what lasts across its redraws while the theme host
// draws it — the theme chosen (demo mode may switch it), the moment its ticks count from, the events on
// its timeline, the opening or ending playing, demo mode, the theme built for the last base and the
// board's real alert level. The layer drawn each second reads and keeps it here.

const { TICK_MS } = run_board_theme_host_state
const { part_of } = run_board_theme_host_frame
// A theme value, or none (`''`).
type ThemeValue = Theme | ''

// The theme values in demo mode's key order: 0 none, then the seven works in the definitions' order.
const THEME_VALUES: ReadonlyArray<ThemeValue> = ['', ...run_board_theme_defs.THEMES]
const VALUE_SET: ReadonlySet<string> = new Set(THEME_VALUES)
const IDLE: ThemeTimeline = { notice: [], progress: [], row: [] }
const NO_LASTS: Lasts = {}

// The factory each theme value is drawn by; none for none.
type ThemeRegistry = (value: ThemeValue) => ThemeFactory | undefined

// The opening or ending playing, from its first moment — set on the first frame that draws it.
interface PlayingPart {
	name: PartName
	start_ms: number | undefined
}

// The theme built over one base: what it was built for, the layout and helpers, the theme itself.
interface Built {
	key: string
	layout: ThemeLayout
	api: ThemeApi
	module: ThemeModule
}

// Demo mode: the timeline its keys play and the theme it was entered in.
interface DemoMode {
	timeline: ThemeTimeline
	entered: ThemeValue
}

interface ThemeRun {
	value: ThemeValue
	registry: ThemeRegistry
	origin_ms: number | undefined
	events: ReadonlyArray<BoardEvent>
	part: PlayingPart | undefined
	demo: DemoMode | undefined
	built: Built | undefined
	level: number | undefined
	// Gives the keys back where a part or demo mode took them (`run-board-keys.ts` → `intercept`).
	release: (() => void) | undefined
	// The opening's sound of each theme value (`run-board-theme-sound.ts`), read for the value shown, and
	// how far into the opening its last frame was.
	opening_sound: OpeningSounds
	sound_ms: number | undefined
	// The start tick of the last event of each kind its sound was played for, and the last part sounded
	// (`run-board-theme-notice-sound.ts`).
	event_starts?: Partial<Record<EventKind, number>>
	part_sounded?: PlayingPart
	// Counts the switches of what the board shows — demo mode entered or left, a work picked — so the
	// second drawing the old look ends and the board is redrawn in the new one at once.
	shown?: number
}

// The opening's sound in a theme value.
type OpeningSounds = (value: ThemeValue) => OpeningSound

function silent_sounds(): OpeningSound {
	return run_board_theme_sound.SILENT
}

function is_value(value: string): value is ThemeValue {
	return VALUE_SET.has(value)
}

// A run of `value`, opening with the theme's opening; a run of none has none to open with.
function run_of(
	value: ThemeValue,
	registry: ThemeRegistry,
	opening_sound: OpeningSounds = silent_sounds,
): ThemeRun {
	return {
		value,
		registry,
		origin_ms: undefined,
		events: run_board_theme_events.NO_EVENTS,
		part: value === '' ? undefined : { name: 'opening', start_ms: undefined },
		demo: undefined,
		built: undefined,
		level: undefined,
		release: undefined,
		opening_sound,
		sound_ms: undefined,
	}
}

function factory_of(run: ThemeRun): ThemeFactory | undefined {
	return run.value === '' ? undefined : run.registry(run.value)
}

// Whether the theme host draws the board: a theme is chosen and the registry has it.
function is_drawn(run: ThemeRun): boolean {
	return factory_of(run) !== undefined
}

// The moment the run's ticks count from, fixed at the first call.
function origin_of(run: ThemeRun, now_ms: number): number {
	run.origin_ms ??= now_ms

	return run.origin_ms
}

function tick_at(run: ThemeRun, at_ms: number): number {
	return run_board_theme_events.tick_of(at_ms, origin_of(run, at_ms))
}

// The first boundary of the run's ticks after `now_ms`.
function next_tick_ms(run: ThemeRun, now_ms: number): number {
	const origin = origin_of(run, now_ms)

	return origin + (tick_at(run, now_ms) + 1) * TICK_MS
}

function lasts_of(run: ThemeRun): Lasts {
	return run.built?.module.lasts ?? NO_LASTS
}

// The events the rows newly typing start, on the run's timeline.
function observe(run: ThemeRun, lines: ReadonlyArray<TypingLine>, now_ms: number): void {
	const origin = origin_of(run, now_ms)

	run.events = run_board_theme_events.observed(run.events, lines, origin, lasts_of(run))
}

// The timeline drawn at `tick`: demo mode's keys', else the board's events'.
function timeline_at(run: ThemeRun, tick: number): ThemeTimeline {
	return run.demo?.timeline ?? run_board_theme_events.timeline_at(run.events, tick)
}

// Whether the theme's own level shows at `tick`: in an event's effect, a part, or demo mode.
function is_own_level(run: ThemeRun, tick: number): boolean {
	if (run.part !== undefined || run.demo !== undefined || run.level === undefined) return true

	return run_board_theme_events.is_playing_at(run.events, tick, lasts_of(run))
}

// How long the theme's `name` part plays, 0 where no theme is built.
function part_ms(run: ThemeRun, name: PartName): number {
	const { built } = run

	if (built === undefined || !is_drawn(run)) return 0

	return part_of(built.module, built.layout, name).ticks * TICK_MS
}

function free_keys(run: ThemeRun): void {
	run.release?.()
	run.release = undefined
}

// `name` played from `at_ms`; its sound counts from its start, not from a part played before it.
function play_part(run: ThemeRun, name: PartName, at_ms: number): void {
	run.part = { name, start_ms: at_ms }
	run.sound_ms = undefined
}

// The part over: the keys the launch's opening took are given back (demo mode keeps its own).
function end_part(run: ThemeRun): void {
	if (run.part?.name === 'opening' && run.demo === undefined) free_keys(run)
	run.part = undefined
}

// A second no theme frame is drawn in — no theme shown, or no lamp panel to lay it out by: what was built
// for an earlier base is dropped, so a part there has no length and Ctrl-C leaves at once, and a launch
// opening that cannot play is ended, so its keys come back.
function settle(run: ThemeRun, is_shown: boolean): void {
	if (is_shown) return
	run.built = undefined
	if (run.part?.name === 'opening') end_part(run)
}

// The keys taken for `on_key` through `intercept`, giving back whatever took them before.
function take_keys(
	run: ThemeRun,
	intercept: ((on_key: KeyTaker) => () => void) | undefined,
	on_key: KeyTaker,
): void {
	free_keys(run)
	run.release = intercept?.(on_key)
}

// What the board shows switched: the second drawing the old look is over (`run-board-spin.ts`).
function switched(run: ThemeRun): void {
	run.shown = (run.shown ?? 0) + 1
}

// Demo mode entered: the current theme's idle board, nothing playing.
function enter_demo(run: ThemeRun): void {
	run.demo = { timeline: IDLE, entered: run.value }
	run.part = undefined
	switched(run)
}

// Demo mode left; the theme it switched to, where it switched one.
function leave_demo(run: ThemeRun): ThemeValue | undefined {
	const entered = run.demo?.entered

	run.demo = undefined
	free_keys(run)
	switched(run)

	return entered === undefined || entered === run.value ? undefined : run.value
}

const run_board_theme_run = {
	IDLE,
	THEME_VALUES,
	end_part,
	enter_demo,
	factory_of,
	is_drawn,
	is_own_level,
	is_value,
	leave_demo,
	next_tick_ms,
	observe,
	part_ms,
	play_part,
	run_of,
	settle,
	switched,
	take_keys,
	tick_at,
	timeline_at,
}

export { run_board_theme_run }
export type { Built, OpeningSounds, PlayingPart, ThemeRegistry, ThemeRun, ThemeValue }
