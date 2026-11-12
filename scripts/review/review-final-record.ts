import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { file_map_stamp, type FileMapStampAccess } from '#scripts/josh/file-map-stamp'
import { review_attest } from './review-attest'
import type { Finding } from './review-finding-ledger'
import { review_round } from './review-round'
import { review_stamps } from './review-stamps'

// Bind completion to the current code contract: a newer unfinished review invalidates the old pass.
function stamp(issue: string, root: string = PROJECT_ROOT): FileMapStampAccess {
	return file_map_stamp.create(
		`josh-ship-final-review-${issue}-`,
		root,
		() => review_attest.read_pointer(root)?.nonce ?? '',
	)
}

function is_attested_final(root: string): boolean {
	const pointer = review_attest.read_pointer(root)

	if (pointer === undefined || review_round.current(root) !== '2') return false
	const expected = review_attest.read_expectation(pointer.nonce)

	return expected !== undefined && review_attest.is_attested_on(expected, root)
}

function record(issue: number, findings: ReadonlyArray<Finding>, root: string): void {
	const completion = stamp(String(issue), root)
	const tree = review_stamps.briefed_stamp.read()

	completion.remove()

	if (
		tree === undefined ||
		!is_attested_final(root) ||
		!review_attest.is_briefed_since(tree.taken_at, root) ||
		findings.some((finding) => finding.severity !== 'low')
	) {
		return
	}

	completion.write(tree.files, undefined, tree.base)
	completion.complete()
}

const review_final_record = { record, stamp }

export { review_final_record }
