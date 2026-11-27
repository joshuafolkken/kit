// The public surface a separate machine-wide security checker imports to reuse `josh audit`'s pass
// cache (joshuafolkken/kit#8255). Exported rather than copied so the cache key, lifetime and
// reservation stay single-sourced in kit.
export { security_audit_cache } from '#scripts/security/security-audit-cache'
export type { AuditPorts } from '#scripts/security/security-audit-cache'
