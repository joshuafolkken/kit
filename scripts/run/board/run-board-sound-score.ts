import { run_board_sound_shape } from './run-board-sound-shape'
import { run_board_sound_voice, type Bed, type Sound } from './run-board-sound-voice'
import { run_board_theme_host_state } from './run-board-theme-host-state'

// A theme's sounds laid out on each event's own time line (joshuafolkken/kit#8917). Each event plays one
// WAV from its start, the parts that overlap mixed into it beforehand, so the board starts one player
// per event and the OS mixes it over the typing trill and any other sound still playing. Loudness rises
// PROGRESS < ROW < NOTICE: a PROGRESS has at most its typed end, a ROW its start, a bed while it types
// and its end, a NOTICE its call, a bed rising to the peak, the peak, a sound on each of the three
// blinks with the bed held between them, and its close.

const { TICK_MS, PEAK_TICKS, NOTICE_END, TRACE_EVERY, TRACE_END } = run_board_theme_host_state
const { add_into, bed_samples, sample_at, sinking, sound_samples } = run_board_sound_voice
const { SAMPLE_RATE, silence, voice_wav } = run_board_sound_shape

const MS_PER_SECOND = 1000
const PEAK_MS = PEAK_TICKS * TICK_MS
const BLINK_EVERY_MS = TRACE_EVERY * TICK_MS
const BLINKS = 3
const FIRST_BLINK_LAG_MS = 500
const CLOSE_AT_MS = PEAK_MS + TRACE_END * TICK_MS
// The host's NOTICE on screen: its effect holds while `cooled` is under NOTICE_END, 0 on the peak's
// last typing tick, so one tick fewer than the peak and the tail.
const NOTICE_MS = (PEAK_TICKS + NOTICE_END - 1) * TICK_MS
// A theme with its own after-peak holds its bed until this long before its NOTICE ends — the last
// lines shown still — and its close ends as the NOTICE does.
const OWN_HOLD_LEAD_MS = 2000
// Each track's WAV once rendered, by its name and key: a track renders once a run.
const RENDERED = new Map<string, string | undefined>()
// The bed between the blinks, as a share of the bed rising to the peak; the opening's bed likewise.
const HELD_GAIN = 0.6
const OPENING_GAIN = 0.5
// No track is louder than this share of full scale.
const TRACK_LIMIT = 0.3

type PartName = 'opening' | 'ending'

// A theme's palette: its sounds and beds, all as data (`run-board-sound-voice.ts`).
interface Palette {
	name: string
	notice: {
		call: Sound
		bed: Bed
		peak: Sound
		blink?: Sound
		close: Sound
		// A theme whose NOTICE plays on past the blinks: its length and its track from the peak.
		ms?: number
		after_peak?: () => Array<number>
	}
	row: { start: Sound; during: Bed; end: Sound }
	progress_end?: Sound
	appear: Sound
	vanish: Sound
	// One-shot sounds the OPENING plays on its way, each from its time since the start
	// (joshuafolkken/kit#9087); a cue past the opening's end is left out.
	opening_cues?: ReadonlyArray<{ at_ms: number; sound: Sound }>
}

// A timed part of a track: its samples from `at_ms`, at `gain`.
interface Placed {
	at_ms: number
	samples: Array<number>
	gain: number
}

// The WAV each event and part plays from its start.
interface Score {
	notice: () => string | undefined
	row: (letters: number) => string | undefined
	progress: (letters: number) => string | undefined
	part: (name: PartName, ms: number) => string | undefined
	// The opening's last sound alone — the board appearing — closing an opening a key skipped.
	appear: () => string | undefined
}

function loudest(samples: ReadonlyArray<number>): number {
	let top = 0

	for (const value of samples) top = Math.max(top, Math.abs(value))

	return top
}

function scaled(samples: Array<number>, peak: number): Array<number> {
	const top = loudest(samples)

	return top === 0 ? samples : samples.map((value) => (value * peak) / top)
}

// A sound at its own peak, so parts mixed keep their loudness to one another.
function placed(sound: Sound, at_ms: number): Placed {
	return { at_ms, samples: scaled(sound_samples(sound), sound.peak), gain: 1 }
}

function bed_part(bed: Bed, at_ms: number, ms: number, gain = 1): Placed {
	return { at_ms, samples: scaled(bed_samples(bed, ms), bed.peak), gain }
}

function ms_of(samples: ReadonlyArray<number>): number {
	return (samples.length * MS_PER_SECOND) / SAMPLE_RATE
}

// The parts laid into one track, long enough for the last of them to finish.
function laid(parts: ReadonlyArray<Placed>, ms: number): Array<number> {
	const end_ms = Math.max(ms, ...parts.map((part) => part.at_ms + ms_of(part.samples)))
	const out = silence(end_ms)

	for (const part of parts) add_into(out, part.samples, sample_at(part.at_ms), part.gain)

	return out
}

// The parts laid into a track no longer than its event shows on screen (`ms`): what runs past is cut.
function fitted(parts: ReadonlyArray<Placed>, ms: number): Array<number> {
	return laid(parts, ms).slice(0, sample_at(ms))
}

// A sound placed to end at `end_ms`, from the track's start at the soonest.
function ending_at(sound: Sound, end_ms: number): Placed {
	const part = placed(sound, 0)

	return { ...part, at_ms: Math.max(0, end_ms - ms_of(part.samples)) }
}

