import { run_board_sound_click } from './run-board-sound-click'
import { run_board_sound_synth } from './run-board-sound-synth'
import { run_board_sound_typing } from './run-board-sound-typing'
import { run_board_sound_wav } from './run-board-sound-wav'

// The building blocks of the themes' own voices (joshuafolkken/kit#8917): short tones that may glide
// and die away, noise bursts and silence, as samples in [-1, 1], and a voice's WAV scaled to its peak.
// New short electronic sounds, none copied from a film's or a game's.

type Wave = 'sine' | 'square' | 'triangle'

// A tone: its pitch (gliding to `to_hz` where given), length, wave and the time it dies away by.
interface Tone {
	hz: number
	to_hz?: number
	ms: number
	wave: Wave
	decay_ms?: number
}

// A voice to cache: its name, the key its samples vary by, the peak it is scaled to, and its samples.
interface Voice {
	name: string
	key: string
	peak: number
	render: () => Array<number>
}

const SAMPLE_RATE = 48_000
const MS_PER_SECOND = 1000
const FADE_MS = 2
const HALF_CYCLE = 0.5
const QUARTER_CYCLE = 0.25
const TRIANGLE_SLOPE = 4
const RADIANS_PER_CYCLE = Math.PI + Math.PI
const NOISE_SPAN = 2
// A typing loop's letters: the teletype trill's pairs, so at its pace it lasts as long.
const LOOP_LETTERS = run_board_sound_typing.TRILL_PAIRS

function count_of(ms: number): number {
	return Math.round((ms * SAMPLE_RATE) / MS_PER_SECOND)
}

function wave_value(wave: Wave, phase: number): number {
	if (wave === 'sine') return Math.sin(RADIANS_PER_CYCLE * phase)
	if (wave === 'square') return phase < HALF_CYCLE ? 1 : -1

	return 1 - TRIANGLE_SLOPE * Math.abs(((phase + QUARTER_CYCLE) % 1) - HALF_CYCLE)
}

// The gain at sample `index` of `count`: faded in and out at the edges, dying away by `decay`.
function gain_at(index: number, count: number, decay: number | undefined): number {
	const fade = count_of(FADE_MS)
	const edge = Math.max(0, Math.min(1, index / fade, (count - 1 - index) / fade))

	return decay === undefined ? edge : edge * Math.exp(-index / decay)
}

// A tone's samples; its phase runs on, so a glide sweeps without a jump.
function tone(spec: Tone): Array<number> {
	const count = count_of(spec.ms)
	const to_hz = spec.to_hz ?? spec.hz
	const decay = spec.decay_ms === undefined ? undefined : count_of(spec.decay_ms)
	let phase = 0

	return Array.from({ length: count }, (_, index) => {
		const hz = spec.hz + ((to_hz - spec.hz) * index) / count

		phase = (phase + hz / SAMPLE_RATE) % 1

		return wave_value(spec.wave, phase) * gain_at(index, count, decay)
	})
}

// A burst of noise `ms` long dying away by `decay_ms`, the same burst for the same `seed`.
function noise(ms: number, decay_ms: number, seed: number): Array<number> {
	const random = run_board_sound_click.seeded(seed)
	const count = count_of(ms)
	const decay = count_of(decay_ms)

	return Array.from({ length: count }, (_, index) => {
		return (random() * NOISE_SPAN - 1) * gain_at(index, count, decay)
	})
}

function silence(ms: number): Array<number> {
	return Array.from({ length: count_of(ms) }, () => 0)
}

// Two parts sounding together, `weight` the share of the second.
function mixed(first: Array<number>, second: Array<number>, weight: number): Array<number> {
	const length = Math.max(first.length, second.length)

	return Array.from({ length }, (_, index) => {
		return (first[index] ?? 0) * (1 - weight) + (second[index] ?? 0) * weight
	})
}

// `part` cut or padded with silence to `ms`.
function fitted(part: Array<number>, ms: number): Array<number> {
	const count = count_of(ms)

	return Array.from({ length: count }, (_, index) => part[index] ?? 0)
}

// The loudest sample's size; a loop's samples are too many to spread into `Math.max`.
function loudest(samples: Array<number>): number {
	let top = 0

	for (const value of samples) top = Math.max(top, Math.abs(value))

	return top
}

// The samples scaled so their loudest reaches `peak` of full scale.
function pcm(samples: Array<number>, peak: number): Int16Array {
	const top = loudest(samples)
	const scale = top === 0 ? 0 : (peak * run_board_sound_synth.FULL_SCALE) / top

	return Int16Array.from(samples, (value) => Math.round(value * scale))
}

// The voice's WAV path, written once under the sounds directory.
function voice_wav(voice: Voice, directory?: string): string | undefined {
	return run_board_sound_wav.resolved_samples(
		{
			name: voice.name,
			key: voice.key,
			sample_rate: SAMPLE_RATE,
			render: () => pcm(voice.render(), voice.peak),
		},
		directory,
	)
}

// A typing loop: `part` once a letter.
function looped(part: Array<number>, letter_ms: number): Array<number> {
	const unit = fitted(part, letter_ms)

	return Array.from({ length: LOOP_LETTERS }, () => unit).flat()
}

// A theme's typing WAV: its `part` once a letter at `letter_ms`.
function typing_wav(
	voice: Omit<Voice, 'key' | 'render'> & { part: () => Array<number> },
	letter_ms: number,
	directory?: string,
): string | undefined {
	const { name, peak, part } = voice

	return voice_wav(
		{ name, peak, key: String(letter_ms), render: looped.bind(undefined, part(), letter_ms) },
		directory,
	)
}

const run_board_sound_shape = {
	SAMPLE_RATE,
	fitted,
	looped,
	typing_wav,
	mixed,
	noise,
	pcm,
	silence,
	tone,
	voice_wav,
}

export { run_board_sound_shape }
export type { Tone, Voice }
