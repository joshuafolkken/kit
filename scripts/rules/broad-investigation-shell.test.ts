import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { broad_investigation_shell } from './broad-investigation-shell'

// joshuafolkken/kit#5351: which shell commands are broad investigation. **Both directions matter**:
// a tree search or a read past the cap left unflagged keeps the consultation rate on it, and a narrow
// check flagged leaves the main line unable to verify a cited line.

const { READ_LINE_CAP, is_broad_command } = broad_investigation_shell
const SHORT_LINES = 10
const WORK_DIRECTORY = mkdtempSync(path.join(tmpdir(), 'broad-investigation-shell-'))

function lines(count: number): string {
	return Array.from({ length: count }, (_line, index) => `line ${String(index)}`).join('\n')
}

beforeAll(() => {
	writeFileSync(path.join(WORK_DIRECTORY, 'short.ts'), lines(SHORT_LINES))
	writeFileSync(path.join(WORK_DIRECTORY, 'long.ts'), lines(READ_LINE_CAP * 2))
	// The cap's own count of lines, the last one ended by a final newline.
	writeFileSync(path.join(WORK_DIRECTORY, 'at-cap.ts'), `${lines(READ_LINE_CAP)}\n`)
	mkdirSync(path.join(WORK_DIRECTORY, 'tree'))
	vi.stubEnv('JOSH_HOOK_CWD', WORK_DIRECTORY)
})

afterAll(() => {
	vi.unstubAllEnvs()
	rmSync(WORK_DIRECTORY, { recursive: true, force: true })
})

describe('broad_investigation_shell.is_broad_command — the broad', () => {
	it.each([
		'find . -name "*.ts"',
		'for f in *.ts; do wc -l $f; done',
		'node -e "console.log(1)"',
		'python3 summarize.py',
		'pnpm josh cost:session',
		'grep -rn guard .',
		'grep -n guard tree',
		'rg guard',
		'rg guard tree',
		'sed -n 1,300p short.ts',
		'sed -n 5,$p short.ts',
		'head -n 500 long.ts',
		'tail -n +5 short.ts',
		'cat long.ts',
		'ls && grep -rn guard tree',
		'git diff && rg guard',
		'head -n 300 -q long.ts',
	])('flags %s', (command) => {
		expect(is_broad_command(command)).toBe(true)
	})
})

describe('broad_investigation_shell.is_broad_command — the narrow', () => {
	it.each([
		'grep -n guard short.ts',
		'rg guard short.ts',
		'sed -n 1,200p long.ts',
		'head -n 50 long.ts',
		'head long.ts',
		'tail -20 long.ts',
		'cat short.ts',
		'cat at-cap.ts',
		'cat <<EOF\nbody\nEOF',
		'git status',
		'git diff | rg TODO',
	])('lets %s through', (command) => {
		expect(is_broad_command(command)).toBe(false)
	})
})
