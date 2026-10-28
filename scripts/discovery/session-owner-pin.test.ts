import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { stamp_file } from '#scripts/josh/stamp-file'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { repo_party } from './repo-party'
import { session_owner_pin } from './session-owner-pin'

// The owner fixed at session start (joshuafolkken/kit#4659): a mid-session `git remote set-url`
// must not turn another owner first-party.

const SESSION_OWNER = 'joshuafolkken'
const SESSION_REMOTE = `https://github.com/${SESSION_OWNER}/kit.git`
const REWRITTEN_REMOTE = 'https://github.com/sveltejs/svelte.git'
const REWRITTEN_OWNER = 'sveltejs'

const state = { repository: '' }

function write_origin(origin_url: string | undefined): void {
	const remote = origin_url === undefined ? '' : `[remote "origin"]\n\turl = ${origin_url}\n`

	writeFileSync(path.join(state.repository, '.git', 'config'), `[core]\n\tbare = false\n${remote}`)
}

beforeEach(() => {
	state.repository = mkdtempSync(path.join(tmpdir(), 'session-owner-pin-'))
	mkdirSync(path.join(state.repository, '.git'))
	write_origin(SESSION_REMOTE)
})

afterEach(() => {
	stamp_file.remove_stamp(session_owner_pin.pin_path(state.repository))
	rmSync(state.repository, { recursive: true, force: true })
})

describe('session_owner_pin — the owner fixed at session start', () => {
	it('keeps the pinned owner after the origin is rewritten', () => {
		session_owner_pin.pin(state.repository)
		write_origin(REWRITTEN_REMOTE)

		expect(repo_party.current_owner(state.repository)).toBe(SESSION_OWNER)
	})

	it('falls back to the live origin when the session start left no pin', () => {
		write_origin(REWRITTEN_REMOTE)

		expect(repo_party.current_owner(state.repository)).toBe(REWRITTEN_OWNER)
	})

	it('re-pins at the next session start', () => {
		session_owner_pin.pin(state.repository)
		write_origin(REWRITTEN_REMOTE)
		session_owner_pin.pin(state.repository)

		expect(session_owner_pin.pinned(state.repository)).toBe(REWRITTEN_OWNER)
	})

	it('leaves no stale pin when the origin is unreadable at session start', () => {
		session_owner_pin.pin(state.repository)
		write_origin(undefined)

		expect(session_owner_pin.pin(state.repository)).toBeUndefined()
		expect(session_owner_pin.pinned(state.repository)).toBeUndefined()
	})
})
