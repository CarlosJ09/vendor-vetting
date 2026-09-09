import { describe, expect, it } from "vitest";

import {
  addDays,
  compareDates,
  daysBetween,
  formatDominicanDate,
  formatLongSpanishDate,
  parseDominicanDate,
  toPlainDate,
} from "./dates";

describe("parseDominicanDate", () => {
  it("parses the DD/MM/YYYY convention used locally", () => {
    expect(parseDominicanDate("15/03/2024")).toBe("2024-03-15");
  });

  it("reads day-first, not month-first", () => {
    // The discriminating case: 03/04 is 3 April, never 4 March.
    expect(parseDominicanDate("03/04/2024")).toBe("2024-04-03");
  });

  it("accepts - and . as separators", () => {
    expect(parseDominicanDate("15-03-2024")).toBe("2024-03-15");
    expect(parseDominicanDate("15.03.2024")).toBe("2024-03-15");
  });

  it("accepts unpadded day and month", () => {
    expect(parseDominicanDate("5/3/2024")).toBe("2024-03-05");
  });

  it("parses the Spanish long form printed on certifications", () => {
    expect(parseDominicanDate("15 de marzo de 2024")).toBe("2024-03-15");
    expect(parseDominicanDate("1 de enero de 2025")).toBe("2025-01-01");
    expect(parseDominicanDate("30 de diciembre de 2023")).toBe("2023-12-30");
  });

  it("handles accented and capitalised long-form months", () => {
    expect(parseDominicanDate("15 DE MARZO DE 2024")).toBe("2024-03-15");
    expect(parseDominicanDate("2 de Agosto de 2024")).toBe("2024-08-02");
  });

  it("rejects dates that do not exist", () => {
    expect(parseDominicanDate("31/02/2024")).toBeNull();
    expect(parseDominicanDate("30/02/2024")).toBeNull();
    expect(parseDominicanDate("32/01/2024")).toBeNull();
    expect(parseDominicanDate("15/13/2024")).toBeNull();
  });

  it("accepts 29 February only in a leap year", () => {
    expect(parseDominicanDate("29/02/2024")).toBe("2024-02-29");
    expect(parseDominicanDate("29/02/2023")).toBeNull();
  });

  it("rejects unparseable input", () => {
    expect(parseDominicanDate("")).toBeNull();
    expect(parseDominicanDate("no consta")).toBeNull();
    expect(parseDominicanDate("15/03")).toBeNull();
    expect(parseDominicanDate("2024-03-15")).toBeNull();
  });
});

describe("toPlainDate", () => {
  it("formats a UTC date as YYYY-MM-DD", () => {
    expect(toPlainDate(new Date(Date.UTC(2024, 2, 15)))).toBe("2024-03-15");
  });
});

describe("addDays", () => {
  it("adds within a month", () => {
    expect(addDays("2024-03-15", 10)).toBe("2024-03-25");
  });

  it("rolls over a month boundary", () => {
    expect(addDays("2024-03-25", 10)).toBe("2024-04-04");
  });

  it("rolls over a year boundary", () => {
    expect(addDays("2024-12-28", 5)).toBe("2025-01-02");
  });

  it("crosses 29 February in a leap year", () => {
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2023-02-28", 1)).toBe("2023-03-01");
  });

  it("subtracts with a negative offset", () => {
    expect(addDays("2024-03-01", -1)).toBe("2024-02-29");
  });
});

describe("daysBetween", () => {
  it("counts forward days", () => {
    expect(daysBetween("2024-03-15", "2024-03-25")).toBe(10);
  });

  it("returns a negative count when the target precedes the origin", () => {
    expect(daysBetween("2024-03-25", "2024-03-15")).toBe(-10);
  });

  it("is zero for the same day", () => {
    expect(daysBetween("2024-03-15", "2024-03-15")).toBe(0);
  });

  it("is unaffected by daylight-saving style offsets", () => {
    // Counted in whole UTC days, so no 23/25-hour day can round the result off.
    expect(daysBetween("2024-01-01", "2025-01-01")).toBe(366);
  });
});

describe("formatting", () => {
  it("renders the numeric convention with padding", () => {
    expect(formatDominicanDate("2024-03-05")).toBe("05/03/2024");
  });

  it("renders the long Spanish form without padding", () => {
    expect(formatLongSpanishDate("2024-03-05")).toBe("5 de marzo de 2024");
    expect(formatLongSpanishDate("2025-01-01")).toBe("1 de enero de 2025");
  });

  it("round-trips through both formats", () => {
    // The generator prints dates and the extractor parses them back, so a
    // format the parser cannot read would poison the whole corpus.
    let date = "2023-01-01";
    for (let i = 0; i < 400; i++) {
      expect(parseDominicanDate(formatDominicanDate(date))).toBe(date);
      expect(parseDominicanDate(formatLongSpanishDate(date))).toBe(date);
      date = addDays(date, 3);
    }
  });
});

describe("compareDates", () => {
  it("orders chronologically", () => {
    expect(compareDates("2024-03-15", "2024-03-16")).toBeLessThan(0);
    expect(compareDates("2024-03-16", "2024-03-15")).toBeGreaterThan(0);
    expect(compareDates("2024-03-15", "2024-03-15")).toBe(0);
  });

  it("sorts a list correctly as a comparator", () => {
    const sorted = ["2024-12-01", "2023-01-15", "2024-02-29"].sort(compareDates);
    expect(sorted).toEqual(["2023-01-15", "2024-02-29", "2024-12-01"]);
  });
});
