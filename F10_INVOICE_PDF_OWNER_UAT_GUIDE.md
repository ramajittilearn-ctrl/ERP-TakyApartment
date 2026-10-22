# F-10 Invoice PDF Owner UAT guide

This change adds an invoice PDF download for issued Stage 3C invoices. UAT should use a controlled synthetic or approved test invoice, not a draft invoice or unrelated real tenant record.

## Find and download the PDF

1. Sign in to ERP-TakyApartment as an authorized ADMIN or STAFF user.
2. Open **Billing** and select the invoice row to open its details.
3. For a managed **ISSUED** invoice, select **ดาวน์โหลด PDF** (Download PDF). The file name follows `Invoice_INV-YYYYMM-0001.pdf`.
4. A managed **VOID** invoice remains downloadable for historical traceability; verify the VOID label and original amounts.
5. A **DRAFT** invoice has no official PDF. The action is disabled and explains that download is available after issuance. Legacy unmanaged invoices do not support this download.

## Verify the document

- Compare invoice number, billing period, issue date, due date, status, room, tenant, and lease reference with the issued invoice record.
- Compare rent, water consumption/rate/charge, electricity consumption/rate/charge, and total payable with the persisted issued invoice snapshot. A PDF downloaded again after live rent, tenant, address, lease number, or utility-rate changes must retain the original invoice facts.
- Amount lines and total use THB and two decimal places. Meter quantities use their persisted precision; water is shown in m³ and electricity in kWh. Utility rates retain their persisted precision.
- Check that long Thai names and addresses wrap and remain readable. Confirm tone marks and vowels appear above/below the correct characters and do not overlap or clip.
- Confirm the document is A4 and prints without cropping. Use the PDF viewer’s **Actual size** or **Fit to printable area** option; avoid browser scaling that cuts off content. Inspect both on-screen preview and one print/PDF output if available.
- For VOID documents, confirm the VOID marking is visible and amounts match the historical invoice. The download must not change invoice history or create another invoice number.

## Known limitations

- The current property schema has no configured phone/contact field, so none appears.
- Historical invoices created before freeze-time address and lease-reference capture may show the address as unavailable and the lease reference as an em dash. They are never completed from current mutable records.
- The approved schema does not define legal/tax registration fields or a footer; no tax, VAT, discount, or optional fee was added.
- Automated checks confirmed embedded OFL Noto Sans Thai fonts, Unicode maps, A4 dimensions, and wrapping behavior. Engineering could not inspect a screenshot because local PDF preview was blocked by the current browser security policy. Owner visual acceptance is a required closure step.

Record the invoice number, browser/PDF viewer, results for each check above, any clipped/overlapping characters, and acceptance or corrective findings. Do not use Owner UAT for engineering integration tests.
