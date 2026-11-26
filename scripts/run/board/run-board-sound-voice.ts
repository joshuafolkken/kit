import { run_board_sound_click } from './run-board-sound-click'
import { run_board_sound_shape, type Tone } from './run-board-sound-shape'

// A theme's voices as data (joshuafolkken/kit#8917): a sound is a run of tones, noise bursts, rests and
// samples a theme already renders, layered where several sound at once; a bed is a pulse train (and an
// optional drone) whose pitch and pace move across its length. Every voice is computed, none recorded.

const { noise, silence, tone, SAMPLE_RATE } = run_board_sound_shape

type Segment =
	| { tone: Tone }
	| { noise: { ms: number; decay_ms: number; seed: number } }
	| { rest: number }
	| { samples: () => Array<number> }

// A one-shot: its layers sound together, each a run of segments; `peak` is its loudest sample.
interface Sound {
	peak: number
	layers: ReadonlyArray<ReadonlyArray<Segment>>
}

// What a bed's pulse or drone sounds in: a wave at `hz` gliding to `to_hz`, or noise.
interface Voice {
	wave: Tone['wave'] | 'noise'
	hz: number
	to_hz: number
}

// A pulse train: `ms` pulses every `every_ms` easing to `to_every_ms`, every second one at `alt_hz`
// where given, each gap stretched or shrunk by up to half of `jitter`.
interface Pulse extends Voice {
	ms: number
	every_ms: number
	to_every_ms: number
	alt_hz?: number
	jitter?: number
}

// A bed: its pulse train and drone, `peak` its loudest, swelling from `from_gain` of it.
interface Bed {
	peak: number
	from_gain: number
	pulse?: Pulse | undefined
	drone?: Voice | undefined
}

const MS_PER_SECOND = 1000
const HALF = 0.5
const DRONE_SHARE = 0.5
const JITTER_SEED = 8917
const PULSE_DECAY_SHARE = 0.6
const EVERY_OTHER = 2

function segment_samples(segment: Segment): Array<number> {
	if ('tone' in segment) return tone(segment.tone)
	if ('noise' in segment) return noise(segment.noise.ms, segment.noise.decay_ms, segment.noise.seed)
	if ('samples' in segment) return segment.samples()

	return silence(segment.rest)
}

// `part` added into `out` from sample `start` at `gain`, cut at `out`'s end.
function add_into(out: Array<number>, part: ReadonlyArray<number>, start: number, gain = 1): void {
	const end = Math.min(part.length, out.length - start)

	for (let index = 0; index < end; index += 1) {
		out[start + index] = (out[start + index] ?? 0) + (part[index] ?? 0) * gain
	}
}

// A sound's samples: its layers summed.
function sound_samples(sound: Sound): Array<number> {
	const layers = sound.layers.map((layer) => layer.flatMap((segment) => segment_samples(segment)))
	const length = Math.max(0, ...layers.map((layer) => layer.length))
	const out = Array.from({ length }, () => 0)

	for (const layer of layers) add_into(out, layer, 0)

	return out
}

// One pulse at `share` (0 to 1) through the bed, its pitch moved along with it.
function pulse_at(pulse: Pulse, share: number, count: number): Array<number> {
	const base = pulse.hz + (pulse.to_hz - pulse.hz) * share
	const hz = pulse.alt_hz !== undefined && count % EVERY_OTHER === 1 ? pulse.alt_hz : base
	const decay_ms = pulse.ms * PULSE_DECAY_SHARE

	if (pulse.wave === 'noise') return noise(pulse.ms, decay_ms, JITTER_SEED + count)

	return tone({ hz, ms: pulse.ms, wave: pulse.wave, decay_ms })
}

function sample_at(ms: number): number {
	return Math.round((ms * SAMPLE_RATE) / MS_PER_SECOND)
}

// The pulse train across `ms`: each pulse written into the track where it starts.
function pulse_train(pulse: Pulse, ms: number): Array<number> {
	const out = silence(ms)
	const random = run_board_sound_click.seeded(JITTER_SEED)
	const at = { ms: 0, count: 0 }

	while (at.ms < ms) {
		const share = at.ms / ms
		const gap = pulse.every_ms + (pulse.to_every_ms - pulse.every_ms) * share

		add_into(out, pulse_at(pulse, share, at.count), sample_at(at.ms))
		at.ms += gap * (1 + (pulse.jitter ?? 0) * (random() - HALF))
		at.count += 1
	}

	return out
}

function drone_samples(drone: Voice, ms: number): Array<number> {
	if (drone.wave === 'noise') return noise(ms, ms * ms, JITTER_SEED)

	return tone({ hz: drone.hz, to_hz: drone.to_hz, ms, wave: drone.wave })
}

// A bed `ms` long: its drone under its pulses, swelling from `from_gain` to full.
function bed_samples(bed: Bed, ms: number): Array<number> {
	const pulses = bed.pulse === undefined ? silence(ms) : pulse_train(bed.pulse, ms)
	const drone = bed.drone === undefined ? silence(ms) : drone_samples(bed.drone, ms)
	const share = bed.drone === undefined ? 0 : DRONE_SHARE
	const both = run_board_sound_shape.mixed(pulses, drone, share)
	const rise = 1 - bed.from_gain

	return both.map((value, index) => value * (bed.from_gain + (rise * index) / both.length))
}

// The bed reversed in pitch and pace: it sinks and slows.
function sinking(bed: Bed): Bed {
	const { pulse, drone } = bed
	const turned_pulse = pulse && {
		...pulse,
		hz: pulse.to_hz,
		to_hz: pulse.hz,
		every_ms: pulse.to_every_ms,
		to_every_ms: pulse.every_ms,
	}
	const turned_drone = drone && { ...drone, hz: drone.to_hz, to_hz: drone.hz }

	return { ...bed, pulse: turned_pulse, drone: turned_drone }
}

// Builders that keep a palette's rows short: a tone, a noise burst and a rest.
function beep(hz: number, ms: number, wave: Tone['wave'], more: Partial<Tone> = {}): Segment {
	return { tone: { hz, ms, wave, ...more } }
}

function hiss(ms: number, decay_ms: number, seed = JITTER_SEED): Segment {
	return { noise: { ms, decay_ms, seed } }
}

function rest(ms: number): Segment {
	return { rest: ms }
}

const run_board_sound_voice = {
	add_into,
	bed_samples,
	beep,
	hiss,
	rest,
	sample_at,
	sinking,
	sound_samples,
}

export { run_board_sound_voice }
export type { Bed, Pulse, Segment, Sound, Voice }
