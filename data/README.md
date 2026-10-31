# Data summaries

This folder holds the small JSON files the tools read at run time. The raw datasets are never
committed: `prep/` downloads them to `.cache/raw/` (ignored by git), turns them into the summaries
here, and the server only ever reads the summaries. To rebuild a file you need
[uv](https://docs.astral.sh/uv/) and an internet connection; the download is cached after the first
run.

## Hillstrom e-mail experiment

File: `hillstrom_cells.json` (about 12 KB). Used by the `email_test_analyze` tool.

- **Source:** Kevin Hillstrom, "MineThatData E-Mail Analytics And Data Mining Challenge", 2008.
  <http://www.minethatdata.com/Kevin_Hillstrom_MineThatData_E-MailAnalytics_DataMiningChallenge_2008.03.20.csv>
  (if that host is down, `prep/download.py` falls back to a public mirror and checks its checksum).
- **License:** the dataset states none. The raw rows are not redistributed here. The JSON keeps
  only aggregated counts and sums, and carries a `license_note` that credits the source.
- **Rebuild:** `uv run python -m prep hillstrom`. The same command also writes
  `tests/fixtures/email_reference.json`, the scipy/statsmodels reference values used by the tests.
- **What the summary keeps:** 64,000 customers were split at random into three arms: `mens`
  (men's merchandise e-mail), `womens` and `control` (no e-mail). For each arm there is one cell
  per value of `overall`, `history_segment`, `zip_code`, `channel`, `newbie` (`new` or `existing`),
  `mens` and `womens` (`bought` or `not_bought` before). Each cell stores `n` (customers), `visits`,
  `conversions`, `spend_sum` and `spend_sq_sum` (sum of squared spend). The two spend sums are
  enough to compute the mean and the sample variance, so the server can run a Welch t-test without
  any customer row. `Surburban` in the raw file is corrected to `Suburban`.

## Marketing mix model results

File: `mmm_results.json` (about 140 KB). Used by the `budget_simulate` and `budget_optimize` tools.

- **Source:** the `marketing-mix-model` project, <https://github.com/hysmarcos/marketing-mix-model>,
  file `site/data/resultados.json` at commit `d570d33`. It is a Bayesian marketing mix model
  (PyMC-Marketing) fitted on Meta Robyn's simulated demo dataset (`dt_simulated_weekly`).
- **License:** MIT, from [Robyn](https://github.com/facebookexperimental/Robyn) (the demo data) and
  the source project. The data is simulated, so it describes no real business.
- **What it contains:** `meta` (13-week horizon, adstock length 8, 200 posterior draws),
  `history` (the last weeks of real spend per channel, needed for the carry-over effect),
  `channels` and `channel_labels` (tv, ooh, print, facebook, search), `scales`, `draws`
  (posterior draws of the saturation and carry-over parameters per channel and of the weekly
  baseline), `spend_max_weekly` (the highest weekly spend seen per channel), and `plans` (the
  current plan, about $41,100 per week, and the optimum the source project found). The file also
  carries fields the tools do not read (contributions, ROI, holdout, diagnostics, headline).
- **Fixed snapshot:** the file is copied as is and is not rebuilt here. To update it, copy the file
  again from the source project and say which commit it came from. `tests/fixtures/simulator_cases.json`
  (a reduced results object plus four plans with the values the Python model gives) is copied from
  the same commit; the tests use it to check that the TypeScript port matches Python.

## Olist e-commerce and marketing funnel

Files: `olist_sales.json` (about 300 KB), `olist_rfm.json` (about 35 KB) and `olist_funnel.json`
(about 38 KB). They feed the sales, RFM and funnel tools. `tests/fixtures/rfm_parity.json` is a
test file made by the same script (see "RFM rules" below).

- **Sources:** both are public datasets on Kaggle, published by Olist, a Brazilian marketplace.
  - Olist, "Brazilian E-Commerce Public Dataset", Kaggle:
    <https://www.kaggle.com/datasets/olistbr/brazilian-ecommerce> (about 45 MB zip). It feeds
    `olist_sales.json` and `olist_rfm.json`.
  - Olist, "Marketing Funnel by Olist", Kaggle:
    <https://www.kaggle.com/datasets/olistbr/marketing-funnel-olist> (about 0.3 MB zip). It feeds
    `olist_funnel.json`.
- **License:** CC BY-NC-SA 4.0, <https://creativecommons.org/licenses/by-nc-sa/4.0/>. Attribution:
  "Olist, Brazilian E-Commerce Public Dataset, Kaggle" (for the funnel file: "Olist, Marketing
  Funnel by Olist, Kaggle"). Every file has `source` and `license` fields with this text. The use is
  **non-commercial**, and these three files are derived from the data, so **ShareAlike** applies:
  keep them under CC BY-NC-SA 4.0 if you copy or change them. The code of this repository is MIT;
  only these derived data files carry the Olist license.
- **Rebuild:** `uv run python -m prep olist funnel`. It downloads both zips to `.cache/raw/` once
  (anonymous GET, no account needed), reads the CSV files straight from the zips, and writes the
  three summaries and `tests/fixtures/rfm_parity.json`.

### `olist_sales.json`

A columnar cube: `months`, `categories` and `states` are lists, and `rows` holds parallel arrays
(`m`, `c`, `s` are indexes into those lists, then `orders`, `items`, `revenue`, `review_sum`,
`review_n`, `late_n`). One row per month, category and state that has sales.

- Only **delivered** orders, bought from 2017-01 to 2018-08 (96,211 orders). Earlier months have
  too few orders.
- `revenue` is the sum of item `price` in BRL, without freight.
- The category is `product_category_name_english`. A product without a name or without a
  translation is `unknown` (1,557 of 109,880 items). An order with items in two categories counts
  once in each, so the sum of `orders` over all rows (97,007) is larger than the number of orders.
- `review_sum` and `review_n` use the order's latest review by `review_answer_timestamp`. Orders
  with no review are not in `review_n`.
- `late_n` counts orders delivered after the estimated delivery date (`order_delivered_customer_date`
  later than `order_estimated_delivery_date`). Orders with no delivery date are not late.
- The file keeps all 72 categories, so no category was rolled into `other` (that rule was ready for
  a file over 900 KB, but the cube is far smaller).

### `olist_rfm.json`

`summary` has one row per `state` and `segment` with `customers`, `revenue`, `avg_recency_days`,
`avg_orders` and `avg_monetary`, for 93,358 customers (`customer_unique_id`) with at least one
delivered order before `as_of`. The state is the one of the customer's most recent order.

#### RFM rules

`as_of` is `2018-09-01`, the day after the last full month in the data. The same rules are in the
`rules` field of the file.

- **R** is the number of whole days from the date of the customer's last purchase to `as_of`.
  **F** is the number of distinct delivered orders. **M** is the sum of item prices (no freight).
- **R score** and **M score** are quintiles from 1 to 5: `pd.qcut` on `rank(method="first")`.
  R is ranked with the smallest number of days first, and the scores are reversed so that R=5 is the
  most recent fifth. M=5 is the highest-spending fifth. Ties are broken by input order (customers
  sorted by `customer_unique_id`).
- **F score:** 1 order is 1, 2 orders is 3, 3 or more orders is 5.
- **Segment**, the first match wins: `champions` (R 4 or more and F 3 or more), `loyal` (F 3 or
  more), `big_spenders_new` (R 4 or more and M 5), `recent` (R 4 or more), `needs_attention` (R 3),
  `at_risk_high_value` (R 2 or less and M 4 or more), `hibernating` (everything else). Note that F
  is 3 for two orders, so a customer with two orders already counts as `loyal`.
- `tests/fixtures/rfm_parity.json` has 40 synthetic customers (seed 7) with their R, F, M scores
  and segment from the Python function. It has ties in recency and in revenue on purpose, and all
  seven segments. The TypeScript port is tested against it.

### `olist_funnel.json`

- `mql`: the 8,000 marketing qualified leads counted by month of first contact (2017-06 to
  2018-05) and by `origin`. `counts[month][origin]` follows the order of `months` and `origins`.
- `deals`: columns for the 842 closed deals, joined to their lead by `mql_id`: `origin`,
  `contact_month`, `segment` (the seller's `business_segment`) and `days_to_close` (days from
  first contact to the won date, using calendar days). One deal in the source was won two days
  before its recorded first contact, so its value is -2; it is kept as is.
- A blank `origin` (60 leads) or a blank segment is stored as `unknown`. The source already has an
  `unknown` origin, so the two are merged: there are 10 origins, not 11.

## Simulated customer journeys

`journeys_sample.json` (about 350 KB) feeds the `attribution_compare` tool. **It is not real data.**
It is generated by `prep/journeys.py` with `numpy.random.default_rng(42)`, so it is the same on
every run, and it has no source or license beyond the MIT license of this repository. Its purpose
is to have a ground truth: because the generator knows how much each channel really moves the
conversion probability, the tool can score attribution models against it.

- **Rebuild:** `uv run python -m prep journeys`. No download.
- **Format:** `{ source, channels, truth, journeys }`. `journeys` has one row per distinct path
  (`path`, `conversions`, `nulls`), so it adds up to 20,000 users. `truth` has one share per
  channel and the shares add up to 1.

### Generator rules

- 20,000 users. Channels: `display`, `paid_social`, `paid_search`, `email`, `organic_search`,
  `direct`.
- **Path length** is 1 + Poisson(2), capped at 8 touches.
- **First touch** is drawn from display .35, paid_social .30, paid_search .15, organic_search .15,
  email .03, direct .02.
- **Last touch** (only for paths of two or more touches) is drawn from direct .35, email .25,
  organic_search .20, paid_search .15, paid_social .03, display .02.
- **Middle touches** are uniform over the six channels. Repeats are allowed.
- **Draw order** (one generator, so any change here changes every value after it): path lengths,
  first touches, middle touches, last touches, then the conversion outcomes. The middle draw takes
  users x 8 values (one per position, used or not) and the last draw is made for every user, even
  for paths of one touch.
- **Conversion:** the chance that a user converts is `p = 1 - 0.99 * prod(1 - e_c)` over the set
  of channels in the path, with e: display .06, paid_social .05, paid_search .04, email .03,
  organic_search .02, direct .005. The outcome is one Bernoulli draw per user. A user who converts
  is counted in `conversions` of their path, the others in `nulls`.

The setup is built on purpose to fool last-touch: display and paid_social start most journeys and
work hardest, while direct and email close most of them but add little.

What the sample shows (mean absolute error of the shares, lower is better): last touch is by far the
worst (0.159); first touch (0.052), linear (0.063) and Shapley (0.063) land closest to the truth,
and Markov (0.080) sits in between. Markov does not win here because the generator draws middle
touches uniformly, so a first-order chain over the channels sees little structure and flattens the
shares toward equal. This is a property of this simulator, not a general ranking: a data-driven
model does not always beat a rule-based one.

### Truth: counterfactual removal effect

For channel c, `lift_c` is the sum over all users of `p - p_without_c`, where `p_without_c` is the
conversion probability of the same user with c taken out of the path (the same formula, without
the factor of c; users who never touched c add 0). The truth share is `lift_c` divided by the sum
of all lifts, so the shares add up to 1. It is computed from the probabilities, not from the
random outcomes, so it has no sampling noise. Like any share of a sum of effects, it splits the
effect of channels that work together by their individual removal, and it depends on the
simulator's assumptions.
