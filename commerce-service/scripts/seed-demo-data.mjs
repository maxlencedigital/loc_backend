import "../dist/commons/Config/LoadEnv.js";

// Demo data for the dashboard: stores, customers, services, price lists and ~150 orders in
// every status. Local only, and never overwrites a row that already exists, so it is safe to
// re-run. Run `npm run db:migrate` first; this creates no tables.
if (process.env.IS_LOCAL !== "true") {
  console.error("Refusing to seed: IS_LOCAL is not true. This script only fills a local database.");
  process.exit(1);
}

const { prisma, disconnectDB } = await import("../dist/src/DB/Prisma.Connection.Db.js");
// The same pricing code the API runs, so every seeded order is priced exactly as a booking would be.
const { priceOrder, rankLists } = await import("../dist/src/Services/OrderPricing.js");

// ---------------------------------------------------------------- randomness
// mulberry32, as in the dashboard's dataset: the same seed always yields the same data.
const makeRng = (seed) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const rng = makeRng(20260922);
const pick = (items) => items[Math.floor(rng() * items.length)];
const int = (min, max) => Math.floor(rng() * (max - min + 1)) + min;
const float = (min, max, digits = 1) => Number((rng() * (max - min) + min).toFixed(digits));
const chance = (p) => rng() < p;
const shuffle = (items) => {
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
};
const pickMany = (items, count) => shuffle(items).slice(0, count);

const NOW = Date.now();
const MINUTE = 60_000;
const DAY = 86_400_000;
const at = (ms) => new Date(ms);
const round5 = (value) => Math.max(5, Math.round(value / 5) * 5);

// ------------------------------------------------------------------- stores
// Ids are fixed: the gateway seeds users pinned to these same stores.
const STORES = [
  { id: "11111111-1111-4111-8111-111111111101", code: "BLR-IND", name: "Indiranagar Plant", city: "Bengaluru", address: "14, 100 Feet Road, Indiranagar, Bengaluru 560038", status: "live", type: "processing", openingHours: "07:00 – 21:00", capacityKgPerDay: 620 },
  { id: "11111111-1111-4111-8111-111111111102", code: "BLR-KOR", name: "Koramangala Plant", city: "Bengaluru", address: "5th Block, Koramangala, Bengaluru 560095", status: "live", type: "processing", openingHours: "07:00 – 21:00", capacityKgPerDay: 480 },
  { id: "11111111-1111-4111-8111-111111111103", code: "BLR-WFD", name: "Whitefield Hub", city: "Bengaluru", address: "ITPL Main Road, Whitefield, Bengaluru 560066", status: "live", type: "pickup_hub", openingHours: "08:00 – 20:00", capacityKgPerDay: 210 },
  { id: "11111111-1111-4111-8111-111111111104", code: "HYD-GAC", name: "Gachibowli Plant", city: "Hyderabad", address: "Financial District, Gachibowli, Hyderabad 500032", status: "planned", type: "franchise", openingHours: "07:00 – 21:00", capacityKgPerDay: 400 },
];
const liveStores = STORES.filter((s) => s.status === "live");
const storeByCode = Object.fromEntries(STORES.map((s) => [s.code, s]));

// ----------------------------------------------------------------- services
const SERVICES = [
  { code: "WASH_FOLD", name: "Wash & Fold", department: "laundry", unit: "kg", turnaroundHours: 48, expressAvailable: true, active: true, base: 70 },
  { code: "WASH_IRON", name: "Wash & Iron", department: "laundry", unit: "kg", turnaroundHours: 48, expressAvailable: true, active: true, base: 95 },
  { code: "STEAM_PRESS", name: "Steam Press only", department: "finishing", unit: "piece", turnaroundHours: 24, expressAvailable: true, active: true, base: 25 },
  { code: "DRY_CLEAN", name: "Dry Clean", department: "dry_clean", unit: "piece", turnaroundHours: 72, expressAvailable: true, active: true, base: 180 },
  { code: "PREMIUM_DRY_CLEAN", name: "Premium Dry Clean", department: "premium", unit: "piece", turnaroundHours: 96, expressAvailable: false, active: true, base: 420 },
  { code: "CURTAIN_UPHOLSTERY", name: "Curtain & Upholstery", department: "household", unit: "kg", turnaroundHours: 96, expressAvailable: false, active: true, base: 160 },
  { code: "SHOE_CARE", name: "Shoe Care", department: "specialty", unit: "pair", turnaroundHours: 120, expressAvailable: false, active: true, base: 350 },
  { code: "LEATHER_SUEDE", name: "Leather & Suede", department: "specialty", unit: "piece", turnaroundHours: 168, expressAvailable: false, active: false, base: 900 },
  { code: "SAREE_ROLL_PRESS", name: "Saree Roll Press", department: "finishing", unit: "piece", turnaroundHours: 48, expressAvailable: true, active: true, base: 60 },
  { code: "CARPET_DEEP_CLEAN", name: "Carpet Deep Clean", department: "household", unit: "kg", turnaroundHours: 120, expressAvailable: false, active: true, base: 130 },
];

