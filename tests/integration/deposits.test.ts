import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../src/server/db";
import type { Actor } from "../../src/server/services";
import { createDepositService } from "../../src/server/deposits";
const key=()=>randomUUID();
let admin:Actor,staff:Actor,dir:string;
// This independently verifies real synthetic retained bytes for core integration tests.
// Upload admission, hostile file handling and production verifier behavior have separate tests.
const service=createDepositService(async(tx,{leaseId,evidenceId})=>{
 await tx.$queryRaw`SELECT id FROM "DepositEvidence" WHERE id=${evidenceId}::uuid FOR UPDATE`;
 const evidence=await tx.depositEvidence.findUniqueOrThrow({where:{id:evidenceId},include:{attachment:true}});
 if(evidence.leaseId!==leaseId)throw new Error("Evidence lease mismatch");
 const file=path.join(dir,evidence.attachment.storageKey);
 const stat=await lstat(file);if(!stat.isFile()||stat.isSymbolicLink())throw new Error("Evidence not regular");
 const data=await readFile(file);if(BigInt(data.length)!==evidence.attachment.bytes||createHash("sha256").update(data).digest("hex")!==evidence.attachment.sha256)throw new Error("Evidence bytes mismatch");
 return {evidenceId,attachmentId:evidence.attachmentId};
});
beforeAll(async()=>{
 const configured=process.env.DATABASE_URL;if(!configured)throw new Error("Explicit isolated synthetic deposit database required");const url=new URL(configured);
 if(url.hostname!=="127.0.0.1"||!/^taky_deposit_test_[a-z0-9_]+$/.test(url.pathname.slice(1))||url.search)throw new Error("Fresh isolated loopback deposit database required");
 const actual=await db.$queryRaw<{name:string}[]>`SELECT current_database() AS name`;expect(actual[0]?.name).toBe(url.pathname.slice(1));
 dir=await mkdtemp(path.join(tmpdir(),"taky-deposit-core-evidence-"));
 for(const role of ["ADMIN","STAFF"] as const){const user=await db.user.create({data:{username:`deposit-${key()}`,email:`${key()}@synthetic.invalid`,name:`Synthetic ${role}`,passwordHash:"not-a-password",role}});if(role==="ADMIN")admin=user;else staff=user;}
});
afterAll(()=>db.$disconnect());
async function fixture(){
 const property=await db.property.create({data:{code:key(),name:"Synthetic deposit property"}});
 const floor=await db.floor.create({data:{propertyId:property.id,number:1,name:"Synthetic floor"}});
 const room=await db.room.create({data:{floorId:floor.id,number:"D01",rent:"1000.00"}});
 const tenant=await db.tenant.create({data:{name:"Synthetic deposit tenant"}});
 const lease=await db.lease.create({data:{number:`D-${key()}`,roomId:room.id,tenantId:tenant.id,startDate:new Date("2026-01-01"),endDate:new Date("2027-01-01"),rent:"1000.00",deposit:"2000.00",status:"ACTIVE"}});
 const storageKey=key();const bytes=Buffer.from("Synthetic retained core evidence\n");await writeFile(path.join(dir,storageKey),bytes,{flag:"wx",mode:0o600});
 const attachment=await db.attachment.create({data:{storageKey,originalName:"synthetic.txt",mimeType:"application/octet-stream",bytes:BigInt(bytes.length),sha256:createHash("sha256").update(bytes).digest("hex"),uploadedById:admin.id,leaseId:lease.id}});
 await db.auditLog.create({data:{actorId:admin.id,action:"DEPOSIT_EVIDENCE_ADMISSION",entity:"deposit-evidence",metadata:{leaseId:lease.id,attemptId:key()}}});
 const evidence=await db.depositEvidence.create({data:{leaseId:lease.id,attachmentId:attachment.id,uploadedById:admin.id}});
 return {lease,attachment,evidence,base:{leaseId:lease.id,evidenceId:evidence.id,reason:"Synthetic operator-verified settlement",commandKey:key(),expectedVersion:0}};
}
const at=()=>new Date(Date.now()-60000).toISOString();
async function reviewed(openingAmount="0.00"){const f=await fixture();const result=await service.reviewDepositAccount(admin,{...f.base,openingAmount,verified:true});return {...f,result};}
describe("managed deposit PostgreSQL core",()=>{
 it("keeps contractual, legacy and reviewed opening distinct with replay",async()=>{
  const f=await fixture();await db.securityDeposit.create({data:{leaseId:f.lease.id,kind:"RECEIVED",amount:"321.25",occurredAt:new Date()}});
  const command={...f.base,openingAmount:"100.00",verified:true};const result=await service.reviewDepositAccount(admin,command);
  expect(result.contractualRequirement).toBe("2000.00");expect(result.unverifiedLegacy.grossReceived).toBe("321.25");expect(result.totals.heldLiability).toBe("100.00");expect(result.account.version).toBe(1);expect(result.items[0].kind).toBe("OPENING");
  expect(await service.reviewDepositAccount(admin,command)).toEqual(result);expect(await db.depositEntry.count({where:{leaseId:f.lease.id}})).toBe(1);
  await expect(service.reviewDepositAccount(admin,{...command,openingAmount:"101.00"})).rejects.toMatchObject({code:"IDEMPOTENCY_CONFLICT"});
  await expect(service.reviewDepositAccount(staff,command)).rejects.toMatchObject({code:"FORBIDDEN"});
 });
 it("handles receipt, deduction, refund and full original reversal exactly",async()=>{
  const f=await reviewed();const receipt=await service.recordDepositReceipt(admin,{...f.base,commandKey:key(),expectedVersion:1,amount:"10.25",occurredAt:at(),verified:true,method:"CASH"});
  const deduction=await service.recordDepositDeduction(admin,{...f.base,commandKey:key(),expectedVersion:2,amount:"1.20",occurredAt:at(),verified:true});
  expect(deduction.totals.heldLiability).toBe("9.05");
  const refund=await service.recordDepositRefund(admin,{...f.base,commandKey:key(),expectedVersion:3,amount:"2.00",occurredAt:at(),settlementReviewed:true,method:"CASH",payeeName:"Synthetic payee"});
  expect(refund.totals.heldLiability).toBe("7.05");
  const target=refund.items.find(row=>row.kind==="REFUND");if(!target)throw new Error("Refund missing");
  const reversed=await service.reverseDepositEntry(admin,{...f.base,commandKey:key(),expectedVersion:4,entryId:target.id,occurredAt:at(),verified:true});
  expect(reversed.totals.heldLiability).toBe("9.05");expect(reversed.totals.reversedRefunds).toBe("2.00");expect(reversed.items.find(row=>row.id===target.id)?.reversedBy).not.toBeNull();
  const reversal=reversed.items.find(row=>row.kind==="REVERSAL");if(!reversal)throw new Error("Reversal missing");
  await expect(service.reverseDepositEntry(admin,{...f.base,commandKey:key(),expectedVersion:5,entryId:reversal.id,occurredAt:at(),verified:true})).rejects.toMatchObject({code:"INVALID_REVERSAL"});
  const document=await service.getDepositDocument(staff,{entryId:receipt.items[0].id});expect(document.documentSnapshot.amount).toBe("10.25");
  const page=await service.getLeaseDepositLedger(staff,{leaseId:f.lease.id,limit:1});expect(page.items).toHaveLength(1);expect(page.total).toBe(4);expect(page.totals.heldLiability).toBe("9.05");
 });
 it("fails closed on missing review, stale versions, overspend and retained-byte tampering",async()=>{
  const f=await fixture();const receipt={...f.base,commandKey:key(),amount:"5.00",occurredAt:at(),verified:true,method:"CASH"};
  await expect(service.recordDepositReceipt(admin,receipt)).rejects.toMatchObject({code:"REVIEW_REQUIRED"});
  await service.reviewDepositAccount(admin,{...f.base,openingAmount:"5.00",verified:true});
  await expect(service.recordDepositReceipt(admin,receipt)).rejects.toMatchObject({code:"STALE_VERSION"});
  await expect(service.recordDepositDeduction(admin,{...f.base,expectedVersion:1,commandKey:key(),amount:"5.01",occurredAt:at(),verified:true})).rejects.toThrow();
  await writeFile(path.join(dir,f.attachment.storageKey),"tampered");
  await expect(service.recordDepositDeduction(admin,{...f.base,expectedVersion:1,commandKey:key(),amount:"1.00",occurredAt:at(),verified:true})).rejects.toThrow("Evidence bytes mismatch");
  const ledger=await service.getLeaseDepositLedger(admin,{leaseId:f.lease.id});expect(ledger.account.version).toBe(1);expect(ledger.total).toBe(1);expect(ledger.totals.heldLiability).toBe("5.00");
 });
 it("freezes financial and accepted attachment rows and rejects raw NaN reviews",async()=>{
  const f=await reviewed("5.00");const entry=f.result.items[0];
  await expect(db.$executeRaw`UPDATE "DepositEntry" SET amount=6 WHERE id=${entry.id}::uuid`).rejects.toThrow();
  await expect(db.$executeRaw`DELETE FROM "DepositEntry" WHERE id=${entry.id}::uuid`).rejects.toThrow();
  await expect(db.$executeRaw`UPDATE "Attachment" SET bytes=1 WHERE id=${f.attachment.id}::uuid`).rejects.toThrow();
  const raw=await fixture();await db.depositAccount.create({data:{leaseId:raw.lease.id}});
  await expect(db.$executeRaw`UPDATE "DepositAccount" SET "reviewState"='REVIEWED',version=1,"reviewedById"=${admin.id}::uuid,"reviewedAt"=CURRENT_TIMESTAMP,"legacyDigest"=deposit_legacy_digest(${raw.lease.id}::uuid),"reviewReason"='Synthetic',"evidenceId"=${raw.evidence.id}::uuid,"openingAmount"='NaN'::numeric WHERE "leaseId"=${raw.lease.id}::uuid`).rejects.toThrow();
  expect((await db.depositAccount.findUniqueOrThrow({where:{leaseId:raw.lease.id}})).reviewState).toBe("UNREVIEWED");
 });
 it("serializes competing spends and duplicate commands without partial commits",async()=>{
  const f=await reviewed("10.00");const data={...f.base,expectedVersion:1,amount:"7.00",occurredAt:at(),verified:true};
  const results=await Promise.allSettled([service.recordDepositDeduction(admin,{...data,commandKey:key()}),service.recordDepositDeduction(admin,{...data,commandKey:key()})]);
  expect(results.filter(row=>row.status==="fulfilled")).toHaveLength(1);
  expect((await service.getLeaseDepositLedger(admin,{leaseId:f.lease.id})).totals.heldLiability).toBe("3.00");
  const second=await reviewed();const receipt={...second.base,expectedVersion:1,commandKey:key(),amount:"0.01",occurredAt:at(),verified:true,method:"CASH"};
  const [a,b]=await Promise.all([service.recordDepositReceipt(admin,receipt),service.recordDepositReceipt(admin,receipt)]);expect(a).toEqual(b);expect(a.total).toBe(1);
 });
 it("rejects historical drift and new receipts on ended leases while permitting refunds",async()=>{
  const f=await reviewed("10.00");await db.lease.update({where:{id:f.lease.id},data:{status:"ENDED"}});
  await expect(service.recordDepositReceipt(admin,{...f.base,expectedVersion:1,commandKey:key(),amount:"1.00",occurredAt:at(),verified:true,method:"CASH"})).rejects.toMatchObject({code:"LEASE_NOT_ACTIVE"});
  const refund=await service.recordDepositRefund(admin,{...f.base,expectedVersion:1,commandKey:key(),amount:"1.00",occurredAt:at(),settlementReviewed:true,method:"CASH",payeeName:"Synthetic"});expect(refund.totals.heldLiability).toBe("9.00");
  await db.securityDeposit.create({data:{leaseId:f.lease.id,kind:"RECEIVED",amount:"0.01",occurredAt:new Date()}});
  await expect(service.recordDepositRefund(admin,{...f.base,expectedVersion:2,commandKey:key(),amount:"1.00",occurredAt:at(),settlementReviewed:true,method:"CASH",payeeName:"Synthetic"})).rejects.toMatchObject({code:"LEGACY_CHANGED"});
 });
});
