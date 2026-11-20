import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it } from 'vitest'
import { transcript_tail } from './transcript-tail'

const make_directory = temporary_directory('suite')
const WORK_DIRECTORY = make_directory('transcript-tail-')
const TAIL_SAMPLE_BYTES = 16
// Longer than the window above, so a read that ignored the window would return something else.
const LONG_TEXT = '0123456789'.repeat(3)

function write_transcript(name: string, text: string): string {
	const target = path.join(WORK_DIRECTORY, `${name}.jsonl`)

	writeFileSync(target, text)

	return target
}

describe('transcript_tail.read_tail', () => {
	it('reads only the end of the file', () => {
		const target = write_transcript('tail', LONG_TEXT)
		const tail = transcript_tail.read_tail(target, TAIL_SAMPLE_BYTES)

		expect(tail).toBe(LONG_TEXT.slice(-TAIL_SAMPLE_BYTES))
	})

	it('reads a file shorter than the window whole', () => {
		const target = write_transcript('short', 'abc')

		expect(transcript_tail.read_tail(target, TAIL_SAMPLE_BYTES)).toBe('abc')
	})

	it('reads a file shorter than the default window whole', () => {
		const target = write_transcript('default', LONG_TEXT)

		expect(LONG_TEXT.length).toBeLessThan(transcript_tail.TAIL_BYTES)
		expect(transcript_tail.read_tail(target)).toBe(LONG_TEXT)
	})
})

describe('transcript_tail.read_tail_holding', () => {
	const FILLER = 'x'.repeat(TAIL_SAMPLE_BYTES * transcript_tail.TAIL_GROWTH)
	const MARK = /^MARK$/gmu

	it('reads only the window when the window holds a match', () => {
		const target = write_transcript('holding-near', `${FILLER}\nMARK\n`)
		const tail = transcript_tail.read_tail_holding(target, MARK, TAIL_SAMPLE_BYTES)

		expect(tail).toBe(`${FILLER}\nMARK\n`.slice(-TAIL_SAMPLE_BYTES))
		expect(transcript_tail.read_tail_holding(target, MARK, TAIL_SAMPLE_BYTES)).toBe(tail)
	})

	it('widens past the window to a match further back, up to the whole file', () => {
		const text = `MARK\n${FILLER}`
		const target = write_transcript('holding-far', text)

		expect(transcript_tail.read_tail_holding(target, MARK, TAIL_SAMPLE_BYTES)).toBe(text)
	})

	it('widens past a match the window cuts at its start', () => {
		const text = `MARK\n${'y'.repeat(TAIL_SAMPLE_BYTES - 2)}`
		const target = write_transcript('holding-cut', text)

		expect(transcript_tail.read_tail_holding(target, MARK, TAIL_SAMPLE_BYTES)).toBe(text)
	})

	it('reads the whole file when nothing matches', () => {
		const target = write_transcript('holding-none', FILLER)

		expect(transcript_tail.read_tail_holding(target, MARK, TAIL_SAMPLE_BYTES)).toBe(FILLER)
	})
})
