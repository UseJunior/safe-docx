## 1. Specification

- [x] 1.1 Validate the CLI, timeout, directory-entry, and performance requirements

## 2. CLI

- [x] 2.1 Parse and document `--verify` and `--certificate`
- [x] 2.2 Enable the compiled verifier and return the public certificate
- [x] 2.3 Fail closed before publishing output when verification does not pass
- [x] 2.4 Atomically write an optional certificate JSON artifact

## 3. Verifier compatibility

- [x] 3.1 Align the documented and implemented default timeout at 10 seconds
- [x] 3.2 Admit only inert, unambiguous ZIP directory placeholders
- [x] 3.3 Update typed semantics and proof bridges for the expanded ZIP subset

## 4. Evidence

- [x] 4.1 Add CLI parsing, certificate-output, and fail-closed tests
- [x] 4.2 Add accepted and adversarial ZIP-directory tests
- [x] 4.3 Add a public NVCA-derived verified-comparison gate at 10 seconds
- [x] 4.4 Run focused Lean, CLI, conformance, and full pre-submit checks
