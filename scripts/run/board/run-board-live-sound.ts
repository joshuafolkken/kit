import type { KeyReading } from './run-board-keys'
import { run_board_sound_latency } from './run-board-sound-latency'
import { run_board_sound_player, type Playing, type StartHandlers } from './run-board-sound-player'
import type { Score } from './run-board-sound-score'
import type { EventKind, TypingSound } from './run-board-sound-typing'
import type { BoardPorts } from './run-board-state'
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
// The longest a board's first frame waits for the resident player's output to open: a Bluetooth output
// takes a second or more (`run-board-sound-resident.ts`), the player's own start on top.
const READY_WAIT_MS = 2000
const HELD = new Set<Held>()
// Event and part sounds a frame ranked, started once the frame's typing has (joshuafolkken/kit#9087).
const PENDING: Array<{ file: string; rank: number }> = []
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
	// a sound not yet started is dropped with them
	PENDING.length = 0
}

// The board leaving: the trill stopped, every sound hushed, the resident player closed, then each of `steps`. Each runs though one
// before it threw, so a failing step never leaves a sound playing on (joshuafolkken/kit#9027); the
// first failure is rethrown once all have run.
function leave_with(trill: Pick<TypingSound, 'stop'> | undefined, steps: Array<() => void>): void {
	const failures: Array<unknown> = []

	for (const step of [() => trill?.stop(), hush, run_board_sound_player.close, ...steps]) {
		try {
			step()
		} catch (error: unknown) {
			failures.push(error)
		}
	}

	if (failures.length > 0) throw failures[0]
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

// An event's or a part's sound by the effects' rules: under a higher sound playing or due it stays
// silent, as the lower effect shows its text alone; else every sound before it ends at once — none
// outranks it then — and it is due to start with the frame's `flush`, after the frame's typing.
function ranked(file: string | undefined, name: EventKind | PartName): void {
	const rank = RANK[name]

	if (file === undefined || [...HELD, ...PENDING].some((held) => held.rank > rank)) return
	hush()
	PENDING.push({ file, rank })
}

// The sounds a frame ranked started, each held until it ends.
function flush(): void {
	for (const { file, rank } of PENDING.splice(0)) run_board_sound_player.start(file, holding(rank))
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

type Scored = Pick<
	TypingSound,
	'event' | 'part' | 'flush' | 'warm_event' | 'warm_part' | 'delay_ms'
>

// The shown theme's sound of an event or a part as it starts, under the sound switch; each rendered
// ahead by the warm ports as the frame that starts it is drawn, and the picture drawn behind the sound by
// the output's delay while the switch is on (joshuafolkken/kit#9087).
function scored(keys: KeyReading, shown: Shown): Scored {
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
		flush,
		warm_event: (kind, letters) => score()?.[kind](letters),
		warm_part: (name, ms) => score()?.part(name, ms),
		delay_ms: () => (is_sounding(keys) ? run_board_sound_latency.delay_ms() : 0),
	}
}

// An opening a key skipped: every sound it was playing ends — its bed, the trill's loop, its typed end
// — and, under the sound switch, its last sound, the board appearing, plays once as the board shows.
// Let go rather than held, so the board's first events still sound over it. Part of the typing voice, so
// a board that heard no trill (`--sound off`, joshuafolkken/kit#8915) stays silent even after an `s` flip.
function skipped(keys: KeyReading | undefined, theme: Theme | undefined): void {
	hush()
	if (theme === undefined || keys === undefined || TRILLS.size === 0 || !is_sounding(keys)) return
	played(THEME_DEFS[theme].score.appear())
}

// `theme`'s NOTICE track and the board appearing rendered ahead, as the board starts or switches to it —
// the longest track, which would hold the board's frames while it renders as the first NOTICE starts,
// and the sound a skipped opening plays — and the resident player opened (joshuafolkken/kit#9087).
function warm(theme: Theme | undefined): void {
	if (theme === undefined) return
	THEME_DEFS[theme].score.notice()
	THEME_DEFS[theme].score.appear()
	run_board_sound_player.prepare()
}

// The wait a board's first frame owes the resident player, none where no sound of the opening would be
// lost: no trill, no theme shown, the sound switch off, or no player still opening.
function awaited(
	board: Pick<BoardPorts, 'typing_sound'>,
	keys: KeyReading,
	shown: Shown | undefined,
): Promise<void> | undefined {
	if (board.typing_sound === undefined || shown?.() === undefined) return undefined

	return is_sounding(keys) ? run_board_sound_player.opening() : undefined
}

// The board's first frame held until the resident player's output is open, so the opening's first
// sounds are heard from their start: a `play` and its `stop` sent before then wait in the player's stdin
// and are read together, the sound never heard. No longer than `READY_WAIT_MS`, so a slow or stuck
// player never keeps the board; the clock is asked for no sleep where there is nothing to wait for.
async function ready(
	board: Pick<BoardPorts, 'sleep' | 'typing_sound'>,
	keys: KeyReading,
	shown: Shown | undefined,
): Promise<void> {
	const opening = awaited(board, keys, shown)

	if (opening !== undefined) await Promise.race([opening, board.sleep(READY_WAIT_MS)])
}

const run_board_live_sound = {
	READY_WAIT_MS,
	heard,
	hush,
	is_sounding,
	leave_with,
	ready,
	scored,
	skipped,
	switched_end,
	typed_end_of,
	warm,
}

export { run_board_live_sound }
export type { Shown }
