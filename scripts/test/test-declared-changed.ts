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

// The working-tree read behind `current_verdict`, injectable so the delivery path can be exercised
// without a checkout (joshuafolkken/kit#2169). Held on a `const` object rather than a reassigned
// variable — production leaves `paths` unset and the real reader runs; a test fixes it for the span of
// one call through `with_paths`, and it is cleared afterwards.
const injected: { paths?: ReadonlyArray<string> } = {}

// The paths `current_verdict` reads when none are passed: the injected set if a test has fixed one,
// else the real working tree.
function source_paths(): ReadonlyArray<string> {
	return injected.paths ?? read_changed_paths_sync()
}

// The verdict over the current working tree. `paths` stays injectable for a direct caller; when it is
// omitted the injected set is read if one is in force, else the real tree.
function current_verdict(paths: ReadonlyArray<string> = source_paths()): Verdict {
	return test_declared_logic.verdict_for(paths)
}

// Put the injection back to what it was before a `with_paths` span — cleared to the live reader when
// nothing was in force, else the outer span's set. Restoring rather than always clearing lets a nested
// span prove the clear happened without reading the live tree (joshuafolkken/kit#2169).
function restore_injection(previous: ReadonlyArray<string> | undefined): void {
	if (previous === undefined) {
		delete injected.paths

		return
	}

	injected.paths = previous
}

// The seam the `rule_delivery` call path needs (joshuafolkken/kit#2169). `is_untested_commit` reads the
// tree at trigger time rather than from an argument, so a unit test driving `rule_delivery` cannot reach
// `current_verdict`'s `paths` port from the outside. Running `body` inside `with_paths` fixes the read
// to `paths` for its duration and restores it afterwards — the `PreToolUse` production path, which never
// calls this, still reads the live tree.
function with_paths<T>(paths: ReadonlyArray<string>, body: () => T): T {
	const previous = injected.paths

	injected.paths = paths

	try {
		return body()
	} finally {
		restore_injection(previous)
	}
}

const test_declared_changed = { current_verdict, path_of, read_changed_paths_sync, with_paths }

export { test_declared_changed }
