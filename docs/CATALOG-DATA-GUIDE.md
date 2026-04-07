# CompoundIQ — Pharmacy Catalog Data Guide

**For pharmacy partners providing their medication catalog to CompoundIQ**

---

## What We Need

We need your pharmacy's compounding medication catalog in CSV format so your formulations appear in our clinic search engine. This allows clinics to find your pharmacy, compare pricing, and route prescriptions to you digitally.

---

## CSV Format

Please provide a CSV file with the following columns:

| Column | Required | Description | Example |
|--------|----------|-------------|---------|
| `medication_name` | Yes | Medication name as you list it | `Semaglutide` |
| `form` | Yes | Dosage form | `Injectable`, `Capsule`, `Topical Cream`, `Troche`, `Nasal Spray` |
| `dose` | Yes | Dose per unit | `0.5mg/0.5mL`, `200mg`, `4.5mg` |
| `strength` | No | Strength specification | `0.5mg`, `200mg` |
| `wholesale_price` | Yes | Your wholesale price to the clinic (USD) | `150.00` |
| `regulatory_status` | Yes | Current status | `ACTIVE` (available), `SUSPENDED` (temp unavailable) |
| `dea_schedule` | No | DEA schedule if controlled (2-5), leave blank if not | `3` for testosterone |
| `average_turnaround_days` | No | Typical business days from order to shipment | `5` |

### Required Columns

At minimum, every row must have: `medication_name`, `form`, `dose`, `wholesale_price`, `regulatory_status`

### Regulatory Status Values

| Value | Meaning |
|-------|---------|
| `ACTIVE` | Available for ordering |
| `SUSPENDED` | Temporarily unavailable (shown with warning to clinics) |

Do NOT include items you no longer compound. Only include currently available formulations.

### DEA Schedule

Only fill this in for controlled substances:
- `2` — Schedule II
- `3` — Schedule III (e.g., testosterone, ketamine)
- `4` — Schedule IV
- `5` — Schedule V
- Leave blank for non-controlled compounds

### Pricing

- Use your standard **wholesale** price to clinics (not retail/patient price)
- Clinics set their own retail markup on top of your wholesale price
- Prices in USD with two decimal places (e.g., `150.00`)
- If pricing varies by volume, provide your standard single-unit price

---

## Example CSV

```csv
medication_name,form,dose,strength,wholesale_price,regulatory_status,dea_schedule,average_turnaround_days
Semaglutide,Injectable,0.5mg/0.5mL,0.5mg,150.00,ACTIVE,,5
Semaglutide,Injectable,1mg/0.5mL,1mg,175.00,ACTIVE,,5
Tirzepatide,Injectable,2.5mg/0.5mL,2.5mg,225.00,ACTIVE,,5
Testosterone Cypionate,Injectable,200mg/mL,200mg,85.00,ACTIVE,3,3
Naltrexone (LDN),Capsule,4.5mg,4.5mg,45.00,ACTIVE,,3
Progesterone,Capsule,200mg,200mg,55.00,ACTIVE,,3
```

A complete template with 20 sample entries is attached as `catalog-csv-template.csv`.

---

## How to Submit

Send your CSV file to: **ops@compoundiq.com**

Include:
- Your pharmacy name
- Your primary contact name and phone number
- The states you are licensed to ship to
- Your preferred fax number (for order delivery until API integration is set up)

---

## What Happens Next

1. We upload your catalog to the CompoundIQ platform
2. Your pharmacy and formulations appear in clinic search results (filtered by state licensing)
3. Clinics can compare your pricing and turnaround times against other pharmacies
4. When a clinic selects your pharmacy, you receive a structured prescription order (via API, portal, or fax depending on your integration tier)

---

## Keeping Your Catalog Updated

- **Price changes:** Send us an updated CSV anytime. We track version history and flag changes >10% for review.
- **New formulations:** Add rows to your CSV and resubmit, or notify us to add individual items.
- **Discontinued items:** Set `regulatory_status` to `SUSPENDED` or remove from the CSV.
- **API sync (coming soon):** If your pharmacy has a REST API, we can sync your catalog automatically on a daily schedule — no manual CSV uploads needed.

---

## Questions?

Contact us at **ops@compoundiq.com** or call your CompoundIQ integration contact.

---

*CompoundIQ — Structured orders. Transparent pricing. No more faxes.*
