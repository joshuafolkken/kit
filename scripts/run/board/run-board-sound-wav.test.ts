import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { atomic_write } from '#scripts/lib/atomic-write'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Note } from './run-board-sound-synth'
import { run_board_sound_wav } from './run-board-sound-wav'

// joshuafolkken/kit#7944: synthesized PCM is saved once as a WAV file named by its definition.

const { SAMPLE_RATE, HEADER_BYTES, cached_wav, wav_of } = run_board_sound_wav

const SAMPLES: Int16Array = Int16Array.from([0, 1000, -1000, 32_767])
const DATA_BYTES = 8
const RIFF_SIZE = 44
const BYTE_RATE = 88_200
const OFFSETS = {
	riff_size: 4,
	wave: 8,
	fmt: 12,
	fmt_size: 16,
	format: 20,
	channels: 22,
	sample_rate: 24,
	byte_rate: 28,
	block_align: 32,
	bits: 34,
	data: 36,
	data_size: 40,
} as const
const TAG_BYTES = 4
const NOTES: ReadonlyArray<Note> = [{ pitch: 'C5', ms: 10, wave: 'sine' }]
const CHANGED_NOTES: ReadonlyArray<Note> = [{ pitch: 'D5', ms: 10, wave: 'sine' }]

function tag_at(wav: Buffer, offset: number): string {
	return wav.toString('ascii', offset, offset + TAG_BYTES)
}

const create_directory = temporary_directory()

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_board_sound_wav.wav_of', () => {
	it('tags the RIFF, fmt and data chunks with sizes matching the PCM length (ac-95209826)', () => {
		const wav = wav_of(SAMPLES, SAMPLE_RATE)

		expect(wav).toHaveLength(HEADER_BYTES + DATA_BYTES)
		expect(tag_at(wav, 0)).toBe('RIFF')
		expect(wav.readUInt32LE(OFFSETS.riff_size)).toBe(RIFF_SIZE)
		expect(tag_at(wav, OFFSETS.wave)).toBe('WAVE')
		expect(tag_at(wav, OFFSETS.fmt)).toBe('fmt ')
		expect(tag_at(wav, OFFSETS.data)).toBe('data')
		expect(wav.readUInt32LE(OFFSETS.data_size)).toBe(DATA_BYTES)
	})

	it('describes 16-bit mono PCM at the sample rate', () => {
		const wav = wav_of(SAMPLES, SAMPLE_RATE)

		expect(wav.readUInt32LE(OFFSETS.fmt_size)).toBe(16)
		expect(wav.readUInt16LE(OFFSETS.format)).toBe(1)
		expect(wav.readUInt16LE(OFFSETS.channels)).toBe(1)
		expect(wav.readUInt32LE(OFFSETS.sample_rate)).toBe(SAMPLE_RATE)
		expect(wav.readUInt32LE(OFFSETS.byte_rate)).toBe(BYTE_RATE)
		expect(wav.readUInt16LE(OFFSETS.block_align)).toBe(2)
		expect(wav.readUInt16LE(OFFSETS.bits)).toBe(16)
	})

	it('stores the samples little-endian after the header', () => {
		const wav = wav_of(SAMPLES, SAMPLE_RATE)
		const stored = SAMPLES.map((_, index) => wav.readInt16LE(HEADER_BYTES + index + index))

		expect([...stored]).toStrictEqual([...SAMPLES])
	})
})

describe('run_board_sound_wav.cached_wav', () => {
	let directory = ''

	beforeEach(() => {
		directory = create_directory('run-board-sound-wav-')
	})

	it('writes the WAV file into the directory and returns its path', () => {
		const target = cached_wav('chime', NOTES, directory)

		expect(target).toBeDefined()
		expect(path.dirname(target ?? '')).toBe(directory)
		expect(tag_at(readFileSync(target ?? ''), 0)).toBe('RIFF')
	})

	it('reuses the file on a second call without writing it again (ac-a86c81d9)', () => {
		const write = vi.spyOn(atomic_write, 'replace_file')
		const first = cached_wav('chime', NOTES, directory)
		const second = cached_wav('chime', NOTES, directory)

		expect(second).toBe(first)
		expect(write).toHaveBeenCalledOnce()
	})

	it('names a changed definition differently (ac-3d6409ea)', () => {
		const original = cached_wav('chime', NOTES, directory)
		const changed = cached_wav('chime', CHANGED_NOTES, directory)

		expect(changed).toBeDefined()
		expect(changed).not.toBe(original)
	})

	it('returns undefined instead of throwing when the write fails (ac-fc55c10f)', () => {
		const blocked = path.join(directory, 'not-a-directory')

		writeFileSync(blocked, '')

		expect(cached_wav('chime', NOTES, blocked)).toBeUndefined()
	})
})
