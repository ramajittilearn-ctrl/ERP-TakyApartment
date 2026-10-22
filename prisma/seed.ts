import "dotenv/config";
import { db } from "../src/server/db";
export async function seed() {
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(20261017)`;
    if (await tx.property.findUnique({ where: { code: "TAKY" } })) return;
    const property = await tx.property.upsert({
      where: { code: "TAKY" },
      update: {},
      create: { code: "TAKY", name: "Taky Apartment" },
    });
    for (const number of [1, 2, 3]) {
      const floor = await tx.floor.upsert({
        where: { propertyId_number: { propertyId: property.id, number } },
        update: {},
        create: { propertyId: property.id, number, name: `ชั้น ${number}` },
      });
      for (let index = 1; index <= 5; index++) {
        const roomNumber = String(number * 100 + index);
        await tx.room.upsert({
          where: { floorId_number: { floorId: floor.id, number: roomNumber } },
          update: {},
          create: {
            floorId: floor.id,
            number: roomNumber,
            rent: "0.00",
            notes: "กรุณากำหนดค่าเช่าก่อนใช้งาน",
          },
        });
      }
    }
  });
}
if (process.argv[1]?.endsWith("seed.ts"))
  seed()
    .then(() =>
      console.info(
        "Seed complete: 3 floors / 15 room identities; existing values preserved.",
      ),
    )
    .finally(() => db.$disconnect());
