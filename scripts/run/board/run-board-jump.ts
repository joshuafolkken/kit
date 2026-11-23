import { run_board_fire_trail } from './run-board-fire-trail'

// joshuafolkken/kit#8677: the bttf theme's time jump and arrival as timelines in ticks of
// `TICK_MS`. A jump runs up over a typing row's letters — one tick each, so it starts on the first
// letter — and jumps on the tick after the last: the speed climbs to 88, the gauge steps up with the
// letters typed, the capacitor floods `LEAD` before the jump, the board is washed and then thaws. The
// arrival at the start flashes three times and thaws.

function numbers_of(text: string): Array<number> {
	return text.split(' ').map(Number)
}

const TICK_MS = 50
const TOP_SPEED = 88
// The capacitor floods this many ticks before the jump at most, a third of the run at most.
const LEAD_TICKS = 15
const LEAD_SHARE = 3
// The ticks the board's wash lasts from the jump, and the ticks a thaw takes.
const WASH_TICKS = 13
const THAW_TICKS = 45
// The two ticks before the flood every lamp is orange; the first three of it the box is pure white.
const ORANGE_TICKS = 2
const WHITE_TICKS = 3
// The share of the run up at which the gauge's second, third, fourth and top ranges begin.
const STAGES = numbers_of('0 0.22 0.42 0.6')
const LAST_STAGE = STAGES.at(-1) ?? 1
// The speed climbs with the square of the run up.
const CLIMB_POWER = 2
// The arrival: its flashes, each its first tick, its ticks and its whiteness, then the thaw from
// `THAW_AT`.
const ARRIVE_FLASHES = ['4 2 0.35', '10 2 0.65', '16 3 1'].map((flash) => {
	const [start = 0, ticks = 0, white = 0] = numbers_of(flash)

	return { start, ticks, white }
})
const THAW_AT = 19
const ARRIVE_TICKS = THAW_AT + THAW_TICKS
// joshuafolkken/kit#8675: the ticks a jump runs past its last letter — its wash, its thaw and its fire
// trails burning out.
const END_TICKS = Math.max(WASH_TICKS + THAW_TICKS, run_board_fire_trail.TRAIL_TICKS)

// A jump: the moment the typing it runs up over started and its letter count.
interface JumpRun {
	start_ms: number
	letters: number
}

// The ticks from the jump at `ms`, negative through the run up.
function tick_of(run: JumpRun, ms: number): number {
	return Math.floor((ms - run.start_ms) / TICK_MS) - run.letters
}

function lead_of(letters: number): number {
	return Math.min(LEAD_TICKS, Math.floor(letters / LEAD_SHARE))
}

// The ticks of the run up before the capacitor floods.
function run_of(letters: number): number {
	return Math.max(1, letters - lead_of(letters))
}

// Whether the jump is over at `ms`: its wash, its thaw and its trails done.
function is_over(run: JumpRun, ms: number): boolean {
	return tick_of(run, ms) >= END_TICKS
}

// Whether the jump's wash and thaw are done at `ms`, leaving only its trails burning out.
function is_thawed(run: JumpRun, ms: number): boolean {
	return tick_of(run, ms) >= WASH_TICKS + THAW_TICKS
}

// Whether `ms` is in the run up or later, before the jump is over.
function is_running(run: JumpRun, ms: number): boolean {
	return tick_of(run, ms) >= -run.letters && !is_over(run, ms)
}

// The speed braked from 88 `share` of the way to `cruise`, held at either end.
function braked(cruise: number, share: number): number {
	return TOP_SPEED + (cruise - TOP_SPEED) * Math.min(1, Math.max(0, share))
}

// The speed `t` ticks from a jump over `letters`: up to 88 with the square of the run, held through the
// wash, braking to `cruise` as the board thaws; none outside the jump.
function jump_speed(t: number, letters: number, cruise: number): number | undefined {
	if (t < -letters || t >= WASH_TICKS + THAW_TICKS) return undefined
	if (t >= WASH_TICKS) return braked(cruise, (t - WASH_TICKS) / THAW_TICKS)
	const share = Math.min(1, (t + letters) / run_of(letters))

	return t < 0 ? cruise + (TOP_SPEED - cruise) * share ** CLIMB_POWER : TOP_SPEED
}

// The speed `tick` ticks into the arrival: 88 until the thaw, braking to `cruise` through it; none once
// it is over.
function arrive_speed(tick: number, cruise: number): number | undefined {
	if (tick >= ARRIVE_TICKS) return undefined

	return braked(cruise, (tick - THAW_AT) / THAW_TICKS)
}

// The gauge's range through the run up, read off the letters typed rather than the speed; none outside
// it.
function stage_of(t: number, letters: number): number | undefined {
	if (t < -letters || t >= 0) return undefined
	const share = (t + letters) / run_of(letters)

	return STAGES.findLastIndex((stage) => share >= stage) + 1
}

// The ticks the gauge climbs to full over, evenly, ending on the flood.
function climb_of(letters: number): number {
	return Math.ceil(run_of(letters) * (1 - LAST_STAGE))
}

// The ticks since the capacitor flooded, `LEAD` before the jump until the wash is over; none otherwise.
function flood_of(t: number, letters: number): number | undefined {
	const lead = lead_of(letters)

	return t >= -lead && t < WASH_TICKS ? t + lead : undefined
}

// Whether every lamp is orange: the two ticks before the flood.
function is_orange(t: number, letters: number): boolean {
	const lead = lead_of(letters)

	return t >= -lead - ORANGE_TICKS && t < -lead
}

// The whiteness of the arrival's flash at `tick`, 0 between them.
function flash_of(tick: number): number {
	const flash = ARRIVE_FLASHES.find(({ start, ticks }) => tick >= start && tick < start + ticks)

	return flash?.white ?? 0
}

const run_board_jump = {
	ARRIVE_TICKS,
	END_TICKS,
	THAW_AT,
	THAW_TICKS,
	TICK_MS,
	TOP_SPEED,
	WASH_TICKS,
	WHITE_TICKS,
	arrive_speed,
	climb_of,
	flash_of,
	flood_of,
	is_orange,
	is_over,
	is_running,
	is_thawed,
	jump_speed,
	lead_of,
	stage_of,
	tick_of,
}

export { run_board_jump }
export type { JumpRun }
