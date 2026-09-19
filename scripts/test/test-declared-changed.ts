import { execFileSync } from 'node:child_process'
import { test_declared_logic, type Verdict } from './test-declared-logic'

// The working-tree change set and the verdict over it, read **synchronously** for the `PreToolUse`
// trigger in `delivered-rules.ts` (joshuafolkken/kit#2118).
//
// **Synchronous on purpose, and separate from `git-command.ts` for the same reason `run-cut.ts` keeps
// a `carried_cut_sync`.** A guard answers a hook synchronously — an `await` or a network call is out —
// so the async execa reader beside it cannot be reused, and this is a different execution model rather
// than a copy of one.
//
// **The source is the working tree about to be committed, read with `git status --porcelain`.** The
// trigger fires at `pnpm josh git -y`, which stages and commits the working tree, so what is about to
// be committed — staged, unstaged and untracked alike — is exactly what one `git status` returns, with
// no change base to resolve. A failure to read it (no repository, git absent) returns an empty set,
// which reads as `exempt` and refuses nothing — the fail-open direction every guard takes.

const RENAME_ARROW = ' -> '
// `XY ` — two status columns and a separating space — precede every path in `--porcelain` output.
const STATUS_PREFIX_LENGTH = 3

// The path a status line names. A rename prints `old -> new`, and the new path is the one that
// changed, so the arrow is followed where it appears.
function path_of(line: string): string {
	const body = line.slice(STATUS_PREFIX_LENGTH)
	const arrow = body.indexOf(RENAME_ARROW)

	return arrow === -1 ? body : body.slice(arrow + RENAME_ARROW.length)
}

function read_changed_paths_sync(): Array<string> {
	try {
		// stderr is discarded: outside a repository git prints `fatal: not a git repository`, which the
		// catch below already handles as an empty change set — surfacing it would only be noise.
		const output = execFileSync('git', ['status', '--porcelain'], {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
		})

		return output
			.split('\n')
			.filter((line) => line.length > STATUS_PREFIX_LENGTH)
			.map((line) => path_of(line))
	} catch {
		return []
	}
}

// The verdict over the current working tree. `paths` is injectable so the wiring is testable without a
// checkout; the default reads the tree.
function current_verdict(paths: ReadonlyArray<string> = read_changed_paths_sync()): Verdict {
	return test_declared_logic.verdict_for(paths)
}

const test_declared_changed = { current_verdict, path_of, read_changed_paths_sync }

export { test_declared_changed }
