import http from "http";
import { AddressInfo } from "net";
import express from "express";

// The real router and controllers over real HTTP; only the Query layer (and the database client
// underneath it) is faked, so request parsing, multipart, headers and role guards all run.
jest.mock("../DB/Prisma.Connection.Db.js", () => ({ prisma: { $queryRaw: jest.fn() } }));
jest.mock("../Queries/Expense.Query.js", () => {
  const stored: any[] = [];
  return {
    __stored: stored,
    ExpenseQuery: {
      findById: async (id: string) => (id === "eeeeeeee-0000-4000-8000-000000000001" ? { id, status: "recorded" } : null),
      findReceiptByHash: async (_id: string, sha256: string) => {
        const found = stored.find((r) => r.sha256 === sha256);
        return found ? { id: "r1", createdAt: new Date(), ...found, content: undefined } : null;
      },
      countReceipts: async () => stored.length,
      addReceipt: async (data: any) => {
        stored.push(data);
        return true;
      },
      spendByStore: async () => [],
      spendByDay: async () => [],
    },
  };
});
jest.mock("../Queries/Reconciliation.Query.js", () => ({
  ReconciliationQuery: {
    createStatement: async (meta: any, lines: any[]) => ({ id: "st-1", ...meta, lineCount: lines.length, skippedCount: 0, createdAt: new Date() }),
  },
}));
jest.mock("../Queries/Gst.Query.js", () => ({
  GstQuery: {
    findById: async (id: string) =>
      id === "ffffffff-0000-4000-8000-000000000001"
        ? {
            id,
            month: "2026-09",
            status: "ready",
            rateBps: 1800,
            grossPaise: 11_800,
            refundsPaise: 0,
            taxablePaise: 10_000,
            taxPaise: 1_800,
            cgstPaise: 900,
            sgstPaise: 900,
            orderCount: 1,
            storeIds: [],
            lines: [{ storeId: null, orders: 1, grossPaise: 11_800, refundsPaise: 0, taxablePaise: 10_000, taxPaise: 1_800, cgstPaise: 900, sgstPaise: 900 }],
            generatedAt: new Date(),
            filedAt: null,
            acknowledgement: null,
          }
        : null,
  },
}));

import router from "./Finance.Routes.js";

let server: http.Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/", router);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => {
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  jest.requireMock("../Queries/Expense.Query.js").__stored.length = 0;
});
afterEach(() => jest.restoreAllMocks());

const STORE = "11111111-1111-4111-8111-111111111101";
const as = (role: string, extra: Record<string, string> = {}) => ({ "x-user-id": "u1", "x-user-role": role, ...extra });
const service = { "x-service-name": "commerce" };

const send = async (method: string, path: string, headers: Record<string, string>, body?: unknown, raw?: Buffer, type?: string) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { ...(raw ? { "content-type": type as string } : { "content-type": "application/json" }), ...headers },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    signal: AbortSignal.timeout(4000),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json, text, headers: res.headers };
};

const multipart = (parts: Array<{ name: string; filename?: string; type?: string; content: Buffer | string }>) => {
  const boundary = "----finance-test-boundary";
  const chunks: Buffer[] = [];
  for (const part of parts) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"${part.filename ? `; filename="${part.filename}"` : ""}\r\n${part.type ? `Content-Type: ${part.type}\r\n` : ""}\r\n`
      ),
      Buffer.from(part.content),
      Buffer.from("\r\n")
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), type: `multipart/form-data; boundary=${boundary}` };
};

describe("role matrix", () => {
  const cases: Array<[string, string, string[]]> = [
    ["GET", "/dashboard/overview", ["admin"]],
    ["GET", "/payments", ["admin"]],
    ["GET", "/payments/mismatches", ["admin", "staff"]],
    ["POST", "/refunds", ["admin"]],
    ["POST", "/refunds/aaaaaaaa-0000-4000-8000-000000000001/approve", ["admin"]],
    ["GET", "/expenses", ["admin", "manager"]],
    ["POST", "/expenses", ["admin"]],
    ["GET", "/cash/daily?date=2026-09-30", ["admin", "manager"]],
    ["POST", "/daily-close/aaaaaaaa-0000-4000-8000-000000000001/approve", ["admin"]],
    ["GET", "/ledger", ["admin"]],
    ["POST", "/receivables/aaaaaaaa-0000-4000-8000-000000000001/payments", ["admin"]],
    ["GET", "/analytics/store-economics", ["admin"]],
  ];
  const everyone = ["super_admin", "admin", "manager", "hr", "staff", "driver", "customer"];

  it.each(cases)("%s %s admits exactly %j (super_admin always)", async (method, path, allowed) => {
    for (const role of everyone) {
      const { status } = await send(method, path, as(role, { "x-user-store-id": STORE }), method === "GET" ? undefined : {});
      const admitted = role === "super_admin" || allowed.includes(role);
      if (admitted) expect([role, status === 403 || status === 401]).toEqual([role, false]);
      else expect([role, status]).toEqual([role, 403]);
    }
  });
});

