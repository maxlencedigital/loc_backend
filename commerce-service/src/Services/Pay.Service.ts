import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { parsePage, toPage } from "../../commons/Utils/Pagination.js";
import { badRequest, conflict, notFound } from "../../commons/Utils/StatusCode.js";
import type { RequestUser } from "../Middleware/Identity.js";
import type { StoreScope } from "../Middleware/StoreScope.js";
import { IEmployeeRef } from "../Models/Hr/Employee.Interface.js";
import {
  EARNING_STATUSES,
  ICompensation,
  IEarning,
  IIncentiveRule,
  IIncentiveScheme,
  IPayout,
  INCENTIVE_APPLIES_TO,
  INCENTIVE_METRICS,
  INCENTIVE_PERIODS,
  IncentivePeriod,
  PAY_CYCLES,
  PAYOUT_TYPES,
} from "../Models/Hr/Pay.Interface.js";
import { AttendanceQuery } from "../Queries/Attendance.Query.js";
import { isUniqueViolation } from "../Queries/DatabaseError.js";
import { EmployeeQuery } from "../Queries/Employee.Query.js";
import { Db, inHrTransaction } from "../Queries/Hr.Transaction.js";
import { PayQuery } from "../Queries/Pay.Query.js";
import { addDays, businessToday, clock, formatDate, minDate, parseDate, parseMonth, parseOptionalDate } from "../Utils/HrDate.js";
import { nullableText, parseBoolean, parseUuid, parseUuidList } from "../Utils/HrInput.js";
import { oneOf, optionalOneOf, parseBody, queryString, text } from "../Utils/Input.js";
import { fromMilli, parseMilli, parsePaise, requireSomething } from "../Utils/PeopleInput.js";
import { toRupees } from "../Utils/Money.js";
import { isUuid } from "../Utils/Uuid.js";
import { AttendanceService } from "./Attendance.Service.js";
import { assertEmployeeInScope } from "./EmployeeAccess.js";
import { actorName } from "./HrActor.js";
import { DayStatus, PayTerms, calculateMonthPay, earningsCoveredBy, payDaysOf, periodRangeOf, rewardFor } from "./PayCalc.js";
import { directoryOf, employeeIdsInScope, requireEmployees } from "./PeopleScope.js";

const MAX_BASE_PAISE = 500_000_000;
const MAX_REWARD_PAISE = 100_000_000;
const MAX_PAYOUT_PAISE = 1_000_000_000;
const MAX_THRESHOLD = 2_000_000;
const MAX_ALLOWANCES = 20;
const MAX_RULES = 10;
const MAX_ASSIGN_PEOPLE = 100;
const MAX_METRICS_PER_CALL = 200;
const MAX_AHEAD_DAYS = 366;
const HISTORY_SHOWN = 20;

const SCHEME_NOT_FOUND = "Incentive scheme not found.";
const EARNING_NOT_FOUND = "Incentive earning not found.";

const rupees = (paise: number) => toRupees(paise);

// ------------------------------------------------------------ compensation

const allowancesView = (allowances: Record<string, number>) =>
  Object.fromEntries(Object.entries(allowances).map(([name, paise]) => [name, rupees(paise)]));

const toCompensationView = (c: ICompensation) => ({
  baseSalary: rupees(c.baseSalaryPaise),
  payCycle: c.payCycle,
  allowances: allowancesView(c.allowances),
  bonusEligible: c.bonusEligible,
  effectiveFrom: formatDate(c.effectiveFrom),
});

const parseAllowances = (value: unknown): Record<string, number> => {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw new CustomException("allowances must be an object of name and amount.", badRequest);
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_ALLOWANCES) throw new CustomException(`allowances can have at most ${MAX_ALLOWANCES} entries.`, badRequest);
  return Object.fromEntries(entries.map(([name, amount]) => [text(name, "allowance name", 40), parsePaise(amount, `allowance ${name}`, MAX_BASE_PAISE)]));
};