// What each active service is actually offered on: [garment, category].
const OFFERED = {
  WASH_FOLD: [["Shirt", "men"], ["Trouser", "men"], ["Kurta", "men"], ["Kids t-shirt", "kids"], ["School uniform", "kids"], ["Bedsheet (double)", "household"], ["Blouse", "women"]],
  WASH_IRON: [["Shirt", "men"], ["Trouser", "men"], ["Kurta", "men"], ["Blouse", "women"], ["Salwar set", "women"], ["School uniform", "kids"], ["Kids t-shirt", "kids"]],
  STEAM_PRESS: [["Shirt", "men"], ["Trouser", "men"], ["Suit (2pc)", "men"], ["Kurta", "men"], ["Saree", "women"], ["Blouse", "women"], ["Dress", "women"], ["Salwar set", "women"], ["School uniform", "kids"], ["Lehenga", "premium"]],
  DRY_CLEAN: [["Shirt", "men"], ["Trouser", "men"], ["Suit (2pc)", "men"], ["Kurta", "men"], ["Saree", "women"], ["Blouse", "women"], ["Dress", "women"], ["Salwar set", "women"], ["Blanket", "household"], ["Curtain panel", "household"]],
  PREMIUM_DRY_CLEAN: [["Suit (2pc)", "men"], ["Silk scarf", "premium"], ["Wool overcoat", "premium"], ["Lehenga", "premium"], ["Saree", "women"], ["Dress", "women"]],
  CURTAIN_UPHOLSTERY: [["Curtain panel", "household"], ["Blanket", "household"], ["Bedsheet (double)", "household"]],
  SHOE_CARE: [["Sneakers", "men"], ["Leather shoes", "men"], ["Heels", "women"]],
  SAREE_ROLL_PRESS: [["Saree", "women"]],
  CARPET_DEEP_CLEAN: [["Carpet", "household"], ["Rug", "household"]],
};

// Piece rates scale with the garment; per-kg services are flat.
const GARMENT_FACTOR = {
  Shirt: 1, Trouser: 1.1, "Suit (2pc)": 2.6, Kurta: 1.2, Saree: 1.8, Blouse: 0.9, Dress: 1.5, "Salwar set": 1.5,
  "School uniform": 0.8, "Kids t-shirt": 0.6, "Bedsheet (double)": 1.5, "Curtain panel": 1.4, Blanket: 2.2,
  "Silk scarf": 1.2, "Wool overcoat": 3.2, Lehenga: 4, Sneakers: 1, "Leather shoes": 1.3, Heels: 1.1, Carpet: 1, Rug: 1.4,
};

// ------------------------------------------------------------- price lists
const PRICE_LISTS = [
  { name: "Standard retail", appliesTo: "All stores · walk-in and app", active: true, storeId: null, customerType: null, factor: 1, rows: 28, ageDays: 12 },
  { name: "Corporate contract", appliesTo: "Corporate accounts · monthly billing", active: true, storeId: null, customerType: "corporate", factor: 0.86, rows: 22, ageDays: 34 },
  { name: "Whitefield launch", appliesTo: "BLR-WFD only · intro pricing", active: true, storeId: storeByCode["BLR-WFD"].id, customerType: null, factor: 0.9, rows: 18, ageDays: 5 },
  { name: "Hyderabad franchise", appliesTo: "HYD-GAC · not yet live", active: false, storeId: storeByCode["HYD-GAC"].id, customerType: null, factor: 1.05, rows: 26, ageDays: 2 },
];

const allCombos = SERVICES.filter((s) => s.active).flatMap((service) =>
  OFFERED[service.code].map(([garment, category]) => ({ service, garment, category }))
);

// Every active service gets at least one row, then the list is filled up to its size.
const chooseRows = (count) => {
  const chosen = SERVICES.filter((s) => s.active).map((service) => pick(allCombos.filter((c) => c.service === service)));
  const rest = shuffle(allCombos.filter((c) => !chosen.includes(c)));
  return [...chosen, ...rest.slice(0, count - chosen.length)];
};

