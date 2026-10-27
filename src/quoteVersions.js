// Quote Stage (Q1 / Q2 / Q3) and Version (V1, V2, V3 ...).
//
// A saved quote's stage is stored as "<stage>-V<n>" (e.g. "Q1-V2"), so every
// save of a job/item is its own record and the database's one-row-per
// Job/Item/Stage rule keeps working. A quote saved before versions existed is
// stored as plain "Q1" -- that counts as version 1 of Q1, so the next one
// offered is V2.
export const QUOTE_STAGES = ["Q1", "Q2", "Q3"];

export const stageLabel = (stage, version) => `${stage || "Q1"}-V${version || 1}`;

/** The version a stored stage string is for the given stage; 0 when it belongs to another stage / is not a Q-stage. */
export function versionOfStage(stored, stage) {
  const m = /^\s*(Q\d+)(?:\s*[- ]?\s*V(\d+))?\s*$/i.exec(String(stored || ""));
  if (!m || m[1].toUpperCase() !== String(stage || "").toUpperCase()) return 0;
  return m[2] ? parseInt(m[2], 10) : 1;
}

/** Highest version already saved for this stage (0 = none). */
export const highestVersion = (storedStages, stage) =>
  (storedStages || []).reduce((mx, s) => Math.max(mx, versionOfStage(s, stage)), 0);

/** "Q1-V2" / "Q1 V2" / "Q1" -> "Q1" (the stage part only). */
export const stageOnly = (stored) => {
  const m = /^\s*(Q\d+)/i.exec(String(stored || ""));
  return m ? m[1].toUpperCase() : String(stored || "").trim() || "Q1";
};
