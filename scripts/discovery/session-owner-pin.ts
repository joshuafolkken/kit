import { stamp_file } from '#scripts/josh/stamp-file'
import { repo_discovery } from './repo-discovery'

// **The session's owner, fixed when the session starts** (joshuafolkken/kit#4659). The first-party
// test compares a target's owner with the session's, and the session's was read from `origin` on
// every call — so `git remote set-url origin https://github.com/<other>/x` mid-session made another
// owner first-party. The session-start hook records the owner once; `repo_party.current_owner`
// answers the record ahead of the live remote. Only the session's owner is pinned: the `{owner}`
// placeholder candidates and a selector-less `gh` write still resolve against the live remotes.
//
// **Written by the process the session start already runs** (`audit-provision --session-start`), so
// pinning adds no spawn to the launch, and read as one local file by the hooks that already run — no
// network call. A checkout with no record (a session the hook did not start) falls back to `origin`.
//
// **Per checkout, replaced at every session start.** The record is the stamp `stamp-file.ts` keeps in
// the temp directory, keyed on the account and the checkout path; a checkout whose origin owner
// cannot be read at start leaves no record rather than a stale one. A command run outside a session
// reads the last session's record for that path, which the next session start replaces.

const PIN_PREFIX = 'josh-session-owner-'
const PIN_SUFFIX = '.txt'

function pin_path(repository_path: string): string {
	return stamp_file.stamp_path(PIN_PREFIX, repository_path, PIN_SUFFIX)
}

// Records the checkout's `origin` owner for the session about to run. Never throws: this runs at
// session start beside the scanner provisioning, and an unwritable temp directory only costs the pin.
function pin(repository_path: string = process.cwd()): string | undefined {
	const owner = repo_discovery.resolve_current_owner(repository_path)

	try {
		if (owner === undefined) stamp_file.remove_stamp(pin_path(repository_path))
		else stamp_file.write_text_stamp(pin_path(repository_path), owner)
	} catch {
		return undefined
	}

	return owner
}

// The owner recorded at session start, or `undefined` when the checkout holds no readable record.
function pinned(repository_path: string = process.cwd()): string | undefined {
	const text = stamp_file.read_stamp_text(pin_path(repository_path))?.trim()

	return text === '' ? undefined : text
}

const session_owner_pin = { pin, pin_path, pinned }

export { session_owner_pin }
