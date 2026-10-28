// A finding written in the `review:record` grammar with its reason after it — `<spec> — <sentence>` —
// split into the two halves, the one place both its writers read it: a ship reviewer's findings file
// (`run-ship-review.ts`) and an agent's own `review:record` round (`review-record-cli.ts`). The spec is
// what the ledger keeps; the first sentence of the reason is what the durable stop log keeps.

// What a finding line carries after its spec: one sentence saying what is wrong, so a stopped ship's
// log tells the resumed lane child the defect rather than only its location.
const DESCRIPTION_SEPARATOR = ' — '
// Where the spec ends on read: a reviewer that types the dash as `-`, `--` or `–` still ends it there,
// so its sentence never lands in the ledger's file field.
const DESCRIPTION_BOUNDARY = / [—–-]{1,2} /u
// Where a description's first sentence ends, and the cap that keeps a run-on one a line. Japanese
// sets no space after `。`, so it ends a sentence on its own.
const SENTENCE_END = /(?<=[.!?])\s|(?<=。)/u
const SENTENCE_LIMIT = 200
const ELLIPSIS = '…'

function split_description(unmarked: string): { spec: string; description: string } {
	const boundary = DESCRIPTION_BOUNDARY.exec(unmarked)

	if (boundary === null) return { spec: unmarked.trim(), description: '' }

	const rest = unmarked.slice(boundary.index + boundary[0].length)

	return { spec: unmarked.slice(0, boundary.index).trim(), description: rest.trim() }
}

function first_sentence(description: string): string {
	const [sentence = ''] = description.split(SENTENCE_END, 1)

	if (sentence.length <= SENTENCE_LIMIT) return sentence

	return `${sentence.slice(0, SENTENCE_LIMIT - ELLIPSIS.length)}${ELLIPSIS}`
}

const review_finding_text = {
	DESCRIPTION_SEPARATOR,
	SENTENCE_LIMIT,
	first_sentence,
	split_description,
}

export { review_finding_text }
