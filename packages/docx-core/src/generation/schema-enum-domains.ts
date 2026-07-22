/**
 * ECMA-376 5th edition transitional WML enum domains used by DocumentSpec.
 *
 * Source: spec-compliance/ecma-376/schemas/transitional/wml.xsd. The
 * conformance test compares every value here with the vendored schema so this
 * runtime copy cannot drift silently. These are schema domains, not public API
 * support declarations.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.4.52
 * @conformance ECMA-376 edition 5, Part 1 § 17.9.17
 * @conformance ECMA-376 edition 5, Part 1 § 17.7.4.17
 */
export const WML_SCHEMA_ENUM_VALUES = {
  ST_TblLayoutType: 'fixed autofit'.split(' '),
  ST_Border: (
    'nil none single thick double dotted dashed dotDash dotDotDash triple thinThickSmallGap thickThinSmallGap ' +
    'thinThickThinSmallGap thinThickMediumGap thickThinMediumGap thinThickThinMediumGap thinThickLargeGap ' +
    'thickThinLargeGap thinThickThinLargeGap wave doubleWave dashSmallGap dashDotStroked threeDEmboss ' +
    'threeDEngrave outset inset apples archedScallops babyPacifier babyRattle balloons3Colors balloonsHotAir ' +
    'basicBlackDashes basicBlackDots basicBlackSquares basicThinLines basicWhiteDashes basicWhiteDots ' +
    'basicWhiteSquares basicWideInline basicWideMidline basicWideOutline bats birds birdsFlight cabins ' +
    'cakeSlice candyCorn celticKnotwork certificateBanner chainLink champagneBottle checkedBarBlack ' +
    'checkedBarColor checkered christmasTree circlesLines circlesRectangles classicalWave clocks compass ' +
    'confetti confettiGrays confettiOutline confettiStreamers confettiWhite cornerTriangles couponCutoutDashes ' +
    'couponCutoutDots crazyMaze creaturesButterfly creaturesFish creaturesInsects creaturesLadyBug crossStitch ' +
    'cup decoArch decoArchColor decoBlocks diamondsGray doubleD doubleDiamonds earth1 earth2 earth3 ' +
    'eclipsingSquares1 eclipsingSquares2 eggsBlack fans film firecrackers flowersBlockPrint flowersDaisies ' +
    'flowersModern1 flowersModern2 flowersPansy flowersRedRose flowersRoses flowersTeacup flowersTiny gems ' +
    'gingerbreadMan gradient handmade1 handmade2 heartBalloon heartGray hearts heebieJeebies holly houseFunky ' +
    'hypnotic iceCreamCones lightBulb lightning1 lightning2 mapPins mapleLeaf mapleMuffins marquee marqueeToothed ' +
    'moons mosaic musicNotes northwest ovals packages palmsBlack palmsColor paperClips papyrus partyFavor ' +
    'partyGlass pencils people peopleWaving peopleHats poinsettias postageStamp pumpkin1 pushPinNote2 ' +
    'pushPinNote1 pyramids pyramidsAbove quadrants rings safari sawtooth sawtoothGray scaredCat seattle ' +
    'shadowedSquares sharksTeeth shorebirdTracks skyrocket snowflakeFancy snowflakes sombrero southwest stars ' +
    'starsTop stars3d starsBlack starsShadowed sun swirligig tornPaper tornPaperBlack trees triangleParty ' +
    'triangles triangle1 triangle2 triangleCircle1 triangleCircle2 shapes1 shapes2 twistedLines1 twistedLines2 ' +
    'vine waveline weavingAngles weavingBraid weavingRibbon weavingStrips whiteFlowers woodwork xIllusions ' +
    'zanyTriangles zigZag zigZagStitch custom'
  ).split(' '),
  ST_HeightRule: 'auto exact atLeast'.split(' '),
  ST_Merge: 'continue restart'.split(' '),
  ST_VerticalJc: 'top center both bottom'.split(' '),
  ST_StyleType: 'paragraph character table numbering'.split(' '),
  ST_NumberFormat: (
    'decimal upperRoman lowerRoman upperLetter lowerLetter ordinal cardinalText ordinalText hex chicago ' +
    'ideographDigital japaneseCounting aiueo iroha decimalFullWidth decimalHalfWidth japaneseLegal ' +
    'japaneseDigitalTenThousand decimalEnclosedCircle decimalFullWidth2 aiueoFullWidth irohaFullWidth ' +
    'decimalZero bullet ganada chosung decimalEnclosedFullstop decimalEnclosedParen ' +
    'decimalEnclosedCircleChinese ideographEnclosedCircle ideographTraditional ideographZodiac ' +
    'ideographZodiacTraditional taiwaneseCounting ideographLegalTraditional taiwaneseCountingThousand ' +
    'taiwaneseDigital chineseCounting chineseLegalSimplified chineseCountingThousand koreanDigital ' +
    'koreanCounting koreanLegal koreanDigital2 vietnameseCounting russianLower russianUpper none numberInDash ' +
    'hebrew1 hebrew2 arabicAlpha arabicAbjad hindiVowels hindiConsonants hindiNumbers hindiCounting thaiLetters ' +
    'thaiNumbers thaiCounting bahtText dollarText custom'
  ).split(' '),
  ST_LevelSuffix: 'tab space nothing'.split(' '),
  ST_Jc: (
    'start center end both mediumKashida distribute numTab highKashida lowKashida thaiDistribute left right'
  ).split(' '),
  ST_Underline: (
    'single words double thick dotted dottedHeavy dash dashedHeavy dashLong dashLongHeavy dotDash dashDotHeavy ' +
    'dotDotDash dashDotDotHeavy wave wavyHeavy wavyDouble none'
  ).split(' '),
} as const;

export type WmlSchemaEnumType = keyof typeof WML_SCHEMA_ENUM_VALUES;

export const WML_SCHEMA_ENUM_SETS: Readonly<Record<WmlSchemaEnumType, ReadonlySet<string>>> = {
  ST_TblLayoutType: new Set(WML_SCHEMA_ENUM_VALUES.ST_TblLayoutType),
  ST_Border: new Set(WML_SCHEMA_ENUM_VALUES.ST_Border),
  ST_HeightRule: new Set(WML_SCHEMA_ENUM_VALUES.ST_HeightRule),
  ST_Merge: new Set(WML_SCHEMA_ENUM_VALUES.ST_Merge),
  ST_VerticalJc: new Set(WML_SCHEMA_ENUM_VALUES.ST_VerticalJc),
  ST_StyleType: new Set(WML_SCHEMA_ENUM_VALUES.ST_StyleType),
  ST_NumberFormat: new Set(WML_SCHEMA_ENUM_VALUES.ST_NumberFormat),
  ST_LevelSuffix: new Set(WML_SCHEMA_ENUM_VALUES.ST_LevelSuffix),
  ST_Jc: new Set(WML_SCHEMA_ENUM_VALUES.ST_Jc),
  ST_Underline: new Set(WML_SCHEMA_ENUM_VALUES.ST_Underline),
};
