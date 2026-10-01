import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { Page, PageRequest, toPage } from "../../commons/Utils/Pagination.js";
import { requireFields } from "../../commons/Utils/Validation.js";
import { badRequest, conflict, notFound } from "../../commons/Utils/StatusCode.js";
import { CommerceClient } from "../Clients/Commerce.Client.js";
import { Actor } from "../Middleware/StoreScope.js";
import { GstStatus, IGstFigures, IGstLine, IGstReport } from "../Models/Gst/Gst.Interface.js";
import { RefundQuery } from "../Queries/Refund.Query.js";
import { GstQuery } from "../Queries/Gst.Query.js";
import { isUniqueViolation } from "../Queries/DatabaseError.js";
import { TransactionQuery } from "../Queries/Transaction.Query.js";
import { clock, istDayEnd, istDayStart, istToday, monthEnd, monthOf, monthStart, parseMonth } from "../Utils/Dates.js";
import { optionalOneOf, optionalText, parseBody, pathId, queryEnum, queryString, queryWholeNumber, isUuid } from "../Utils/Input.js";
import { mulDivHalfUp, toRupees } from "../Utils/Money.js";

const STATUSES: readonly GstStatus[] = ["draft", "ready", "filed"];
const RANK: Record<GstStatus, number> = { draft: 0, ready: 1, filed: 2 };
const MAX_STORE_FILTER = 100;
const DEFAULT_RATE_BPS = 1800;

// GST on laundry services is one rate, set by GST_RATE_BPS (basis points: 1800 is 18%). The rate
// used is stored on each report so a later change never rewrites a month already generated.
export const gstRateBps = (): number => {
  const raw = process.env.GST_RATE_BPS;
  if (raw === undefined || raw === "") return DEFAULT_RATE_BPS;
  const rate = Number(raw);
  if (!Number.isInteger(rate) || rate < 0 || rate > 4000) {
    console.error("[gst] GST_RATE_BPS must be a whole number of basis points from 0 to 4000.");
    throw new CustomException("GST reports are unavailable right now. Please try again.", 503);
  }
  return rate;
};

/**
 * Splits a GST-inclusive amount into taxable value and tax. Order amounts already include GST,
 * so taxable = amount / (1 + rate), rounded half up to whole paise; tax is the remainder, so
 * the two always add back to the amount exactly. A negative net (refunds above sales) is the
 * same split mirrored, which is a credit note reducing the month's tax.
 */
export const splitInclusive = (netPaise: number, rateBps: number): { taxablePaise: number; taxPaise: number } => {
  const sign = netPaise < 0 ? -1 : 1;
  const magnitude = Math.abs(netPaise);
  const taxable = mulDivHalfUp(magnitude, 10_000, 10_000 + rateBps);
  return { taxablePaise: sign * taxable, taxPaise: sign * (magnitude - taxable) };
};

// Intra-state supply: the tax is shared equally between CGST and SGST, the odd paisa going to SGST.
const splitTax = (taxPaise: number) => {
  const cgst = Math.trunc(taxPaise / 2);
  return { cgstPaise: cgst, sgstPaise: taxPaise - cgst };
};

const lineOf = (storeId: string | null, orders: number, grossPaise: number, refundsPaise: number, rateBps: number): IGstLine => {
  const { taxablePaise, taxPaise } = splitInclusive(grossPaise - refundsPaise, rateBps);
  return { storeId, orders, grossPaise, refundsPaise, taxablePaise, taxPaise, ...splitTax(taxPaise) };
};

const sum = (lines: IGstLine[], pick: (line: IGstLine) => number) => lines.reduce((total, line) => total + pick(line), 0);

