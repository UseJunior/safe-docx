## ADDED Requirements
### Requirement: Recoverable save publication
The save tool SHALL preflight all requested destinations before requested output writes, reject aliased outputs, stage on each destination filesystem and recover original contents after ordinary publication failures. It SHALL preserve existing inode/security metadata semantics or refuse before destination mutation if preservation is unsupported. It SHALL report exact remaining recovery paths if rollback fails. It SHALL NOT claim crash atomicity across filesystems.

#### Scenario: Destination preflight
- **WHEN** either destination fails policy or filesystem checks, or outputs alias by canonical path, inode or filesystem name comparison for missing targets/parents
- **THEN** neither requested artifact is written
- **AND** existing symlink write-through and POSIX modes are preserved on supported targets; multiply linked targets are rejected before writing
- **AND** safe private probes are cleaned before publication and distinct names remain supported on case-sensitive filesystems

#### Scenario: Staging and publication recovery
- **WHEN** staging, backup or either publication fails
- **THEN** existing files are restored and newly published files removed if recovery succeeds
- **AND** even a partially written target whose write rejects SHALL be restored through its existing inode using verified complete original bytes
- **AND** unused staging files and private empty staging directories are cleaned

#### Scenario: Recovery needs attention
- **WHEN** restoration, removal or staging cleanup fails
- **THEN** the error identifies exact destination and surviving recovery paths
- **AND** a backup that could not be restored is retained

#### Scenario: Successful paired publication
- **WHEN** publication succeeds
- **THEN** both outputs contain the selected bytes from the same captured generation
- **AND** existing destination inode, ownership/group, ACL and xattr write-through semantics are retained; new outputs use exclusive creation
- **AND** cleanup failures after commit are reported with exact paths without claiming rollback
