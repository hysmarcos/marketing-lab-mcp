"""Writes tests/fixtures/abtest_reference.json with scipy/statsmodels reference values.

The TypeScript implementations in src/core are checked against this file.
Run with: uv run python -m prep reference
"""

import json
import math
from pathlib import Path

from scipy import integrate, stats
from scipy.special import betainc
from statsmodels.stats.proportion import proportions_ztest

OUT = Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "abtest_reference.json"

# (name, control visitors, control conversions, variant visitors, variant conversions)
AB_CASES = [
    ("basic", 10000, 500, 10000, 570),
    ("hillstrom_sized", 21306, 1210, 21387, 1352),
    ("zero_control", 1000, 0, 1000, 3),
    ("srm", 10000, 500, 10600, 530),
]
CONFIDENCE = 0.95
EXPECTED_SPLIT = 0.5

# (baseline_rate, mde_relative, alpha, power, variants)
SAMPLE_SIZE_CASES = [
    (0.10, 0.10, 0.05, 0.8, 2),
    (0.03, 0.20, 0.05, 0.8, 2),
    (0.05, 0.15, 0.05, 0.9, 2),
    (0.05, 0.15, 0.05, 0.8, 4),
]

# (mean1, std1, n1, mean2, std2, n2)
WELCH_CASES = [
    (12.5, 30.0, 4000, 13.4, 33.0, 4100),
    (0.9, 2.5, 25, 1.6, 3.1, 30),
    (150.0, 40.0, 21306, 152.0, 41.0, 21387),
]

BETAINC_CASES = [
    (0.5, 2.0, 3.0),
    (0.1, 0.5, 0.5),
    (0.9, 5.0, 1.5),
    (0.0215, 1210.5, 20097.5),
    (0.3, 40.0, 12.0),
    (0.999, 0.5, 20000.0),
    (0.5, 0.5, 0.5),
    (0.25, 1.0, 1.0),
]

NORMAL_Z = [-8.0, -5.0, -3.1, -1.96, -1.0, -0.25, 0.0, 0.5, 1.0, 1.644854, 1.96, 2.5, 4.0, 6.0]
PPF_P = [1e-10, 1e-6, 0.001, 0.01, 0.02425, 0.025, 0.1, 0.3, 0.5, 0.7, 0.9, 0.975, 0.99, 0.999999]
CHI2_X = [0.0, 0.01, 0.5, 1.0, 3.84, 10.83, 17.48, 40.0, 100.0]
T_CASES = [
    (0.0, 5),
    (0.5, 1),
    (1.0, 2),
    (2.0, 10),
    (-2.0, 10),
    (2.5, 30),
    (3.0, 100),
    (-1.5, 3),
    (4.2, 25),
    (1.96, 40000),
    (0.8, 42000),
]


def sample_size(p1: float, mde: float, alpha: float, power: float, variants: int) -> int:
    p2 = p1 * (1 + mde)
    pbar = (p1 + p2) / 2
    a = alpha / (variants - 1) if variants > 2 else alpha
    za = stats.norm.ppf(1 - a / 2)
    zb = stats.norm.ppf(power)
    num = (
        za * math.sqrt(2 * pbar * (1 - pbar)) + zb * math.sqrt(p1 * (1 - p1) + p2 * (1 - p2))
    ) ** 2
    return math.ceil(num / (p2 - p1) ** 2)


def prob_b_better_exact(ca: int, na: int, cb: int, nb: int) -> float:
    """P(B > A) for independent Beta(1+c, 1+n-c) posteriors, by numerical integration."""
    a = stats.beta(1 + ca, 1 + na - ca)
    b = stats.beta(1 + cb, 1 + nb - cb)
    value, _ = integrate.quad(lambda x: a.pdf(x) * b.sf(x), 0, 1, limit=500, points=[a.mean()])
    return value


def ab_case(name: str, na: int, ca: int, nb: int, cb: int) -> dict:
    z, p = proportions_ztest([cb, ca], [nb, na], value=0)  # pooled variance (value=0)
    pa, pb = ca / na, cb / nb
    se = math.sqrt(pa * (1 - pa) / na + pb * (1 - pb) / nb)
    zc = stats.norm.ppf(1 - (1 - CONFIDENCE) / 2)
    diff = pb - pa
    total = na + nb
    exp = [total * EXPECTED_SPLIT, total * (1 - EXPECTED_SPLIT)]
    chi2, srm_p = stats.chisquare([na, nb], f_exp=exp)
    a_alpha, a_beta = 1 + ca, 1 + na - ca
    b_alpha, b_beta = 1 + cb, 1 + nb - cb
    ma, mb = stats.beta.mean(a_alpha, a_beta), stats.beta.mean(b_alpha, b_beta)
    va, vb = stats.beta.var(a_alpha, a_beta), stats.beta.var(b_alpha, b_beta)
    return {
        "name": name,
        "control": {"visitors": na, "conversions": ca},
        "variant": {"visitors": nb, "conversions": cb},
        "confidence": CONFIDENCE,
        "expected_split": EXPECTED_SPLIT,
        "z": float(z),
        "p_value": float(p),
        "absolute_diff": diff,
        "ci_low": diff - zc * se,
        "ci_high": diff + zc * se,
        "srm_chi2": float(chi2),
        "srm_p_value": float(srm_p),
        "prob_variant_better_normal": float(stats.norm.cdf((mb - ma) / math.sqrt(va + vb))),
        "prob_variant_better_exact": prob_b_better_exact(ca, na, cb, nb),
    }


def welch_case(m1: float, s1: float, n1: int, m2: float, s2: float, n2: int) -> dict:
    t, p = stats.ttest_ind_from_stats(m1, s1, n1, m2, s2, n2, equal_var=False)
    v1, v2 = s1**2 / n1, s2**2 / n2
    df = (v1 + v2) ** 2 / (v1**2 / (n1 - 1) + v2**2 / (n2 - 1))
    return {
        "mean1": m1,
        "std1": s1,
        "n1": n1,
        "mean2": m2,
        "std2": s2,
        "n2": n2,
        "t": float(t),
        "df": df,
        "p_value": float(p),
    }


def build() -> dict:
    return {
        "ab_cases": [ab_case(n, na, ca, nb, cb) for n, na, ca, nb, cb in AB_CASES],
        "sample_size": [
            {
                "baseline_rate": p1,
                "mde_relative": mde,
                "alpha": al,
                "power": pw,
                "variants": k,
                "per_variant": sample_size(p1, mde, al, pw, k),
            }
            for p1, mde, al, pw, k in SAMPLE_SIZE_CASES
        ],
        "welch": [welch_case(*c) for c in WELCH_CASES],
        "betainc": [
            {"x": x, "a": a, "b": b, "value": float(betainc(a, b, x))} for x, a, b in BETAINC_CASES
        ],
        "normal_cdf": [{"z": z, "value": float(stats.norm.cdf(z))} for z in NORMAL_Z],
        "normal_ppf": [{"p": p, "value": float(stats.norm.ppf(p))} for p in PPF_P],
        "chi2_1_sf": [{"x": x, "value": float(stats.chi2.sf(x, 1))} for x in CHI2_X],
        "student_t_sf": [
            {"t": t, "df": df, "value": float(stats.t.sf(t, df))} for t, df in T_CASES
        ],
    }


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(build(), indent=2) + "\n")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
