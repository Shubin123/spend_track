# Spend Track

A high-fidelity spending tracker prototype. No build step or dependencies: just static HTML, CSS, and vanilla JS.

**Live demo:** https://shubin123.github.io/spend_track/

## Features

- **Dashboard**: spent, income, net saved, and budget-left KPIs; a cumulative spending-pace chart compared with last month and budget pace; a category donut; a 6-month income vs. spend trend; recent activity
- **Transactions**: grouped by day, with search, category and type filters, add/edit/delete (with undo), and CSV export
- **Budgets**: per-category monthly limits with progress, on-track / at-risk / over status, and end-of-month projection
- Month navigation, light and dark themes, responsive layout with a mobile tab bar, and the `n` keyboard shortcut for a new transaction
- Data is stored in your browser's `localStorage` and seeded with realistic demo data. Use **Reset demo** to restore it.

## Run locally

```sh
python3 -m http.server 8000
# open http://localhost:8000
```
