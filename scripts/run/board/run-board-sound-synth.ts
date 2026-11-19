// PCM samples (16-bit mono) synthesized from text note definitions, so `run:board` can sound cues
// without bundling audio files (joshuafolkken/kit#7943). Each note fades in and out linearly at its
// edges so the joins between notes do not click.

type Wave = 'sine' | 'square' | 'triangle'

interface Note {
	// A pitch name such as `C5`, `F#4` or `Bb3`, or `REST` for silence.
	readonly pitch: string
	readonly ms: number
	readonly wave: Wave
}

const REST = 'REST'
// The default loudness: the RMS (average level, not the amplitude) every note sounds at as a fraction
// of full scale, about -20 dBFS like common notification sounds. Applied here rather than by the
// player because players do not take a volume argument alike across operating systems.
const TARGET_RMS = 0.1
// Each wave's RMS at amplitude 1; a note's amplitude is `TARGET_RMS` over it, so no wave sounds
// louder than another (joshuafolkken/kit#8190). A triangle's RMS is 1/√3.
const TRIANGLE_MEAN_SQUARE_DIVISOR = 3
const WAVE_RMS: Readonly<Record<Wave, number>> = {
	sine: Math.SQRT1_2,
	square: 1,
	triangle: 1 / Math.sqrt(TRIANGLE_MEAN_SQUARE_DIVISOR),
}
const FADE_MS = 5
const MS_PER_SECOND = 1000
const FULL_SCALE = 32_767
const A4_FREQUENCY = 440
const A4_MIDI = 69
const OCTAVE_RATIO = 2
const RADIANS_PER_CYCLE = Math.PI + Math.PI
const HALF_CYCLE = 0.5
const QUARTER_CYCLE = 0.25
const TRIANGLE_SLOPE = 4
const PITCH_PATTERN = /^(?<letter>[A-G])(?<accidental>[#b]?)(?<octave>-?\d)$/u
// One octave's semitones from C; a letter's semitone is its place here.
const CHROMATIC: ReadonlyArray<string> = [
	'C',
	'C#',
	'D',
	'D#',
	'E',
	'F',
	'F#',
	'G',
	'G#',
	'A',
	'A#',
	'B',
]
const SEMITONES_PER_OCTAVE = CHROMATIC.length
// A natural (no accidental) is absent here and so reads 0.
const ACCIDENTAL_SEMITONES: ReadonlyMap<string, number> = new Map([
	['#', 1],
	['b', -1],
])

// A letter's semitone from C within its octave, moved by its accidental.
function semitone_of(letter = '', accidental = ''): number {
	return CHROMATIC.indexOf(letter) + (ACCIDENTAL_SEMITONES.get(accidental) ?? 0)
}

function midi_of(pitch: string): number {
	const groups = PITCH_PATTERN.exec(pitch)?.groups

	if (groups === undefined) throw new Error(`Unknown pitch: ${pitch}`)

	const semitone = semitone_of(groups['letter'], groups['accidental'])

	return (Number(groups['octave']) + 1) * SEMITONES_PER_OCTAVE + semitone
}

// A pitch's frequency in Hz on equal temperament with A4 at 440 Hz; a rest is 0.
function frequency_of(pitch: string): number {
	if (pitch === REST) return 0

	return A4_FREQUENCY * OCTAVE_RATIO ** ((midi_of(pitch) - A4_MIDI) / SEMITONES_PER_OCTAVE)
}

// One wave's value in [-1, 1] at a phase in [0, 1): sine and triangle start at 0, square starts at 1.
function wave_value(wave: Wave, phase: number): number {
	if (wave === 'sine') return Math.sin(RADIANS_PER_CYCLE * phase)
	if (wave === 'square') return phase < HALF_CYCLE ? 1 : -1

	return 1 - TRIANGLE_SLOPE * Math.abs(((phase + QUARTER_CYCLE) % 1) - HALF_CYCLE)
}

// The linear edge fade's gain at a sample: 0 at the first and last sample, 1 past the fade.
function fade_gain(index: number, count: number, fade_count: number): number {
	return Math.max(0, Math.min(1, index / fade_count, (count - 1 - index) / fade_count))
}

function sample_count_of(ms: number, sample_rate: number): number {
	return Math.round((ms * sample_rate) / MS_PER_SECOND)
}

function note_samples(note: Note, sample_rate: number): Int16Array {
	const count = sample_count_of(note.ms, sample_rate)

	// A rest is silent whatever its wave: a square wave's value at phase 0 is not 0.
	if (note.pitch === REST) return new Int16Array(count)

	const frequency = frequency_of(note.pitch)
	const fade_count = Math.max(1, sample_count_of(FADE_MS, sample_rate))
	const amplitude = (TARGET_RMS / WAVE_RMS[note.wave]) * FULL_SCALE

	return Int16Array.from({ length: count }, (_, index) => {
		const phase = ((index * frequency) / sample_rate) % 1
		const gain = fade_gain(index, count, fade_count)

		return Math.round(wave_value(note.wave, phase) * gain * amplitude)
	})
}

// The notes' samples back to back, as 16-bit mono PCM at the sample rate.
function samples_of(notes: ReadonlyArray<Note>, sample_rate: number): Int16Array {
	const parts = notes.map((note) => note_samples(note, sample_rate))

	return new Int16Array(parts.flatMap((part) => [...part]))
}

const run_board_sound_synth = { REST, TARGET_RMS, FULL_SCALE, frequency_of, samples_of }

export { run_board_sound_synth }
export type { Note, Wave }
