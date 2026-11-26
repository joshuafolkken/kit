import type { FluxJump } from './run-board-theme-flux-capacitor'
import { run_board_theme_flux_gauge, type GaugeLook } from './run-board-theme-flux-gauge'
import type { Channel, ThemeState } from './run-board-theme-host-types'

// The BTTF theme's motion (joshuafolkken/kit#8917, run-board-jump.ts): the speed and the gauge's range
// at any tick — the cruise swaying, PROGRESS and ROW climbing and falling back, the NOTICE's JUMP to 88
// and its thaw. Ported from the confirmed theme demo's `fixed-v21-theme-bttf.mjs`.

const { range_of } = run_board_theme_flux_gauge

const TOP_SPEED = 88
const LEAD_TICKS = 15
const LEAD_SHARE = 3
const WASH_TICKS = 13
const THAW_TICKS = 45
const ORANGE_TICKS = 2
const STAGE_SECOND = 0.22
const STAGE_THIRD = 0.42
const LAST_STAGE = 0.6
const STAGES = [0, STAGE_SECOND, STAGE_THIRD, LAST_STAGE]
const CLIMB_POWER = 2
const CRUISE = 28
const SWAY = 5
const SWAY_TICKS = 9
const HALF = 2

// The smaller events' own climbs: PROGRESS to just over the first range, ROW to the third.
// PROGRESS plays what ROW played in v14 (to 72, the third range); ROW climbs to the fourth range.
const PROGRESS_TOP = 72
const PROGRESS_FALL = 20
const PROGRESS_CLIMB = 25
const ROW_TOP = 82
const ROW_CLIMB = 40
const ROW_FALL = 24
const ROW_CEILING = 87

// What the motion reads of the state: the three channels at a tick.
type MotionState = Pick<ThemeState, 'notice' | 'progress' | 'row' | 'tick'>

// The speed and the gauge's range at any tick; `t` counts from the jump (undefined with no notice).
interface Motion {
	t: number | undefined
	speed_at: (tick: number) => number
	range_at: (tick: number) => number
	gauge: GaugeLook
	flux: FluxJump | undefined
}

interface Span {
	typing: number
	rise: number
	fall: number
}

function cruise_of(tick: number): number {
	return CRUISE + SWAY * Math.sin(tick / SWAY_TICKS)
}

function lead_of(letters: number): number {
	return Math.min(LEAD_TICKS, Math.floor(letters / LEAD_SHARE))
}

function run_of(letters: number): number {
	return Math.max(1, letters - lead_of(letters))
}

function jump_speed(t: number, letters: number, cruise: number): number | undefined {
	if (t < -letters || t >= WASH_TICKS + THAW_TICKS) return undefined

	if (t >= WASH_TICKS) {
		return TOP_SPEED + (cruise - TOP_SPEED) * Math.min(1, (t - WASH_TICKS) / THAW_TICKS)
	}

	const share = Math.min(1, (t + letters) / run_of(letters))

	return t < 0 ? cruise + (TOP_SPEED - cruise) * share ** CLIMB_POWER : TOP_SPEED
}

function stage_of(t: number, letters: number): number | undefined {
	if (t < -letters || t >= 0) return undefined
	const share = (t + letters) / run_of(letters)

	return STAGES.findLastIndex((stage) => share >= stage) + 1
}

function climb_of(letters: number): number {
	return Math.ceil(run_of(letters) * (1 - LAST_STAGE))
}

function flood_of(t: number, letters: number): number | undefined {
	const lead = lead_of(letters)

	return t >= -lead && t < WASH_TICKS ? t + lead : undefined
}

function is_orange(t: number, letters: number): boolean {
	const lead = lead_of(letters)

	return t >= -lead - ORANGE_TICKS && t < -lead
}

// `age` is the ticks since the line started typing (the demo's `u`).
function eased(base: number, top: number, age: number, span: Span): number | undefined {
	if (age < 0) return undefined
	if (age < span.typing) return base + (top - base) * Math.min(1, (age + 1) / span.rise)
	if (age - span.typing < span.fall) return top + (base - top) * ((age - span.typing) / span.fall)

	return undefined
}

// The ticks from the jump at `tick`, from the notice's start and length alone.
function t_at(notice: Channel, tick: number): number | undefined {
	return notice.index >= 0 ? tick - notice.start - notice.total : undefined
}

function typed_speed(progress: Channel, base: number, tick: number): number | undefined {
	if (progress.index < 0) return undefined
	const span = { typing: progress.total, rise: PROGRESS_CLIMB, fall: PROGRESS_FALL }

	return eased(base, PROGRESS_TOP + (base - CRUISE) / HALF, tick - progress.start, span)
}

function lane_speed(row: Channel, base: number, tick: number): number | undefined {
	if (row.index < 0) return undefined
	const span = { typing: row.total, rise: ROW_CLIMB, fall: ROW_FALL }

	return eased(
		base,
		Math.min(ROW_CEILING, ROW_TOP + (base - CRUISE) / HALF),
		tick - row.start,
		span,
	)
}

// The speed at any tick, from the channels' starts and lengths alone, so the gauge can look back
// over past ticks as the demo's `change_before` does.
function speed_at(state: MotionState, tick: number): number {
	const base = cruise_of(tick)
	const t = t_at(state.notice, tick)
	const jump = t === undefined ? undefined : jump_speed(t, state.notice.total, base)

	if (jump !== undefined) return jump
	const typed = typed_speed(state.progress, base, tick) ?? 0

	return Math.max(base, typed, lane_speed(state.row, base, tick) ?? 0)
}

function range_at(state: MotionState, tick: number): number {
	const t = t_at(state.notice, tick)
	const stage = t === undefined ? undefined : stage_of(t, state.notice.total)

	return stage ?? range_of(speed_at(state, tick))
}

function is_jump(t: number | undefined, letters: number): t is number {
	return t !== undefined && t >= -letters && t < WASH_TICKS + THAW_TICKS
}

function jump_looks(t: number, letters: number): Pick<Motion, 'flux' | 'gauge'> {
	const flood = flood_of(t, letters)

	return {
		gauge: { climb: climb_of(letters), is_flooded: flood !== undefined },
		flux: { flood, is_orange: is_orange(t, letters) },
	}
}

function motion_of(state: MotionState): Motion {
	const t = t_at(state.notice, state.tick)
	const letters = state.notice.total
	const looks = is_jump(t, letters) ? jump_looks(t, letters) : { gauge: {}, flux: undefined }

	return {
		t,
		speed_at: (tick) => speed_at(state, tick),
		range_at: (tick) => range_at(state, tick),
		...looks,
	}
}

const run_board_theme_flux_motion = {
	LEAD_TICKS,
	PROGRESS_FALL,
	ROW_FALL,
	THAW_TICKS,
	TOP_SPEED,
	WASH_TICKS,
	cruise_of,
	eased,
	jump_speed,
	motion_of,
	stage_of,
}

export { run_board_theme_flux_motion }
export type { Motion, MotionState }
