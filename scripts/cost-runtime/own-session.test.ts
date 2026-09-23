import { describe, expect, it } from 'vitest'
import type { SessionFile } from './cost-transcript'
import { own_session } from './own-session'

// The selection is a pure function over the files a walk found and the environment, so it is exercised
// with hand-built `SessionFile`s rather than a temporary transcript home: what it must get right is
// which id it prefers, not how the files were discovered (joshuafolkken/kit#2403).
const SESSION_ID_KEY = 'CLAUDE_CODE_SESSION_ID'
const OWN_ID = 'my-session'
const OTHER_ID = 'another-session'

function file(session_id: string, modified_ms: number, is_delegated = false): SessionFile {
	return {
		session_id,
		path: `${session_id}.jsonl`,
		modified_ms,
		is_delegated,
		depth: is_delegated ? 1 : 0,
	}
}

// The caller's own transcript is older than another session's, the shape the bug turned on: a parent
// waiting on a child stops writing, so the child's file is newer.
const OWN_OLDER = file(OWN_ID, 100)
const OTHER_NEWER = file(OTHER_ID, 200)

describe('own_session.session_id_of', () => {
	it('reads the running session id the environment exports', () => {
		expect(own_session.session_id_of({ [SESSION_ID_KEY]: OWN_ID })).toBe(OWN_ID)
	})

	it('treats an absent id as none', () => {
		expect(own_session.session_id_of({})).toBeUndefined()
	})

	// `CLAUDE_CODE_SESSION_ID=` must not read as a session named the empty string.
	it('treats an empty id as none', () => {
		expect(own_session.session_id_of({ [SESSION_ID_KEY]: '' })).toBeUndefined()
	})
})

describe('own_session.select_own_session', () => {
	// The fix: the id wins over the mtime, so a newer transcript under another name is never measured
	// as this session's own.
	it('selects the named session even when a newer one exists', () => {
		const selection = own_session.select_own_session([OTHER_NEWER, OWN_OLDER], {
			[SESSION_ID_KEY]: OWN_ID,
		})

		expect(selection).toStrictEqual({ kind: 'own', index: 1 })
	})

	// The other half: when the named session has no transcript, the answer is "not found" rather than
	// the newest other file.
	it('does not fall back to the newest when the named session is absent', () => {
		const selection = own_session.select_own_session([OTHER_NEWER], { [SESSION_ID_KEY]: OWN_ID })

		expect(selection).toStrictEqual({ kind: 'absent', session_id: OWN_ID })
	})

	// With no id, the mtime fallback stands: the newest own (non-delegated) file, exactly as before.
	it('falls back to the newest own transcript when the environment names none', () => {
		const delegated = file(`${OWN_ID}/agent-1`, 300, true)
		const selection = own_session.select_own_session([delegated, OTHER_NEWER, OWN_OLDER], {})

		expect(selection).toStrictEqual({ kind: 'own', index: 1 })
	})
})
