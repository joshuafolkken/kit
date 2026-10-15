// Whose words kit acts on: the `author_association` REST reports with an issue or a comment, and the
// ones that can write to the repository. On a public repository anyone can file an issue or comment,
// so a body kit runs (`josh measure:rerun`) or copies into the ledger (`review:record`) is taken only
// from an author with write access — and an unknown author is not a trusted one.
const TRUSTED_ASSOCIATIONS: ReadonlySet<string> = new Set(['OWNER', 'MEMBER', 'COLLABORATOR'])
const TRUSTED_LIST = [...TRUSTED_ASSOCIATIONS].join(' / ')

function is_trusted(association: string | null | undefined): boolean {
	return typeof association === 'string' && TRUSTED_ASSOCIATIONS.has(association)
}

const gh_author_association = { TRUSTED_LIST, is_trusted }

export { gh_author_association }