/** The month's figures from commerce's order summary and our confirmed refunds. */
export const computeFigures = async (month: string, storeIds: string[], rateBps: number): Promise<IGstFigures> => {
  const from = monthStart(month);
  const to = monthEnd(month);
  const [summary, refunds] = await Promise.all([
    CommerceClient.getOrderSummary({ from, to }),
    RefundQuery.sumProcessedByStore(istDayStart(from), istDayEnd(to)),
  ]);

  const wanted = storeIds.length > 0 ? new Set(storeIds) : null;
  const byStore = new Map<string | null, { orders: number; gross: number; refunds: number }>();
  const slot = (storeId: string | null) => {
    const found = byStore.get(storeId) ?? { orders: 0, gross: 0, refunds: 0 };
    byStore.set(storeId, found);
    return found;
  };
  for (const row of summary.byStore) {
    if (wanted && !wanted.has(row.storeId.toLowerCase())) continue;
    const entry = slot(row.storeId.toLowerCase());
    entry.orders += row.orders;
    entry.gross += row.revenuePaise;
  }
  for (const row of refunds) {
    // Refunds of an unknown store are company-wide; a store filter leaves them out.
    if (wanted && (row.storeId === null || !wanted.has(row.storeId))) continue;
    slot(row.storeId).refunds += row.amountPaise;
  }

  const lines = [...byStore.entries()]
    .sort(([a], [b]) => String(a).localeCompare(String(b)))
    .map(([storeId, v]) => lineOf(storeId, v.orders, v.gross, v.refunds, rateBps));
  return {
    rateBps,
    grossPaise: sum(lines, (l) => l.grossPaise),
    refundsPaise: sum(lines, (l) => l.refundsPaise),
    taxablePaise: sum(lines, (l) => l.taxablePaise),
    taxPaise: sum(lines, (l) => l.taxPaise),
    cgstPaise: sum(lines, (l) => l.cgstPaise),
    sgstPaise: sum(lines, (l) => l.sgstPaise),
    orderCount: sum(lines, (l) => l.orders),
    storeIds,
    lines,
  };
};

const toLine = (line: IGstLine) => ({
  storeId: line.storeId,
  orders: line.orders,
  gross: toRupees(line.grossPaise),
  refunds: toRupees(line.refundsPaise),
  taxable: toRupees(line.taxablePaise),
  tax: toRupees(line.taxPaise),
  cgst: toRupees(line.cgstPaise),
  sgst: toRupees(line.sgstPaise),
});

const toListItem = (report: IGstReport) => ({
  id: report.id,
  month: report.month,
  status: report.status,
  taxable: toRupees(report.taxablePaise),
  tax: toRupees(report.taxPaise),
});

const toReport = (report: IGstReport) => ({
  ...toListItem(report),
  gross: toRupees(report.grossPaise),
  refunds: toRupees(report.refundsPaise),
  cgst: toRupees(report.cgstPaise),
  sgst: toRupees(report.sgstPaise),
  rateBps: report.rateBps,
  orderCount: report.orderCount,
  storeIds: report.storeIds,
  stores: report.lines.map(toLine),
  generatedAt: report.generatedAt,
  filedAt: report.filedAt,
  acknowledgement: report.acknowledgement,
});

