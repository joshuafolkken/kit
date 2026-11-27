import { run_board_sound_palettes_extra } from './run-board-sound-palettes-extra'
import { run_board_sound_palettes_rk800_voice } from './run-board-sound-palettes-rk800-voice'
import { run_board_sound_score, type Cue, type Palette } from './run-board-sound-score'
import { run_board_sound_voice, type Sound } from './run-board-sound-voice'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import { run_board_theme_rk800_data } from './run-board-theme-rk800-data'
import { run_board_theme_rk800_tables } from './run-board-theme-rk800-tables'

// The rk800 board's palette: the sounds of `run-board-sound-palettes-rk800-voice.ts` — a glass
// tick and ping, three chimes, a low body, the scanner's three blips, hums and swells, a soft thump,
// the wall's thud, crunch and shatter, the two UI sounds — laid on each event's own time line inside
// the one sound its slot of the palette holds (`run-board-sound-score.ts`), each part at its moment
// on the screen and its level; the cues and a ROW's beats are timed from the theme's own tables.

const { scaled } = run_board_sound_score
const { sound_samples } = run_board_sound_voice

/* eslint-disable @typescript-eslint/no-magic-numbers -- a palette is its numbers: hz, ms and peaks */

const { TICK_MS, PEAK_TICKS, NOTICE_END } = run_board_theme_host_state
const { OPEN, MENU, STAMP, TIMELINE, WALL } = run_board_theme_rk800_data
const { CARD_AT, ENTER, RESULTS } = run_board_theme_rk800_tables
const {
	BLIP_FIRST,
	BLIP_SECOND,
	BLIP_THIRD,
	BOOM,
	BURST,
	CHIME_A,
	CHIME_B,
	CHIME_C,
	CLICK,
	CRUNCH,
	HIT,
	INSTABILITY_DOWN,
	INSTABILITY_UP,
	LOW_SWELL,
	PING,
	SCREEN_BOOM,
	SPARKLE,
	THUMP,
	TICK,
	UI_FIVE,
	UI_TWO,
	compound,
	menu_pad,
	partials,
	swell,
} = run_board_sound_palettes_rk800_voice

// A NOTICE on screen and the afterglow from its peak to its end, as the score times them.
const NOTICE_MS = (PEAK_TICKS + NOTICE_END - 1) * TICK_MS
const AFTERGLOW_MS = NOTICE_MS - PEAK_TICKS * TICK_MS
// The wall starts this long into a NOTICE: an act changes, and the instability rises.
const WALL_MS = WALL.from * TICK_MS

// The typing trill's letter: a quiet blip of the scanner's family; the typed end: analysis complete,
// the glass tick over the ping.
const RK800_LETTER: Sound = { ...partials(20, 10, [646, 1], [861, 0.8]), peak: 0.1 }
const RK800_END = compound(0.09, [0, 0.8, TICK], [0, 1, PING])

// NOTICE's call, the whole of its four seconds to the peak: the cursor moving to its second choice
// and the pulse on it; as the wall starts — the act changes — the screen's boom and the instability
// rising, as `∧ SOFTWARE INSTABILITY` shows; the wall's eight hits at their ticks
// (`run-board-theme-rk800-data.ts` → `HITS`, a board tick each from the wall's start) — a triple
// tap, a single, four quickening, the last two with the crunch — then nothing until the peak.
const CALL = compound(
	0.16,
	[500, 0.25, CLICK],
	[800, 0.5, PING],
	[WALL_MS, 0.6, SCREEN_BOOM],
	[WALL_MS, 1, INSTABILITY_UP],
	[1100, 0.45, HIT],
	[1250, 0.45, HIT],
	[1400, 0.5, HIT],
	[1700, 0.55, HIT],
	[2000, 0.55, HIT],
	[2200, 0.55, HIT],
	[2350, 0.6, HIT],
	[2350, 0.45, CRUNCH],
	[2450, 0.6, HIT],
	[2450, 0.45, CRUNCH],
)

// The peak: the shatter — a bright burst, the boom and its sparkle — the chime as the probability
// flips two ticks on, and the screen's boom just after the shatter as the act changes.
const PEAK = compound(
	0.22,
	[0, 1, BURST],
	[30, 0.9, BOOM],
	[30, 0.25, SPARKLE],
	[100, 0.45, CHIME_A],
	[150, 0.5, SCREEN_BOOM],
)

// The close: the instability falling at its measured spacing, quiet, ending as the NOTICE ends — so
// starting `NOTE.fall_lead` ticks before, as `∨ SOFTWARE INSTABILITY` shows.
const CLOSE = compound(0.08, [0, 1, INSTABILITY_DOWN])

// The afterglow's bed from the peak: the menu pad, very quiet, under the blinks to the NOTICE's end.
function afterglow(): Array<number> {
	return scaled(sound_samples(menu_pad(AFTERGLOW_MS)), 0.02)
}

