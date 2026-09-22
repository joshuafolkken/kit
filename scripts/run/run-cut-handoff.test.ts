import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { run_cut_handoff, type Handoff } from './run-cut-handoff'

// joshuafolkken/kit#2354: the handoff carries the run's instruction and work state across a cut, so a
// fresh process resumes on what it was told to do rather than the working tree alone. These pin the
// write→read round trip the acceptance requires, the completeness check the resume gates on, and the
// block printed to the resumed session.

const scratch = mkdtempSync(path.join(tmpdir(), 'run-cut-handoff-test-'))

const INSTRUCTION = 'Add the field; do not touch the schema migration.'
const REMAINING_ITEM = 'wire the CLI'
const UNTOUCHED_ITEM = 'the migration file'
const HANDOFF: Handoff = {
	instruction: INSTRUCTION,
	completed: ['read the record', 'added the type'],
	remaining: [REMAINING_ITEM],
	untouched: [UNTOUCHED_ITEM],
}

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

describe('a handoff written and read back', () => {
	it('round-trips every field through JSON', () => {
		const read = run_cut_handoff.parse_handoff(JSON.stringify(HANDOFF))

		expect(read).toStrictEqual(HANDOFF)
	})

	it('reads back from a file at a path', () => {
		const handoff_path = path.join(scratch, 'handoff.json')

		writeFileSync(handoff_path, JSON.stringify(HANDOFF))

		expect(run_cut_handoff.read_handoff_file(handoff_path)).toStrictEqual(HANDOFF)
	})
})

describe('a handoff that is not well-formed', () => {
	it('reads text that is not JSON as undefined', () => {
		expect(run_cut_handoff.parse_handoff('not json')).toBeUndefined()
	})

	it('reads JSON missing a required field as undefined', () => {
		expect(run_cut_handoff.parse_handoff(JSON.stringify({ instruction: 'x' }))).toBeUndefined()
	})

	it('reads a missing file as undefined', () => {
		expect(run_cut_handoff.read_handoff_file(path.join(scratch, 'absent.json'))).toBeUndefined()
	})
})

describe('the completeness the resume gates on', () => {
	it('is complete with a non-empty instruction', () => {
		expect(run_cut_handoff.is_complete_handoff(HANDOFF)).toBe(true)
	})

	it('is incomplete with a blank instruction', () => {
		expect(run_cut_handoff.is_complete_handoff({ ...HANDOFF, instruction: '  ' })).toBe(false)
	})

	it('is incomplete when absent', () => {
		expect(run_cut_handoff.is_complete_handoff(undefined)).toBe(false)
	})
})

describe('loading a handoff for a cut to carry', () => {
	const BOUND = 8192

	it('carries no handoff when no path is given', () => {
		expect(run_cut_handoff.load_handoff(undefined, BOUND)).toStrictEqual({
			kind: 'ok',
			handoff: undefined,
		})
	})

	it('loads the handoff a readable path holds', () => {
		const handoff_path = path.join(scratch, 'load.json')

		writeFileSync(handoff_path, JSON.stringify(HANDOFF))

		expect(run_cut_handoff.load_handoff(handoff_path, BOUND)).toStrictEqual({
			kind: 'ok',
			handoff: HANDOFF,
		})
	})

	it('refuses an unreadable path', () => {
		expect(run_cut_handoff.load_handoff(path.join(scratch, 'missing.json'), BOUND).kind).toBe('bad')
	})

	it('refuses a handoff that would push the record past its bound', () => {
		const handoff_path = path.join(scratch, 'big.json')

		writeFileSync(handoff_path, JSON.stringify(HANDOFF))

		expect(run_cut_handoff.load_handoff(handoff_path, 1).kind).toBe('bad')
	})
})

describe('the block shown to the resumed session', () => {
	it('carries the verbatim instruction and each list item', () => {
		const block = run_cut_handoff.describe_handoff(HANDOFF)

		expect(block).toContain(INSTRUCTION)
		expect(block).toContain(REMAINING_ITEM)
		expect(block).toContain(UNTOUCHED_ITEM)
	})

	it('names an empty list rather than dropping it', () => {
		const block = run_cut_handoff.describe_handoff({ ...HANDOFF, remaining: [] })

		expect(block).toContain('Remaining: (none)')
	})
})
