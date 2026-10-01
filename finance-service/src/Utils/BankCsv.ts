import crypto from "crypto";
import { CustomException } from "../../commons/Exception/CustomException.js";
import { badRequest } from "../../commons/Utils/StatusCode.js";
import { IBankLineInput } from "../Models/Reconciliation/Reconciliation.Interface.js";

export const MAX_STATEMENT_LINES = 2000;

const fail = (message: string): never => {
  throw new CustomException(message, badRequest);
};

/** RFC-4180-style rows: quoted fields may hold commas, quotes ("") and line breaks. */
export const parseCsvRows = (text: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (quoted) fail("The statement has an unterminated quote.");
  row.push(field);
  if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  return rows;
};

// 2026-10-01, 01/10/2026 and 01-10-2026 (day first, as Indian banks print it).
const toIsoDay = (raw: string, line: number): string => {
  const value = raw.trim();
  let iso = value;
  const dayFirst = /^(\d{2})[/-](\d{2})[/-](\d{4})$/.exec(value);
  if (dayFirst) iso = `${dayFirst[3]}-${dayFirst[2]}-${dayFirst[1]}`;
  const date = new Date(`${iso}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso) {
    return fail(`Line ${line}: the date "${value.slice(0, 20)}" is not valid.`);
  }
  return iso;
};

// "1,234.50" -> 123450 paise. Anything with a third decimal or a stray character is refused.
const toPaise = (raw: string, line: number): number => {
  const cleaned = raw.replace(/,/g, "").trim();
  const match = /^(-?)(\d{1,12})(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return fail(`Line ${line}: the amount "${raw.trim().slice(0, 20)}" is not valid.`);
  const paise = Number(match[2]) * 100 + Number((match[3] ?? "").padEnd(2, "0"));
  if (paise > 2_000_000_000) return fail(`Line ${line}: the amount is too large.`);
  return match[1] === "-" ? -paise : paise;
};

/**
 * Reads a bank statement CSV. Needs a header with date, description and either amount (credits
 * positive) or debit and credit columns; reference is optional. All-or-nothing: one bad line
 * rejects the file and says which, so a half-imported statement can never exist.
 */
export const parseBankCsv = (text: string, bank: string | null): IBankLineInput[] => {
  const rows = parseCsvRows(text.replace(/^﻿/, ""));
  const header = rows.shift()?.map((cell) => cell.trim().toLowerCase());
  if (!header) return fail("The statement is empty.");
  const column = (name: string) => (header as string[]).indexOf(name);
  const dateAt = column("date");
  const descriptionAt = column("description");
  const referenceAt = column("reference");
  const amountAt = column("amount");
  const debitAt = column("debit");
  const creditAt = column("credit");
  if (dateAt < 0 || descriptionAt < 0 || (amountAt < 0 && debitAt < 0 && creditAt < 0)) {
    return fail("The statement needs date, description and amount (or debit and credit) columns.");
  }
  if (rows.length === 0) return fail("The statement has no lines.");
  if (rows.length > MAX_STATEMENT_LINES) return fail(`A statement may have at most ${MAX_STATEMENT_LINES} lines.`);

  const seen = new Map<string, number>();
  return rows.map((cells, index) => {
    const line = index + 2;
    const at = (i: number) => (i >= 0 ? (cells[i] ?? "").trim() : "");
    let amountPaise: number;
    if (amountAt >= 0 && at(amountAt) !== "") amountPaise = toPaise(at(amountAt), line);
    else {
      const credit = at(creditAt) === "" ? 0 : toPaise(at(creditAt), line);
      const debit = at(debitAt) === "" ? 0 : toPaise(at(debitAt), line);
      amountPaise = Math.abs(credit) - Math.abs(debit);
    }
    const date = toIsoDay(at(dateAt), line);
    const description = at(descriptionAt).slice(0, 300);
    const reference = at(referenceAt).slice(0, 120) || null;
    // Identical lines on one day are real (two equal deposits), so the n-th repeat gets its own hash.
    const base = [bank ?? "", date, description, reference ?? "", amountPaise].join("|");
    const nth = (seen.get(base) ?? 0) + 1;
    seen.set(base, nth);
    return {
      date,
      description,
      reference,
      amountPaise,
      lineHash: crypto.createHash("sha256").update(`${base}|${nth}`).digest("hex"),
    };
  });
};
