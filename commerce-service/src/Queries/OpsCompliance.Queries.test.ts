const mockFns = {
  itemFindFirst: jest.fn().mockResolvedValue(null),
  itemFindMany: jest.fn().mockResolvedValue([]),
  itemCount: jest.fn().mockResolvedValue(0),
  auditFindFirst: jest.fn().mockResolvedValue(null),
  auditUpdateMany: jest.fn().mockResolvedValue({ count: 0 }),
  findingFindFirst: jest.fn().mockResolvedValue(null),
  findingUpdateMany: jest.fn().mockResolvedValue({ count: 0 }),
  incidentFindFirst: jest.fn().mockResolvedValue(null),
  incidentUpdateMany: jest.fn().mockResolvedValue({ count: 0 }),
};

jest.mock("../DB/Prisma.Connection.Db.js", () => ({
  prisma: {
    complianceItem: { findFirst: (...a: unknown[]) => mockFns.itemFindFirst(...a), findMany: (...a: unknown[]) => mockFns.itemFindMany(...a), count: (...a: unknown[]) => mockFns.itemCount(...a) },
    audit: { findFirst: (...a: unknown[]) => mockFns.auditFindFirst(...a), updateMany: (...a: unknown[]) => mockFns.auditUpdateMany(...a) },
    auditFinding: { findFirst: (...a: unknown[]) => mockFns.findingFindFirst(...a), updateMany: (...a: unknown[]) => mockFns.findingUpdateMany(...a) },
    safetyIncident: { findFirst: (...a: unknown[]) => mockFns.incidentFindFirst(...a), updateMany: (...a: unknown[]) => mockFns.incidentUpdateMany(...a) },
  },
}));

import { AuditQuery } from "./Audit.Query.js";
import { ComplianceQuery } from "./Compliance.Query.js";
import { SafetyIncidentQuery } from "./SafetyIncident.Query.js";

const STORE = "11111111-1111-4111-8111-111111111101";
const ID = "22222222-2222-4222-8222-222222222222";
const visible = { OR: [{ storeId: STORE }, { storeId: null }] };

// The scope and the status guard must reach the WHERE clause, or isolation and conflict
// handling would rest on the service layer alone.
describe("scope and guards reach the database query", () => {
  it("scopes compliance reads to the store plus company-wide rows, and none for an unscoped admin", async () => {
    await ComplianceQuery.findById(ID, STORE);
    await ComplianceQuery.findById(ID, null);
    expect(mockFns.itemFindFirst.mock.calls[0][0].where).toEqual({ id: ID, AND: [visible] });
    expect(mockFns.itemFindFirst.mock.calls[1][0].where).toEqual({ id: ID, AND: [{}] });
  });

  it("pages and orders the due list by the indexed expiry column", async () => {
    await ComplianceQuery.searchDue({ scope: STORE, until: new Date() }, { offset: 40, limit: 20 });
    expect(mockFns.itemFindMany.mock.calls[0][0]).toMatchObject({ skip: 40, take: 20, orderBy: [{ expiresOn: "asc" }, { id: "asc" }] });
  });

  it("guards audit and finding transitions on the status that was read", async () => {
    await AuditQuery.changeIfStatus(ID, ["in_progress"], { status: "completed" }, { audit: { updateMany: mockFns.auditUpdateMany } } as never);
    await AuditQuery.changeFindingIfStatus(ID, "open", { status: "in_progress" }, { auditFinding: { updateMany: mockFns.findingUpdateMany } } as never);
    expect(mockFns.auditUpdateMany.mock.calls[0][0].where).toEqual({ id: ID, status: { in: ["in_progress"] } });
    expect(mockFns.findingUpdateMany.mock.calls[0][0].where).toEqual({ id: ID, status: "open" });
  });

  it("scopes incidents strictly to the store and to the reporter when asked", async () => {
    await SafetyIncidentQuery.findById(ID, { storeId: STORE, reportedBy: "r1" });
    await SafetyIncidentQuery.findById(ID, { storeId: null });
    expect(mockFns.incidentFindFirst.mock.calls[0][0].where).toEqual({ id: ID, storeId: STORE, reportedBy: "r1" });
    expect(mockFns.incidentFindFirst.mock.calls[1][0].where).toEqual({ id: ID });
  });

  it("guards an incident change on status, severity and the action cap", async () => {
    await SafetyIncidentQuery.change(
      ID,
      { expectedStatus: "open", expectedSeverity: "low", data: { status: "in_progress" }, addAction: { cap: 50 } },
      { safetyIncident: { updateMany: mockFns.incidentUpdateMany } } as never
    );
    expect(mockFns.incidentUpdateMany.mock.calls[0][0]).toMatchObject({
      where: { id: ID, status: "open", severity: "low", actionCount: { lt: 50 } },
      data: { status: "in_progress", actionCount: { increment: 1 } },
    });
  });
});
