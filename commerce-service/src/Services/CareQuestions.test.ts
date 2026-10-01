import { evaluateCare, openingQuestions, parseAnswers, toCareInput } from "./CareQuestions.js";

const answered = (...pairs: [string, string][]) =>
  parseAnswers(pairs.map(([questionId, answer]) => ({ questionId, answer })));

describe("care questions", () => {
  it("opens with one yes or no question", () => {
    expect(openingQuestions()).toEqual([expect.objectContaining({ id: "delicate", type: "yes_no", options: ["yes", "no"] })]);
  });

  it("ends a normal order after the first answer", () => {
    const result = evaluateCare(answered(["delicate", "no"]), ["cotton"], false);
    expect(result).toMatchObject({ followUps: [], complete: true, offerPhotoAndNote: false, riskClass: "low" });
    expect(result.flags).toEqual({ delicate: false, coldWash: false, handWash: false });
  });

  it("asks for the opening answer when there is none", () => {
    const result = evaluateCare(answered(), [], false);
    expect(result.complete).toBe(false);
    expect(result.followUps.map((q) => q.id)).toEqual(["delicate"]);
  });

  it("asks follow-ups one at a time only after a yes", () => {
    const first = evaluateCare(answered(["delicate", "yes"]), [], false);
    expect(first.followUps.map((q) => q.id)).toEqual(["delicate_kind"]);
    const second = evaluateCare(answered(["delicate", "yes"], ["delicate_kind", "Silk or fine fabric"]), [], false);
    expect(second.followUps.map((q) => q.id)).toEqual(["wash_preference"]);
    const done = evaluateCare(answered(["delicate", "yes"], ["delicate_kind", "Silk or fine fabric"], ["wash_preference", "Hand wash"]), [], false);
    expect(done.complete).toBe(true);
    expect(done.flags).toEqual({ delicate: true, coldWash: true, handWash: true });
    expect(done.riskClass).toBe("high");
    expect(done.offerPhotoAndNote).toBe(true);
  });

  it("ignores follow-up answers when the customer said nothing is delicate", () => {
    const result = evaluateCare(answered(["delicate", "no"], ["delicate_kind", "Leather or suede"]), ["cotton"], false);
    expect(result.flags.delicate).toBe(false);
    expect(result.riskClass).toBe("low");
  });

  it.each([
    [["cotton"], "low"],
    [["cotton", "linen"], "medium"],
    [["denim", "silk"], "high"],
    [["unknown", "synthetic"], "low"],
  ] as const)("rates fabrics %p as %s", (fabrics, expected) => {
    expect(evaluateCare(answered(["delicate", "no"]), [...fabrics], false).riskClass).toBe(expected);
  });

  it("treats a silk or leather item as delicate even if the customer did not say so", () => {
    expect(evaluateCare(answered(["delicate", "no"]), ["leather"], false).flags.delicate).toBe(true);
  });

  it("offers a photo and note for a premium item", () => {
    expect(evaluateCare(answered(["delicate", "no"]), ["cotton"], true).offerPhotoAndNote).toBe(true);
  });

  it("feeds the floor's care profile: risk class, labels, wash advice and the customer's note", () => {
    const evaluation = evaluateCare(answered(["delicate", "yes"], ["delicate_kind", "Wool or cashmere"], ["wash_preference", "Cold wash"]), ["wool"], false);
    expect(toCareInput(evaluation, ["wool", "unknown"], "Handle with care")).toEqual({
      fabric: "wool",
      riskClass: "high",
      flags: ["Delicate", "Cold wash only"],
      customerNote: "Handle with care",
      recommendedWash: "Cold wash 20°C",
    });
  });
});

describe("care answers are selections only", () => {
  it.each([
    ["an unknown question", [{ questionId: "colour", answer: "red" }]],
    ["free text instead of an option", [{ questionId: "delicate", answer: "my sari is very old" }]],
    ["a missing answer", [{ questionId: "delicate" }]],
    ["the same question twice", [{ questionId: "delicate", answer: "yes" }, { questionId: "delicate", answer: "no" }]],
    ["not a list", "yes"],
    ["more than ten answers", Array.from({ length: 11 }, () => ({ questionId: "delicate", answer: "yes" }))],
  ])("rejects %s with 400", (_name, raw) => {
    expect(() => parseAnswers(raw)).toThrow(expect.objectContaining({ errorCode: 400 }));
  });
});
