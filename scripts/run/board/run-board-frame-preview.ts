import { parseArgs, stripVTControlCharacters } from 'node:util'
import type { TerminalSize } from './run-board-fit'
import type { Notice } from './run-board-header-notice'
import { run_board_sound_transition, type Cause } from './run-board-sound-transition'
import type { BoardPorts } from './run-board-state'
import { run_board_theme, type Theme } from './run-board-theme'
import { run_board_tick } from './run-board-tick'

// `josh run:board --frame` — one board frame drawn in a state fixed by its flags, for reading what a
// live board shows only when a cue fires: the header notice, its repeat mark and the sound switch
// (joshuafolkken/kit#8434). It draws through the live `tick` in the screen form, fitted to the size it
// is given, and never reads or records the frame store. The text is plain unless `--ansi` keeps the SGR.

const FRAME_FLAG = '--frame'
const FRAME_USAGE =
	'--frame [--notice <row state> [--issue <n>] [--repeat]] [--mute] [--columns <n>] [--rows <n>] [--ansi]'
const DEFAULT_SIZE: TerminalSize = { rows: 40, columns: 120 }
const COUNT = /^[1-9]\d*$/u
const OPTIONS = {
	notice: { type: 'string' },
	issue: { type: 'string' },
	repeat: { type: 'boolean', default: false },
	mute: { type: 'boolean', default: false },
	columns: { type: 'string' },
	rows: { type: 'string' },
	ansi: { type: 'boolean', default: false },
} as const

interface FrameOptions {
	readonly cause: Cause | undefined
	readonly is_repeat: boolean
	readonly is_muted: boolean
	readonly size: TerminalSize
	readonly is_ansi: boolean
}

type FrameValues = ReturnType<
	typeof parseArgs<{ args: Array<string>; options: typeof OPTIONS }>
>['values']

function values_of(rest: ReadonlyArray<string>): FrameValues | undefined {
	try {
		return parseArgs({ args: [...rest], options: OPTIONS }).values
	} catch {
		return undefined
	}
}

// The row state named as a live row's cue would name it (`run-board-sound-transition.ts`).
function sound_of(name: string | undefined): Cause | undefined {
	const named = Object.entries(run_board_sound_transition.ROW_SOUNDS).find(([key]) => key === name)

	return named?.[1]
}

function is_counted(values: FrameValues): boolean {
	return [values.issue, values.columns, values.rows].every(
		(text) => text === undefined || COUNT.test(text),
	)
}

// `--issue` and `--repeat` only qualify a notice, so either without one is refused.
function is_noticed(values: FrameValues): boolean {
	const { notice } = values

	if (notice === undefined) return values.issue === undefined && !values.repeat

	return sound_of(notice) !== undefined
}

function is_valid(values: FrameValues): boolean {
	return is_counted(values) && is_noticed(values)
}

function cause_of(values: FrameValues): Cause | undefined {
	const sound = sound_of(values.notice)

	if (sound === undefined || values.issue === undefined) return sound

	return { ...sound, issue: Number(values.issue) }
}

function size_of(values: FrameValues): TerminalSize {
	return {
		rows: Number(values.rows ?? DEFAULT_SIZE.rows),
		columns: Number(values.columns ?? DEFAULT_SIZE.columns),
	}
}

// The fixed state the flags name; undefined for a flag it does not know, a count that is no positive
// integer, or a notice no row state sounds.
function options_of(rest: ReadonlyArray<string>): FrameOptions | undefined {
	const values = values_of(rest)

	if (values === undefined || !is_valid(values)) return undefined

	return {
		cause: cause_of(values),
		is_repeat: values.repeat,
		is_muted: values.mute,
		size: size_of(values),
		is_ansi: values.ansi,
	}
}

function notice_of(options: FrameOptions, now_ms: number): Notice | undefined {
	const { cause, is_repeat } = options

	return cause === undefined ? undefined : { cause, is_repeat, at_ms: now_ms }
}

// The live ports in the live screen form, with the size and sound switch fixed, the rows typing where
// the theme's live board types them, marked live (so its lamp panel shows though its rows do not
// type), no cue sounded and no frame store; the frame is collected so its escapes can be left off.
function fixed_ports(
	ports: BoardPorts,
	options: FrameOptions,
	write: BoardPorts['write'],
	theme: Theme | undefined,
): BoardPorts {
	return {
		...ports,
		write,
		is_tty: true,
		form: 'screen',
		size: () => options.size,
		sound: () => !options.is_muted,
		types_rows: theme !== undefined,
		is_live: true,
		cue: undefined,
		frames: undefined,
	}
}

// The frame as `--frame` prints it: its escapes kept under `--ansi`, else plain. A themed board's
// animation is the theme layer's (joshuafolkken/kit#8917), which a single frame does not draw.
function painted(text: string, options: FrameOptions): string {
	return options.is_ansi ? text : stripVTControlCharacters(text)
}

async function draw(
	ports: BoardPorts,
	options: FrameOptions,
	theme: Theme | undefined,
): Promise<void> {
	const parts: Array<string> = []
	const read = await ports.gather('settled')
	const fixed = fixed_ports(
		{ ...ports, gather: async () => read },
		options,
		(frame) => {
			parts.push(frame)
		},
		theme,
	)
	// Dated as the run read, so the tick takes it for this run's view and keeps the notice
	// (`run-board-data.ts` → `view_for`).
	const state = {
		...run_board_tick.FRESH_STATE,
		run_started_ms: read.local?.started_ms,
		notice: notice_of(options, ports.now()),
	}

	await run_board_tick.tick(state, run_board_theme.themed(fixed, theme))

	ports.write(painted(parts.join(''), options))
}

const run_board_frame_preview = {
	FRAME_FLAG,
	FRAME_USAGE,
	draw,
	fixed_ports,
	options_of,
	painted,
}

export { run_board_frame_preview }
export type { FrameOptions }
