import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { stamp_file } from './stamp-file'

// joshuafolkken/kit#1215: the record mechanics `josh eval` had were needed a second time by
// `josh latest:scope`, so they moved here. The defenses below are what made a second copy
// unacceptable — they are the module, not incidental file handling.

const TEST_PREFIX = 'josh-stamp-file-test-'
const ORIGINAL_CONTENT = 'someone else owns this'
const EXAMPLE_PREFIX = 'josh-example-stamp-'
const PAYLOAD = { ran_at: '2026-09-02T00:00:00.000Z' }

const scratch = mkdtempSync(path.join(tmpdir(), TEST_PREFIX))

afterAll(() => {
	rmSync(scratch, { recursive: true, force: true })
})

describe('stamp_file.stamp_path', () => {
	// One checkout's record must not answer another's question, and both commands have to arrive at
	// the same file without being told where it is.
	it('is a json file in the temp directory keyed to this checkout', () => {
		const target = stamp_file.stamp_path(EXAMPLE_PREFIX)

		expect(path.dirname(target)).toBe(tmpdir())
		expect(path.basename(target)).toMatch(
			new RegExp(String.raw`^${EXAMPLE_PREFIX}[\da-f]+\.json$`, 'u'),
		)
	})

	it('answers with the same path every time', () => {
		expect(stamp_file.stamp_path(EXAMPLE_PREFIX)).toBe(stamp_file.stamp_path(EXAMPLE_PREFIX))
	})

	// The prefix is what keeps two records apart in one shared directory; the checkout key alone
	// would give `josh eval` and `josh latest` the same file.
	it('keeps records with different prefixes apart', () => {
		expect(stamp_file.stamp_path('josh-a-')).not.toBe(stamp_file.stamp_path('josh-b-'))
	})

	// A globally installed `josh` has one package directory for every project on the machine, so a
	// record about the project has to key on the project — otherwise one project answers for another.
	it('keys the record to the root it is given', () => {
		expect(stamp_file.stamp_path(EXAMPLE_PREFIX, '/projects/one')).not.toBe(
			stamp_file.stamp_path(EXAMPLE_PREFIX, '/projects/two'),
		)
	})
})

describe('stamp_file.digest', () => {
	it('hashes bytes rather than a decoded string', () => {
		const invalid = Buffer.from([0xff, 0xfe])
		const other = Buffer.from([0xfe, 0xff])

		expect(stamp_file.digest(invalid)).not.toBe(stamp_file.digest(other))
	})
})

describe('stamp_file.write_stamp and read_stamp_text', () => {
	it('reads back what it wrote', () => {
		const target = path.join(scratch, 'round-trip.json')

		stamp_file.write_stamp(target, PAYLOAD)

		expect(stamp_file.read_stamp_text(target)).toBe(JSON.stringify(PAYLOAD))
	})

	it('answers with no record when the file is not there', () => {
		expect(stamp_file.read_stamp_text(path.join(scratch, 'absent.json'))).toBeUndefined()
	})

	it('replaces a record it wrote before', () => {
		const target = path.join(scratch, 'rewritten.json')

		stamp_file.write_stamp(target, { ran_at: 'first' })
		stamp_file.write_stamp(target, PAYLOAD)

		expect(stamp_file.read_stamp_text(target)).toBe(JSON.stringify(PAYLOAD))
	})
})

// The path is deterministic and sits in a directory every account on the host may write to, so a
// record somebody else chose is a record that suppresses exactly the work the reader exists to force.
describe('stamp_file refuses a record it did not write', () => {
	it('answers with no record when the path is a symlink', () => {
		const real = path.join(scratch, 'planted.json')
		const target = path.join(scratch, 'link.json')

		stamp_file.write_stamp(real, PAYLOAD)
		symlinkSync(real, target)

		expect(stamp_file.read_stamp_text(real)).toBeDefined()
		expect(stamp_file.read_stamp_text(target)).toBeUndefined()
	})

	// Someone re-creating the path between the unlink and the create can make the write fail; it must
	// never make it land somewhere else, and a failure leaves no record, which is the safe answer.
	it('refuses to write through a symlink rather than following it', () => {
		const outside = path.join(scratch, 'not-the-record.txt')
		const target = path.join(scratch, 'write-link.json')

		writeFileSync(outside, ORIGINAL_CONTENT)
		symlinkSync(outside, target)
		stamp_file.write_stamp(target, PAYLOAD)

		expect(readFileSync(outside, 'utf8')).toBe(ORIGINAL_CONTENT)
	})
})
