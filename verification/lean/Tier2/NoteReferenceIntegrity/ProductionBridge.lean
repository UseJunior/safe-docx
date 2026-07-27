import Tier2.NoteReferenceIntegrity.Semantics
import Tier2.RelationshipStorySelector

namespace Tier2.ConventionalMainNoteSelector

open RelationshipStorySelector

def exactNoteTypeRecords (kind : NoteKind) (records : List RelationshipRecord) :
    List (Nat × RelationshipRecord) :=
  records.zipIdx.filterMap fun (record, ordinal) =>
    if record.relationshipType == kind.relationshipType then some (ordinal, record) else none

def selectConventionalMainNoteRecords (kind : NoteKind)
    (records : List RelationshipRecord) :
    Except SelectionFailure (Option SelectedNoteIdentity) := do
  match exactNoteTypeRecords kind records with
  | [] => return none
  | [(ordinal, record)] =>
    match record.targetMode with
    | none | some "Internal" =>
      if record.rawTarget.toUTF8.size > maxLocatorBytes then
        throw (.targetLimit ordinal)
      match normalizeTarget record.rawTarget with
      | .ok path => return some {
          relationshipRecordOrdinal := ordinal
          relationshipId := record.id
          normalizedPartPath := path
        }
      | .error _ => throw (.unsafeTarget ordinal)
    | some "External" => throw (.external ordinal)
    | some _ => throw (.invalidTargetMode ordinal)
  | (ordinal, _) :: _ => throw (.ambiguous ordinal)

def SelectedNoteRecordIdentityOf (records : List RelationshipRecord)
    (kind : NoteKind) (selected : SelectedNoteIdentity) : Prop :=
  selectConventionalMainNoteRecords kind records = .ok (some selected)

theorem production_note_selector_exact
    (records : List RelationshipRecord) (kind : NoteKind)
    (selected : SelectedNoteIdentity)
    (hSelect :
      selectConventionalMainNoteRecords kind records = .ok (some selected)) :
    SelectedNoteRecordIdentityOf records kind selected :=
  hSelect

end Tier2.ConventionalMainNoteSelector