const inForce = (versionsNewestFirst: ICompensation[], today: Date) => versionsNewestFirst.find((v) => v.effectiveFrom <= today) ?? null;

// `justSet` lets the answer to a change show terms that only start in the future.
const getCompensationFor = async (employeeId: string, justSet = false) => {
  const versions = await PayQuery.listCompensation(employeeId);
  const today = businessToday();
  const current = inForce(versions, today) ?? (justSet ? versions[versions.length - 1] : null);
  if (!current) throw new CustomException("No pay terms are in force for this person.", notFound);
  const upcoming = versions.filter((v) => v.effectiveFrom > today && v !== current).pop();
  return {
    ...toCompensationView(current),
    ...(upcoming ? { upcoming: toCompensationView(upcoming) } : {}),
    history: versions.slice(0, HISTORY_SHOWN).map(toCompensationView),
  };
};

const getCompensation = async (id: string, scope: StoreScope) => {
  try {
    const employee = await assertEmployeeInScope(id, scope);
    return await getCompensationFor(employee.id);
  } catch (error) {
    throw toCustomException(error);
  }
};

const setCompensation = async (user: RequestUser, id: string, scope: StoreScope, body: unknown) => {
  try {
    const input = parseBody(body);
    const baseSalaryPaise = parsePaise(input.baseSalary, "baseSalary", MAX_BASE_PAISE, true);
    const payCycle = input.payCycle === undefined ? "monthly" : oneOf(input.payCycle, PAY_CYCLES, "payCycle");
    const allowances = parseAllowances(input.allowances);
    const bonusEligible = input.bonusEligible === undefined ? false : parseBoolean(input.bonusEligible, "bonusEligible");
    const effectiveFrom = parseDate(input.effectiveFrom, "effectiveFrom");
    const employee = await assertEmployeeInScope(id, scope);
    if (employee.status === "exited") throw new CustomException("Pay terms cannot be set for someone who has left.", conflict);
    if (effectiveFrom < employee.joinDate) throw new CustomException("effectiveFrom cannot be before the person joined.", badRequest);
    if (effectiveFrom > addDays(businessToday(), MAX_AHEAD_DAYS)) throw new CustomException(`effectiveFrom can be at most ${MAX_AHEAD_DAYS} days ahead.`, badRequest);
    await inHrTransaction(async (tx) => {
      // The employee row lock serialises two changes to one person's terms.
      if (!(await EmployeeQuery.lockById(employee.id, scope, tx))) throw new CustomException("Employee not found.", notFound);
      const latest = await PayQuery.latestCompensation(employee.id, tx);
      if (latest && effectiveFrom <= latest.effectiveFrom) {
        throw new CustomException("effectiveFrom must be after the latest pay terms, which are never rewritten.", conflict);
      }
      await PayQuery.createCompensation(
        { employeeId: employee.id, baseSalaryPaise, payCycle, allowances, bonusEligible, effectiveFrom, createdByName: actorName(user) },
        tx
      );
    }).catch((error) => {
      if (isUniqueViolation(error)) throw new CustomException("Pay terms already exist from that date.", conflict);
      throw error;
    });
    return await getCompensationFor(employee.id, true);
  } catch (error) {
    throw toCustomException(error);
  }
};

/** The person's own current terms (self-service): salary, cycle and bonus eligibility only. */
const getMyCompensation = async (ref: IEmployeeRef) => {
  try {
    const current = inForce(await PayQuery.listCompensation(ref.id), businessToday());
    if (!current) throw new CustomException("No pay terms are in force for you yet.", notFound);
    return { baseSalary: rupees(current.baseSalaryPaise), payCycle: current.payCycle, bonusEligible: current.bonusEligible };
  } catch (error) {
    throw toCustomException(error);
  }
};

// ----------------------------------------------------------------- schemes

const toSchemeView = (s: IIncentiveScheme) => ({
  id: s.id,
  name: s.name,
  appliesTo: s.appliesTo,
  metric: s.metric,
  period: s.period,
  rules: s.rules.map((r) => ({ threshold: fromMilli(r.thresholdMilli), reward: rupees(r.rewardPaise) })),
  isActive: s.isActive,
  createdAt: s.createdAt.toISOString(),
  updatedAt: s.updatedAt.toISOString(),
});

