import type { KeyReading } from './run-board-keys'
import { run_board_sound_player, type Playing, type StartHandlers } from './run-board-sound-player'
import type { Score } from './run-board-sound-score'
import type { EventKind, TypingSound } from './run-board-sound-typing'
import { run_board_theme_defs, type Theme } from './run-board-theme-defs'
import type { PartName } from './run-board-theme-host-types'

// The live board's one-shot sounds (joshuafolkken/kit#8917): a theme's typed end and its score's sound of
// each event and part, each played once and let go, so it sounds over the trill and any other sound
// still playing, under the sound switch.

const { THEME_DEFS } = run_board_theme_defs

// The theme the board shows this moment, none while it shows none.
type Shown = () => Theme | undefined

// A typed end is part of the typing voice, so where no player starts it falls silent as the trill does,
// never ringing the bell a cue falls back to.
const QUIET: StartHandlers = {
	started: () => {
		// a one-shot sound is let go, never ended
	},
	failed: () => {
		// silent, as the trill is where no player starts
	},
}

// An event's or a part's sound playing, and its rank: NOTICE > ROW > PROGRESS, as their effects cut in
// (`run-board-theme-events.ts`), and a part over all.
interface Held {
	child: Playing
	rank: number
}

const RANK: Readonly<Record<EventKind | PartName, number>> = {
	progress: 0,
	row: 1,
	notice: 2,
	opening: 3,
	ending: 3,
}
const HELD = new Set<Held>()
// The boards' trills, hushed with the rest.
const TRILLS = new Set<Pick<TypingSound, 'hush'>>()

function played(file: string | undefined): void {
	if (file !== undefined) run_board_sound_player.start(file, QUIET)
}

// Every sound the board started ended — each event's and part's, the trill's loop, the typed ends and the
// cues: an effect gave way to another on screen, or the board leaves (joshuafolkken/kit#8917).
function hush(): void {
	for (const trill of TRILLS) trill.hush?.()
	run_board_sound_player.stop_all()
	HELD.clear()
}

// `trill` hushed with every other sound from here on.
function heard(trill: Pick<TypingSound, 'hush'>): void {
	TRILLS.add(trill)
}

// A started sound kept until it ends, so a cut can end it.
function holding(rank: number): StartHandlers {
	return {
		started: (child) => {
			const held = { child, rank }

			HELD.add(held)
			child.on('exit', () => HELD.delete(held))
		},
		failed: QUIET.failed,
	}
}

// An event's or a part's sound by the effects' rules: under a higher sound playing it stays silent, as
// the lower effect shows its text alone; else every sound before it ends — none outranks it then — and
// it plays.
function ranked(file: string | undefined, name: EventKind | PartName): void {
	const rank = RANK[name]

	if (file === undefined || [...HELD].some((held) => held.rank > rank)) return
	hush()
	run_board_sound_player.start(file, holding(rank))
}

// The theme's typed end played once (joshuafolkken/kit#8697); nothing in no theme or a theme with none.
function typed_end_of(theme?: Theme): () => void {
	return () => {
		played(theme === undefined ? undefined : THEME_DEFS[theme].typed_end())
	}
}

// Whether the sound switch is on; on where the keys carry none.
function is_sounding(keys: KeyReading): boolean {
	return keys.sound?.() ?? true
}

// `typed_end` sounded only while the sound switch is on.
function switched_end(keys: KeyReading, typed_end: (() => void) | undefined): () => void {
	return () => {
		if (is_sounding(keys)) typed_end?.()
	}
}

// The shown theme's sound of an event or a part as it starts, under the sound switch.
function scored(keys: KeyReading, shown: Shown): Pick<TypingSound, 'event' | 'part'> {
	function score(): Score | undefined {
		const theme = shown()

		return theme === undefined || !is_sounding(keys) ? undefined : THEME_DEFS[theme].score
	}

	return {
		event: (kind, letters) => {
			ranked(score()?.[kind](letters), kind)
		},
		part: (name, ms) => {
			ranked(score()?.part(name, ms), name)
		},
	}
}

// An opening a key skipped: every sound it was playing ends — its bed, the trill's loop, its typed end
// — and, under the sound switch, its last sound, the board appearing, plays once as the board shows.
// Let go rather than held, so the board's first events still sound over it.
function skipped(keys: KeyReading | undefined, theme: Theme | undefined): void {
	hush()
	if (theme === undefined || keys === undefined || !is_sounding(keys)) return
	played(THEME_DEFS[theme].score.appear())
}

// `theme`'s NOTICE track rendered ahead, as the board starts or switches to it: the longest track,
// which would hold the board's frames while it renders as the first NOTICE starts.
function warm(theme: Theme | undefined): void {
	if (theme !== undefined) THEME_DEFS[theme].score.notice()
}

const run_board_live_sound = {
	heard,
	hush,
	is_sounding,
	scored,
	skipped,
	switched_end,
	typed_end_of,
	warm,
}

export { run_board_live_sound }
export type { Shown }
