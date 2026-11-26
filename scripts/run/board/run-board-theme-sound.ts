import type { TypingSound } from './run-board-sound-typing'
import { run_board_theme_defs, type IntroDefinition, type Theme } from './run-board-theme-defs'
import type { PartTyping, TypedSpan } from './run-board-theme-host-types'

// A themed board's opening sound (joshuafolkken/kit#8917): the theme's opening plays as frames of the
// theme host, and its sound keeps the old intro's count and times (`intro` in `run-board-theme-defs.ts`), counted from
// the opening's first frame — the trill while each line's letters type, and the typed-end sound once the
// theme's line types through. The one-shot sounds on the first frame at or past its moment, once, however
// many frames were skipped; a key that skips the opening before then leaves it silent, as before.

// A stretch the trill sounds over, from the part's start.
type TrillSpan = TypedSpan

// The trill's stretches and the typed-end's moment (none where the intro sounds none). An ending that
// types letters sounds the same way, from the part's own `typing` (`ThemePart`).
type OpeningSound = PartTyping

const SILENT: OpeningSound = { spans: [], typed_ms: undefined }

// The lead lines' letters, each line's hold and gap after it (the removed `run-board-intro.ts` → `lead_in`).
function lead_spans(
	lines: ReadonlyArray<string>,
	letter_ms: number,
	rest_ms: number,
): Array<TrillSpan> {
	const spans: Array<TrillSpan> = []
	let at = 0

	for (const line of lines) {
		const to_ms = at + line.length * letter_ms

		spans.push({ from_ms: at, to_ms })
		at = to_ms + rest_ms
	}

	return spans
}

// The sound of `theme`'s old intro: its lead lines' letters, or its line's and the typed end after
// them.
function opening_sound_of(theme: Theme | undefined): OpeningSound {
	if (theme === undefined) return SILENT
	const { intro }: { intro: IntroDefinition } = run_board_theme_defs.THEME_DEFS[theme]
	const { leads } = intro

	if (leads !== undefined) {
		return {
			spans: lead_spans(leads.lines, intro.letter_ms, leads.hold_ms + leads.gap_ms),
			typed_ms: undefined,
		}
	}

	const typed_ms = intro.line.length * intro.letter_ms

	return { spans: [{ from_ms: 0, to_ms: typed_ms }], typed_ms }
}

// How long the trill still sounds `since_ms` into the opening; 0 where it is silent then.
function trill_left(sound: OpeningSound, since_ms: number): number {
	const span = sound.spans.find(({ from_ms, to_ms }) => since_ms >= from_ms && since_ms < to_ms)

	return span === undefined ? 0 : span.to_ms - since_ms
}

// Whether the typed end's moment falls after `last_ms` and by `since_ms`, both into the opening.
function is_crossed(sound: OpeningSound, last_ms: number | undefined, since_ms: number): boolean {
	const { typed_ms } = sound

	if (typed_ms === undefined || since_ms < typed_ms) return false

	return last_ms === undefined || last_ms < typed_ms
}

// How long the trill is timed to sound: untimed while the opening's letters (`opening_left_ms`) type,
// else the board's own letters' time.
function timed_ms(opening_left_ms: number, board_left_ms: number): number | undefined {
	return opening_left_ms > 0 ? undefined : board_left_ms
}

// What one frame `since_ms` into the opening sounds, the last frame having been `last_ms` into it: the
// trill set with the board's own typing's, and the typed end where its moment was crossed. While the
// opening's letters type the trill takes no `left_ms`, so it sounds until a frame past them turns it off
// and never calls its `ended` itself: the typed end is the opening's own, once, or none in a theme whose
// intro has none.
function sounded(
	trill: Pick<TypingSound, 'set' | 'typed'> | undefined,
	sound: OpeningSound,
	at: { last_ms: number | undefined; since_ms: number },
	board: { is_on: boolean; left_ms: number },
): void {
	if (trill === undefined) return
	const left_ms = trill_left(sound, at.since_ms)

	trill.set(board.is_on || left_ms > 0, timed_ms(left_ms, board.left_ms))
	if (is_crossed(sound, at.last_ms, at.since_ms)) trill.typed?.()
}

// The trill's voice in `theme`: its row's typing WAV at its opening's letter pace
// (joshuafolkken/kit#8365), read by the trill as it starts.
function voice_of(theme: Theme): () => string | undefined {
	const { typing, intro } = run_board_theme_defs.THEME_DEFS[theme]

	return () => typing(intro.letter_ms)
}

const run_board_theme_sound = {
	SILENT,
	is_crossed,
	opening_sound_of,
	sounded,
	trill_left,
	voice_of,
}

export { run_board_theme_sound }
export type { OpeningSound, TrillSpan }