const parseRules = (value: unknown, metric: string): IIncentiveRule[] => {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_RULES) {
    throw new CustomException(`rules must list 1 to ${MAX_RULES} thresholds.`, badRequest);
  }
  const max = metric === "rating" ? 5 : MAX_THRESHOLD;
  const rules = value.map((raw) => {
    const rule = parseBody(raw);
    return { thresholdMilli: parseMilli(rule.threshold, "threshold", 0.001, max), rewardPaise: parsePaise(rule.reward, "reward", MAX_REWARD_PAISE) };
  });
  rules.sort((a, b) => a.thresholdMilli - b.thresholdMilli);
  if (rules.some((r, i) => i > 0 && r.thresholdMilli === rules[i - 1].thresholdMilli)) {
    throw new CustomException("Each threshold may appear once.", badRequest);
  }
  return rules;
};

const checkMetricPeriod = (metric: string, period: IncentivePeriod) => {
  if (metric === "attendance" && period !== "monthly") {
    throw new CustomException("An attendance scheme is evaluated monthly.", badRequest);
  }
};

const createScheme = async (body: unknown) => {
  try {
    const input = parseBody(body);
    const metric = oneOf(input.metric, INCENTIVE_METRICS, "metric");
    const period = input.period === undefined ? "monthly" : oneOf(input.period, INCENTIVE_PERIODS, "period");
    checkMetricPeriod(metric, period);
    const scheme = await PayQuery.createScheme({
      name: text(input.name, "name", 80),
      appliesTo: oneOf(input.appliesTo, INCENTIVE_APPLIES_TO, "appliesTo"),
      metric,
      period,
      rules: parseRules(input.rules, metric),
      isActive: input.isActive === undefined ? true : parseBoolean(input.isActive, "isActive"),
    });
    return toSchemeView(scheme);
  } catch (error) {
    throw toCustomException(error);
  }
};

const listSchemes = async (query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    const { items, total } = await PayQuery.listSchemes(page.offset, page.limit);
    return toPage(items.map(toSchemeView), total, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

const loadScheme = async (id: string): Promise<IIncentiveScheme> => {
  const scheme = isUuid(id) ? await PayQuery.findScheme(id) : null;
  if (!scheme) throw new CustomException(SCHEME_NOT_FOUND, notFound);
  return scheme;
};

const getScheme = async (id: string) => {
  try {
    return toSchemeView(await loadScheme(id));
  } catch (error) {
    throw toCustomException(error);
  }
};

const updateScheme = async (id: string, body: unknown) => {
  try {
    const input = parseBody(body);
    const current = await loadScheme(id);
    const metric = input.metric === undefined ? current.metric : oneOf(input.metric, INCENTIVE_METRICS, "metric");
    const period = input.period === undefined ? current.period : oneOf(input.period, INCENTIVE_PERIODS, "period");
    checkMetricPeriod(metric, period);
    const changes = {
      name: input.name === undefined ? undefined : text(input.name, "name", 80),
      appliesTo: optionalOneOf(input.appliesTo, INCENTIVE_APPLIES_TO, "appliesTo"),
      metric: input.metric === undefined ? undefined : metric,
      period: input.period === undefined ? undefined : period,
      rules: input.rules === undefined ? undefined : parseRules(input.rules, metric),
      isActive: input.isActive === undefined ? undefined : parseBoolean(input.isActive, "isActive"),
    };
    requireSomething(changes);
    const updated = await PayQuery.updateScheme(id, Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined)));
    if (!updated) throw new CustomException(SCHEME_NOT_FOUND, notFound);
    return toSchemeView(updated);
  } catch (error) {
    throw toCustomException(error);
  }
};

const APPLIES: Record<string, string[]> = { staff: ["staff", "manager"], rider: ["rider"], both: ["staff", "manager", "rider"] };