const rateFor = (service, garment, factor) => {
  const garmentFactor = service.unit === "kg" ? 1 : (GARMENT_FACTOR[garment] ?? 1);
  const rupees = round5(service.base * garmentFactor * factor);
  const express = service.expressAvailable ? round5(rupees * 1.45) : rupees;
  return { ratePaise: rupees * 100, expressRatePaise: express * 100 };
};

// ---------------------------------------------------------------- customers
const FIRST_NAMES = ["Aarav", "Diya", "Vihaan", "Ananya", "Arjun", "Ishita", "Kabir", "Meera", "Rohan", "Saanvi", "Aditya", "Nisha", "Rahul", "Priya", "Karan", "Tara", "Siddharth", "Neha", "Manav", "Kavya", "Yash", "Riya", "Devan", "Pooja", "Imran", "Fatima", "Joseph", "Grace", "Nikhil", "Sneha"];
const LAST_NAMES = ["Sharma", "Verma", "Iyer", "Nair", "Patel", "Reddy", "Kulkarni", "Banerjee", "Chopra", "Menon", "Gupta", "Desai", "Rao", "Joshi", "Malhotra", "Pillai", "Khan", "Dsouza", "Sinha", "Bhat"];
const CUSTOMER_TAGS = ["Regular", "Premium", "Corporate", "Prepaid", "Express user", "Delicate care", "Bulk"];
const AREAS = { "BLR-IND": ["Indiranagar", "Domlur", "Jeevan Bhima Nagar"], "BLR-KOR": ["Koramangala", "HSR Layout", "Jayanagar"], "BLR-WFD": ["Whitefield", "Marathahalli", "Bellandur"] };
const CUSTOMER_COUNT = 60;
const emailFor = (name) => `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@example.in`;

