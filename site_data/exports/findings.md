# Findings (REAL data)

Coverage: 2019-01 to 2025-06 (77 months), 3677 flagged batches (61 spurious).
1523 manufacturer spellings resolved to 1392 companies and 1505 factory sites.

Wording rule: a row here means "flagged in a CDSCO alert" for one tested batch. It is not a judgement on a company.

## Repeat offenders (sites flagged in 3+ months)
| company_name | state | district | months_flagged | total_flags | first_flag_month | last_flag_month | spellings_seen |
|---|---|---|---|---|---|---|---|
| Karnataka Antibiotics & Pharmaceuticals Limited | Karnataka |  | 30 | 38 | 2019-07 | 2025-06 | 1 |
| Jackson Laboratories Pvt. Ltd | Punjab |  | 29 | 50 | 2019-02 | 2025-05 | 2 |
| Mascot Health Series Pvt. Ltd | Uttarakhand | Haridwar | 26 | 32 | 2019-12 | 2025-03 | 3 |
| Unicure India Ltd | Uttar Pradesh | Gautam Budh Nagar | 25 | 33 | 2019-04 | 2025-06 | 1 |
| Zee Laboratories Ltd | Himachal Pradesh | Sirmaur | 20 | 28 | 2019-06 | 2025-06 | 1 |
| Himalaya Meditek Pvt. Ltd | Uttarakhand | Dehradun | 17 | 23 | 2019-02 | 2025-06 | 1 |
| Nestor Pharmaceuticals Limited | Haryana |  | 17 | 22 | 2019-07 | 2025-04 | 3 |
| Theon Pharmaceuticals Ltd | Himachal Pradesh | Solan | 17 | 18 | 2019-02 | 2025-05 | 1 |
| Apple Formulations Pvt. Ltd | Uttarakhand | Haridwar | 15 | 28 | 2020-04 | 2025-06 | 1 |
| Vivek Pharmachem (India) Ltd | Rajasthan |  | 15 | 20 | 2019-07 | 2025-05 | 3 |

## Where flagged factories are
| state | district | flags | sites | companies |
|---|---|---|---|---|
| Himachal Pradesh | Solan | 686 | 268 | 258 |
| Uttarakhand | Haridwar | 402 | 120 | 117 |
| Himachal Pradesh | Sirmaur | 223 | 82 | 77 |
| Unknown |  | 184 | 109 | 108 |
| Punjab |  | 141 | 47 | 46 |
| Haryana |  | 105 | 49 | 49 |
| Uttarakhand | Dehradun | 104 | 37 | 35 |
| Maharashtra |  | 102 | 65 | 63 |
| Tamil Nadu |  | 102 | 54 | 53 |
| Madhya Pradesh | Indore | 101 | 32 | 32 |

## Why medicines failed
| reason_primary | flags |
|---|---|
| assay | 1379 |
| dissolution | 880 |
| description | 258 |
| other | 247 |
| sterility | 170 |
| particulate matter | 169 |
| disintegration | 121 |
| impurities | 87 |

## QR-coded brands in alerts since Aug 2023
| qr_brand | spurious_batches | nsq_batches |
|---|---|---|
| Augmentin | 1 | 0 |
| Shelcal | 1 | 1 |

## Re-flag model
Test period 2024-07 to 2025-06. Watch list of 20 sites per month.

| | model | baseline (last 6 months) |
|---|---|---|
| precision@20 | 0.2958 | 0.3333 |
| average precision | 0.1668 | 0.1624 |

Model beat the baseline in 3 of 12 test months (tied in 2). Base rate: 0.0408.

Re-flag model on factories already flagged at least once. CDSCO samples are not random, so this predicts where regulators find failures, not true quality.

## Data quality
| check | status | value | detail |
|---|---|---|---|
| rows match stated totals | FAIL | 42/57 files | files: 2019-10_combined_5224.pdf, 2019-11_combined_5349.pdf, 2019-12_combined_6840.pdf, 2021-05_combined_7357.pdf, 2021-08_combined_7656.pdf |
| files parsed without errors | PASS | 128/128 |  |
| pages with rows but no table found | WARN | 6 | re-run with --llm to read these pages |
| rows with a batch number | PASS | 99.9% |  |
| rows with a manufacturer | PASS | 99.8% |  |
| rows with a drug name | PASS | 99.9% |  |
| non-spurious rows linked to a site | PASS | 99.8% |  |
| manufacture date before expiry | WARN | 3675/3677 | 2 rows have mfg after expiry |
| states from address text or district (not PIN alone) | PASS | 87.7% | a state taken from the PIN code alone is approximate |
| months with at least one alert | WARN | 77/78 | missing: 2021-06 |
| rows read by the LLM fallback | PASS | 0 | none |
