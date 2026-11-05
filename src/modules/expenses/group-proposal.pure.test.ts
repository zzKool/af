// The group a paper's date proposes (review 2026-10-31 §5.2): the covering trip, else the month's group, else nothing
// — never the first of the list (lessons *F124 build*).
import { describe, expect, it } from "vitest";
import { type GroupForProposal, monthOfGroupName, proposeGroupForDate } from "./group-proposal";

const trip: GroupForProposal = {
  id: "trip",
  name: "213 — Switzerland, March 2026",
  kind: "trip",
  departure: "2026-03-02",
  return: "2026-03-21",
};
const july: GroupForProposal = { id: "july", name: "2026-07 card purchases", kind: "batch" };
const first: GroupForProposal = { id: "first", name: "1 — Licences", kind: "batch" };

describe("proposeGroupForDate", () => {
  it("a trip whose departure–return covers the paper's date wins, edges included", () => {
    const groups = [first, july, trip];
    expect(proposeGroupForDate("2026-03-10", groups)).toEqual({ groupId: "trip", reason: "trip" });
    expect(proposeGroupForDate("2026-03-02", groups)).toEqual({ groupId: "trip", reason: "trip" });
    expect(proposeGroupForDate("2026-03-21", groups)).toEqual({ groupId: "trip", reason: "trip" });
    expect(proposeGroupForDate("2026-03-22", groups).reason).not.toBe("trip");
  });

  it("the trip's instants are read to their day; a trip without both dates never counts", () => {
    const stamped = { ...trip, departure: "2026-03-02T08:00:00.000Z", return: "2026-03-21T16:00" };
    expect(proposeGroupForDate("2026-03-15", [stamped])).toEqual({
      groupId: "trip",
      reason: "trip",
    });
    expect(proposeGroupForDate("2026-03-15", [{ ...trip, return: null }])).toEqual({
      groupId: null,
      reason: null,
    });
  });

  it("the trip wins over a month group of the same month; two covering trips → the shorter one", () => {
    const march: GroupForProposal = { id: "march", name: "March 2026", kind: "batch" };
    expect(proposeGroupForDate("2026-03-10", [march, trip]).groupId).toBe("trip");
    const long: GroupForProposal = {
      id: "long",
      name: "Long stay",
      kind: "trip",
      departure: "2026-01-01",
      return: "2026-06-30",
    };
    expect(proposeGroupForDate("2026-03-10", [long, trip]).groupId).toBe("trip");
    expect(proposeGroupForDate("2026-05-10", [long, trip]).groupId).toBe("long");
  });

  it("two covering trips of the same length: the later departure wins (the trip under way), whatever the list order", () => {
    const earlier: GroupForProposal = {
      id: "earlier",
      name: "Berlin",
      kind: "trip",
      departure: "2026-03-01",
      return: "2026-03-10",
    };
    const later: GroupForProposal = {
      id: "later",
      name: "Geneva",
      kind: "trip",
      departure: "2026-03-05",
      return: "2026-03-14",
    };
    expect(proposeGroupForDate("2026-03-08", [earlier, later]).groupId).toBe("later");
    expect(proposeGroupForDate("2026-03-08", [later, earlier]).groupId).toBe("later");
    // before the later one left, only the earlier covers the date
    expect(proposeGroupForDate("2026-03-03", [later, earlier]).groupId).toBe("earlier");
  });

  it("the month fallback is the date's month, the trip's month name never standing in for a receipt outside its days", () => {
    const march: GroupForProposal = { id: "march", name: "2026-03 receipts", kind: "batch" };
    // the day after the return: the trip is over, the month's group takes the receipt
    expect(proposeGroupForDate("2026-03-22", [trip, march])).toEqual({
      groupId: "march",
      reason: "month",
    });
    // a batch group named like a month proposes nothing for another month
    expect(proposeGroupForDate("2026-04-02", [trip, march]).groupId).toBeNull();
  });

  it("no trip: the group whose name (or stored month) is the paper's month — not the first of the list", () => {
    expect(proposeGroupForDate("2026-07-08", [first, july, trip])).toEqual({
      groupId: "july",
      reason: "month",
    });
    const stored: GroupForProposal = { id: "m", name: "Summer", kind: "batch", month: "2026-07" };
    expect(proposeGroupForDate("2026-07-08", [first, stored]).groupId).toBe("m");
    // a trip group never stands for a month, whatever its name says
    const tripNamedMonth = { ...trip, name: "July 2026 trip", departure: null, return: null };
    expect(proposeGroupForDate("2026-07-08", [tripNamedMonth]).groupId).toBeNull();
  });

  it("nothing fits → null, and the caller offers + New group; a date that is not a day proposes nothing", () => {
    expect(proposeGroupForDate("2026-09-01", [first, july, trip])).toEqual({
      groupId: null,
      reason: null,
    });
    expect(proposeGroupForDate("", [first])).toEqual({ groupId: null, reason: null });
    expect(proposeGroupForDate("2026-07-08", [])).toEqual({ groupId: null, reason: null });
  });
});

describe("monthOfGroupName", () => {
  it("reads an ISO month anywhere in the name, and an English month name with its year", () => {
    expect(monthOfGroupName("2026-07 card purchases")).toBe("2026-07");
    expect(monthOfGroupName("Receipts 2026-11")).toBe("2026-11");
    expect(monthOfGroupName("July 2026")).toBe("2026-07");
    expect(monthOfGroupName("Sep. 2026 expenses")).toBe("2026-09");
    expect(monthOfGroupName("Switzerland, March 2026")).toBe("2026-03");
  });

  it("a group number, a year alone or an impossible month is not a month", () => {
    expect(monthOfGroupName("213 — Switzerland")).toBeNull();
    expect(monthOfGroupName("2026-13 nonsense")).toBeNull();
    expect(monthOfGroupName("Budget 2026")).toBeNull();
    expect(monthOfGroupName("Licences")).toBeNull();
  });
});
