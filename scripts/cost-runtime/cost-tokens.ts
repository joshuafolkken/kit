// Estimating tokens for the parts of the context the transcript records as text
// (joshuafolkken/kit#1151).
//
// **Why an estimate exists at all.** The transcript reports real token counts for exactly two
// things: what each request was billed, and how many of a response's output tokens were thinking.
// Everything else — `CLAUDE.md`, a tool result, a Bash command body — is stored as text with no
// count beside it, and Claude's tokenizer is not public. So a breakdown of the resident block or of
// the conversation is an estimate by construction, and the report says so wherever it prints one.
//
// **Why two terms rather than one bytes-per-token ratio.** A single ratio is wrong by a factor of
// three across this project's own content: English markdown runs about 3 characters per token,
// while Japanese runs about one token per character at 3 bytes each. Splitting on the ASCII
// boundary removes that error without pretending to be a tokenizer.
//
// Both constants were calibrated against this repository's transcripts, using the one place where a
// real count sits beside real text: an assistant response whose content is only `text` blocks and
// whose `thinking_tokens` is 0, where `output_tokens` is the token count of exactly that text.
//
// - **Wide characters — 1 token each.** A least-squares fit over 238 such responses (197,259 ASCII
//   and 164,073 wide characters against 257,036 output tokens) put the wide coefficient at 0.991.
// - **ASCII — 3 characters per token**, taken from the one clean reading in that set: the responses
//   that are almost entirely ASCII, which give 2.97. The other readings are all *denser* and each is
//   denser for a reason that does not apply to a document like `CLAUDE.md`. Subtracting the wide
//   term across the whole set leaves 2.12, but that ASCII is markdown scaffolding embedded in
//   Japanese — punctuation, bullets, table pipes, identifiers in backticks — which tokenizes far
//   denser than prose; the same figure rises monotonically as the wide fraction falls (2.08 → 2.27 →
//   2.97). And the resident baseline moved 309–1,116 tokens across `CLAUDE.md` growth of
//   807–2,045 bytes, i.e. 1.8–2.6, but other resident surfaces grew in those same commits, so that
//   reading attributes their tokens to `CLAUDE.md`'s bytes and is biased dense by construction.
//
// **The residual error runs in one direction, and the report says where it lands.** If 3 is too
// generous for some content, the rows sized from repository files are *under*-counted and the
// difference falls into `cost-resident.ts`'s harness remainder — which is therefore an upper bound
// on what the transcript cannot decompose, and the sized rows a lower bound on what it can. That is
// why the remainder is one named row rather than a figure distributed over the others.

const ASCII_CHARS_PER_TOKEN = 3
const WIDE_TOKENS_PER_CHAR = 1
const ASCII_LIMIT = 128

interface CharCounts {
	ascii_chars: number
	wide_chars: number
}

// Iterated by code point rather than by UTF-16 unit, so an emoji or any other astral character
// counts once instead of twice. `for…of` over a string yields code points.
function count_chars(text: string): CharCounts {
	let ascii_chars = 0
	let wide_chars = 0

	for (const char of text) {
		if ((char.codePointAt(0) ?? 0) < ASCII_LIMIT) ascii_chars += 1
		else wide_chars += 1
	}

	return { ascii_chars, wide_chars }
}

function estimate(text: string): number {
	const { ascii_chars, wide_chars } = count_chars(text)

	return Math.round(ascii_chars / ASCII_CHARS_PER_TOKEN) + wide_chars * WIDE_TOKENS_PER_CHAR
}

// The token image of a byte count, for content that is pure ASCII — where one byte is one character,
// so this is exactly `estimate` of such a document and rounds the same way. A budget expressed in
// both units has to agree with itself on ASCII, and this is the conversion that makes the two the
// same limit rather than two limits to reconcile. Anything denser costs more tokens per byte, so the
// token limit binds first there, which is the whole reason for holding one.
function ascii_bytes_to_tokens(bytes: number): number {
	return Math.round(bytes / ASCII_CHARS_PER_TOKEN)
}

const cost_tokens = {
	ASCII_CHARS_PER_TOKEN,
	WIDE_TOKENS_PER_CHAR,
	count_chars,
	estimate,
	ascii_bytes_to_tokens,
}

export type { CharCounts }
export { cost_tokens }
