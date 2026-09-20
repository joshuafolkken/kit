import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { document_byte_budget } from './document-byte-budget'
import { document_byte_check } from './document-byte-check'

const { ceiling_message, check_all, over_budget_for, over_budget_messages } = document_byte_check

const REPOSITORY_ROOT = process.cwd()
const JOSH_COMMANDS = path.join(REPOSITORY_ROOT, 'docs', 'josh-commands.md')
const A_SCRIPT = path.join(REPOSITORY_ROOT, 'scripts', 'document', 'document-byte-check.ts')

describe('ceiling_message — the pure over-budget decision', () => {
	it('is undefined for a path with no budget entry', () => {
		expect(ceiling_message('docs/whatever.md', 1_000_000, undefined)).toBeUndefined()
	})

	it('is undefined when the size is within the ceiling', () => {
		const recorded = 1000

		expect(
			ceiling_message('docs/x.md', document_byte_budget.ceiling_for(recorded), recorded),
		).toBeUndefined()
	})

	it('names the file and the value to record when over the ceiling', () => {
		const recorded = 1000
		const current = document_byte_budget.ceiling_for(recorded) + 1
		const message = ceiling_message('docs/x.md', current, recorded)

		expect(message).toContain('docs/x.md')
		expect(message).toContain(`raise its recorded size to ${current.toString()}`)
	})
})

describe('over_budget_for — the same decision for a resolved absolute path', () => {
	it('is undefined for a real budgeted document within its ceiling', () => {
		expect(over_budget_for(REPOSITORY_ROOT, JOSH_COMMANDS)).toBeUndefined()
	})

	it('is undefined for a path carrying no budget entry', () => {
		expect(over_budget_for(REPOSITORY_ROOT, A_SCRIPT)).toBeUndefined()
	})

	it('does not throw on a path absent from disk', () => {
		// A path named in the resolved list but no longer on the tree must be answered, not thrown on.
		const absent = path.join(REPOSITORY_ROOT, 'docs', 'never-created-here.md')

		expect(over_budget_for(REPOSITORY_ROOT, absent)).toBeUndefined()
	})
})

describe('over_budget_messages — the resolved file list', () => {
	it('keeps only the over-budget documents, dropping scripts and non-budgeted paths', () => {
		expect(over_budget_messages(REPOSITORY_ROOT, [JOSH_COMMANDS, A_SCRIPT])).toStrictEqual([])
	})
})

describe('check_all — the whole-budget fallback', () => {
	it('answers zero on a tree where every budgeted document is within its ceiling', () => {
		// The gate's own test keeps the recorded sizes honest, so the whole budget is within ceiling on
		// this tree — the fallback path must therefore pass, not skip, exactly as the resolved-list check
		// does. If a document were over, `document-byte-budget.test.ts` would already be red.
		expect(check_all(REPOSITORY_ROOT)).toBe(0)
	})
})
