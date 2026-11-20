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

describe('transcript_tail.last_line_matching', () => {
	const FILLER = 'x'.repeat(TAIL_SAMPLE_BYTES * TAIL_SAMPLE_BYTES)
	const MARK = /^MARK.*$/gmu

	async function last_mark(name: string, text: string): Promise<string | undefined> {
		const target = write_transcript(name, text)

		return await transcript_tail.last_line_matching(target, MARK, TAIL_SAMPLE_BYTES)
	}

	it('finds the last matching line in the last piece, and again with the same pattern', async () => {
		const last = 'MARK two'
		const text = `${FILLER}\nMARK one\n${last}\n`

		const target = write_transcript('matching-near', text)

		expect(await transcript_tail.last_line_matching(target, MARK, TAIL_SAMPLE_BYTES)).toBe(last)
		expect(await transcript_tail.last_line_matching(target, MARK, TAIL_SAMPLE_BYTES)).toBe(last)
	})

	it('reads back through many pieces to a line at the file start', async () => {
		expect(await last_mark('matching-far', `MARK first\n${FILLER}\n${FILLER}`)).toBe('MARK first')
	})

	it('joins a line longer than a piece, cut inside a character, back whole', async () => {
		const line = `MARK ${'é'.repeat(TAIL_SAMPLE_BYTES)}`

		expect(await last_mark('matching-long', `x\n${line}\n${'y'.repeat(3)}`)).toBe(line)
	})

	it('takes no line that a piece cuts at its start for a match', async () => {
		expect(
			await last_mark('matching-cut', `${'z'.repeat(TAIL_SAMPLE_BYTES)}MARK\n`),
		).toBeUndefined()
	})

	it('finds nothing in a file with no matching line, or an empty one', async () => {
		expect(await last_mark('matching-none', FILLER)).toBeUndefined()
		expect(await last_mark('matching-empty', '')).toBeUndefined()
	})
})

describe('transcript_tail.read_head', () => {
	it("reads a file's first bytes, and the whole of a shorter one", async () => {
		const target = write_transcript('head', LONG_TEXT)

		expect(await transcript_tail.read_head(target, TAIL_SAMPLE_BYTES)).toBe(
			LONG_TEXT.slice(0, TAIL_SAMPLE_BYTES),
		)
		expect(await transcript_tail.read_head(target)).toBe(LONG_TEXT)
	})
})
