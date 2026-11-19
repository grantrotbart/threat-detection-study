/* =========================================================================
   stats.js — signal detection measures, 2x2 repeated-measures ANOVA,
   and the pilot-based simulation of additional participants.
   ========================================================================= */
(function (global) {
  'use strict';

  // ---------- distributions ----------
  // Inverse standard normal CDF (Acklam's algorithm, |error| < 1.15e-9)
  function zInv(p) {
    if (p <= 0) return -Infinity;
    if (p >= 1) return Infinity;
    const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
    const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
    const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
    const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
    const pl = 0.02425, ph = 1 - pl;
    let q, r;
    if (p < pl) {
      q = Math.sqrt(-2 * Math.log(p));
      return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    if (p <= ph) {
      q = p - 0.5; r = q * q;
      return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
    }
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  // Standard normal CDF via erfc (Numerical Recipes erfcc, |error| < 1.2e-7)
  function phi(x) {
    const z = Math.abs(x) / Math.SQRT2;
    const t = 1 / (1 + 0.5 * z);
    const erfc = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
    return x >= 0 ? 1 - erfc / 2 : erfc / 2;
  }

  function logGamma(x) {
    const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
    let y = x, tmp = x + 5.5;
    tmp -= (x + 0.5) * Math.log(tmp);
    let ser = 1.000000000190015;
    for (let j = 0; j < 6; j++) ser += g[j] / ++y;
    return -tmp + Math.log(2.5066282746310005 * ser / x);
  }
  function betacf(a, b, x) {
    const MAXIT = 300, EPS = 3e-14, FPMIN = 1e-300;
    let qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    d = 1 / d; let h = d;
    for (let m = 1; m <= MAXIT; m++) {
      const m2 = 2 * m;
      let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d; h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d; const del = d * c; h *= del;
      if (Math.abs(del - 1) < EPS) break;
    }
    return h;
  }
  // Regularized incomplete beta I_x(a,b)
  function ibeta(x, a, b) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
    if (x < (a + 1) / (a + b + 2)) return bt * betacf(a, b, x) / a;
    return 1 - bt * betacf(b, a, 1 - x) / b;
  }
  // Upper-tail p for F(df1, df2)
  function fPValue(F, df1, df2) {
    if (!isFinite(F) || F < 0) return NaN;
    return ibeta(df2 / (df2 + df1 * F), df2 / 2, df1 / 2);
  }

  // ---------- descriptives ----------
  function mean(a) { return a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN; }
  function sd(a) {
    if (a.length < 2) return NaN;
    const m = mean(a);
    return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
  }

  // ---------- signal detection ----------
  /**
   * counts: { hits, misses, fas, crs }  (timeouts already excluded)
   * Log-linear correction (Hautus, 1995): add 0.5 to each cell count and 1 to
   * each trial count so rates of 0 or 1 never produce infinite z-scores.
   */
  function sdt(counts) {
    const nS = counts.hits + counts.misses, nN = counts.fas + counts.crs;
    const H = (counts.hits + 0.5) / (nS + 1);
    const F = (counts.fas + 0.5) / (nN + 1);
    const zH = zInv(H), zF = zInv(F);
    const dprime = zH - zF;
    const c = -0.5 * (zH + zF);
    const lnBeta = c * dprime;          // ln(β) = c·d′
    return { hitRate: H, faRate: F, rawHitRate: nS ? counts.hits / nS : NaN, rawFaRate: nN ? counts.fas / nN : NaN, dprime, c, beta: Math.exp(lnBeta), lnBeta };
  }

  // ---------- 2x2 repeated-measures ANOVA ----------
  /**
   * rows: [{ id, FA15, FA5, MS15, MS5 }]  (A = AI bias: FA vs MS; B = time: 15 vs 5)
   * With two levels per factor, each RM-ANOVA effect is equivalent to a
   * one-sample t-test on a contrast score, F = t², df = (1, n−1).
   */
  function rmAnova2x2(rows) {
    const n = rows.length;
    if (n < 3) return null;
    const contrasts = {
      'AI bias': r => ((r.FA15 + r.FA5) - (r.MS15 + r.MS5)) / 2,
      'Time pressure': r => ((r.FA15 + r.MS15) - (r.FA5 + r.MS5)) / 2,
      'AI bias × Time': r => ((r.FA15 - r.FA5) - (r.MS15 - r.MS5)) / 2,
    };
    const out = [];
    for (const [name, fn] of Object.entries(contrasts)) {
      const L = rows.map(fn);
      const m = mean(L), s = sd(L);
      const dfE = n - 1;
      // SS_effect = n * 4 * (m/2)^2 * ... use F directly; also report SS for completeness
      const ssEffect = n * m * m;       // for the scaled contrast
      const ssError = L.reduce((acc, v) => acc + (v - m) ** 2, 0);
      const F = s > 0 ? (n * m * m) / (s * s) : (m === 0 ? 0 : Infinity);
      const p = s > 0 ? fPValue(F, 1, dfE) : (m === 0 ? 1 : 0);
      const eta = ssEffect + ssError > 0 ? ssEffect / (ssEffect + ssError) : 0;
      out.push({ effect: name, df1: 1, df2: dfE, F, p, partialEta2: eta, contrastMean: m });
    }
    return out;
  }

  // Paired t-test (simple effects)
  function pairedT(a, b) {
    const d = a.map((v, i) => v - b[i]);
    const n = d.length, m = mean(d), s = sd(d);
    const t = s > 0 ? m / (s / Math.sqrt(n)) : (m === 0 ? 0 : Infinity);
    const p = s > 0 ? fPValue(t * t, 1, n - 1) : (m === 0 ? 1 : 0);
    return { t, df: n - 1, p, meanDiff: m, dz: s > 0 ? m / s : NaN };
  }

  // ---------- simulation ----------
  function cholesky(S) {
    const n = S.length;
    for (let attempt = 0; attempt < 8; attempt++) {
      const jitter = attempt === 0 ? 0 : 1e-8 * Math.pow(10, attempt) * (S.reduce((s, r, i) => s + r[i], 0) / n || 1);
      const L = Array.from({ length: n }, () => new Array(n).fill(0));
      let ok = true;
      for (let i = 0; i < n && ok; i++) {
        for (let j = 0; j <= i; j++) {
          let sum = S[i][j] + (i === j ? jitter : 0);
          for (let k = 0; k < j; k++) sum -= L[i][k] * L[j][k];
          if (i === j) {
            if (sum <= 0) { if (sum > -1e-12 && attempt > 0) sum = 0; else { ok = false; break; } }
            L[i][i] = Math.sqrt(sum);
          } else L[i][j] = L[j][j] > 0 ? sum / L[j][j] : 0;
        }
      }
      if (ok) return L;
    }
    // fall back to independent (diagonal)
    return S.map((r, i) => r.map((_, j) => (i === j ? Math.sqrt(Math.max(0, S[i][i])) : 0)));
  }
  function covariance(rows, keys) {
    const n = rows.length;
    const mu = keys.map(k => mean(rows.map(r => r[k])));
    const S = keys.map((ki, i) => keys.map((kj, j) => {
      let s = 0;
      for (const r of rows) s += (r[ki] - mu[i]) * (r[kj] - mu[j]);
      return n > 1 ? s / (n - 1) : 0;
    }));
    return { mu, S };
  }
  function normalPair(rng) {
    let u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /**
   * Simulate participants from pilot data.
   * pilot: { dvKey: rows[{FA15,FA5,MS15,MS5}] }
   * For each DV, draws from a multivariate normal with the pilot mean vector
   * and the pilot 4×4 covariance matrix across conditions (keeps the
   * within-subject correlation), or independent normals if method='independent'.
   */
  function simulate(pilot, opts) {
    const { n, seed, method, bounds } = opts;
    const rng = Stimuli.makeRng('sim:' + seed);
    const keys = ['FA15', 'FA5', 'MS15', 'MS5'];
    const sims = Array.from({ length: n }, (_, i) => ({ id: 'S' + String(i + 1).padStart(3, '0') }));
    const params = {};
    for (const [dv, rows] of Object.entries(pilot)) {
      const { mu, S } = covariance(rows, keys);
      const useCov = method === 'covariance' && rows.length >= 5;
      const L = useCov ? cholesky(S) : S.map((r, i) => r.map((_, j) => (i === j ? Math.sqrt(Math.max(0, S[i][i])) : 0)));
      params[dv] = { mu, S, usedCovariance: useCov };
      const [lo, hi] = bounds[dv] || [-Infinity, Infinity];
      for (const s of sims) {
        const z = keys.map(() => normalPair(rng));
        keys.forEach((k, i) => {
          let v = mu[i];
          for (let j = 0; j <= i; j++) v += L[i][j] * z[j];
          s[dv + '_' + k] = Math.min(hi, Math.max(lo, v));
        });
      }
    }
    return { sims, params };
  }

  global.Stats = { zInv, phi, fPValue, ibeta, mean, sd, sdt, rmAnova2x2, pairedT, simulate, covariance };
})(window);
