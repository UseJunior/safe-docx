import LeanDocxChecker

namespace ProtocolV6StructuralChargeAudit

def sharedOrdinaryIssueLimit : Nat := 511
def ordinaryEscapedStringBudget : Nat := 1571840
def protocolV5StructuralEnvelope : Nat := 1047936
def protocolV6FixedStructuralCharge : Nat := 4928
def ordinaryLegalUpperEnvelope : Nat :=
  protocolV5StructuralEnvelope + ordinaryEscapedStringBudget +
    protocolV6FixedStructuralCharge
def terminalIssueStructuralCharge : Nat := 640
def terminalEscapedStringReserve : Nat := 1024
def legalTerminalJsonEnvelope : Nat :=
  ordinaryLegalUpperEnvelope + terminalIssueStructuralCharge +
    terminalEscapedStringReserve
def legalStdoutEnvelope : Nat := legalTerminalJsonEnvelope + 1

theorem ordinary_upper_envelope_exact :
    ordinaryLegalUpperEnvelope = 2624704 := by decide

theorem legal_terminal_json_envelope_exact :
    legalTerminalJsonEnvelope = 2626368 := by decide

theorem legal_stdout_envelope_exact :
    legalStdoutEnvelope = 2626369 := by decide

theorem stdout_hard_cap_margin_exact :
    8 * 1024 * 1024 - legalStdoutEnvelope = 5762239 := by decide

end ProtocolV6StructuralChargeAudit
