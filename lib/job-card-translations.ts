// =============================================================================
// Job Card Translations — Hindi / English
// Used by all 6 A-20 production job card forms in the Operator Section.
//
// Rules:
//   - Chemical names, material codes, product grades, numerical values,
//     batch numbers, lot numbers are NOT translated.
//   - All user-facing labels, placeholders, headings, buttons, messages
//     and instructions ARE translated.
// =============================================================================

import type { JobCardLang } from "./job-card-lang-context";

// ---------------------------------------------------------------------------
// Translation table
// ---------------------------------------------------------------------------
const T = {
  // ── Navigation & Banner ──────────────────────────────────────────────────
  backLink:             { en: "← All Job Card Types",                    hi: "← सभी जॉब कार्ड प्रकार" },
  companyName:          { en: "JAISHIL SULPHUR AND CHEMICAL INDUSTRIES",  hi: "जैशील सल्फर एंड केमिकल इंडस्ट्रीज" },
  editingBanner:        { en: "✏️ Editing existing job card",             hi: "✏️ मौजूदा जॉब कार्ड संपादित हो रहा है" },

  // ── Section Headers ──────────────────────────────────────────────────────
  secJobCardHeader:     { en: "Job Card Header",                          hi: "जॉब कार्ड हेडर" },
  secPhaseARawMat:      { en: "Phase A — Raw Materials & Ingredients",    hi: "फेज़ A — कच्चा माल और सामग्री" },
  secPhaseBRawMat:      { en: "Phase B — Raw Materials & Ingredients",    hi: "फेज़ B — कच्चा माल और सामग्री" },
  secRawMat:            { en: "Raw Materials & Ingredients",              hi: "कच्चा माल और सामग्री" },
  secSulphurBagDetails: { en: "Sulphur Bag Details",                      hi: "सल्फर बैग विवरण" },
  secBoricBagDetails:   { en: "BORIC ACID Bag Details",                   hi: "बोरिक एसिड बैग विवरण" },
  secJsc45BagDetails:   { en: "JSC45 Bag Details",                        hi: "JSC45 बैग विवरण" },
  secZnoBagDetails:     { en: "ZNO (Zinc Oxide) Bag Details",             hi: "ZNO (जिंक ऑक्साइड) बैग विवरण" },
  secPhaseAObs:         { en: "Phase A — Observations",                   hi: "फेज़ A — अवलोकन" },
  secPhaseBObs:         { en: "Phase B — Observations",                   hi: "फेज़ B — अवलोकन" },  // SulphurSc/UPL
  secPhaseAMixing:      { en: "Phase A Mixing",                           hi: "फेज़ A मिश्रण" },
  secPhaseBMixing:      { en: "Phase B Mixing",                           hi: "फेज़ B मिश्रण" },
  secPhaseAMixHeat:     { en: "Phase A Mixing & Heating",                 hi: "फेज़ A मिश्रण और गर्म करना" },
  secPhaseAObsInstacal: { en: "Phase A Observations",                     hi: "फेज़ A अवलोकन" },
  secPhaseBObsInstacal: { en: "Phase B Observations",                     hi: "फेज़ B अवलोकन" },
  secObservations:      { en: "OBSERVATIONS",                             hi: "अवलोकन" },
  secFinalCollection:   { en: "Final Collection",                         hi: "अंतिम संग्रह" },
  secCheckPoints:       { en: "Check Points",                             hi: "जाँच बिंदु" },
  secWaterTds:          { en: "Water TDS",                                hi: "पानी TDS" },
  secPh:                { en: "pH",                                        hi: "pH" },
  secTotalLotWeight:    { en: "Total Lot Weight",                         hi: "कुल लॉट वज़न" },

  // ── Header Labels ────────────────────────────────────────────────────────
  operatorName:         { en: "Operator Name",                            hi: "ऑपरेटर का नाम" },
  batchSizeKg:          { en: "Batch Size (kg) *",                        hi: "बैच साइज़ (kg) *" },
  lotNo:                { en: "Lot No *",                                  hi: "लॉट नंबर *" },
  date:                 { en: "Date *",                                    hi: "दिनांक *" },

  // ── Phase info rows ──────────────────────────────────────────────────────
  phaseAInstrTotal:     { en: "Phase A Instructed Total",                 hi: "फेज़ A निर्देशित कुल" },
  phaseBInstrTotal:     { en: "Phase B Instructed Total",                 hi: "फेज़ B निर्देशित कुल" },
  phaseAInstrTotal2:    { en: "Phase A Instruction Total",                hi: "फेज़ A निर्देश कुल" },   // SulphurSc variant
  phaseBInstrTotal2:    { en: "Phase B Instruction Total",                hi: "फेज़ B निर्देश कुल" },

  // ── Table Column Headers ─────────────────────────────────────────────────
  colOrder:             { en: "Order",                                     hi: "क्रम" },
  colComponent:         { en: "Component",                                 hi: "घटक" },
  colComponents:        { en: "Components",                                hi: "घटक" },
  colMaterialCode:      { en: "Material Code",                            hi: "मटेरियल कोड" },
  colInstructedKg:      { en: "Instructed (kg)",                          hi: "निर्देशित (kg)" },
  colInstructionsKg:    { en: "Instructions (kg)",                        hi: "निर्देश (kg)" },
  colInstructionsKgs:   { en: "Instructions (kgs)",                       hi: "निर्देश (kgs)" },
  colAddedKg:           { en: "Added (kg)",                               hi: "डाला गया (kg)" },
  colAddedKgs:          { en: "Added (kgs)",                              hi: "डाला गया (kgs)" },
  colRmBatchNo:         { en: "RM Batch No",                              hi: "RM बैच नंबर" },
  colBatchNo:           { en: "Batch No.",                                 hi: "बैच नंबर" },
  colBatchNoLower:      { en: "Batch no.",                                 hi: "बैच नंबर" },
  colDrumBagNo:         { en: "Drum / Bag No",                            hi: "ड्रम / बैग नंबर" },
  colDrumBagNoFull:     { en: "Drum / Bag No.",                           hi: "ड्रम / बैग नंबर" },
  colDrumBagNoCaps:     { en: "DRUM / BAG NO.",                           hi: "ड्रम / बैग नंबर" },
  colTdsNote:           { en: "TDS / Note",                               hi: "TDS / नोट" },
  colRemark:            { en: "Remark",                                    hi: "टिप्पणी" },
  colBagNo:             { en: "Bag No.",                                   hi: "बैग नंबर" },
  colWeightKg:          { en: "Weight (kg)",                              hi: "वज़न (kg)" },

  // ── Table Footer ─────────────────────────────────────────────────────────
  totalPhaseA:          { en: "Total Phase A",                            hi: "फेज़ A कुल" },
  totalPhaseB:          { en: "Total Phase B",                            hi: "फेज़ B कुल" },
  totalPHASEA:          { en: "Total PHASE A",                            hi: "फेज़ A कुल" },
  totalPHASEB:          { en: "Total PHASE B",                            hi: "फेज़ B कुल" },
  totalInstructions:    { en: "Total Instructions",                        hi: "कुल निर्देश" },
  totalInstructionsSuf: { en: "Total Instructions:",                       hi: "कुल निर्देश:" },
  totalAdded:           { en: "Total Added:",                              hi: "कुल डाला गया:" },

  // ── Observation Subheads ─────────────────────────────────────────────────
  preMix:               { en: "Pre-Mix",                                  hi: "प्री-मिक्स" },
  beadMill:             { en: "Bead Mill",                                hi: "बीड मिल" },
  phaseAMixingSubhead:  { en: "Phase A Mixing",                           hi: "फेज़ A मिश्रण" },
  heatingSubhead:       { en: "Heating",                                  hi: "गर्म करना" },

  // ── Observation & Mixing Labels ──────────────────────────────────────────
  startTime:            { en: "Start Time",                               hi: "शुरू समय" },
  endTime:              { en: "End Time",                                  hi: "बंद समय" },
  flowRateSL:           { en: "Flow Rate (s/L)",                          hi: "प्रवाह दर (s/L)" },
  totalPhaseAAddedCalc: { en: "Total Phase A Added (kg) — calculated",    hi: "फेज़ A कुल डाला गया (kg) — गणना" },
  totalPhaseBAddedCalc: { en: "Total Phase B Added (kg) — calculated",    hi: "फेज़ B कुल डाला गया (kg) — गणना" },
  totalPhaseAAddedKgs:  { en: "Total Phase A Added (kgs) — calculated",   hi: "फेज़ A कुल डाला गया (kgs) — गणना" },
  totalPhaseBAddedKgs:  { en: "Total Phase B Added (kgs) — calculated",   hi: "फेज़ B कुल डाला गया (kgs) — गणना" },
  collectedSlurryA:     { en: "Collected Slurry Phase A (kg)",            hi: "संग्रहित स्लरी फेज़ A (kg)" },
  collectedSlurryB:     { en: "Collected Slurry Phase B (kg)",            hi: "संग्रहित स्लरी फेज़ B (kg)" },
  heatingStartTime:     { en: "Heating Start Time",                       hi: "गर्म करना शुरू समय" },
  heatingStopTime:      { en: "Heating Stop Time",                        hi: "गर्म करना बंद समय" },

  // ── Phase A/B Observations textareas ────────────────────────────────────
  phaseAObsLabel:       { en: "Phase A Observations",                     hi: "फेज़ A अवलोकन" },
  phaseBObsLabel:       { en: "Phase B Observations",                     hi: "फेज़ B अवलोकन" },
  phaseAObsPlaceholder: { en: "Enter any Phase A observations…",          hi: "फेज़ A के अवलोकन यहाँ लिखें…" },
  phaseBObsPlaceholder: { en: "Enter any Phase B observations…",          hi: "फेज़ B के अवलोकन यहाँ लिखें…" },
  phaseAObsPlaceholder2:{ en: "Enter Phase A observations…",              hi: "फेज़ A अवलोकन लिखें…" },
  phaseBObsPlaceholder2:{ en: "Enter Phase B observations…",              hi: "फेज़ B अवलोकन लिखें…" },

  // ── Final Collection ─────────────────────────────────────────────────────
  totalScCollectedKg:   { en: "Total SC Collected (kg)",                  hi: "कुल SC संग्रहित (kg)" },
  totalScCollectedL:    { en: "Total SC Collected (Litres)",              hi: "कुल SC संग्रहित (लीटर)" },

  // ── Check Points ─────────────────────────────────────────────────────────
  cpCoolingTower:       { en: "Cooling Tower Pressure",                   hi: "कूलिंग टॉवर दबाव" },
  cpMechSeal:           { en: "Mechanical Seal",                          hi: "मैकेनिकल सील" },
  cpPipes:              { en: "Pipes / Fittings and Leakages",            hi: "पाइप / फिटिंग और रिसाव" },
  cpObsPlaceholder:     { en: "Observation",                              hi: "अवलोकन" },

  // ── Bag Grid ─────────────────────────────────────────────────────────────
  bagWeightTotal:       { en: "Bag weight total:",                        hi: "बैग वज़न कुल:" },
  sulphurAddedConfirmed:{ en: "Sulphur Added (kg) — confirmed total *",   hi: "सल्फर डाला गया (kg) — पुष्टि कुल *" },

  // ── Water TDS / pH ───────────────────────────────────────────────────────
  waterTdsLabel:        { en: "Water TDS",                                hi: "पानी TDS" },
  waterTdsPlaceholder:  { en: "TDS reading",                              hi: "TDS रीडिंग" },
  waterTdsHint:         { en: "Recorded for the WATER ingredient (row 1).", hi: "WATER सामग्री (पंक्ति 1) के लिए दर्ज।" },
  phLabel:              { en: "pH",                                        hi: "pH" },

  // ── Total Lot Weight ─────────────────────────────────────────────────────
  totalLotWeightConfirmed: { en: "Total Lot Weight (kg) — confirmed",     hi: "कुल लॉट वज़न (kg) — पुष्टि" },
  totalLotWtActual:     { en: "TOTAL LOT WT (kg) — confirmed actual",     hi: "कुल लॉट वज़न (kg) — पुष्टि वास्तविक" },

  // ── Buttons ──────────────────────────────────────────────────────────────
  saving:               { en: "Saving…",                                  hi: "सेव हो रहा है…" },
  saveChanges:          { en: "Save Changes",                             hi: "बदलाव सेव करें" },
  submitJobCard:        { en: "Submit Job Card",                          hi: "जॉब कार्ड सबमिट करें" },
  saveAsDraft:          { en: "Save as Draft",                            hi: "ड्राफ्ट के रूप में सेव करें" },
  cancel:               { en: "Cancel",                                   hi: "रद्द करें" },

  // ── Placeholders ─────────────────────────────────────────────────────────
  placeholderName:      { en: "Name",                                     hi: "नाम" },
  placeholderLotNo:     { en: "e.g. LOT-2024-001",                       hi: "जैसे LOT-2024-001" },
  placeholderBatchNo:   { en: "Batch no.",                                hi: "बैच नंबर" },
  placeholderDrumBag:   { en: "Drum/Bag",                                 hi: "ड्रम/बैग" },
  placeholderTds:       { en: "TDS",                                      hi: "TDS" },
  placeholderObs:       { en: "0",                                        hi: "0" },
  placeholderRemark:    { en: "Remark",                                   hi: "टिप्पणी" },
  selectOption:         { en: "— select —",                               hi: "— चुनें —" },

  // ── Loading / Empty states ───────────────────────────────────────────────
  loadingFormula:       { en: "Loading formula…",                         hi: "फॉर्मूला लोड हो रहा है…" },
  loading:              { en: "Loading…",                                  hi: "लोड हो रहा है…" },

  // ── Hint / Helper texts ──────────────────────────────────────────────────
  batchNotChange:       { en: "Batch size cannot be changed when editing.", hi: "संपादन करते समय बैच साइज़ नहीं बदली जा सकती।" },
  batchVariantNotChange:{ en: "Batch variant cannot be changed when editing.", hi: "संपादन करते समय बैच वेरिएंट नहीं बदली जा सकती।" },
  refBatchHint:         { en: "kg · quantities scaled proportionally",    hi: "kg · मात्राएँ अनुपात में बदली गई हैं" },
  refBatchHintTemplate: { en: "Template batch:",                          hi: "टेम्पलेट बैच:" },
  refBatchHintRef:      { en: "Reference batch:",                         hi: "संदर्भ बैच:" },
  sulphurBagHint:       { en: "Enter the weight of each Sulphur bag (1–20). The total auto-fills the", hi: "प्रत्येक सल्फर बैग (1–20) का वज़न दर्ज करें। कुल स्वचालित रूप से" },
  sulphurBagHintBold:   { en: "Sulphur Added (kg)",                       hi: "सल्फर डाला गया (kg)" },
  sulphurBagHintSuffix: { en: "field in the Phase A table above.",        hi: "फेज़ A तालिका में भर जाएगा।" },
  sulphurBagHint2:      { en: "Enter weight of each Sulphur bag. Total is calculated automatically.", hi: "प्रत्येक सल्फर बैग का वज़न दर्ज करें। कुल स्वचालित रूप से गणना होगी।" },
  boricBagHint:         { en: "Enter weight of each bag. Total auto-fills the BORIC ACID Added (kgs) field above.", hi: "प्रत्येक बैग का वज़न दर्ज करें। कुल स्वचालित रूप से BORIC ACID डाला गया (kgs) फ़ील्ड भरेगा।" },
  jsc45BagHint:         { en: "Enter weight of each JSC45 bag. Total auto-fills the JSC45 Added (kg) field above.", hi: "प्रत्येक JSC45 बैग का वज़न दर्ज करें। कुल स्वचालित रूप से JSC45 Added (kg) फ़ील्ड भरेगा।" },
  znoBagHint:           { en: "Enter weight per bag. Total auto-fills the Added (kgs) field in the ZNO row above.", hi: "प्रत्येक बैग का वज़न दर्ज करें। कुल स्वचालित रूप से ZNO पंक्ति में Added (kgs) फ़ील्ड भरेगा।" },
  bagAutoFillBoricAbove:{ en: "↑ Auto-fills BORIC ACID Added (kgs) above", hi: "↑ BORIC ACID Added (kgs) स्वचालित भरेगा" },
  bagAutoFillJsc45Above:{ en: "↑ Auto-fills JSC45 Added (kg) above",      hi: "↑ JSC45 Added (kg) स्वचालित भरेगा" },
  bagAutoFillZnoAbove:  { en: "↑ Auto-fills ZNO Added (kgs) in the table above", hi: "↑ तालिका में ZNO Added (kgs) स्वचालित भरेगा" },
  totalLotWeightHintPrefix: { en: "Calculated from Phase A + Phase B instruction totals:", hi: "फेज़ A + फेज़ B निर्देश कुल से गणना:" },
  totalLotWeightHintSuffix: { en: "(template value — override below if actual differs)", hi: "(टेम्पलेट मान — वास्तविक अलग हो तो नीचे बदलें)" },
  totalLotWeightInstabor:   { en: "(calculated from instruction totals)",  hi: "(निर्देश कुल से गणना)" },
  waterTdsHintFull:     { en: "Recorded for the WATER ingredient (row 1).", hi: "WATER सामग्री (पंक्ति 1) के लिए दर्ज।" },
  noFormulaItems:       { en: "No formula items found.",                   hi: "कोई फॉर्मूला आइटम नहीं मिला।" },
  kgumNoFormulaItems:   { en: "No formula items found. Run migration 016 on the A-20 Supabase project.", hi: "कोई फॉर्मूला आइटम नहीं मिला।" },
  instaborNoFormula:    { en: "No formula items found. Run migration 017 on the A-20 Supabase project.", hi: "कोई फॉर्मूला आइटम नहीं मिला।" },
  instacalNoFormulaPhase: { en: ". Run migration 015 on the A-20 Supabase project.", hi: "।" },
  nutrizinNoFormulaPhase: { en: ". Run migration 014.",                    hi: "।" },
  uplNoPhaseAFormula:   { en: "No Phase A formula items found. Run migration 012 on the A-20 Supabase project.", hi: "फेज़ A के लिए कोई फॉर्मूला आइटम नहीं मिला।" },
  uplNoPhaseBFormula:   { en: "No Phase B formula items found.",           hi: "फेज़ B के लिए कोई फॉर्मूला आइटम नहीं मिला।" },
  sulphurNoPhaseAFormula: { en: "No Phase A formula items found. Run migration 013 on the A-20 Supabase project.", hi: "फेज़ A के लिए कोई फॉर्मूला आइटम नहीं मिला।" },
  sulphurNoPhaseBFormula: { en: "No Phase B formula items found.",         hi: "फेज़ B के लिए कोई फॉर्मूला आइटम नहीं मिला।" },

  // ── Instacal-specific ────────────────────────────────────────────────────
  usesJsc63:            { en: "Uses JSC63 (row 5)",                       hi: "JSC63 (पंक्ति 5) उपयोग होगा" },
  usesJsc64:            { en: "Uses JSC64 (row 5)",                       hi: "JSC64 (पंक्ति 5) उपयोग होगा" },
  usesJsc64Return:      { en: "Uses JSC64 (row 5) · includes RETURN INSTACAL", hi: "JSC64 (पंक्ति 5) · RETURN INSTACAL शामिल" },
  returnInstacalNote:   { en: "← 573 kg only",                            hi: "← केवल 573 kg के लिए" },

  // ── Nutrizin-specific ───────────────────────────────────────────────────
  discrepancyLabel:     { en: "Discrepancy:",                             hi: "विसंगति:" },
  discrepancyText:      { en: "Sum of ingredient values =",               hi: "सामग्री मूल्यों का योग =" },
  discrepancyStated:    { en: "template-stated total =",                  hi: "टेम्पलेट-घोषित कुल =" },
  discrepancyNote:      { en: "Values displayed as provided — do not correct without authorization.", hi: "मान जैसे दिए गए वैसे दर्शाए गए हैं — अधिकृत किए बिना सुधार न करें।" },
  ingredientSum:        { en: "⚠ ingredient sum =",                       hi: "⚠ सामग्री योग =" },

  // ── Bag mismatch warnings ────────────────────────────────────────────────
  mismatchSulphur:      { en: "⚠ Sulphur Added",                          hi: "⚠ सल्फर डाला गया" },
  mismatchSulphurUpl:   { en: "⚠ Sulphur Added",                          hi: "⚠ सल्फर डाला गया" },
  mismatchBoricAcid:    { en: "⚠ BORIC ACID Added",                       hi: "⚠ BORIC ACID डाला गया" },
  mismatchJsc45:        { en: "⚠ JSC45 Added",                            hi: "⚠ JSC45 डाला गया" },
  mismatchZno:          { en: "⚠ ZNO Added",                              hi: "⚠ ZNO डाला गया" },
  mismatchDiffers:      { en: "kg) differs from bag weight total (",      hi: "kg) बैग वज़न कुल (" },
  mismatchDiffers2:     { en: "kg) differs from bag total (",             hi: "kg) बैग कुल (" },
  mismatchReconcile:    { en: "Reconcile before saving.",                  hi: "सेव करने से पहले मिलान करें।" },
  mismatchUplSuffix:    { en: "kg). Please reconcile the values before submitting.", hi: "kg)। सबमिट करने से पहले कृपया मानों का मिलान करें।" },

  // ── Validation messages ──────────────────────────────────────────────────
  valLotRequired:       { en: "Lot number is required.",                  hi: "लॉट नंबर आवश्यक है।" },
  valBatchRequired:     { en: "Batch size is required.",                  hi: "बैच साइज़ आवश्यक है।" },
  valBatchKgRequired:   { en: "Batch size (kg) is required.",             hi: "बैच साइज़ (kg) आवश्यक है।" },
  valJsc3Required:      { en: "Select JSC57 or JSC07 for Unitop FL / SOPROPHORFLR (order 3).", hi: "Unitop FL / SOPROPHORFLR (क्रम 3) के लिए JSC57 या JSC07 चुनें।" },
  valSulphurMismatch:   { en: "Sulphur Added (kg) differs from bag weight total — reconcile before saving.", hi: "सल्फर डाला गया (kg) बैग वज़न कुल से अलग है — सेव करने से पहले मिलान करें।" },
  valSulphurMismatchUpl:{ en: "Sulphur Added (kg) differs from the bag weight total. Confirm or reconcile before submitting.", hi: "सल्फर डाला गया (kg) बैग वज़न कुल से अलग है। सबमिट करने से पहले पुष्टि या मिलान करें।" },
  valBoricMismatch:     { en: "BORIC ACID Added (kg) differs from bag total — reconcile before saving.", hi: "BORIC ACID Added (kg) बैग कुल से अलग है — सेव करने से पहले मिलान करें।" },
  valJsc45Mismatch:     { en: "JSC45 Added (kg) differs from bag weight total — reconcile before saving.", hi: "JSC45 Added (kg) बैग वज़न कुल से अलग है — सेव करने से पहले मिलान करें।" },
  valZno843Mismatch:    { en: "ZNO Added (843 kg) differs from bag total — reconcile before saving.", hi: "ZNO Added (843 kg) बैग कुल से अलग है — सेव करने से पहले मिलान करें।" },
  valZno808Mismatch:    { en: "ZNO Added (808 kg) differs from bag total — reconcile before saving.", hi: "ZNO Added (808 kg) बैग कुल से अलग है — सेव करने से पहले मिलान करें।" },
  valPhNotNumeric:      { en: "pH must be a numeric value.",              hi: "pH एक संख्यात्मक मान होना चाहिए।" },

  // ── Toast / Error messages ───────────────────────────────────────────────
  toastLoadFailed:      { en: "Could not load job card.",                 hi: "जॉब कार्ड लोड नहीं हो सका।" },
  toastLoadFailedEdit:  { en: "Could not load job card for editing.",     hi: "संपादन के लिए जॉब कार्ड लोड नहीं हो सका।" },
  toastUpdateFailed:    { en: "Update failed: ",                          hi: "अपडेट विफल: " },
  toastSaveFailed:      { en: "Could not save: ",                         hi: "सेव नहीं हो सका: " },
  toastItemsFailed:     { en: "Card saved but items failed: ",            hi: "कार्ड सेव हुआ पर आइटम विफल: " },
  toastUpdated:         { en: "Job card updated ✓",                       hi: "जॉब कार्ड अपडेट हुआ ✓" },
  toastSubmitted:       { en: "Submitted ✓",                              hi: "सबमिट हुआ ✓" },
  toastJobSubmitted:    { en: "Job card submitted ✓",                     hi: "जॉब कार्ड सबमिट हुआ ✓" },
  toastDraftSaved:      { en: "Draft saved ✓",                            hi: "ड्राफ्ट सेव हुआ ✓" },
  toastNetworkError:    { en: "Network error: ",                          hi: "नेटवर्क त्रुटि: " },
  toastUnknown:         { en: "unknown",                                  hi: "अज्ञात" },

  // ── Inline small text ────────────────────────────────────────────────────
  scaledProportionally: { en: " kg · quantities scaled proportionally",   hi: " kg · मात्राएँ अनुपात में" },
  seeBagGrid:           { en: "see bag grid ↓",                           hi: "बैग ग्रिड देखें ↓" },
  tdsBelow:             { en: "TDS ↓",                                    hi: "TDS ↓" },
  totalAddedTooltip:    { en: "Total of actual Added quantities",         hi: "वास्तविक Added मात्राओं का कुल" },
} as const;

// ---------------------------------------------------------------------------
// Accessor — returns the string for the given language
// ---------------------------------------------------------------------------
export function jcT(key: keyof typeof T, lang: JobCardLang): string {
  return T[key][lang];
}

// Hook-like helper for use in components
export function makeJcT(lang: JobCardLang) {
  return (key: keyof typeof T) => T[key][lang];
}