const assignScheme = async (user: RequestUser, id: string, scope: StoreScope, body: unknown) => {
  try {
    const employeeIds = parseUuidList(parseBody(body).employeeIds, "employeeIds", MAX_ASSIGN_PEOPLE);
    const scheme = await loadScheme(id);
    if (!scheme.isActive) throw new CustomException("This scheme is switched off.", conflict);
    const people = await requireEmployees(employeeIds, scope);
    for (const person of people) {
      if (person.status === "exited") throw new CustomException("A scheme cannot be assigned to someone who has left.", badRequest);
      if (!APPLIES[scheme.appliesTo].includes(person.employeeType)) {
        throw new CustomException(`This scheme applies to ${scheme.appliesTo} only; ${person.name} is ${person.employeeType}.`, badRequest);
      }
    }
    const already = new Set(await PayQuery.assignedEmployeeIds(scheme.id, employeeIds));
    await inHrTransaction((tx) => PayQuery.assignMany(scheme.id, employeeIds.filter((e) => !already.has(e)), actorName(user), tx));
    return { schemeId: scheme.id, assigned: employeeIds.length - already.size, alreadyAssigned: already.size };
  } catch (error) {
    throw toCustomException(error);
  }
};

// --------------------------------------------------------------- incentives

const periodTypeOfKey = (key: string): IncentivePeriod | null =>
  INCENTIVE_PERIODS.find((period) => periodRangeOf(period, key) !== null) ?? null;

// Turns one reported value into a pending earning for every scheme assigned to the person
// that measures it over this kind of period. Approved or paid earnings are never touched.
const evaluate = async (
  assigned: { employeeId: string; scheme: IIncentiveScheme }[],
  metric: { employeeId: string; metric: string; period: string; valueMilli: number },
  tx: Db
) => {
  const type = periodTypeOfKey(metric.period);
  const range = type ? periodRangeOf(type, metric.period) : null;
  if (!type || !range) return;
  for (const { employeeId, scheme } of assigned) {
    if (employeeId !== metric.employeeId || scheme.metric !== metric.metric || scheme.period !== type) continue;
    const rewardPaise = rewardFor(scheme.rules, metric.valueMilli);
    await PayQuery.upsertPendingEarning(
      {
        employeeId,
        schemeId: scheme.id,
        schemeName: scheme.name,
        period: metric.period,
        periodStart: range.start,
        periodEnd: range.end,
        metricValueMilli: metric.valueMilli,
        rewardPaise,
      },
      rewardPaise > 0,
      tx
    );
  }
};

/** Internal: other services report what a person did in a period. At most 200 values per call. */
const ingestMetrics = async (body: unknown) => {
  try {
    const raw = parseBody(body).metrics;
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_METRICS_PER_CALL) {
      throw new CustomException(`metrics must list 1 to ${MAX_METRICS_PER_CALL} values.`, badRequest);
    }
    const metrics = raw.map((item) => {
      const m = parseBody(item);
      const metric = oneOf(m.metric, INCENTIVE_METRICS, "metric");
      if (metric === "attendance") throw new CustomException("attendance is computed from the attendance records, not reported.", badRequest);
      const period = text(m.period, "period", 12);
      if (!periodTypeOfKey(period)) throw new CustomException("period must be 2026-09-15, 2026-W38 or 2026-09.", badRequest);
      const max = metric === "rating" ? 5 : MAX_THRESHOLD;
      return { employeeId: parseUuid(m.employeeId, "employeeId"), metric, period, valueMilli: parseMilli(m.value, "value", 0, max) };
    });
    const employees = await EmployeeQuery.findByIds([...new Set(metrics.map((m) => m.employeeId))], null);
    const known = new Set(employees.filter((e) => e.status !== "exited").map((e) => e.id));
    const accepted = metrics.filter((m) => known.has(m.employeeId));
    const assigned = await PayQuery.activeSchemesFor([...known]);
    await inHrTransaction(async (tx) => {
      for (const m of accepted) {
        await PayQuery.upsertMetric(m, tx);
        await evaluate(assigned, m, tx);
      }
    });
    return { accepted: accepted.length, ignored: metrics.length - accepted.length };
  } catch (error) {
    throw toCustomException(error);
  }
};

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

