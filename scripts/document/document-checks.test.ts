import { beforeEach, describe, expect, it, vi } from 'vitest'
import { document_byte_check } from './document-byte-check'
import { document_checks } from './document-checks'
import { document_ratchet_check } from './document-ratchet-check'

// Mocked so the verdict is the mocked checks' alone; each check's ceilings are its own suite.
vi.mock('./document-byte-check', () => ({
	document_byte_check: { check_all: vi.fn(), check_files: vi.fn() },
}))
vi.mock('./document-ratchet-check', () => ({
	document_ratchet_check: { check_all: vi.fn(), check_files: vi.fn() },
}))

const ROOT = '/repository'
const FILES = ['/repository/docs/josh-commands.md']
const FAILED = 1

const CHECKS = [
	{ name: 'byte', check: document_byte_check },
	{ name: 'ratchet', check: document_ratchet_check },
]

beforeEach(() => {
	vi.clearAllMocks()

	for (const { check } of CHECKS) {
		vi.mocked(check.check_all).mockReturnValue(0)
		vi.mocked(check.check_files).mockReturnValue(0)
	}
})

describe('document_checks', () => {
	it('passes when every check passes, having run each over the change', () => {
		expect(document_checks.check_files(ROOT, FILES)).toBe(0)

		for (const { check } of CHECKS) expect(check.check_files).toHaveBeenCalledWith(ROOT, FILES)
	})

	it.each(CHECKS)('fails on a $name failure and still runs every other check', ({ check }) => {
		vi.mocked(check.check_files).mockReturnValue(FAILED)

		expect(document_checks.check_files(ROOT, FILES)).toBe(FAILED)
		expect(document_byte_check.check_files).toHaveBeenCalled()
		expect(document_ratchet_check.check_files).toHaveBeenCalled()
	})

	it.each(CHECKS)('fails the whole-tree run on a $name failure', ({ check }) => {
		vi.mocked(check.check_all).mockReturnValue(FAILED)

		expect(document_checks.check_all(ROOT)).toBe(FAILED)
		expect(document_byte_check.check_all).toHaveBeenCalledWith(ROOT)
		expect(document_ratchet_check.check_all).toHaveBeenCalledWith(ROOT)
	})
})
