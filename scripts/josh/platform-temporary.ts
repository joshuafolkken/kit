import { accessSync, constants } from 'node:fs'
import { tmpdir } from 'node:os'

// The temp directory in a spelling every process on one host resolves alike. **`os.tmpdir()` is not
// "the temp directory"**: it honors `TMPDIR`, which on macOS names a per-user `/var/folders/…/T`, so
// two processes with different `TMPDIR` values resolve two different places. A record one josh
// command writes for another to read then lands where the reader never looks — the transcript a
// harness wrote under `/tmp` that `os.tmpdir()` could not name (joshuafolkken/kit#1501), and the run
// record a `backlogrun` handed off that the `run:wake`-launched session began again from nothing
// (joshuafolkken/kit#1909). A cross-process handoff has to key on a root neither end's own `TMPDIR`
// can move, and that is what this pins.
//
// **It is decided by platform rather than written as a bare `/tmp`, because a POSIX literal is not
// inert on Windows.** There is no `/tmp` there, and `path.relative` would resolve the rooted path
// against the current drive as `C:\tmp` — a root nobody declared. Windows therefore keeps
// `os.tmpdir()` exactly as it was; it reads `TEMP` / `TMP` per process, so the split this pins on
// POSIX is not ruled out there, only left unchanged.
//
// **A POSIX host whose `/tmp` cannot be written falls back to `os.tmpdir()`.** Some environments point
// `TMPDIR` at the only writable scratch directory — a Nix build sandbox, an Android terminal, a locked-down
// container — and pinning to `/tmp` there would turn every record write into an error. Those hosts get
// the behavior they had before, which is a working record rather than a shared one.
const POSIX_TEMP_ROOT = '/tmp'
const WINDOWS_PLATFORM = 'win32'

function is_writable_directory(directory: string): boolean {
	try {
		accessSync(directory, constants.W_OK)

		return true
	} catch {
		return false
	}
}

function resolve_temporary_root(
	platform: string,
	can_write: (directory: string) => boolean = is_writable_directory,
): string {
	if (platform === WINDOWS_PLATFORM) return tmpdir()

	return can_write(POSIX_TEMP_ROOT) ? POSIX_TEMP_ROOT : tmpdir()
}

// **An explicit root wins, and the unit suite is who sets one** (joshuafolkken/kit#2494). Every
// record keyed here is shared by the whole host, so a unit test that drove a writer for real wrote
// into the live run's records — progress lines for issues the run never touched, relayed to the
// session watching it. The network guard's `arm` points this at a directory of its own before any
// worker forks, so every process of one test run shares a root no real run reads, and `disarm`
// removes it with the rest of the guard.
const TEMP_ROOT_KEY = 'JOSH_TEMP_ROOT'

function temporary_root(override: string | undefined, platform: string): string {
	return override === undefined || override === '' ? resolve_temporary_root(platform) : override
}

const PLATFORM_TEMP_ROOT = temporary_root(process.env[TEMP_ROOT_KEY], process.platform)

const platform_temporary = {
	TEMP_ROOT_KEY,
	resolve_temporary_root,
	is_writable_directory,
	temporary_root,
}

export { platform_temporary, PLATFORM_TEMP_ROOT, POSIX_TEMP_ROOT }
