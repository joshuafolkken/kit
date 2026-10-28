// Enforce the comment rule of prompts/coding-standards.md → 基本方針: a comment states why, so the
// history of how the code got here ("Previously, …", "used to …") and measured values with a unit
// ("about 16,000 tokens", "1.9 seconds") are reported — git history and the Issue hold both. An Issue
// citation such as `joshuafolkken/kit#5282` is allowed: it is where the why is recorded. The two
// checks are separate rules so a repository can switch each on once its own comments are clean.

// A bare "previously" often means "earlier in this run" ("a previously parked lane"); only the
// sentence-opening "Previously," narrates the past. "is used to" describes a purpose, not a
// history, so the look-behind skips it.
const HISTORY_PATTERNS = [
	/\bpreviously,/iu,
	/\bformerly\b/iu,
	/(?<!\b(?:is|are|be|been|being|was|were|get|gets|got|getting|only|also|not|just) )\bused to\b/iu,
	/以前は/u,
]

// A sentence opening with "Used to" describes a purpose too, so that opening is cut off before the
// history check. A sentence opens at a line start (after a block comment's `*`) or after `.`, `!`,
// `?` or `:`; the capital `U` keeps a lowercase "used to" that wraps onto the next line of a
// sentence a history.
const SENTENCE_BOUNDARY = /(?<=[.!?:\n])/u
const OPENING_PURPOSE_PATTERN = /^[\s*]*Used to\b/u

// A number with a time, size or token unit, `12k tokens` and `10-second` included. The look-behind
// keeps `#1234` and the tail of a longer number or identifier from matching. A bare `s` is left out:
// it would read `1990s` and `502s` as durations.
const MEASUREMENT_PATTERNS = [
	/(?<![#\w.,])\d[\d.,]*[\s-]?(?:ms|secs?|mins?)(?!\w)/u,
	/(?<![#\w.,])\d[\d.,]*[\s-]?(?:seconds?|minutes?|hours?)(?!\w)/u,
	/(?<![#\w.,])\d[\d.,]*[\s-]?(?:[KMG]i?B|kB|bytes?)(?!\w)/u,
	/(?<![#\w.,])\d[\d.,]*[kKM]?[\s-]?tokens?(?!\w)/u,
]

/**
 * @param {string} sentence
 * @returns {boolean}
 */
function sentence_has_history(sentence) {
	const opening = OPENING_PURPOSE_PATTERN.exec(sentence)
	const rest = opening ? sentence.slice(opening[0].length) : sentence

	return HISTORY_PATTERNS.some((pattern) => pattern.test(rest))
}

/**
 * @param {string} text
 * @returns {boolean}
 */
function has_history(text) {
	return text.split(SENTENCE_BOUNDARY).some((sentence) => sentence_has_history(sentence))
}

/**
 * @param {string} text
 * @returns {boolean}
 */
function has_measurement(text) {
	return MEASUREMENT_PATTERNS.some((pattern) => pattern.test(text))
}

/**
 * @param {(text: string) => boolean} is_violation
 * @param {string} message_id
 * @param {string} message
 * @returns {import('eslint').Rule.RuleModule}
 */
function comment_rule(is_violation, message_id, message) {
	return {
		meta: {
			type: 'suggestion',
			docs: { description: message },
			messages: { [message_id]: message },
			schema: [],
		},
		create(context) {
			return {
				Program() {
					for (const comment of context.sourceCode.getAllComments()) {
						if (!is_violation(comment.value)) continue
						context.report({ loc: comment.loc, messageId: message_id })
					}
				},
			}
		},
	}
}

const no_history_comment_rule = comment_rule(
	has_history,
	'history',
	'Drop the history from this comment ("Previously, …", "used to …"); state why the code is as it is now. git history and the Issue keep the past (prompts/coding-standards.md → 基本方針).',
)

const no_measurement_comment_rule = comment_rule(
	has_measurement,
	'measurement',
	'Drop the measured value from this comment (a number with a time, size or token unit); cite the Issue that recorded it instead (prompts/coding-standards.md → 基本方針).',
)

// The plugin wrapper a flat config merges into its `kit` namespace.
const comment_why_only_plugin = {
	rules: {
		'no-history-comment': no_history_comment_rule,
		'no-measurement-comment': no_measurement_comment_rule,
	},
}

export { comment_why_only_plugin }
