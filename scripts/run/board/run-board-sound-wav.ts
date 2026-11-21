import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { atomic_write } from '#scripts/lib/atomic-write'
import { usage_state_path } from '#scripts/usage/usage-state-path'
import { run_board_sound_synth, type Note } from './run-board-sound-synth'

// Synthesized cues saved as WAV files an OS player can open (joshuafolkken/kit#7944). Each sound is
// written once into the josh state directory under a digest of its definition and implementation, so a
// changed sound gets a new file and an unchanged one reuses the file already there.

const SAMPLE_RATE = 44_100
const HEADER_BYTES = 44
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

function written_wav(name: string, notes: ReadonlyArray<Note>, directory: string): string {
	const target = path.join(directory, file_name_of(name, notes))

	if (existsSync(target)) return target
	const wav = wav_of(run_board_sound_synth.samples_of(notes, SAMPLE_RATE), SAMPLE_RATE)

	atomic_write.replace_file(target, wav)

	return target
}

// The sound's WAV path, written on the first call only; `undefined` when synthesis or the write
// fails, so a bad note or a failing disk silences the cue rather than taking the board down.
function cached_wav(
	name: string,
	notes: ReadonlyArray<Note>,
	directory = usage_state_path.sounds(),
): string | undefined {
	try {
		return written_wav(name, notes, directory)
	} catch {
		return undefined
	}
}

const run_board_sound_wav = { SAMPLE_RATE, HEADER_BYTES, cached_wav, wav_of }

export { run_board_sound_wav }
