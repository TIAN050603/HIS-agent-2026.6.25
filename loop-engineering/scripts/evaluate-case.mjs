import { firstFailedAssertion } from "./loop-lib.mjs";

export function evaluateCaseResult(caseDef, rawResult) {
  const assertions = rawResult.assertions || [];
  const firstFailure = firstFailedAssertion(assertions);
  const status = rawResult.status === "skipped"
    ? "skipped"
    : firstFailure
      ? "failed"
      : "passed";
  return {
    ...rawResult,
    status,
    first_failure: firstFailure ? {
      case_id: caseDef.case_id,
      expected: firstFailure.expected,
      actual: firstFailure.actual,
      event: firstFailure.name,
      evidence: firstFailure.evidence || "",
      recommended_fix_layer: rawResult.recommended_fix_layer || "evaluator_detected_contract_gap"
    } : null
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log("evaluate-case.mjs exports evaluateCaseResult(); use run-case or run-loop to execute cases.");
}
