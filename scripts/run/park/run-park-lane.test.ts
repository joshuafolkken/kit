import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { git_spawn_sync } from '#scripts/git/git-spawn-sync'
import { session_language } from '#scripts/josh/session-language'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_park_lane } from './run-park-lane'

const make_directory = temporary_directory('suite')

const ISSUE = '4132'
const SEAT = 3
const BODY = 'Which option?\n'
const WORK_DIRECTORY = make_directory('run-park-lane-')
const LANE_ROOT = path.join(WORK_DIRECTORY, '.kit-lanes')
const LANE_DIRECTORY = path.join(LANE_ROOT, ISSUE)

beforeEach(() => {
	vi.stubEnv('JOSH_LANE_ROOT', LANE_ROOT)
	vi.stubEnv(session_language.ENV_KEY, 'en')
	mkdirSync(LANE_DIRECTORY, { recursive: true })
	writeFileSync(path.join(LANE_DIRECTORY, '.env'), `JOSH_LANE_SEAT=${String(SEAT)}\n`)
})

afterEach(() => {
	vi.unstubAllEnvs()
	rmSync(LANE_DIRECTORY, { recursive: true, force: true })
})

// joshuafolkken/kit#5840: a park from inside a lane names the lane it keeps.
describe('run_park_lane.with_lane_note', () => {
	it('appends the lane directory, the held seat and the lane:close hint inside a lane', () => {
		const note = run_park_lane.with_lane_note(BODY, LANE_DIRECTORY)

		expect(note.startsWith(BODY)).toBe(true)
		expect(note).toContain(`Lane directory: \`${LANE_DIRECTORY}\``)
		expect(note).toContain(`Seat ${String(SEAT)} stays held`)
		expect(note).toContain(`\`pnpm josh lane:close ${ISSUE}\``)
	})

	it('names the lane from a Claude Code worktree under it', () => {
		const nested = path.join(LANE_DIRECTORY, '.claude', 'worktrees', 'agent')

		expect(run_park_lane.with_lane_note(BODY, nested)).toContain(
			`Lane directory: \`${LANE_DIRECTORY}\``,
		)
	})

	it('reads an unreadable seat as unknown', () => {
		rmSync(path.join(LANE_DIRECTORY, '.env'))

		expect(run_park_lane.with_lane_note(BODY, LANE_DIRECTORY)).toContain('Seat unknown stays held')
	})

	it('leaves the body unchanged outside a lane', () => {
		expect(run_park_lane.with_lane_note(BODY, WORK_DIRECTORY)).toBe(BODY)
	})
})

// joshuafolkken/kit#7667: the note follows `JOSH_SESSION_LANG` (an empty value resolves as unset, to
// `ja`); the separator, the directory and the `lane:close` command stay as they are.
const JAPANESE_MARKS = ['レーンのディレクトリ', `席 ${String(SEAT)} は確保したまま`, '返却']
const ENGLISH_MARKS = ['Lane directory', `Seat ${String(SEAT)} stays held`, 'Give it back']

function note_in(lang: string): string {
	vi.stubEnv(session_language.ENV_KEY, lang)

	return run_park_lane.with_lane_note(BODY, LANE_DIRECTORY)
}

describe('run_park_lane.with_lane_note — the note follows the session language', () => {
	it.each(['', 'ja'])('writes the note in Japanese when the language is "%s"', (lang) => {
		const note = note_in(lang)

		for (const mark of JAPANESE_MARKS) expect(note).toContain(mark)
		for (const mark of ENGLISH_MARKS) expect(note).not.toContain(mark)
	})

	it('writes the note in English when the language is en', () => {
		const note = note_in('en')

		for (const mark of ENGLISH_MARKS) expect(note).toContain(mark)
		for (const mark of JAPANESE_MARKS) expect(note).not.toContain(mark)
	})

	it.each(['ja', 'en'])('keeps the separator, directory and command in %s', (lang) => {
		const note = note_in(lang)

		expect(note).toContain(`\n---\n`)
		expect(note).toContain(`\`${LANE_DIRECTORY}\``)
		expect(note).toContain(`\`pnpm josh lane:close ${ISSUE}\``)
	})
})

function commit_lane(): string {
	const options = git_spawn_sync.located(LANE_DIRECTORY)
	const identity = ['-c', 'user.name=test', '-c', 'user.email=test@example.com']

	git_spawn_sync.run(['init', '--quiet'], options)
	git_spawn_sync.run([...identity, 'commit', '--quiet', '--allow-empty', '-m', 'base'], options)

	return git_spawn_sync.read(['rev-parse', '--short', 'HEAD'], options) ?? ''
}

// joshuafolkken/kit#7820: the note records the lane's tree, which `tree_of` reads back.
describe('run_park_lane — the lane tree (ac-70294b59)', () => {
	it.each(['ja', 'en'])('records HEAD and the uncommitted change count in %s', (lang) => {
		const head = commit_lane()

		expect(run_park_lane.tree_of(note_in(lang))).toBe(`${head} · 1`)
	})

	it('reads a moved tree as a different one', () => {
		const head = commit_lane()

		writeFileSync(path.join(LANE_DIRECTORY, 'work.ts'), 'export {}\n')

		expect(run_park_lane.tree_of(note_in('en'))).toBe(`${head} · 2`)
	})

	it('writes no tree line where git reads none', () => {
		const note = note_in('en')

		expect(note).not.toContain('- Tree:')
		expect(run_park_lane.tree_of(note)).toBeUndefined()
	})
})
