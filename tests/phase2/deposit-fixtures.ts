import { randomUUID } from "node:crypto";
import { deflateSync } from "node:zlib";
import { expect, type APIRequestContext } from "./guarded-test";
import { browserTestTarget } from "../../src/server/browser-test-target";
import { db } from "../../src/server/db";

export async function depositBrowserFixture() {
  const target = browserTestTarget();
  expect(
    await db.$queryRaw<
      { database: string; role: string }[]
    >`SELECT current_database() AS database,current_user AS role`,
  ).toEqual([{ database: target.database, role: target.role }]);
  const admin = await db.user.findUniqueOrThrow({
    where: { username: "test-admin" },
  });
  const staff = await db.user.findUniqueOrThrow({
    where: { username: "test-staff" },
  });
  expect(admin).toMatchObject({ role: "ADMIN", disabled: false });
  expect(staff).toMatchObject({ role: "STAFF", disabled: false });
  const suffix = randomUUID();
  const property = await db.property.create({
    data: {
      code: `DEP-${suffix}`,
      name: `Synthetic deposits ${suffix}`,
      address: "Synthetic browser fixture only",
    },
  });
  const floor = await db.floor.create({
    data: { propertyId: property.id, number: 1, name: "Synthetic deposits" },
  });
  const room = await db.room.create({
    data: { floorId: floor.id, number: "D101", rent: "1000.00" },
  });
  const tenant = await db.tenant.create({
    data: { name: `Synthetic deposit tenant ${suffix}`, isDemo: false },
  });
  const lease = await db.lease.create({
    data: {
      number: `DEP-${suffix}`,
      roomId: room.id,
      tenantId: tenant.id,
      startDate: new Date("2026-01-01"),
      endDate: new Date("2038-12-31"),
      rent: "1000.00",
      deposit: "2000.00",
      status: "ACTIVE",
      isDemo: false,
    },
  });
  return { admin, staff, property, floor, room, tenant, lease };
}

export async function signInDepositBrowser(
  request: APIRequestContext,
  staff = false,
) {
  const target = browserTestTarget();
  const response = await request.post("/api/auth/login/", {
    headers: { Origin: target.origin },
    data: {
      identifier: staff ? "test-staff" : "test-admin",
      password: staff
        ? process.env.TEST_STAFF_PASSWORD
        : process.env.TEST_ADMIN_PASSWORD,
    },
  });
  expect(response.status()).toBe(200);
}

export function depositBrowserPng() {
  const crc = (bytes: Buffer) => {
    let value = 0xffffffff;
    for (const byte of bytes) {
      value ^= byte;
      for (let bit = 0; bit < 8; bit++)
        value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    }
    return (value ^ 0xffffffff) >>> 0;
  };
  const chunk = (name: string, data: Buffer) => {
    const type = Buffer.from(name),
      size = Buffer.alloc(4),
      checksum = Buffer.alloc(4);
    size.writeUInt32BE(data.length);
    checksum.writeUInt32BE(crc(Buffer.concat([type, data])));
    return Buffer.concat([size, type, data, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.from([0, 255, 0, 0]))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