function blinks_of(blink: Sound | undefined): Array<Placed> {
	if (blink === undefined) return []

	// The first blink starts with the peak, so its sound waits for the peak's to die away.
	return Array.from({ length: BLINKS }, (_, index) => {
		const lag = index === 0 ? FIRST_BLINK_LAG_MS : 0

		return placed(blink, PEAK_MS + BLINK_EVERY_MS * index + lag)
	})
}

// The held bed's end and the close of a NOTICE `ms` long: the host's close at the trace's end; a theme
// with its own after-peak holds its bed to just before its longer NOTICE ends and closes as it ends.
function closing_of(notice: Palette['notice'], ms: number): { held_to: number; close: Placed } {
	if (notice.ms === undefined) {
		return { held_to: CLOSE_AT_MS, close: placed(notice.close, CLOSE_AT_MS) }
	}

	return { held_to: ms - OWN_HOLD_LEAD_MS, close: ending_at(notice.close, ms) }
}

// A NOTICE's track, no longer than it shows: call, rising bed, peak, blinks over the held bed, close; a
// theme with its own after-peak lays that from the peak.
function notice_track(palette: Palette): Array<number> {
	const { notice } = palette
	const ms = notice.ms ?? NOTICE_MS
	const { held_to, close } = closing_of(notice, ms)
	const held = { ...notice.bed, from_gain: 1 }
	const after = notice.after_peak?.() ?? []

	return fitted(
		[
			placed(notice.call, 0),
			bed_part(notice.bed, 0, PEAK_MS),
			bed_part(held, PEAK_MS, held_to - PEAK_MS, HELD_GAIN),
			placed(notice.peak, PEAK_MS),
			...blinks_of(notice.blink),
			{ at_ms: PEAK_MS, samples: after, gain: 1 },
			close,
		],
		ms,
	)
}

function letters_ms(letters: number): number {
	return Math.max(1, letters) * TICK_MS
}

// A ROW's track over the letters typing, as long as they: its start, its bed, and its end ending as
// they finish.
function row_track(palette: Palette, letters: number): Array<number> {
	const { row } = palette
	const typing_ms = letters_ms(letters)

	return fitted(
		[placed(row.start, 0), bed_part(row.during, 0, typing_ms), ending_at(row.end, typing_ms)],
		typing_ms,
	)
}

// A PROGRESS's track over the letters typing, as long as they: its typed end ending as they finish.
function progress_track(end: Sound, letters: number): Array<number> {
	const typing_ms = letters_ms(letters)

	return fitted([ending_at(end, typing_ms)], typing_ms)
}

// The opening's cues that start within its `ms`, each placed at its time.
function cues_of(palette: Palette, ms: number): Array<Placed> {
	const cues = palette.opening_cues ?? []

	return cues.filter(({ at_ms }) => at_ms < ms).map(({ at_ms, sound }) => placed(sound, at_ms))
}

// A part's track, as long as the part: the opening's quiet bed, its cues, then the board appearing; the
// ending's sinking bed then the board gone, each ending with the part.
function part_track(palette: Palette, name: PartName, ms: number): Array<number> {
	const is_opening = name === 'opening'
	const bed = is_opening ? palette.notice.bed : sinking(palette.notice.bed)
	const last = is_opening ? palette.appear : palette.vanish
	const cues = is_opening ? cues_of(palette, ms) : []

	return fitted(
		[bed_part(bed, 0, ms, is_opening ? OPENING_GAIN : HELD_GAIN), ...cues, ending_at(last, ms)],
		ms,
	)
}

// A track's WAV at its own loudness: `pcm` scales to the loudest sample, so it is given that loudest,
// held under `TRACK_LIMIT`. A silent track writes none.
function rendered_wav(name: string, key: string, render: () => Array<number>): string | undefined {
	const samples = render()
	const top = loudest(samples)

	if (top === 0) return undefined

	return voice_wav({ name, key, peak: Math.min(top, TRACK_LIMIT), render: () => samples })
}

// A track's WAV, rendered on its first call only.
function track_wav(name: string, key: string, render: () => Array<number>): string | undefined {
	const id = `${name}\0${key}`

	if (!RENDERED.has(id)) RENDERED.set(id, rendered_wav(name, key, render))

	return RENDERED.get(id)
}

function progress_wav(palette: Palette, letters: number): string | undefined {
	const end = palette.progress_end

	if (end === undefined) return undefined

	return track_wav(`${palette.name}-progress`, String(letters), () => progress_track(end, letters))
}

function score_of(palette: Palette): Score {
	const { name } = palette

	return {
		notice: () => track_wav(`${name}-notice`, '', () => notice_track(palette)),
		row: (letters) => track_wav(`${name}-row`, String(letters), () => row_track(palette, letters)),
		progress: (letters) => progress_wav(palette, letters),
		part: (part, ms) =>
			track_wav(`${name}-${part}`, String(ms), () => part_track(palette, part, ms)),
		appear: () => track_wav(`${name}-appear`, '', () => laid([placed(palette.appear, 0)], 0)),
	}
}

const run_board_sound_score = { PEAK_MS, laid, loudest, scaled, score_of }

export { run_board_sound_score }
export type { Palette, Placed, Score }
