// The public surface a separate machine-wide security checker imports to fetch the vulnerability
// scanner the same way `josh audit` does (joshuafolkken/kit#8255). Exported rather than copied so
// the asset naming, version floor and download URL stay single-sourced in kit.
export { security_audit_provision_logic } from '#scripts/security/security-audit-provision-logic'
export type { ScannerAsset } from '#scripts/security/security-audit-provision-logic'