const toEarningView = (e: IEarning, name?: string) => ({
  id: e.id,
  employeeId: e.employeeId,
  ...(name !== undefined ? { employeeName: name } : {}),
  scheme: e.schemeName,
  amount: rupees(e.rewardPaise),
  status: e.status,
  period: e.period,
});

const listIncentiveEarnings = async (scope: StoreScope, query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    const employeeId = queryString(query.employeeId, "employeeId");
    const period = queryString(query.period, "period");
    if (employeeId) await assertEmployeeInScope(employeeId, scope);
    if (period && period.length > 12) throw new CustomException("period is not valid.", badRequest);
    const { ids } = employeeId ? { ids: null } : await employeeIdsInScope(scope);
    const { items, total } = await PayQuery.listEarnings({
      employeeIds: ids,
      employeeId,
      status: optionalOneOf(queryString(query.status, "status"), EARNING_STATUSES, "status"),
      periodMonth: period && MONTH_KEY.test(period) ? parseMonth(period, "period") : undefined,
      periodExact: period && !MONTH_KEY.test(period) ? period : undefined,
      offset: page.offset,
      limit: page.limit,
    });
    const names = await directoryOf(items.map((e) => e.employeeId));
    return toPage(items.map((e) => toEarningView(e, names.get(e.employeeId)?.name ?? "Unknown")), total, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

const approveIncentiveEarning = async (user: RequestUser, id: string, scope: StoreScope) => {
  try {
    const earning = isUuid(id) ? await PayQuery.findEarning(id) : null;
    if (!earning) throw new CustomException(EARNING_NOT_FOUND, notFound);
    const employee = await assertEmployeeInScope(earning.employeeId, scope).catch(() => {
      throw new CustomException(EARNING_NOT_FOUND, notFound);
    });
    if (earning.periodEnd >= businessToday()) throw new CustomException("An incentive can be approved once its period has ended.", conflict);
    const approved = await inHrTransaction((tx) => PayQuery.approveEarning(earning.id, clock.now(), actorName(user), tx));
    if (!approved) throw new CustomException("This incentive has already been approved.", conflict);
    return toEarningView((await PayQuery.findEarning(id)) as IEarning, employee.name);
  } catch (error) {
    throw toCustomException(error);
  }
};

// ----------------------------------------------------------------- earnings

const earningsFor = async (employee: IEmployeeRef, query: Record<string, unknown>) => {
  const today = businessToday();
  const monthKey = queryString(query.month, "month") ?? formatDate(today).slice(0, 7);
  const month = parseMonth(monthKey, "month");

  // Attendance days are HR's own data, so this one metric is evaluated when asked for.
  const schemes = (await PayQuery.activeSchemesFor([employee.id])).filter((a) => a.scheme.metric === "attendance" && a.scheme.period === "monthly");
  if (schemes.length > 0 && month.from <= today) {
    const [count] = await AttendanceQuery.countByEmployee([employee.id], month.from, minDate(month.to, today));
    const days = (count?.present ?? 0) + (count?.late ?? 0);
    await inHrTransaction(async (tx) => {
      const metric = { employeeId: employee.id, metric: "attendance" as const, period: monthKey, valueMilli: days * 1000 };
      await PayQuery.upsertMetric(metric, tx);
      await evaluate(schemes, metric, tx);
    });
  }

  const [versions, attendance, earnings, sums] = await Promise.all([
    PayQuery.listCompensation(employee.id),
    AttendanceService.getEmployeeMonth(employee.id, null, { month: monthKey }),
    PayQuery.earningsOfMonth(employee.id, month.from, month.to),
    PayQuery.sumsByType(employee.id, monthKey),
  ]);
  const terms: PayTerms[] = versions.map((v) => ({
    effectiveFrom: v.effectiveFrom,
    baseSalaryPaise: v.baseSalaryPaise,
    payCycle: v.payCycle,
    allowancesPaise: Object.values(v.allowances).reduce((a, b) => a + b, 0),
  }));
  const { days, provisional } = payDaysOf({
    month,
    attendance: attendance.days.map((d) => ({ date: parseDate(d.date, "date"), status: d.status as DayStatus })),
    today,
    employeeExited: employee.status === "exited",
    joinDate: employee.joinDate,
  });
  const pay = calculateMonthPay(month, terms, days);

  const counted = earnings.filter((e) => e.status !== "pending").reduce((sum, e) => sum + e.rewardPaise, 0);
  const bonuses = sums.bonus ?? 0;
  const paid = Object.values(sums).reduce((a, b) => a + b, 0);
  const total = pay.basePaise + pay.allowancesPaise + counted + bonuses;
  return {
    employeeId: employee.id,
    month: monthKey,
    base: rupees(pay.basePaise),
    allowances: rupees(pay.allowancesPaise),
    incentives: earnings.map((e) => ({ scheme: e.schemeName, earned: rupees(e.rewardPaise), status: e.status })),
    bonuses: rupees(bonuses),
    totalEarned: rupees(total),
    paid: rupees(paid),
    due: rupees(Math.max(0, total - paid)),
    overpaid: rupees(Math.max(0, paid - total)),
    payableDays: pay.payableDays,
    unpaidDays: pay.unpaidDays,
    provisional,
  };
};

const getEmployeeEarnings = async (id: string, scope: StoreScope, query: Record<string, unknown>) => {
  try {
    return await earningsFor(await assertEmployeeInScope(id, scope), query);
  } catch (error) {
    throw toCustomException(error);
  }
};

const getMyEarnings = async (ref: IEmployeeRef, query: Record<string, unknown>) => {
  try {
    const { employeeId: _employeeId, ...mine } = await earningsFor(ref, query);
    return mine;
  } catch (error) {
    throw toCustomException(error);
  }
};

// ----------------------------------------------------------------- payouts

const toPayoutView = (p: IPayout, name?: string) => ({
  id: p.id,
  employeeId: p.employeeId,
  ...(name !== undefined ? { employeeName: name } : {}),
  amount: rupees(p.amountPaise),
  type: p.type,
  period: p.period,
  paidOn: formatDate(p.paidOn),
  reference: p.reference,
});

const sameAs = (p: IPayout, f: { employeeId: string; amountPaise: number; type: string; period: string; paidOn: Date }) =>
  p.employeeId === f.employeeId && p.amountPaise === f.amountPaise && p.type === f.type && p.period === f.period && p.paidOn.getTime() === f.paidOn.getTime();

const recordPayout = async (user: RequestUser, scope: StoreScope, body: unknown, idempotencyKey: string | null) => {
  try {
    const input = parseBody(body);
    const employee = await assertEmployeeInScope(parseUuid(input.employeeId, "employeeId"), scope);
    const today = businessToday();
    const period = text(input.period, "period", 7);
    const periodMonth = parseMonth(period, "period");
    if (periodMonth.from > today) throw new CustomException("period cannot be a future month.", badRequest);
    const paidOn = parseDate(input.paidOn, "paidOn");
    if (paidOn > today) throw new CustomException("paidOn cannot be in the future.", badRequest);
    if (paidOn < employee.joinDate) throw new CustomException("paidOn cannot be before the person joined.", badRequest);
    const fields = {
      employeeId: employee.id,
      amountPaise: parsePaise(input.amount, "amount", MAX_PAYOUT_PAISE),
      type: oneOf(input.type, PAYOUT_TYPES, "type"),
      period,
      paidOn,
    };
    const reference = nullableText(input.reference, "reference", 80) ?? null;

    const replay = async (): Promise<ReturnType<typeof toPayoutView> | null> => {
      const existing = idempotencyKey ? await PayQuery.findPayoutByKey(user.id, idempotencyKey) : null;
      if (!existing) return null;
      if (!sameAs(existing, fields)) throw new CustomException("That Idempotency-Key was used for a different payout.", conflict);
      return toPayoutView(existing, employee.name);
    };
    const first = await replay();
    if (first) return first;

    const created = await inHrTransaction(async (tx) => {
      if (!(await EmployeeQuery.lockById(employee.id, scope, tx))) throw new CustomException("Employee not found.", notFound);
      const earnings = fields.type === "incentive" ? await PayQuery.earningsOfMonth(employee.id, periodMonth.from, periodMonth.to, tx) : [];
      if (fields.type === "incentive") {
        const approvedTotal = earnings.filter((e) => e.status !== "pending").reduce((s, e) => s + e.rewardPaise, 0);
        const alreadyPaid = (await PayQuery.sumsByType(employee.id, period, tx)).incentive ?? 0;
        if (alreadyPaid + fields.amountPaise > approvedTotal) {
          throw new CustomException("That is more than the approved incentives for the month.", conflict);
        }
      }
      const payout = await PayQuery.createPayout(
        { ...fields, reference, idempotencyKey, recordedByUserId: user.id, recordedByName: actorName(user) },
        tx
      );
      if (fields.type === "incentive") {
        const paidTotal = (await PayQuery.sumsByType(employee.id, period, tx)).incentive ?? 0;
        const settled = earnings.filter((e) => e.status === "paid").reduce((s, e) => s + e.rewardPaise, 0);
        const covered = earningsCoveredBy(earnings.filter((e) => e.status === "approved"), paidTotal - settled);
        await PayQuery.markPaid(covered.map((e) => e.id), clock.now(), tx);
      }
      return toPayoutView(payout, employee.name);
    }).catch(async (error) => {
      if (idempotencyKey && isUniqueViolation(error)) {
        const raced = await replay();
        if (raced) return raced;
      }
      throw error;
    });
    return created;
  } catch (error) {
    throw toCustomException(error);
  }
};

const listPayouts = async (scope: StoreScope, query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    const employeeId = queryString(query.employeeId, "employeeId");
    if (employeeId) await assertEmployeeInScope(employeeId, scope);
    const { ids } = employeeId ? { ids: null } : await employeeIdsInScope(scope);
    const { items, total } = await PayQuery.listPayouts({
      employeeIds: ids,
      employeeId,
      type: optionalOneOf(queryString(query.type, "type"), PAYOUT_TYPES, "type"),
      from: parseOptionalDate(queryString(query.from, "from"), "from"),
      to: parseOptionalDate(queryString(query.to, "to"), "to"),
      offset: page.offset,
      limit: page.limit,
    });
    const names = await directoryOf(items.map((p) => p.employeeId));
    return toPage(items.map((p) => toPayoutView(p, names.get(p.employeeId)?.name ?? "Unknown")), total, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

/** The person's own payments (self-service). */
const listMyPayouts = async (ref: IEmployeeRef, query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    const { items, total } = await PayQuery.listPayouts({
      employeeIds: null,
      employeeId: ref.id,
      from: parseOptionalDate(queryString(query.from, "from"), "from"),
      to: parseOptionalDate(queryString(query.to, "to"), "to"),
      offset: page.offset,
      limit: page.limit,
    });
    return toPage(
      items.map((p) => ({ id: p.id, amount: rupees(p.amountPaise), type: p.type, period: p.period, paidOn: formatDate(p.paidOn) })),
      total,
      page
    );
  } catch (error) {
    throw toCustomException(error);
  }
};

export const PayService = {
  getCompensation,
  setCompensation,
  getMyCompensation,
  createScheme,
  listSchemes,
  getScheme,
  updateScheme,
  assignScheme,
  ingestMetrics,
  listIncentiveEarnings,
  approveIncentiveEarning,
  getEmployeeEarnings,
  getMyEarnings,
  recordPayout,
  listPayouts,
  listMyPayouts,
};
