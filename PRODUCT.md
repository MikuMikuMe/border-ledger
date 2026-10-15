# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

delegated: React + TypeScript + Vite served from a Cloudflare Worker with D1 and Queues bindings; GitHub Actions owns checks and Cloudflare owns deployment.

## Users

One private user managing personal spending across a Canadian RBC account and a Bank of China account.

## Product Purpose

Provide a trustworthy daily, weekly, and monthly view of spending across CAD and CNY accounts. Success means the user can import a bank statement, understand what is counted, review uncertain records, and see source currency totals without double-counting transfers, refunds, or pending records.

## Positioning

This is a reconciliation-first personal ledger: automatic bank records and provisional alerts are kept distinct until the user can trust the total.

## Operating Context

The user checks the app on desktop and phone, imports CSV/XLSX statements, reviews uncertain records, and eventually connects RBC through Plaid. Bank of China notifications may arrive through a separate Android companion later; the web app does not assume it can read phone notifications.

## Capabilities and Constraints

- Store original currency and integer minor units for every transaction.
- Report CAD and CNY separately by default, with an optional converted CAD estimate and visible rate date.
- Classify expenses, income, transfers, refunds, and fees.
- Support imports with preview, duplicate detection, and review before commit.
- Keep provisional alert records separate from confirmed bank records.
- Exclude transfers and credit-card repayments from spending totals.
- Preserve source dates and use an explicit reporting timezone and week start.
- Do not collect bank passwords; Plaid, device credentials, and webhook verification are separate integration paths.
- Live Plaid and Bank of China automation remain open dependencies until account access and source formats are proven.

## Evidence on Hand

The approved cross-border spending tracker plan is recorded in the referenced planning chat. No real bank statement, Plaid credential, or notification sample is available in the repository; all displayed transactions are labeled demo data until replaced by an import.

## Product Principles

1. Totals must explain themselves.
2. Source currency stays visible.
3. Provisional data never masquerades as confirmed data.
4. Reconciliation is a first-class workflow, not an error case.
5. Private financial data never belongs in source control, logs, or browser caches.

## Accessibility & Inclusion

The web surface should be keyboard usable, keep text contrast at accessible levels, avoid relying on color alone for transaction state, and remain useful at phone widths.