describe("uploads", () => {
  const RECEIPT = "/expenses/eeeeeeee-0000-4000-8000-000000000001/receipt";

  it("attaches a receipt sent as multipart/form-data", async () => {
    const { body, type } = multipart([{ name: "file", filename: "bill.pdf", type: "application/pdf", content: "%PDF-1.4 hello" }]);
    const res = await send("POST", RECEIPT, as("admin"), undefined, body, type);
    expect(res.status).toBe(201);
    expect(res.json.result).toMatchObject({ fileName: "bill.pdf", contentType: "application/pdf", sizeBytes: 14 });
    expect(jest.requireMock("../Queries/Expense.Query.js").__stored[0].content.toString()).toBe("%PDF-1.4 hello");
  });

  it("answers 400 (and never hangs) for JSON sent to an upload route, a missing file and a lying file type", async () => {
    expect((await send("POST", RECEIPT, as("admin"), {})).status).toBe(400);
    const none = multipart([{ name: "note", content: "hi" }]);
    expect((await send("POST", RECEIPT, as("admin"), undefined, none.body, none.type)).status).toBe(400);
    const lie = multipart([{ name: "file", filename: "x.pdf", type: "application/pdf", content: "<html>" }]);
    expect((await send("POST", RECEIPT, as("admin"), undefined, lie.body, lie.type)).status).toBe(400);
  });

  it("answers 413 for a file over the limit and 404 for an unknown expense", async () => {
    const big = multipart([{ name: "file", filename: "big.pdf", type: "application/pdf", content: Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(2 * 1024 * 1024)]) }]);
    expect((await send("POST", RECEIPT, as("admin"), undefined, big.body, big.type)).status).toBe(413);
    const ok = multipart([{ name: "file", filename: "bill.pdf", type: "application/pdf", content: "%PDF-1.4" }]);
    expect((await send("POST", "/expenses/eeeeeeee-0000-4000-8000-000000000009/receipt", as("admin"), undefined, ok.body, ok.type)).status).toBe(404);
  });

  it("uploads a bank statement with its bank field and reports the line count", async () => {
    const { body, type } = multipart([
      { name: "bank", content: "HDFC" },
      { name: "file", filename: "oct.csv", type: "text/csv", content: "date,description,amount\n2026-10-01,Deposit,10.00\n2026-10-02,Deposit,20.00\n" },
    ]);
    const res = await send("POST", "/reconciliation/bank-statements", as("admin"), undefined, body, type);
    expect(res.status).toBe(201);
    expect(res.json.result).toMatchObject({ bank: "HDFC", lines: 2, fileName: "oct.csv" });
    const bad = multipart([{ name: "file", filename: "bad.csv", type: "text/csv", content: "date,description,amount\nyesterday,x,1\n" }]);
    expect((await send("POST", "/reconciliation/bank-statements", as("admin"), undefined, bad.body, bad.type)).status).toBe(400);
  });
});

describe("GST export download", () => {
  const ID = "ffffffff-0000-4000-8000-000000000001";

  it("serves csv as an attachment and json by default", async () => {
    const csv = await send("GET", `/gst/reports/${ID}/export?format=csv`, as("admin"));
    expect(csv.status).toBe(200);
    expect(csv.headers.get("content-type")).toMatch(/text\/csv/);
    expect(csv.headers.get("content-disposition")).toBe('attachment; filename="gst-2026-09.csv"');
    expect(csv.text).toContain("TOTAL,1,118.00,0.00,100.00,18.00,9.00,9.00");
    expect(JSON.parse((await send("GET", `/gst/reports/${ID}/export`, as("admin"))).text).month).toBe("2026-09");
    expect((await send("GET", `/gst/reports/${ID}/export?format=xlsx`, as("admin"))).status).toBe(400);
    expect((await send("GET", "/gst/reports/ffffffff-0000-4000-8000-000000000009/export", as("admin"))).status).toBe(404);
  });
});

describe("internal endpoints", () => {
  it("refuse a request without a service name, and answer 400 to bad input", async () => {
    for (const [method, path] of [
      ["GET", "/internal/payments?orderRef=A"],
      ["POST", "/internal/payments/orders"],
      ["POST", "/internal/payments/verify"],
      ["POST", "/internal/receivables"],
      ["POST", "/internal/cash/day-close"],
      ["POST", "/internal/cash/deposits"],
    ] as const) {
      expect((await send(method, path, as("admin"), method === "POST" ? {} : undefined)).status).toBe(401);
      const asService = await send(method, method === "GET" ? "/internal/payments" : path, service, method === "POST" ? {} : undefined);
      expect(asService.status).toBe(400);
    }
  });

  it("validates a checkout request from commerce before touching Razorpay", async () => {
    const res = await send("POST", "/internal/payments/orders", service, { orderRef: "LOC-1", amountPaise: 12.5, customerUserId: "22222222-2222-4222-8222-222222222201" });
    expect(res.status).toBe(400);
    expect(res.json.displayMessage).toMatch(/whole number of paise/);
  });
});
