import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { SUITE_TIMEOUT_MS } from '#scripts/lib/timeouts'
import { git_spawn } from './git-spawn'

// The pre-push hook, run ahead of the push instead of inside it.
//
// **The push budget is a transfer budget, and a hook is not a transfer.** `PUSH_TIMEOUT_MS` was read
// off what moving objects costs here, but `git push` runs the pre-push hook first and the budget
// counted it: a hook that ran the whole unit suite — any push the gate's record does not cover, such
// as the observation ledger commit or a tree `ship` has just synced with main — took 130 to 196
// seconds and was killed at 120 on a push that was healthy. Killing `git` did not kill the hook
// either: lefthook and vitest outlived it, and the retry started a second suite in the same work tree,
// where each `test-state-guard` read the other's temporary files as a mutation and both failed.
//
// So the hook runs here, once, on a suite's budget rather than a transfer's, and `git_command.push`
// spawns the bounded transfer that follows with `--no-verify`. The retry then repeats the transfer
// alone, and a hook that is still running cannot exist for it to overlap: a hook cut at
// `SUITE_TIMEOUT_MS` fails the push instead of reaching the transfer.
//
// **What git hands the hook is reproduced rather than dropped.** `git hook run` executes whatever
// hook is configured — lefthook's or anyone's — and the arguments and stdin are git's pre-push
// contract: the remote's name and URL, and one `<local ref> <local oid> <remote ref> <remote oid>`
// line per ref. A hook that reads them (`git lfs pre-push` uploads exactly the objects those lines
// name) would otherwise act on nothing. Both pushes `git_command.push` makes send the current branch to
// the same name on `origin`, so that is the one line written. Like git, an up-to-date branch runs no
// hook: the remote-tracking ref already naming `HEAD` is git's "Everything up-to-date".

const REMOTE = 'origin'
const HOOK_NAME = 'pre-push'
const PROBE_HOOK_NAME = 'kit-hook-run-probe'
const ALLOW_UNKNOWN_HOOK_NAME_FLAG = '--allow-unknown-hook-name'
const HOOK_RUN = 'run'
const STDIN_FILE = 'refs'
const TEMPORARY_PREFIX = 'kit-pre-push-'
const ZERO_DIGIT = '0'

interface PushReferences {
	branch: string
	local_oid: string
	remote_oid: string | undefined
}

// `undefined` is a branch the remote has never seen, which git reports with an all-zero object id.
async function read_remote_oid(branch: string): Promise<string | undefined> {
	try {
		return await git_spawn.read([
			'rev-parse',
			'--verify',
			'--quiet',
			`refs/remotes/${REMOTE}/${branch}`,
		])
	} catch {
		return undefined
	}
}

async function read_push_references(): Promise<PushReferences> {
	const [branch, local_oid] = await Promise.all([
		git_spawn.read(['rev-parse', '--abbrev-ref', 'HEAD']),
		git_spawn.read(['rev-parse', 'HEAD']),
	])

	return { branch, local_oid, remote_oid: await read_remote_oid(branch) }
}

// The zero id takes the local id's length, so a SHA-256 repository gets 64 digits rather than 40.
function to_stdin_line(references: PushReferences): string {
	const reference = `refs/heads/${references.branch}`
	const remote_oid = references.remote_oid ?? ZERO_DIGIT.repeat(references.local_oid.length)

	return `${reference} ${references.local_oid} ${reference} ${remote_oid}\n`
}

function to_hook_run_arguments(stdin_path: string, hook_name: string): Array<string> {
	return [HOOK_RUN, '--ignore-missing', `--to-stdin=${stdin_path}`, hook_name]
}

// **A git that cannot run the hook this way leaves it to the push** — `git hook run` is Git 2.36, and
// `--to-stdin` later still; an older git exits 129 on either. It is asked with a hook name nothing
// configures, which `--ignore-missing` turns into a clean exit on any git that understands the call,
// so the answer never depends on what the real hook does. Git 2.54 refuses a name that is not a
// native hook unless `--allow-unknown-hook-name` says otherwise, and a git before it refuses that flag,
// so the probe is asked both ways.
async function can_probe(probe_arguments: ReadonlyArray<string>): Promise<boolean> {
	try {
		await git_spawn.read(['hook', ...probe_arguments])

		return true
	} catch {
		return false
	}
}

async function can_run_hooks(stdin_path: string): Promise<boolean> {
	const [, ...options] = to_hook_run_arguments(stdin_path, PROBE_HOOK_NAME)

	if (await can_probe([HOOK_RUN, ALLOW_UNKNOWN_HOOK_NAME_FLAG, ...options])) return true

	return await can_probe([HOOK_RUN, ...options])
}

async function run_with_stdin(stdin_line: string): Promise<boolean> {
	const directory = await mkdtemp(path.join(tmpdir(), TEMPORARY_PREFIX))
	const stdin_path = path.join(directory, STDIN_FILE)

	try {
		await writeFile(stdin_path, stdin_line)
		if (!(await can_run_hooks(stdin_path))) return false
		const url = await git_spawn.read(['remote', 'get-url', REMOTE])

		await git_spawn.with_output(
			'hook',
			[...to_hook_run_arguments(stdin_path, HOOK_NAME), '--', REMOTE, url],
			{ timeout_ms: SUITE_TIMEOUT_MS },
		)

		return true
	} finally {
		await rm(directory, { force: true, recursive: true })
	}
}

// `true` when the hook is settled here — run, or nothing to push — so the push skips it; `false` when
// this git cannot run it, so the push runs it as it always did. A hook that fails throws
// `git hook exited with code <n>`, and the push is never attempted.
async function run(): Promise<boolean> {
	const references = await read_push_references()

	if (references.local_oid === references.remote_oid) return true

	return await run_with_stdin(to_stdin_line(references))
}

const git_pre_push_hook = {
	run,
}

export { git_pre_push_hook }
