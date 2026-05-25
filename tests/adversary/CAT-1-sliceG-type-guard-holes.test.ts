/**
 * Adversary test — type guard holes in isPlateNotFoundWithInterpretations
 * and extractStateFromUserText state extraction edge cases.
 *
 * Findings:
 * 1. isPlateNotFoundWithInterpretations accepts arrays of strings as valid
 *    interpretations, passing the guard but crashing PlateInterpretationsWidget
 *    (which calls candidate.vehicle.year, etc. on a string).
 * 2. extractStateFromUserText returns wrong state codes for common English
 *    phrases like "in the morning" -> "TH", "in trouble" -> "TR", "in love" -> "LO".
 *    Any user message containing "in <word>" that is not a state code gets the
 *    first two letters of that word silently sent as the state code to the lookup.
 */
import { describe, expect, it } from "vitest";

// Import the REAL functions under test rather than inlining copies.
// Inlined copies drift from the implementation the moment the
// implementation gets fixed — which is precisely the failure mode this
// file went through on commit c1d2da5. The functions are exported from
// ChatbotShell.tsx specifically to make this kind of adversarial test
// possible.
import {
  isPlateNotFoundWithInterpretations,
  extractStateFromUserText,
} from "../../src/components/ChatbotShell.tsx";

describe("isPlateNotFoundWithInterpretations — type guard holes", () => {
  it("correctly rejects missing interpretations field", () => {
    expect(
      isPlateNotFoundWithInterpretations({
        kind: "not_found",
        origin: "plate",
        originalPlate: "ABC123",
      }),
    ).toBe(false);
  });

  it("correctly rejects null interpretations", () => {
    expect(
      isPlateNotFoundWithInterpretations({
        kind: "not_found",
        origin: "plate",
        originalPlate: "ABC123",
        interpretations: null,
      }),
    ).toBe(false);
  });

  it("correctly rejects string interpretations", () => {
    expect(
      isPlateNotFoundWithInterpretations({
        kind: "not_found",
        origin: "plate",
        originalPlate: "ABC123",
        interpretations: "oops",
      }),
    ).toBe(false);
  });

  it(
    "BLOCKER — accepts array-of-strings as valid interpretations, " +
      "which crashes PlateInterpretationsWidget when rendered (candidate.vehicle is undefined on a string)",
    () => {
      // isPlateNotFoundWithInterpretations only checks Array.isArray().
      // An array of strings passes the guard. PlateInterpretationsWidget then does:
      //   candidate.vehicle -> undefined (string has no .vehicle)
      //   v.trim -> TypeError
      //   v.year, v.make, v.model -> TypeError
      // The widget crashes with a React render error rather than falling through
      // to the generic raw-payload card.
      //
      // This test asserts the guard SHOULD reject the array-of-strings case.
      // It currently FAILS because the guard incorrectly returns true.
      expect(
        isPlateNotFoundWithInterpretations({
          kind: "not_found",
          origin: "plate",
          originalPlate: "ABC123",
          interpretations: ["string1", "string2"],
        }),
      ).toBe(false); // FAILS: guard returns true, but strings crash the widget
    },
  );

  it(
    "BLOCKER — accepts candidate objects with null vehicle, " +
      "which crashes CandidateCard when rendered (v.year on null)",
    () => {
      // candidate.vehicle is checked in CandidateCard as:
      //   const v = candidate.vehicle;
      //   const trim = v.trim !== undefined ...
      // If vehicle is null, this is 'null.trim' -> TypeError crash.
      expect(
        isPlateNotFoundWithInterpretations({
          kind: "not_found",
          origin: "plate",
          originalPlate: "ABC123",
          interpretations: [
            {
              kind: "resolved_alternative",
              plate: "ABC124",
              vehicle: null,  // null vehicle crashes CandidateCard
              viaVendor: "stub",
              editCount: 1,
              swaps: [{ index: 5, fromChar: "3", toChar: "4" }],
            },
          ],
        }),
      ).toBe(false); // FAILS: guard returns true, but null vehicle crashes the widget
    },
  );
});

describe("extractStateFromUserText — false-positive state extraction", () => {
  it("returns empty string when no 'in X' phrase present", () => {
    expect(extractStateFromUserText("my plate is XRJ4041")).toBe("");
  });

  it("correctly extracts NY from 'my plate in NY'", () => {
    expect(extractStateFromUserText("my plate in NY")).toBe("NY");
  });

  it(
    "BLOCKER — 'in the morning' returns 'TH' (first two chars of 'the'), " +
      "silently sending an invalid state code to the lookup",
    () => {
      // The regex /\bin\s+([A-Za-z]{2,})\b/ matches 'in the' and extracts 'the'.
      // Slicing to 2 and uppercasing gives 'TH', which is NOT a valid US state.
      // The widget sends 'TH' as the state when the user previously wrote
      // a message like "I'll check in the morning" or "drop in the mail".
      // Expected: should return '' (no valid state found)
      // Actual: returns 'TH'
      expect(extractStateFromUserText("I'll check in the morning")).toBe("");
    },
  );

  it(
    "BLOCKER — 'in trouble' returns 'TR', silently sending invalid state to lookup",
    () => {
      expect(extractStateFromUserText("my car is in trouble")).toBe("");
    },
  );

  it(
    "BLOCKER — 'in love' returns 'LO', silently sending invalid state to lookup",
    () => {
      expect(extractStateFromUserText("I am in love with this car")).toBe("");
    },
  );

  it(
    "CONCERNING — full state name 'Texas' returns 'TE', not 'TX'",
    () => {
      // The comment says 'the widget validates length=2 before submitting'
      // but 'TE' IS length 2 (first two chars of 'Texas'), so validation passes.
      // The lookup then runs with state='TE', which is not a valid US state code.
      // The server returns format_error, and the user sees a confusing failure.
      expect(extractStateFromUserText("my plate is XRJ4041 in Texas")).toBe("TX");
    },
  );
});
