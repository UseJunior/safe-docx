import Tier2.CommentReferenceIntegrity.TypedSemantics

open Tier2.CommentReferenceIntegrity.Typed

def stackWitnessPayloadSize : Nat := 400000

def stackWitnessBytesA : List UInt8 :=
  List.replicate stackWitnessPayloadSize (UInt8.ofNat 97)

def stackWitnessBytesB : List UInt8 :=
  List.replicate stackWitnessPayloadSize (UInt8.ofNat 97)

def stackWitnessBoundedBytes (values : List UInt8) : BoundedBytes :=
  { bytes := values
    limit := values.length
    admitted := Nat.le_refl _ }

def stackWitnessBoundedByteArray (values : List UInt8) : BoundedByteArray :=
  let bytes : ByteArray := ⟨values.toArray⟩
  { bytes
    limit := bytes.size
    admitted := Nat.le_refl _ }

def stackWitnessAttributeA : TypedXmlAttribute :=
  { namespaceUri := stackWitnessBoundedBytes []
    localName := stackWitnessBoundedBytes [UInt8.ofNat 97]
    value := stackWitnessBoundedByteArray stackWitnessBytesA }

def stackWitnessAttributeB : TypedXmlAttribute :=
  { namespaceUri := stackWitnessBoundedBytes []
    localName := stackWitnessBoundedBytes [UInt8.ofNat 97]
    value := stackWitnessBoundedByteArray stackWitnessBytesB }

def stackWitnessEventsA : List TypedXmlEvent :=
  [ .startElement
      (stackWitnessBoundedBytes [])
      (stackWitnessBoundedBytes [UInt8.ofNat 99])
      [stackWitnessAttributeA] 0 false 0
  , .text (stackWitnessBoundedByteArray stackWitnessBytesA) 1 1
  , .endElement
      (stackWitnessBoundedBytes [])
      (stackWitnessBoundedBytes [UInt8.ofNat 99]) 0 2
  ]

def stackWitnessEventsB : List TypedXmlEvent :=
  [ .startElement
      (stackWitnessBoundedBytes [])
      (stackWitnessBoundedBytes [UInt8.ofNat 99])
      [stackWitnessAttributeB] 0 false 0
  , .text (stackWitnessBoundedByteArray stackWitnessBytesB) 1 1
  , .endElement
      (stackWitnessBoundedBytes [])
      (stackWitnessBoundedBytes [UInt8.ofNat 99]) 0 2
  ]

example : typedByteListEqCheck stackWitnessBytesA stackWitnessBytesB = true := by
  apply (typedByteListEqCheck_true_iff _ _).2
  rfl

example :
    typedXmlEventListEqCheck stackWitnessEventsA stackWitnessEventsB = true := by
  apply (typedXmlEventListEqCheck_true_iff _ _).2
  rfl
