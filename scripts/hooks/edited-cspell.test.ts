import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { edited_cspell } from './edited-cspell'

// joshuafolkken/kit#2296: the edit hook reports the edited file's cspell unknown words as
// additionalContext, and reports nothing when there are none — and never fails the edit, however the
// spell check behaves.

const DIRECTORY = mkdtempSync(path.join(tmpdir(), 'edited-cspell-'))

function file_of(name: string): string {
	const target = path.join(DIRECTORY, name)

	writeFileSync(target, 'content')

	return target
}

async function never_called(): Promise<string> {
	throw new Error('runner should not have been called')
}

afterAll(() => {
	rmSync(DIRECTORY, { recursive: true, force: true })
})

describe('format_unknown_words', () => {
	it('names each unknown word under a header', () => {
		const block = edited_cspell.format_unknown_words('widget\ngizmo\n')

		expect(block).toContain('widget')
		expect(block).toContain('gizmo')
		expect(block).toContain('cspell')
	})

	it('reports nothing when cspell knew every word', () => {
		expect(edited_cspell.format_unknown_words('')).toBeUndefined()
		expect(edited_cspell.format_unknown_words('   \n\n')).toBeUndefined()
	})
})

describe('spelling_diagnostics', () => {
	it('reports nothing for a missing path', async () => {
		const block = await edited_cspell.spelling_diagnostics(undefined, DIRECTORY, never_called)

		expect(block).toBeUndefined()
	})

	it('does not spell-check a binary asset', async () => {
		const asset = file_of('logo.png')
		const block = await edited_cspell.spelling_diagnostics(asset, DIRECTORY, never_called)

		expect(block).toBeUndefined()
	})

	it('returns the unknown words for a checkable file', async () => {
		const source = file_of('widget.ts')
		const block = await edited_cspell.spelling_diagnostics(
			source,
			DIRECTORY,
			async () => 'widget\n',
		)

		expect(block).toContain('widget')
	})

	it('reports nothing when the runner finds no unknown words', async () => {
		const source = file_of('clean.ts')
		const block = await edited_cspell.spelling_diagnostics(source, DIRECTORY, async () => '')

		expect(block).toBeUndefined()
	})

	// A `PostToolUse` hook must never turn a landed edit into a failure — cspell absent, a timeout — so
	// a throwing runner resolves to nothing rather than rejecting.
	it('never rejects when the spell check throws', async () => {
		const source = file_of('broken.ts')

		await expect(
			edited_cspell.spelling_diagnostics(source, DIRECTORY, async () => {
				throw new Error('cspell exploded')
			}),
		).resolves.toBeUndefined()
	})
})
