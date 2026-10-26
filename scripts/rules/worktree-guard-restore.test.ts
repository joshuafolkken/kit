import { execFileSync, execSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { worktree_guard } from './worktree-guard'

// joshuafolkken/kit#4988: the named restore, run as written, puts HEAD's bytes back on the one file and
// leaves every other tracked edit where it was — and this row does not refuse it.
const scratch = mkdtempSync(path.join(tmpdir(), 'worktree-guard-restore-'))
const TARGET = 'src/app.ts'
const OTHER = 'other.md'
const HEAD_BODY = 'line one\n\nline three\n'
const OTHER_EDIT = 'edited, kept\n'

function git(...args: ReadonlyArray<string>): void {
	execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: scratch })
}

function restore_command(): string {
	return worktree_guard.SINGLE_FILE_RESTORE.replaceAll('<path>', () => TARGET)
}

// Commits both files, then edits both — the target as a hand revert that dropped a line would.
function edited_repository(): void {
	mkdirSync(path.join(scratch, 'src'))
	writeFileSync(path.join(scratch, TARGET), HEAD_BODY)
	writeFileSync(path.join(scratch, OTHER), 'original\n')
	git('init', '-q')
	git('add', '.')
	git('commit', '-q', '-m', 'base')
	writeFileSync(path.join(scratch, TARGET), 'line one\nline three\nadded\n')
	writeFileSync(path.join(scratch, OTHER), OTHER_EDIT)
}

describe('worktree_guard.SINGLE_FILE_RESTORE', () => {
	afterAll(() => {
		rmSync(scratch, { recursive: true, force: true })
	})

	it('is not refused by this row', () => {
		expect(worktree_guard.is_unauthorized_worktree_change(restore_command())).toBe(false)
	})

	it('restores only the named file, byte-identical to HEAD', () => {
		edited_repository()

		execSync(restore_command(), { cwd: scratch })

		expect(readFileSync(path.join(scratch, TARGET), 'utf8')).toBe(HEAD_BODY)
		expect(readFileSync(path.join(scratch, OTHER), 'utf8')).toBe(OTHER_EDIT)
	})
})