const listReports = async (query: Record<string, unknown>, page: PageRequest): Promise<Page<ReturnType<typeof toListItem>>> => {
  try {
    const year = queryWholeNumber(query.year, "year", 2000, 2100);
    const { items, total } = await GstQuery.search(year === undefined ? undefined : String(year), page);
    return toPage(items.map(toListItem), total, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

const notFoundReport = () => new CustomException("GST report not found.", notFound);

const getReport = async (rawId: string) => {
  try {
    const report = await GstQuery.findById(pathId(rawId, "GST report"));
    if (!report) throw notFoundReport();
    return toReport(report);
  } catch (error) {
    throw toCustomException(error);
  }
};

const readStoreIds = (value: unknown): string[] => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_STORE_FILTER || !value.every(isUuid)) {
    throw new CustomException(`storeIds must be a list of at most ${MAX_STORE_FILTER} valid ids.`, badRequest);
  }
  return [...new Set(value.map((id) => id.toLowerCase()))].sort();
};

/**
 * Generates (or refreshes) the report for a month, and moves it through draft -> ready -> filed.
 * One row per month. Generating again before filing recomputes from current figures; filing
 * freezes the reviewed figures (no recompute) and nothing can change a filed report.
 */
const generateReport = async (input: unknown, actor: Actor) => {
  try {
    const body = parseBody(input);
    requireFields(body, ["month"]);
    const month = parseMonth(body.month, "month");
    const storeIds = readStoreIds(body.storeIds);
    const target = optionalOneOf(body.targetStatus, STATUSES, "targetStatus") ?? "draft";
    const acknowledgement = optionalText(body.acknowledgement, "acknowledgement", 64) ?? null;
    const thisMonth = monthOf(istToday(clock.now()));
    if (month > thisMonth) throw new CustomException("A GST report cannot be generated for a future month.", badRequest);
    if (target === "filed") {
      if (!acknowledgement) throw new CustomException("acknowledgement is required to file a report.", badRequest);
      if (month >= thisMonth) throw new CustomException("A month cannot be filed before it has ended.", conflict);
    }

    const existing = await GstQuery.findByMonth(month);
    if (existing?.status === "filed") {
      if (target === "filed" && existing.acknowledgement === acknowledgement) return toReport(existing);
      throw new CustomException("This month has been filed and can no longer be changed.", conflict);
    }
    if (existing && RANK[target] < RANK[existing.status]) {
      throw new CustomException(`A ${existing.status} report cannot go back to ${target}.`, conflict);
    }
    if (target === "filed" && existing?.status !== "ready") {
      throw new CustomException("A report must be ready before it is filed.", conflict);
    }

    // Filing keeps the figures that were reviewed; every other path recomputes them.
    const figures = target === "filed" && existing ? existing : await computeFigures(month, storeIds, gstRateBps());
    const now = new Date();
    const meta = {
      status: target,
      generatedByUserId: target === "filed" && existing ? existing.generatedByUserId : actor.id,
      generatedAt: target === "filed" && existing ? existing.generatedAt : now,
      acknowledgement: target === "filed" ? acknowledgement : null,
      filedByUserId: target === "filed" ? actor.id : null,
      filedAt: target === "filed" ? now : null,
    };
    const toFigures: IGstFigures = {
      rateBps: figures.rateBps,
      grossPaise: figures.grossPaise,
      refundsPaise: figures.refundsPaise,
      taxablePaise: figures.taxablePaise,
      taxPaise: figures.taxPaise,
      cgstPaise: figures.cgstPaise,
      sgstPaise: figures.sgstPaise,
      orderCount: figures.orderCount,
      storeIds: figures.storeIds,
      lines: figures.lines,
    };

    const saved = await TransactionQuery.run(async (tx) => {
      const locked = await GstQuery.lockByMonth(month, tx);
      if (!locked) {
        try {
          if (!(await GstQuery.create({ month, ...meta, ...toFigures }, tx))) {
            throw new CustomException("This month is being generated by someone else. Try again.", conflict);
          }
        } catch (error) {
          if (isUniqueViolation(error)) throw new CustomException("This month is being generated by someone else. Try again.", conflict);
          throw error;
        }
      } else if (!(await GstQuery.replaceUnfiled(locked.id, { ...meta, ...toFigures }, tx))) {
        throw new CustomException("This month has been filed and can no longer be changed.", conflict);
      }
      return (await GstQuery.findByMonth(month, tx)) as IGstReport;
    });
    return toReport(saved);
  } catch (error) {
    throw toCustomException(error);
  }
};

const money = (paise: number) => toRupees(paise).toFixed(2);

const exportReport = async (rawId: string, query: Record<string, unknown>) => {
  try {
    const report = await GstQuery.findById(pathId(rawId, "GST report"));
    if (!report) throw notFoundReport();
    const format = queryEnum(queryString(query.format, "format") ?? "json", ["csv", "xlsx", "json"] as const, "format");
    if (format === "xlsx") {
      throw new CustomException("Excel export is not available. Use csv or json.", badRequest);
    }
    const fileName = `gst-${report.month}`;
    if (format === "json") {
      return { contentType: "application/json; charset=utf-8", fileName: `${fileName}.json`, body: JSON.stringify(toReport(report), null, 2) };
    }
    const header = "store_id,orders,gross,refunds,taxable_value,tax,cgst,sgst";
    const rows = [...report.lines, { ...sumLine(report.lines), storeId: "TOTAL" }].map((line) =>
      [
        line.storeId ?? "unassigned",
        line.orders,
        money(line.grossPaise),
        money(line.refundsPaise),
        money(line.taxablePaise),
        money(line.taxPaise),
        money(line.cgstPaise),
        money(line.sgstPaise),
      ].join(",")
    );
    const preface = [`month,${report.month}`, `status,${report.status}`, `rate_bps,${report.rateBps}`];
    return { contentType: "text/csv; charset=utf-8", fileName: `${fileName}.csv`, body: [...preface, header, ...rows].join("\n") + "\n" };
  } catch (error) {
    throw toCustomException(error);
  }
};

const sumLine = (lines: IGstLine[]): IGstLine => ({
  storeId: null,
  orders: sum(lines, (l) => l.orders),
  grossPaise: sum(lines, (l) => l.grossPaise),
  refundsPaise: sum(lines, (l) => l.refundsPaise),
  taxablePaise: sum(lines, (l) => l.taxablePaise),
  taxPaise: sum(lines, (l) => l.taxPaise),
  cgstPaise: sum(lines, (l) => l.cgstPaise),
  sgstPaise: sum(lines, (l) => l.sgstPaise),
});

export const GstService = { listReports, getReport, generateReport, exportReport };
