import { createHash } from 'node:crypto'
import { closeSync, existsSync, openSync, readFileSync, readSync } from 'node:fs'
import path from 'node:path'
import { atomic_write } from '#scripts/lib/atomic-write'
import { usage_state_path } from '#scripts/usage/usage-state-path'
import { run_board_sound_synth, type Note } from './run-board-sound-synth'

// Synthesized cues saved as WAV files an OS player can open (joshuafolkken/kit#7944). Each sound is
// written once into the josh state directory under a digest of its definition and implementation, so a
// changed sound gets a new file and an unchanged one reuses the file already there.

const SAMPLE_RATE = 44_100
const HEADER_BYTES = 44
// The fmt chunk's sample rate: after the RIFF tag, size, WAVE tag, fmt tag, chunk size, format and channels.
const RATE_OFFSET = 24
// The RIFF size counts the bytes after its own field: the header less the `RIFF` tag and the size.
const RIFF_UNCOUNTED_BYTES = 8
const FMT_CHUNK_BYTES = 16
const PCM_FORMAT = 1
const CHANNELS = 1
const BITS_PER_SAMPLE = 16
const BYTES_PER_SAMPLE = 2
const U16_BYTES = 2
const U32_BYTES = 4
const DIGEST_LENGTH = 12
const source: { digest: string | undefined } = { digest: undefined }
// joshuafolkken/kit#8897: each sampled sound's path, resolved once per process, keyed by its
// directory, name, key and rate.
const resolved_paths = new Map<string, string>()

// A sound rendered to samples on demand: its name, what tells its renderings apart (a pace, say),
// the rate it is rendered at and the rendering itself.
interface SampledSound {
	name: string
	key: string
	sample_rate: number
	render: () => Int16Array
}

// In source runs these are separate modules; a distributed build contains both in this module's
// bundle. Hash the actual implementation, so changing synthesis needs no manually bumped version.
function implementation_digest(): string {
	const digest = createHash('sha256').update(readFileSync(new URL(import.meta.url)))
	const synth = new URL('run-board-sound-synth.ts', import.meta.url)

	if (existsSync(synth)) digest.update(readFileSync(synth))

	return digest.digest('hex')
}

function u16(value: number): Buffer {
	const field = Buffer.alloc(U16_BYTES)

	field.writeUInt16LE(value)

	return field
}

function u32(value: number): Buffer {
	const field = Buffer.alloc(U32_BYTES)

	field.writeUInt32LE(value)

	return field
}

function format_chunk(sample_rate: number): Buffer {
	return Buffer.concat([
		Buffer.from('fmt '),
		u32(FMT_CHUNK_BYTES),
		u16(PCM_FORMAT),
		u16(CHANNELS),
		u32(sample_rate),
		u32(sample_rate * BYTES_PER_SAMPLE),
		u16(BYTES_PER_SAMPLE),
		u16(BITS_PER_SAMPLE),
	])
}

function data_of(samples: Int16Array): Buffer {
	const data = Buffer.alloc(samples.length * BYTES_PER_SAMPLE)

	for (const [index, sample] of samples.entries()) {
		data.writeInt16LE(sample, index * BYTES_PER_SAMPLE)
	}

	return data
}

// 16-bit mono PCM as a WAV file's bytes: the RIFF, fmt and data chunks in order.
function wav_of(samples: Int16Array, sample_rate: number): Buffer {
	const data = data_of(samples)

	return Buffer.concat([
		Buffer.from('RIFF'),
		u32(HEADER_BYTES - RIFF_UNCOUNTED_BYTES + data.length),
		Buffer.from('WAVE'),
		format_chunk(sample_rate),
		Buffer.from('data'),
		u32(data.length),
		data,
	])
}

// The key is available before rendering, including the output and synthesis implementations.
function file_name_of(name: string, notes: ReadonlyArray<Note>): string {
	source.digest ??= implementation_digest()
	const definition = JSON.stringify([notes, SAMPLE_RATE, source.digest])
	const digest = createHash('sha256').update(definition).digest('hex').slice(0, DIGEST_LENGTH)

	return `${name}-${digest}.wav`
}

// The WAV at `file_name` in `directory`, rendered and written only when the file is not there yet;
// `undefined` when rendering or the write fails, so a bad sound or a failing disk silences it rather
// than taking the board down.
function cached_file(
	directory: string,
	file_name: () => string,
	render: () => Buffer,
): string | undefined {
	try {
		const target = path.join(directory, file_name())

		if (!existsSync(target)) atomic_write.replace_file(target, render())

		return target
	} catch {
		return undefined
	}
}

// The notes' WAV path, written on the first call only.
function cached_wav(
	name: string,
	notes: ReadonlyArray<Note>,
	directory = usage_state_path.sounds(),
): string | undefined {
	return cached_file(
		directory,
		() => file_name_of(name, notes),
		() => wav_of(run_board_sound_synth.samples_of(notes, SAMPLE_RATE), SAMPLE_RATE),
	)
}

// Rendered samples' WAV path at their own rate (joshuafolkken/kit#8365), named after the WAV's bytes:
// the same samples reuse their file and different ones get another.
function cached_samples(
	name: string,
	samples: Int16Array,
	sample_rate: number,
	directory = usage_state_path.sounds(),
): string | undefined {
	const wav = wav_of(samples, sample_rate)
	const digest = createHash('sha256').update(wav).digest('hex').slice(0, DIGEST_LENGTH)

	return cached_file(
		directory,
		() => `${name}-${digest}.wav`,
		() => wav,
	)
}

// The sound's WAV path (`cached_samples`), its samples rendered, built into a WAV and hashed on the
// first call only: later calls with the same directory, name, key and rate reuse the path. A path that
// could not be written is not kept, so the next call tries again.
function resolved_samples(
	sound: SampledSound,
	directory = usage_state_path.sounds(),
): string | undefined {
	const memo_key = JSON.stringify([directory, sound.name, sound.key, sound.sample_rate])
	const known = resolved_paths.get(memo_key)

	if (known !== undefined) return known

	const target = cached_samples(sound.name, sound.render(), sound.sample_rate, directory)

	if (target !== undefined) resolved_paths.set(memo_key, target)

	return target
}

// The sample rate a WAV file's fmt chunk records, read from its header alone, so a raw-PCM player
// plays each file at its own rate (joshuafolkken/kit#8365); throws when the file cannot be read.
function rate_of(file: string): number {
	const header = Buffer.alloc(HEADER_BYTES)
	const descriptor = openSync(file, 'r')

	try {
		readSync(descriptor, header, 0, HEADER_BYTES, 0)
	} finally {
		closeSync(descriptor)
	}

	return header.readUInt32LE(RATE_OFFSET)
}

const run_board_sound_wav = {
	SAMPLE_RATE,
	HEADER_BYTES,
	cached_samples,
	cached_wav,
	rate_of,
	resolved_samples,
	wav_of,
}

export { run_board_sound_wav, type SampledSound }
