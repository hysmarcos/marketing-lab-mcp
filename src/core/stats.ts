/** Statistics primitives. Pure, dependency-free, checked against scipy in tests. */

const EPS = 1e-16;
const TINY = 1e-300;
const MAX_ITER = 10000;

// Lanczos approximation (g = 7, n = 9), accurate to about 1e-15.
const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
  1.5056327351493116e-7,
];

function logGamma(x: number): number {
  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }
  const z = x - 1;
  let sum = LANCZOS[0] as number;
  for (let i = 1; i < LANCZOS.length; i++) {
    sum += (LANCZOS[i] as number) / (z + i);
  }
  const t = z + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(sum);
}

/** Upper regularized incomplete gamma Q(1/2, x), which equals erfc(sqrt(x)). */
function upperGammaHalf(x: number): number {
  if (x <= 0) return 1;
  const a = 0.5;
  const lnPrefix = -x + a * Math.log(x) - Math.log(Math.sqrt(Math.PI));
  if (x < a + 1) {
    // Series for P(a, x); Q = 1 - P.
    let term = 1 / a;
    let sum = term;
    let ap = a;
    for (let n = 0; n < MAX_ITER; n++) {
      ap += 1;
      term *= x / ap;
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * EPS) break;
    }
    return 1 - sum * Math.exp(lnPrefix);
  }
  // Continued fraction for Q(a, x) (modified Lentz).
  let b = x + 1 - a;
  let c = 1 / TINY;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < MAX_ITER; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < TINY) d = TINY;
    c = b + an / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < EPS) break;
  }
  return Math.exp(lnPrefix) * h;
}

/** Standard normal CDF. Keeps relative accuracy in the tails. */
export function normalCdf(z: number): number {
  if (Number.isNaN(z)) return Number.NaN;
  const tail = 0.5 * upperGammaHalf((z * z) / 2); // P(Z > |z|)
  return z >= 0 ? 1 - tail : tail;
}

// Acklam's rational approximation coefficients.
const A = [
  -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2,
  -3.066479806614716e1, 2.506628277459239,
];
const B = [
  -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1,
  -1.328068155288572e1,
];
const C = [
  -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734,
  4.374664141464968, 2.938163982698783,
];
const D = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
const P_LOW = 0.02425;

function poly(coeffs: number[], x: number): number {
  let r = 0;
  for (const c of coeffs) r = r * x + c;
  return r;
}

/** Inverse standard normal CDF (Acklam's algorithm plus one Halley refinement step). */
export function normalPpf(p: number): number {
  if (!(p > 0 && p < 1)) {
    throw new RangeError(`normalPpf: p must be in (0, 1), got ${p}`);
  }
  let x: number;
  if (p < P_LOW) {
    const q = Math.sqrt(-2 * Math.log(p));
    x = poly(C, q) / (poly(D, q) * q + 1);
  } else if (p <= 1 - P_LOW) {
    const q = p - 0.5;
    const r = q * q;
    x = (poly(A, r) * q) / (poly(B, r) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    x = -poly(C, q) / (poly(D, q) * q + 1);
  }
  // One refinement step brings the ~1e-9 relative error down to machine precision.
  const e = normalCdf(x) - p;
  const u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2);
  return x - u / (1 + (x * u) / 2);
}

/** Survival function of a chi-square distribution with 1 degree of freedom. */
export function chiSquare1Sf(x: number): number {
  if (!(x > 0)) return 1;
  return upperGammaHalf(x / 2);
}

/** Continued fraction for the incomplete beta function (Numerical Recipes betacf, Lentz). */
function betaContinuedFraction(x: number, a: number, b: number): number {
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAX_ITER; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < EPS) break;
  }
  return h;
}

/** Regularized incomplete beta function I_x(a, b). */
export function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (!(x >= 0 && x <= 1)) throw new RangeError(`x must be in [0, 1], got ${x}`);
  if (!(a > 0 && b > 0)) throw new RangeError(`a and b must be positive, got ${a}, ${b}`);
  if (x === 0) return 0;
  if (x === 1) return 1;
  const lnFront =
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log1p(-x);
  const front = Math.exp(lnFront);
  if (x < (a + 1) / (a + b + 2)) {
    return (front * betaContinuedFraction(x, a, b)) / a;
  }
  return 1 - (front * betaContinuedFraction(1 - x, b, a)) / b;
}

/** Upper-tail probability P(T > t) of Student's t. Two-sided p-value is 2 * studentTSf(|t|, df). */
export function studentTSf(t: number, df: number): number {
  if (!(df > 0)) throw new RangeError(`df must be positive, got ${df}`);
  if (Number.isNaN(t)) return Number.NaN;
  if (t === 0) return 0.5;
  const tail = 0.5 * regularizedIncompleteBeta(df / (df + t * t), df / 2, 0.5); // P(T > |t|)
  return t > 0 ? tail : 1 - tail;
}
