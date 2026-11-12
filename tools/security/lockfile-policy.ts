#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { git_spawn } from '#scripts/git/git-spawn'
import { resolve_spawn_exit } from '#scripts/lib/spawn-exit'
import { metrics_base } from '#tools/metrics/metrics-base'
import { execaSync } from 'execa'

// Whether every version the lockfile pins still clears the workspace's supply-chain policy —
// `minimumReleaseAge` above all (joshuafolkken/kit#4090).
//
// pnpm checks the age only when it resolves, and `trustLockfile: true` skips the re-check on
// install. A lockfile can therefore hold a version younger than the window: raising the window
// (#4023 took it from one day to three) left versions pnpm had picked under the old one in place,
// and the gap surfaced only when a cache-less Publish run downloaded them through Safe Chain, whose
// mirrored window refused them. The check is pnpm's own — the install-time verification
// `trustLockfile: false` turns back on — so the policy has one reader.
//
// It runs only when the lockfile or the policy moved from the merge-base: the verification
// fetches full registry metadata for every entry (about a minute), and a lockfile whose entries
// and window are both unchanged answers what the default branch already answered. A base that
// cannot be read verifies anyway — no base means no skip.

const PNPM = 'pnpm'
const POLICY_FILES: ReadonlyArray<string> = ['pnpm-lock.yaml', 'pnpm-workspace.yaml']
const VERIFY_ARGUMENTS: ReadonlyArray<string> = [
	'install',
	'--frozen-lockfile',
	'--lockfile-only',
	'--config.trust-lockfile=false',
]

async function has_policy_change(base: string | undefined): Promise<boolean> {
	if (base === undefined) return true
	const changed = await git_spawn.read(['diff', '--name-only', base, '--', ...POLICY_FILES])

	return changed.length > 0
}

function verify(): number {
	const result = execaSync(PNPM, [...VERIFY_ARGUMENTS], { stdio: 'inherit', reject: false })

	return resolve_spawn_exit(PNPM, result)
}

async function main(): Promise<number> {
	const base = await metrics_base.resolve_commit()

	return (await has_policy_change(base)) ? verify() : 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const exit_code = await main()

	if (exit_code !== 0) process.exit(exit_code)
}

const lockfile_policy = { has_policy_change, main }

export { lockfile_policy }
