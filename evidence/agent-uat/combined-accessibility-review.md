# Combined invoice accessibility correction

The full browser run `8a6f2e8f5b3166f805353e53` completed with 68 passes and one failure. Its log, `evidence/agent-uat/combined-full-browser.log`, records a Playwright strict-mode failure in the invoice loading assertion. The generic text `โหลด` matched both the billing history status `กำลังโหลดประวัติ…` and the invoice status `กำลังโหลดใบแจ้งหนี้…`.

The assertion now selects the invoice status by its complete visible message. It still requires the `status` role and a visible loading state. This matches the actual invoice loading element in `src/features/invoices/screen.tsx`. The billing history loader remains unchanged.

All four Axe scans, the disabled and enabled reload assertions, populated invoice assertions, error and recovery assertions, screenshot capture, and timeouts remain unchanged. No application code changed. The Main Agent will execute a fresh full browser run and arrange independent review before accepting this correction. This note does not claim that rerun has passed.

Main Agent independently compared the one-line correction with the live source status at src/features/invoices/screen.tsx and the preserved strict-mode failure. The exact invoice loading message is unique in the source. The correction retains all test assertions and does not change application behavior. Code review accepted; fresh full-suite result remains separately recorded.
