import { execFileSync, execSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { worktree_guard } from './worktree-guard'

// joshuafolkken/kit#4988: the named restore, run as written, puts HEAD's bytes back on the one file and
// leaves every other tracked edit where it was — from the repository root or a subdirectory — and an
// untracked path is left untouched. This row does not refuse it.
const scratch = mkdtempSync(path.join(tmpdir(), 'worktree-guard-restore-'))
const TARGET = 'src/app.ts'
const OTHER = 'other.md'
const UNTRACKED = 'src/new.ts'
const HEAD_BODY = 'line one\n\nline three\n'
const HAND_REVERT = 'line one\nline three\nadded\n'
const OTHER_EDIT = 'edited, kept\n'

function git(...args: ReadonlyArray<string>): void {
	const config = ['user.name=t', 'user.email=t@t', 'commit.gpgsign=false', 'maintenance.auto=false']

	execFileSync('git', [...config.flatMap((entry) => ['-c', entry]), ...args], { cwd: scratch })
}

function restore_command(target: string): string {
	return worktree_guard.SINGLE_FILE_RESTORE.replaceAll('<path>', () => target)
}

function read(file: string): string {
	return readFileSync(path.join(scratch, file), 'utf8')
}

// Commits both files, then edits the other one and leaves a file HEAD lacks beside the target.
function edited_repository(): void {
	mkdirSync(path.join(scratch, 'src'))
	writeFileSync(path.join(scratch, TARGET), HEAD_BODY)
	writeFileSync(path.join(scratch, OTHER), 'original\n')
	git('init', '-q')
	git('add', '.')
	git('commit', '-q', '-m', 'base')
	writeFileSync(path.join(scratch, OTHER), OTHER_EDIT)
	writeFileSync(path.join(scratch, UNTRACKED), HAND_REVERT)
}

describe('worktree_guard.SINGLE_FILE_RESTORE', () => {
	beforeAll(() => {
		edited_repository()
	})

	// The target as a hand revert that dropped a line would leave it.
	beforeEach(() => {
		writeFileSync(path.join(scratch, TARGET), HAND_REVERT)
	})

	afterAll(() => {
		rmSync(scratch, { recursive: true, force: true })
	})

	it('is not refused by this row', () => {
		expect(worktree_guard.is_unauthorized_worktree_change(restore_command(TARGET))).toBe(false)
	})

	it('restores only the named file, byte-identical to HEAD', () => {
		execSync(restore_command(TARGET), { cwd: scratch })

		expect(read(TARGET)).toBe(HEAD_BODY)
		expect(read(OTHER)).toBe(OTHER_EDIT)
	})

	it('reads the path from the shell directory, as the redirect writes it', () => {
		execSync(restore_command(path.basename(TARGET)), { cwd: path.join(scratch, 'src') })

		expect(read(TARGET)).toBe(HEAD_BODY)
	})

	it('leaves an untracked file untouched', () => {
		// Its exit status is git's to choose; the file is what must not change.
		spawnSync(restore_command(UNTRACKED), { cwd: scratch, shell: true, stdio: 'ignore' })

		expect(read(UNTRACKED)).toBe(HAND_REVERT)
	})

	// Last: it leaves the index ahead of HEAD.
	it('keeps a staged change, reverting only the unstaged edit', () => {
		git('add', TARGET)
		writeFileSync(path.join(scratch, TARGET), OTHER_EDIT)

		execSync(restore_command(TARGET), { cwd: scratch })

		expect(read(TARGET)).toBe(HAND_REVERT)
	})
})