const usedPhones = new Set();
const newPhone = () => {
  for (;;) {
    const digits = `${int(70, 99)}${int(100, 999)}${int(10000, 99999)}`;
    const phone = `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
    if (!usedPhones.has(phone)) {
      usedPhones.add(phone);
      return phone;
    }
  }
};

const planCustomer = (index) => {
  const contact = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
  const corporate = chance(0.12);
  // Indiranagar and Koramangala are the big plants; Whitefield is a hub.
  const store = liveStores[[0, 0, 0, 0, 1, 1, 1, 2, 2][int(0, 8)]];
  const areas = AREAS[store.code];
  return {
    index,
    store,
    name: corporate ? `${pick(["Nimbus", "Orbit", "Vertex", "Kestrel", "Lumen"])} ${pick(["Hotels", "Serviced Suites", "Clinics", "Studios"])}` : contact,
    phone: newPhone(),
    email: emailFor(contact),
    type: corporate ? "corporate" : "retail",
    joinedAt: at(NOW - int(20, 900) * DAY),
    addresses: Array.from({ length: int(1, 3) }, () => `${int(1, 90)}, ${pick(areas)}, Bengaluru`),
    walletBalancePaise: chance(0.3) ? int(100, 4200) * 100 : 0,
    loyaltyPoints: int(0, 3600),
    tags: pickMany(CUSTOMER_TAGS, int(1, 3)),
    rating: chance(0.78) ? float(3.1, 5, 1) : null,
    historicOrders: int(0, 60),
    averageTicketPaise: int(380, 1450) * 100,
    idleDays: int(0, 120),
    orders: [],
  };
};

// ------------------------------------------------------------------- orders
const ORDER_COUNT = 150;
const FIRST_ORDER_NUMBER = 24800;
const STATUS_FLOW = ["booked", "picked_up", "received", "sorted", "washing", "drying", "quality_check", "packed", "out_for_delivery", "delivered"];
// Active stages are sampled more than final ones, as on a busy floor.
const STATUS_POOL = [
  "booked", "picked_up", "received", "received", "sorted", "washing", "washing", "drying", "quality_check", "packed",
  "out_for_delivery", "delivered", "delivered", "delivered", "cancelled",
];
// Minutes an order typically spends before entering each stage (index 1 = booked to picked up).
const STEP_MINUTES = [null, [30, 180], [30, 120], [20, 90], [30, 150], [60, 180], [60, 180], [20, 90], [60, 240], [30, 150]];

const FABRICS = ["Cotton", "Cotton blend", "Linen", "Silk", "Wool", "Polyester", "Denim", "Rayon", "Unknown"];
const HIGH_RISK_FABRICS = new Set(["Silk", "Wool", "Unknown"]);
const CARE_FLAGS = ["Delicate — hand wash zone", "Cold wash only", "Do not tumble dry", "Colour bleed risk", "Existing stain noted at pickup", "Loose button", "Beaded work", "Dry clean only"];
const RIDER_NOTES = ["Small tear on left cuff, photographed at the door.", "Faint stain near collar, customer aware.", "Zip already broken before pickup.", "Customer asked for extra care on the silk item."];
const CUSTOMER_NOTES = ["Please do not tumble dry the wool coat.", "Handle the saree separately, it bleeds colour.", "Light starch on shirts please.", "Needed before Friday evening."];
const WASH_PROGRAMMES = ["Cold delicate 30°C", "Warm cotton 40°C", "Hot whites 60°C", "Wool cycle 20°C", "Quick mixed 30°C"];
const DRY_PROGRAMMES = ["Line dry only", "Low heat tumble", "Medium tumble", "Flat dry", "Cabinet dry 45°C"];
const CANCEL_REASONS = ["Customer changed plans", "Duplicate booking", "Customer unreachable at pickup", "Booked at the wrong store"];
const RIDERS = ["Kabir Sharma", "Manav Tiwari", "Yash Gupta", "Devan Rao"];
const FLOOR_STAFF = ["Sanjay K", "Farah K", "Dinesh P", "Grace D"];

const buildCare = () => {
  const fabric = pick(FABRICS);
  const riskClass = HIGH_RISK_FABRICS.has(fabric) ? "high" : chance(0.22) ? "medium" : "low";
  const delicate = riskClass !== "low";
  return {
    fabric,
    colour: pick(["white", "light", "dark", "multi"]),
    soilLevel: pick(["light", "normal", "normal", "heavy", "stained"]),
    riskClass,
    flags: delicate ? pickMany(CARE_FLAGS, int(1, 3)) : [],
    customerNote: delicate && chance(0.5) ? pick(CUSTOMER_NOTES) : null,
    riderNote: delicate && chance(0.45) ? pick(RIDER_NOTES) : null,
    photoCount: delicate ? int(0, 4) : 0,
    recommendedWash: riskClass === "high" ? "Wool cycle 20°C" : pick(WASH_PROGRAMMES),
    recommendedDry: riskClass === "high" ? "Flat dry" : pick(DRY_PROGRAMMES),
  };
};

const actorFor = (stage, channel) => {
  if (stage === "booked") return channel === "app" ? "Customer app" : "Store counter";
  if (stage === "picked_up" || stage === "out_for_delivery" || stage === "delivered") return `Rider · ${pick(["Kabir S", "Manav T"])}`;
  return `Floor · ${pick(FLOOR_STAFF)}`;
};

// Stage events are laid out backwards from "the last thing that happened", so no event is in
// the future and the gaps between stages are plausible.
const buildTimeline = (status, channel) => {
  if (status === "cancelled") {
    const stopAt = int(0, 7);
    const gaps = STATUS_FLOW.slice(1, stopAt + 1).map((_, i) => int(...STEP_MINUTES[i + 1]));
    const cancelGap = int(20, 240);
    const cancelAgo = int(30, 4 * 1440);
    const total = gaps.reduce((a, b) => a + b, 0) + cancelGap;
    const placed = NOW - (cancelAgo + total) * MINUTE;
    let clock = placed;
    const events = STATUS_FLOW.slice(0, stopAt + 1).map((stage, i) => {
      if (i > 0) clock += gaps[i - 1] * MINUTE;
      return { status: stage, at: at(clock), byName: actorFor(stage, channel), note: null };
    });
    clock += cancelGap * MINUTE;
    events.push({ status: "cancelled", at: at(clock), byName: "Store counter", note: stopAt === 0 ? "Cancelled before pickup" : pick(CANCEL_REASONS) });
    return { placedAt: at(placed), events };
  }

  const last = STATUS_FLOW.indexOf(status);
  const gaps = STATUS_FLOW.slice(1, last + 1).map((_, i) => int(...STEP_MINUTES[i + 1]));
  const lastAgo = status === "delivered" ? int(90, 6 * 1440) : int(5, 420);
  const placed = NOW - (lastAgo + gaps.reduce((a, b) => a + b, 0)) * MINUTE;
  let clock = placed;
  const events = STATUS_FLOW.slice(0, last + 1).map((stage, i) => {
    if (i > 0) clock += gaps[i - 1] * MINUTE;
    return { status: stage, at: at(clock), byName: actorFor(stage, channel), note: null };
  });
  return { placedAt: at(placed), events };
};

const payWeights = ["paid", "paid", "paid", "unpaid", "part_paid"];

const planOrder = (index, customers, servicesByCode, rankedFor) => {
  const customer = pick(customers);
  // The first eleven cover every status once, so the demo never lacks one.
  const status = index < 11 ? [...STATUS_FLOW, "cancelled"][index] : pick(STATUS_POOL);
  const priority = chance(0.24) ? "express" : "standard";
  const channel = pick(["app", "app", "app", "walk_in", "web", "phone"]);

  const ranked = rankedFor(customer);
  const offered = ranked.flatMap((list) => list.rows.map((row) => ({ list, row })));
  const lines = [];
  const seen = new Set();
  const wanted = int(1, 4);
  for (const { row } of shuffle(offered)) {
    const service = servicesByCode.byId.get(row.serviceId);
    const key = `${row.serviceId}|${row.garment}|${row.category}`;
    if (seen.has(key) || (priority === "express" && !service.expressAvailable)) continue;
    seen.add(key);
    const milli = service.unit === "kg" ? Math.round(float(0.8, 6, 1) * 1000) : service.unit === "pair" ? int(1, 3) * 1000 : int(1, 6) * 1000;
    lines.push({ serviceId: row.serviceId, garment: row.garment, category: row.category, quantityMilli: milli });
    if (lines.length === wanted) break;
  }
  const priced = priceOrder(lines, servicesByCode.byId, ranked, priority);

  const { placedAt, events } = buildTimeline(status, channel);
  const finished = status === "delivered" || status === "cancelled";
  const promisedAt = finished
    ? at(placedAt.getTime() + (priority === "express" ? 24 : 48) * 60 * MINUTE)
    : at(NOW + int(-260, 3400) * MINUTE);
  const paymentStatus = status === "cancelled" ? "unpaid" : status === "delivered" && chance(0.85) ? "paid" : pick(payWeights);

  return {
    customer,
    status,
    priority,
    channel,
    paymentStatus,
    placedAt,
    promisedAt,
    events,
    care: buildCare(),
    priced,
    riderName: status === "booked" ? null : pick(RIDERS),
    address: pick(customer.addresses),
  };
};

// ---------------------------------------------------------------------- run
try {
  for (const store of STORES) {
    await prisma.store.upsert({ where: { code: store.code }, create: store, update: {} });
  }

  for (const { base: _base, ...service } of SERVICES) {
    await prisma.service.upsert({ where: { code: service.code }, create: service, update: {} });
  }
  const services = await prisma.service.findMany();
  const serviceByCode = new Map(services.map((s) => [s.code, s]));
  const servicesByCode = { byId: new Map(services.map((s) => [s.id, s])) };

  for (const plan of PRICE_LISTS) {
    const { factor: _factor, rows: _rows, ageDays, ...fields } = plan;
    await prisma.priceList.upsert({
      where: { name: plan.name },
      create: { ...fields, updatedAt: at(NOW - ageDays * DAY) },
      update: {},
    });
  }
  const lists = await prisma.priceList.findMany();
  const listByName = new Map(lists.map((l) => [l.name, l]));
  for (const plan of PRICE_LISTS) {
    const list = listByName.get(plan.name);
    for (const { service, garment, category } of chooseRows(plan.rows)) {
      const serviceId = serviceByCode.get(service.code).id;
      await prisma.priceRow.upsert({
        where: { priceListId_serviceId_garment_category: { priceListId: list.id, serviceId, garment, category } },
        create: { priceListId: list.id, serviceId, garment, category, ...rateFor(service, garment, plan.factor) },
        update: {},
      });
    }
  }

  // Plan everything in memory first (the random stream never depends on the database), then write.
  const customerPlans = Array.from({ length: CUSTOMER_COUNT }, (_, i) => planCustomer(i));
  const activeLists = await prisma.priceList.findMany({
    where: { active: true },
    select: { id: true, name: true, storeId: true, customerType: true, rows: { select: { serviceId: true, garment: true, category: true, ratePaise: true, expressRatePaise: true } } },
  });
  const rankedFor = (customer) => rankLists(activeLists, customer.store.id, customer.type);
  const orderPlans = Array.from({ length: ORDER_COUNT }, (_, i) => planOrder(i, customerPlans, servicesByCode, rankedFor));
  // References rise with time, like real bookings: the oldest order gets the lowest number.
  orderPlans.sort((a, b) => a.placedAt - b.placedAt);
  orderPlans.forEach((order, i) => {
    order.ref = `LOC-${FIRST_ORDER_NUMBER + i}`;
    if (order.status !== "cancelled") order.customer.orders.push(order);
  });

  const customerRows = new Map();
  for (const plan of customerPlans) {
    const seededValue = plan.orders.reduce((total, o) => total + o.priced.amountPaise, 0);
    const lastSeeded = plan.orders.reduce((latest, o) => Math.max(latest, o.placedAt.getTime()), 0);
    const orderCount = plan.orders.length + plan.historicOrders;
    const lastOrderAt = lastSeeded ? at(lastSeeded) : plan.historicOrders ? at(NOW - plan.idleDays * DAY) : null;
    const idle = lastOrderAt ? Math.floor((NOW - lastOrderAt.getTime()) / DAY) : plan.idleDays;
    const row = await prisma.customer.upsert({
      where: { phone: plan.phone },
      create: {
        storeId: plan.store.id,
        name: plan.name,
        phone: plan.phone,
        email: plan.email,
        type: plan.type,
        orderCount,
        lifetimeValuePaise: seededValue + plan.historicOrders * plan.averageTicketPaise,
        lastOrderAt,
        churnRisk: Math.min(97, Math.round(idle * 0.72 + int(0, 18))),
        rating: plan.rating,
        addresses: plan.addresses,
        walletBalancePaise: plan.walletBalancePaise,
        loyaltyPoints: plan.loyaltyPoints,
        tags: plan.tags,
        createdAt: plan.joinedAt,
      },
      update: {},
    });
    customerRows.set(plan.phone, row);
  }

  let createdOrders = 0;
  for (const order of orderPlans) {
    if (await prisma.order.findUnique({ where: { ref: order.ref }, select: { id: true } })) continue;
    await prisma.order.create({
      data: {
        ref: order.ref,
        storeId: order.customer.store.id,
        customerId: customerRows.get(order.customer.phone).id,
        status: order.status,
        priority: order.priority,
        paymentStatus: order.paymentStatus,
        channel: order.channel,
        pieces: order.priced.pieces,
        weightGrams: order.priced.weightGrams,
        amountPaise: order.priced.amountPaise,
        placedAt: order.placedAt,
        promisedAt: order.promisedAt,
        care: order.care,
        riderName: order.riderName,
        address: order.address,
        items: { create: order.priced.items.map((item, position) => ({ ...item, position })) },
        events: { create: order.events },
      },
    });
    createdOrders += 1;
  }

  // New bookings continue after the seeded references instead of colliding with them.
  const lastNumber = FIRST_ORDER_NUMBER + ORDER_COUNT - 1;
  await prisma.sequenceCounter.upsert({ where: { name: "order_ref" }, create: { name: "order_ref", value: lastNumber }, update: {} });
  await prisma.sequenceCounter.updateMany({ where: { name: "order_ref", value: { lt: lastNumber } }, data: { value: lastNumber } });

  const group = async (field) =>
    Object.fromEntries((await prisma.order.groupBy({ by: [field], _count: { _all: true } })).map((g) => [g[field], g._count._all]));
  console.log("Seeded the local commerce database (existing rows are left untouched).");
  console.log({
    stores: await prisma.store.count(),
    services: await prisma.service.count(),
    priceLists: await prisma.priceList.count(),
    priceRows: await prisma.priceRow.count(),
    customers: await prisma.customer.count(),
    orders: await prisma.order.count(),
    orderItems: await prisma.orderItem.count(),
    orderEvents: await prisma.orderEvent.count(),
    newOrdersThisRun: createdOrders,
  });
  console.log("orders by status", await group("status"));
  console.log("orders by priority", await group("priority"));
  console.log("orders by payment", await group("paymentStatus"));
  console.log("orders by store", Object.fromEntries((await prisma.order.groupBy({ by: ["storeId"], _count: { _all: true } })).map((g) => [STORES.find((s) => s.id === g.storeId)?.code, g._count._all])));
} catch (error) {
  console.error("Seeding failed:", error instanceof Error ? error.message : error);
  await disconnectDB();
  process.exit(1);
}

// Released explicitly: the pool keeps the process alive otherwise.
await disconnectDB();
process.exit(0);
