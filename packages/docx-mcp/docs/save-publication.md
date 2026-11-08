# Local save publication and recovery

`save` checks every requested destination's path policy before creating directories or writing output. Clean and tracked destinations must be distinct after resolving existing symlinks, dangling links and symlinked parents. Existing device/inode aliases are also rejected (`ALIASED_OUTPUT_PATHS`).

Existing symlinks retain write-through behavior: the link remains and its resolved target is replaced. Existing POSIX mode bits are preserved. Multiply linked destinations fail with `HARDLINK_OUTPUT_UNSUPPORTED`; rename-based replacement would otherwise split the hardlink and silently change the established write-through behavior. Non-regular targets and destinations without write access fail before staging. Publication creates a new inode; ownership, extended attributes and ACL cloning are outside this guarantee.

Each output is staged in a private directory beside its resolved destination. Existing originals are backed up there before either staged file is published. If staging, backup or publication fails, save restores originals and removes newly published outputs. It cleans partial stages and known empty staging directories without recursive deletion. New parent directories created for the requested paths can remain empty after failure.

An ordinary recoverable error returns the usual save failure. If rollback needs attention, `SAVE_ERROR` includes `rollback_failures`: each entry names `path`, `operation`, `error` and, when present, `backup_path` and `staging_path`. The message also includes these exact paths. A backup that could not be restored is retained. Recover the listed originals before retrying; do not delete the backup to suppress the error.

Once both outputs are published, backup cleanup is separate from commit. A cleanup error returns success with `publication_cleanup_failures`, using the same path/operation fields, because both requested outputs already exist. Retained backups or empty staging directories can then be removed deliberately.

Each rename stays within its destination filesystem. The pair is recoverable on ordinary failures, **not crash atomic**, including when destinations are on separate filesystems. Preflight checks do not eliminate TOCTOU races with external filesystem changes or concurrent writers. This mechanism adds no new save parameters and preserves artifact/cache/generation policies.
