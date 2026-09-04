import { git_command } from './git/git-command'
import { review_tree } from './review/review-tree'

// The two readings a green-gate record is written from and compared against: the digest of every
// changed file, and the commit that map is a diff against (joshuafolkken/kit#1241,
// joshuafolkken/kit#1328).
//
// They live here rather than inside `verification-gate.ts` because there are now two readers — the
// gate, which reuses a green record instead of re-running its four checks, and the pre-push hook,
// which reuses the same record instead of re-running the unit suite (joshuafolkken/kit#1334). A
// second copy of the pair would be the clone `CLAUDE.md` prohibits, and it would not have stayed
// identical: what these functions really encode is which failure direction is safe, and a copy is
// where that decision gets made twice.
//
// **A failed read is `undefined` or an empty map, never a throw.** Neither reader is entitled to fail
// because git could not answer; both are entitled to conclude that nothing can be reused. The gate
// then runs its checks and the hook runs the suite, which is the direction that costs seconds rather
// than correctness.

interface GateTree {
	files: Record<string, string>
	base: string | undefined
}

async function read_changed_files(): Promise<Record<string, string>> {
	try {
		return await review_tree.read_changed_tree()
	} catch {
		return {}
	}
}

async function read_base(): Promise<string | undefined> {
	try {
		return await git_command.default_branch_commit()
	} catch {
		return undefined
	}
}

// The two readings are independent, so they are started together rather than one after the other.
async function read_gate_tree(): Promise<GateTree> {
	const [files, base] = await Promise.all([read_changed_files(), read_base()])

	return { files, base }
}

const gate_tree = { read_base, read_changed_files, read_gate_tree }

export type { GateTree }
export { gate_tree }