// ROW's beats: a soft thump as the timeline's head passes each yellow tick, louder and under a glass
// tick on those a clue card hangs from. The head plays from the rewind's end to the last letter
// (`run-board-theme-rk800-scrub.ts` → `play_share`), the ticks even along its track.
const BEAT = compound(0.05, [0, 1, THUMP])
const CARD_BEAT = compound(0.09, [0, 1, THUMP], [0, 0.4, TICK])
const TICK_PLACES = TIMELINE.ticks + 1
const CARD_TICKS = new Set(Object.values(CARD_AT).map((place) => Math.round(place * TICK_PLACES)))

function row_beats(letters: number): Array<Cue> {
	const played = Math.max(0, letters - STAMP.rewind)

	return Array.from({ length: TIMELINE.ticks }, (_, index) => {
		const typed = STAMP.rewind + (played * (index + 1)) / TICK_PLACES

		return {
			at_ms: Math.round(typed * TICK_MS),
			sound: CARD_TICKS.has(index + 1) ? CARD_BEAT : BEAT,
		}
	})
}

// The OPENING's moments (`run-board-theme-rk800-opening.ts`): the menu's ice, its first bar, the
// cursor plate, the menu sliding away, the chapter card and the light bars lifting.
const MENU_MS = OPEN.menu_from * TICK_MS
const BARS_MS = (OPEN.menu_from + OPEN.ice_ticks) * TICK_MS
const BAR_STEP_MS = ENTER.step * TICK_MS
const PLATE_MS =
	BARS_MS + MENU.words.length * BAR_STEP_MS + (ENTER.pause + ENTER.fade * 2) * TICK_MS
const CHAPTER_MS = OPEN.chapter_from * TICK_MS
const CARD_MS = (OPEN.chapter_from + OPEN.slide) * TICK_MS
const REVEAL_MS = OPEN.reveal_from * TICK_MS
const CHANGE = compound(0.07, [0, 1, SCREEN_BOOM])
const BAR_CLICK = compound(0.05, [0, 1, CLICK])

// The OPENING's cues: a quiet hum under the date card; the boom at each screen change; the menu pad,
// very quiet, under the menu; a low click as each menu bar enters; the ping as the cursor plate
// arrives; chime B on the chapter card. The swell as the board appears is `appear`.
const OPENING_CUES: ReadonlyArray<Cue> = [
	{ at_ms: 0, sound: compound(0.03, [0, 1, swell(MENU_MS, [215, 1])]) },
	...[MENU_MS, CHAPTER_MS, REVEAL_MS].map((at_ms) => ({ at_ms, sound: CHANGE })),
	{ at_ms: MENU_MS, sound: compound(0.02, [0, 1, menu_pad(CHAPTER_MS - MENU_MS)]) },
	...MENU.words.map((_, index) => ({ at_ms: BARS_MS + index * BAR_STEP_MS, sound: BAR_CLICK })),
	{ at_ms: PLATE_MS, sound: compound(0.08, [0, 1, PING]) },
	{ at_ms: CARD_MS, sound: compound(0.08, [0, 1, CHIME_B]) },
]

// The ENDING's cues: the low swell as its bed, and UI sound two as the numbers come in.
const ENDING_CUES: ReadonlyArray<Cue> = [
	{ at_ms: 0, sound: compound(0.06, [0, 1, LOW_SWELL]) },
	{ at_ms: RESULTS.first_from * TICK_MS, sound: compound(0.07, [0, 1, UI_TWO]) },
]

const RK800: Palette = {
	name: 'deviant',
	notice: {
		ms: NOTICE_MS,
		after_peak: afterglow,
		call: CALL,
		// The swelling hum, rising to the peak, under soft thumps that quicken and rise.
		bed: {
			peak: 0.08,
			from_gain: 0.5,
			drone: { wave: 'sine', hz: 151, to_hz: 215 },
			pulse: {
				wave: 'sine',
				hz: 86,
				to_hz: 108,
				ms: 180,
				every_ms: 2000,
				to_every_ms: 700,
				jitter: 0.2,
			},
		},
		peak: PEAK,
		blink: compound(0.14, [0, 1, PING]),
		close: CLOSE,
	},
	row: {
		start: compound(0.09, [0, 1, BLIP_FIRST], [350, 0.9, BLIP_SECOND], [620, 0.8, BLIP_THIRD]),
		// No bed while it types: the thumps fall on the screen's own beats.
		during: { peak: 0, from_gain: 1 },
		beats: row_beats,
		// The lane has typed: chime A ringing its whole decay, and UI sound five, quiet, as
		// `▣ PATH UNLOCKED` shows.
		end: compound(0.11, [0, 1, CHIME_A], [0, 0.35, UI_FIVE]),
		ring_ms: 1900,
	},
	progress_end: RK800_END,
	appear: compound(0.1, [0, 1, swell(2200, [237, 1], [323, 0.7])]),
	vanish: compound(0.1, [0, 1, CHIME_C]),
	opening_cues: OPENING_CUES,
	ending_cues: ENDING_CUES,
}

const run_board_sound_palettes_rk800 = {
	RK800,
	RK800_VOICES: run_board_sound_palettes_extra.voices_of('deviant', RK800_LETTER, RK800_END),
}

export { run_board_sound_palettes_rk800 }
