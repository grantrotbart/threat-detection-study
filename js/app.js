/* =========================================================================
   app.js — experimenter console + participant runner
   Data is stored in this browser's localStorage and exported as JSON/CSV.
   ========================================================================= */
(function () {
  'use strict';

  // ======================================================================
  // Constants
  // ======================================================================
  const STORE_SESSIONS = 'tdx_sessions_v1';
  const STORE_SETTINGS = 'tdx_settings_v1';
  const STORE_SIM = 'tdx_sim_v1';
  const STORE_CALIB = 'tdx_calibration_v1';
  const STORE_OPERATOR = 'tdx_operator_v1';
  const APP_VERSION = '1.2';
  // ISO/IEC 7810 ID-1 card (credit card, UF Gator 1 card, driver's licence)
  const CARD_W_MM = 85.6, CARD_H_MM = 53.98;

  const COND_KEYS = ['FA15', 'FA5', 'MS15', 'MS5'];
  // Williams (balanced Latin square) design for 4 conditions: every condition
  // appears once in each position and immediately follows every other once.
  const LATIN = [
    [0, 1, 3, 2],
    [1, 2, 0, 3],
    [2, 3, 1, 0],
    [3, 0, 2, 1],
  ];

  const TRUST_ITEMS = [ // Jian, Bisantz & Drury (2000) — items 1–5 reverse-scored
    'The system is deceptive.',
    'The system behaves in an underhanded manner.',
    'I am suspicious of the system’s intent, action, or outputs.',
    'I am wary of the system.',
    'The system’s actions will have a harmful or injurious outcome.',
    'I am confident in the system.',
    'The system provides security.',
    'The system has integrity.',
    'The system is dependable.',
    'The system is reliable.',
    'I can trust the system.',
    'I am familiar with the system.',
  ];
  const TRUST_REVERSED = [0, 1, 2, 3, 4];

  const DEFAULT_SETTINGS = {
    trialsPerBlock: 20,
    minorityErrors: 0,          // 0 = pure: FA-prone AI makes only false alarms, miss-prone only misses
    practiceTrials: 8,
    practiceTime: 15,
    timeLong: 15,
    timeShort: 5,
    feedback: 'full',           // 'full' | 'none'
    feedbackMs: 1500,
    fixationMs: 500,
    itiMs: 300,
    difficulty: 'medium',
    imageWidthMm: 190,          // physical width of the X-ray image on every laptop (after calibration)
    autoDownload: true,
    systemNames: ['ARGUS', 'SENTINEL', 'VIGIL', 'ORION'],
    consentText:
      'You are invited to take part in a class research project for EIN3241 (Human Factors & Ergonomics) at the University of Florida. ' +
      'You will classify simulated X-ray images of bags as containing a threat or not, sometimes with help from an AI screening system, ' +
      'and answer short questionnaires. The session takes about 35 minutes. Participation is voluntary, you may stop at any time without penalty, ' +
      'and your responses are recorded under a participant number only — no names are stored with the data. There are no known risks beyond those of normal computer use.',
  };

  function condInfo(key, settings) {
    const s = settings || getSettings();
    const aiBias = key.startsWith('FA') ? 'FA' : 'MS';
    const time = key.endsWith('15') ? s.timeLong : s.timeShort;
    return {
      key, aiBias, time,
      aiLabel: aiBias === 'FA' ? 'False-alarm-prone' : 'Miss-prone',
      label: `${aiBias === 'FA' ? 'False-alarm-prone' : 'Miss-prone'} AI, ${time} s`,
      short: `${aiBias === 'FA' ? 'FA-prone' : 'Miss-prone'} · ${time}s`,
    };
  }

  // ======================================================================
  // Storage
  // ======================================================================
  function load(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { alert('Could not save to browser storage: ' + e.message + '\nExport your data now from the Data tab.'); return false; }
  }
  function getSettings() { return Object.assign({}, DEFAULT_SETTINGS, load(STORE_SETTINGS, {})); }

  // Short code that changes whenever a setting that affects the experiment changes.
  // Every laptop on the team should show the same code.
  const PROTOCOL_KEYS = ['trialsPerBlock', 'minorityErrors', 'practiceTrials', 'practiceTime', 'timeLong', 'timeShort', 'feedback',
    'feedbackMs', 'fixationMs', 'itiMs', 'difficulty', 'imageWidthMm', 'systemNames'];
  function protocolCode(settings) {
    const s = settings || getSettings();
    const str = APP_VERSION + '|' + PROTOCOL_KEYS.map(k => JSON.stringify(s[k])).join('|');
    const h = Stimuli.hashString(str).toString(36).toUpperCase().padStart(7, '0').slice(-6);
    return h.slice(0, 3) + '-' + h.slice(3);
  }

  // Screen calibration: CSS pixels per millimetre on this laptop/browser/zoom level.
  function getCalibration() { return load(STORE_CALIB, null); }
  function calibrationStatus() {
    const c = getCalibration();
    if (!c) return { ok: false, reason: 'This laptop has not been calibrated yet.' };
    if (Math.abs(c.dpr - window.devicePixelRatio) > 0.01) return { ok: false, reason: 'The browser zoom or display scaling changed since calibration (reset zoom with Ctrl+0 / Cmd+0, or recalibrate).' };
    if (c.screen !== `${screen.width}x${screen.height}`) return { ok: false, reason: 'A different screen is in use than at calibration (external monitor?). Recalibrate on the screen you will test on.' };
    return { ok: true, cal: c };
  }
  function getOperator() { return load(STORE_OPERATOR, { experimenter: '', laptop: '' }); }
  function getSessions() { return load(STORE_SESSIONS, []); }
  function putSession(session) {
    const all = getSessions();
    const i = all.findIndex(s => s.id === session.id);
    if (i >= 0) all[i] = session; else all.push(session);
    save(STORE_SESSIONS, all);
  }
  function deleteSession(id) { save(STORE_SESSIONS, getSessions().filter(s => s.id !== id)); }

  // ======================================================================
  // Helpers
  // ======================================================================
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const pad2 = n => String(n).padStart(2, '0');
  const fmt = (v, d = 2) => (v == null || Number.isNaN(v) ? '—' : (!isFinite(v) ? (v > 0 ? '∞' : '−∞') : Number(v).toFixed(d)));
  const fmtP = p => (p == null || Number.isNaN(p) ? '—' : p < 0.001 ? '< .001' : '= ' + p.toFixed(3).replace(/^0/, ''));
  const today = () => new Date().toISOString().slice(0, 10);

  function download(filename, text, type) {
    const blob = new Blob([text], { type: type || 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function toCSV(rows, cols) {
    const cell = v => {
      if (v == null) return '';
      if (typeof v === 'number') return Number.isFinite(v) ? String(+v.toFixed(6)) : '';
      const s = String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return [cols.join(','), ...rows.map(r => cols.map(c => cell(r[c])).join(','))].join('\n');
  }

  // ======================================================================
  // Experimental design: schedules, image assignment
  // ======================================================================
  function errorPlan(settings) {
    const N = settings.trialsPerBlock;
    const nErr = Math.round(N * 0.2);
    const m = Math.min(settings.minorityErrors, Math.floor(nErr / 2));
    // Error positions (0-based) — identical in every block; none in the first 5 trials
    const jitter = [0, 1, -1, 0, 1, -1, 0, 1, -1, 0];
    const step = (N - 5) / nErr;
    const positions = [];
    for (let i = 0; i < nErr; i++) {
      let p = 5 + Math.floor(i * step + step / 2) + jitter[i % jitter.length];
      p = Math.max(5, Math.min(N - 1, p));
      while (positions.includes(p)) p++;
      positions.push(p);
    }
    // which error slots carry the minority error type (spread out)
    const minoritySlots = [];
    for (let k = 0; k < m; k++) minoritySlots.push(nErr - 1 - 2 * k);
    return { N, nErr, nMinority: m, positions, minoritySlots };
  }

  function aiRates(settings) {
    const p = errorPlan(settings);
    const half = p.N / 2;
    const fa = { fas: p.nErr - p.nMinority, misses: p.nMinority };
    const ms = { fas: p.nMinority, misses: p.nErr - p.nMinority };
    const row = (e) => ({
      hits: half - e.misses, misses: e.misses, fas: e.fas, crs: half - e.fas,
      hitRate: (half - e.misses) / half, faRate: e.fas / half, accuracy: (p.N - p.nErr) / p.N,
    });
    return { plan: p, FA: row(fa), MS: row(ms) };
  }

  /** Build the trial list for one block. */
  function buildBlockTrials(aiBias, images, settings, seed) {
    const plan = errorPlan(settings);
    const rng = Stimuli.makeRng(seed);
    const N = plan.N, half = N / 2;
    const slots = new Array(N).fill(null);
    plan.positions.forEach((pos, i) => {
      const minority = plan.minoritySlots.includes(i);
      const type = (aiBias === 'FA') !== minority ? 'FA' : 'miss';
      slots[pos] = type === 'FA'
        ? { truth: 'clear', aiLabel: 'threat', aiCorrect: false, aiErrorType: 'FA' }
        : { truth: 'threat', aiLabel: 'clear', aiCorrect: false, aiErrorType: 'miss' };
    });
    const nMissErr = slots.filter(s => s && s.aiErrorType === 'miss').length;
    const nFAErr = slots.filter(s => s && s.aiErrorType === 'FA').length;
    const rest = [];
    for (let i = 0; i < half - nMissErr; i++) rest.push('threat');
    for (let i = 0; i < half - nFAErr; i++) rest.push('clear');
    let seq;
    for (let attempt = 0; attempt < 500; attempt++) {
      const sh = rng.shuffle(rest);
      let k = 0;
      seq = slots.map(s => s || { truth: sh[k], aiLabel: sh[k++], aiCorrect: true, aiErrorType: '' });
      // limit runs of the same truth to 4
      let run = 1, ok = true;
      for (let i = 1; i < N; i++) { run = seq[i].truth === seq[i - 1].truth ? run + 1 : 1; if (run > 4) { ok = false; break; } }
      if (ok) break;
    }
    const threatImgs = rng.shuffle(images.threat), clearImgs = rng.shuffle(images.clear);
    let ti = 0, ci = 0;
    return seq.map((t, i) => {
      const img = t.truth === 'threat' ? threatImgs[ti++] : clearImgs[ci++];
      return Object.assign({ trial: i + 1, imageId: img.id, threatType: img.threatType, threatVariant: img.threatVariant }, t);
    });
  }

  function buildPracticeTrials(settings, seed) {
    const n = settings.practiceTrials;
    const per = Math.ceil(n / 2);
    const set = Stimuli.buildImageSet('P', per, settings.difficulty);
    const rng = Stimuli.makeRng(seed);
    const list = rng.shuffle([...set.threat.slice(0, per), ...set.clear.slice(0, n - per)]);
    return list.map((img, i) => ({
      trial: i + 1, imageId: img.id, threatType: img.threatType, threatVariant: img.threatVariant, truth: img.isThreat ? 'threat' : 'clear',
      aiLabel: '', aiCorrect: null, aiErrorType: '',
    }));
  }

  function designFor(pnum, settings) {
    const row = (pnum - 1) % 4;
    const order = LATIN[row].map(i => COND_KEYS[i]);
    const imageSets = {};
    COND_KEYS.forEach((k, ci) => { imageSets[k] = ((ci + pnum - 1) % 4) + 1; });
    return {
      latinRow: row + 1, order, imageSets,
      blocks: order.map((cond, pos) => ({ position: pos + 1, cond, system: settings.systemNames[pos], imageSet: imageSets[cond] })),
    };
  }

  function createSession(pnum, isTest) {
    const settings = getSettings();
    const id = (isTest ? 'TEST-' : '') + 'P' + pad2(pnum);
    const d = designFor(pnum, settings);
    const perType = settings.trialsPerBlock / 2;
    const blocks = d.blocks.map(b => {
      const ci = condInfo(b.cond, settings);
      const set = Stimuli.buildImageSet(b.imageSet - 1, perType, settings.difficulty);
      return {
        position: b.position, cond: b.cond, aiBias: ci.aiBias, timeLimit: ci.time, system: b.system, imageSet: b.imageSet,
        plan: buildBlockTrials(ci.aiBias, set, settings, `${id}|block${b.position}`),
        trials: [], trust: null, startedAt: null, endedAt: null, done: false,
      };
    });
    return {
      id, participantNumber: pnum, isTest: !!isTest, include: !isTest,
      createdAt: new Date().toISOString(), completedAt: null, status: 'in-progress',
      settings, latinRow: d.latinRow, order: d.order, imageSets: d.imageSets,
      consent: null, demographics: null,
      practice: { plan: buildPracticeTrials(settings, id + '|practice'), trials: [], done: false },
      blocks, notes: '', userAgent: navigator.userAgent,
      screen: `${screen.width}x${screen.height}`,
      appVersion: APP_VERSION, protocolCode: protocolCode(settings),
      experimenter: getOperator().experimenter, laptop: getOperator().laptop,
      setupChecks: null,
      display: {
        calibration: getCalibration(), devicePixelRatio: window.devicePixelRatio,
        targetImageWidthMm: settings.imageWidthMm, renderedImageWidthMm: null, shrunkTrials: 0,
      },
    };
  }

  // ======================================================================
  // Scoring
  // ======================================================================
  function trustScore(items) {
    if (!items || items.length !== 12 || items.some(v => v == null)) return null;
    const adj = items.map((v, i) => (TRUST_REVERSED.includes(i) ? 8 - v : v));
    return Stats.mean(adj);
  }

  function summarizeBlock(block) {
    const t = block.trials;
    const answered = t.filter(x => x.response !== 'timeout');
    const counts = { hits: 0, misses: 0, fas: 0, crs: 0 };
    answered.forEach(x => {
      if (x.truth === 'threat') x.response === 'threat' ? counts.hits++ : counts.misses++;
      else x.response === 'threat' ? counts.fas++ : counts.crs++;
    });
    const sdt = Stats.sdt(counts);
    const wrongAI = answered.filter(x => x.aiCorrect === false);
    const rightAI = answered.filter(x => x.aiCorrect === true);
    const pct = (a, f) => (a.length ? (100 * a.filter(f).length) / a.length : NaN);
    return Object.assign({
      cond: block.cond, aiBias: block.aiBias, timeLimit: block.timeLimit, system: block.system, position: block.position, imageSet: block.imageSet,
      nTrials: t.length, timeouts: t.length - answered.length,
      accuracy: pct(answered, x => x.correct),
      agreeWrong: pct(wrongAI, x => x.followedAI),
      rejectCorrect: pct(rightAI, x => !x.followedAI),
      agreeOverall: pct(answered, x => x.followedAI),
      nWrongAIAnswered: wrongAI.length, nRightAIAnswered: rightAI.length,
      meanRT: answered.length ? Stats.mean(answered.map(x => x.rtMs)) / 1000 : NaN,
      meanRT_followAI: (a => (a.length ? Stats.mean(a.map(x => x.rtMs)) / 1000 : NaN))(answered.filter(x => x.followedAI === true)),
      meanRT_overrideAI: (a => (a.length ? Stats.mean(a.map(x => x.rtMs)) / 1000 : NaN))(answered.filter(x => x.followedAI === false)),
      clickResponses: answered.filter(x => x.inputMethod === 'click').length,
      trust: block.trust ? block.trust.score : null,
    }, counts, sdt);
  }

  function sessionSummaries(session) {
    const out = {};
    session.blocks.forEach(b => { if (b.done) out[b.cond] = summarizeBlock(b); });
    return out;
  }

  // ======================================================================
  // Exports
  // ======================================================================
  const TRIAL_COLS = ['participant', 'experimenter', 'isTest', 'latinRow', 'phase', 'blockPosition', 'condition', 'aiBias', 'timeLimit_s', 'system', 'imageSet',
    'trial', 'half', 'imageId', 'truth', 'threatType', 'threatVariant', 'aiLabel', 'aiCorrect', 'aiErrorType', 'response', 'outcome', 'correct', 'followedAI',
    'rt_ms', 'inputMethod', 'imageWidthMm', 'timeout', 'feedbackShown', 'timestamp'];

  function trialRows(session) {
    const rows = [];
    const base = { participant: session.id, experimenter: session.experimenter || '', isTest: session.isTest ? 1 : 0, latinRow: session.latinRow };
    const push = (phase, b, t, n) => rows.push(Object.assign({}, base, {
      phase, blockPosition: b ? b.position : 0, condition: b ? b.cond : 'practice', aiBias: b ? b.aiBias : 'none',
      timeLimit_s: b ? b.timeLimit : session.settings.practiceTime, system: b ? b.system : '', imageSet: b ? b.imageSet : 'P',
      trial: t.trial, half: t.trial <= n / 2 ? 1 : 2, imageId: t.imageId, truth: t.truth, threatType: t.threatType, threatVariant: t.threatVariant || '', aiLabel: t.aiLabel,
      aiCorrect: t.aiCorrect == null ? '' : t.aiCorrect ? 1 : 0, aiErrorType: t.aiErrorType, response: t.response, outcome: t.outcome,
      correct: t.correct ? 1 : 0, followedAI: t.followedAI == null ? '' : t.followedAI ? 1 : 0, rt_ms: t.rtMs == null ? '' : Math.round(t.rtMs), inputMethod: t.inputMethod || '', imageWidthMm: t.imageWidthMm == null ? '' : t.imageWidthMm,
      timeout: t.response === 'timeout' ? 1 : 0, feedbackShown: t.feedbackShown ? 1 : 0, timestamp: t.timestamp,
    }));
    session.practice.trials.forEach(t => push('practice', null, t, session.practice.plan.length));
    session.blocks.forEach(b => b.trials.forEach(t => push('block', b, t, b.plan.length)));
    return rows;
  }

  const SUMMARY_COLS = ['source', 'participant', 'experimenter', 'laptop', 'condition', 'aiBias', 'timePressure_s', 'blockPosition', 'system', 'imageSet',
    'hits', 'misses', 'fas', 'crs', 'timeouts', 'hitRate', 'faRate', 'dprime', 'c', 'beta', 'lnBeta', 'accuracy',
    'agreeWrongAI_pct', 'rejectCorrectAI_pct', 'agreeOverall_pct', 'trust', 'meanRT_s', 'meanRT_followAI_s', 'meanRT_overrideAI_s', 'clickResponses'];

  function summaryRow(source, pid, s) {
    return {
      source, participant: pid, condition: s.cond, aiBias: s.aiBias === 'FA' ? 'false-alarm-prone' : 'miss-prone', timePressure_s: s.timeLimit,
      blockPosition: s.position, system: s.system, imageSet: s.imageSet,
      hits: s.hits, misses: s.misses, fas: s.fas, crs: s.crs, timeouts: s.timeouts, hitRate: s.hitRate, faRate: s.faRate,
      dprime: s.dprime, c: s.c, beta: s.beta, lnBeta: s.lnBeta, accuracy: s.accuracy, agreeWrongAI_pct: s.agreeWrong,
      rejectCorrectAI_pct: s.rejectCorrect, agreeOverall_pct: s.agreeOverall, trust: s.trust, meanRT_s: s.meanRT, meanRT_followAI_s: s.meanRT_followAI, meanRT_overrideAI_s: s.meanRT_overrideAI, clickResponses: s.clickResponses,
    };
  }

  // ======================================================================
  // Analysis dataset (real + simulated)
  // ======================================================================
  const DVS = [
    { key: 'dprime', label: 'Sensitivity (d′)', unit: '', zero: true, sim: true, hyp: 'H2: lower under time pressure' },
    { key: 'c', label: 'Response bias (c)', unit: '', zero: true, sim: true, hyp: 'H1/H3: negative = liberal, positive = conservative' },
    { key: 'lnBeta', label: 'Response bias (ln β)', unit: '', zero: true, sim: false, hyp: 'Same direction as c; ln β = c·d′' },
    { key: 'agreeWrong', label: 'Agreement with incorrect AI advice', unit: '%', sim: true, bounds: [0, 100], hyp: 'H2: higher under time pressure (automation bias)' },
    { key: 'rejectCorrect', label: 'Rejection of correct AI advice', unit: '%', sim: true, bounds: [0, 100], hyp: 'Under-reliance (instructor suggestion)' },
    { key: 'trust', label: 'Trust in automation (1–7)', unit: '', sim: true, bounds: [1, 7], hyp: 'H4: lower for the false-alarm-prone AI' },
    { key: 'accuracy', label: 'Accuracy', unit: '%', sim: false, hyp: 'Descriptive' },
    { key: 'meanRT', label: 'Mean response time', unit: 's', sim: true, bounds: [0.15, 60], hyp: 'Descriptive' },
    { key: 'timeouts', label: 'Timeouts per section', unit: '', sim: true, bounds: [0, 1000], hyp: 'Descriptive (excluded from d′ and c)' },
  ];

  function realParticipants() {
    return getSessions()
      .filter(s => s.include && s.blocks.every(b => b.done))
      .map(s => ({ id: s.id, source: 'real', summaries: sessionSummaries(s), settings: s.settings }));
  }

  // Wide record: { id, source, dv_COND: value, ... }
  function toWide(p) {
    const w = { id: p.id, source: p.source };
    DVS.forEach(dv => COND_KEYS.forEach(k => { const s = p.summaries[k]; w[dv.key + '_' + k] = s ? s[dv.key] : NaN; }));
    COND_KEYS.forEach(k => { const s = p.summaries[k]; w['hitRate_' + k] = s ? s.hitRate : NaN; w['faRate_' + k] = s ? s.faRate : NaN; w['beta_' + k] = s ? s.beta : NaN; });
    return w;
  }

  function runSimulation(real, n, seed, method) {
    const settings = real[0].settings;
    const half = settings.trialsPerBlock / 2;
    const zMax = Stats.zInv((half + 0.5) / (half + 1));
    const pilot = {};
    const bounds = {};
    DVS.filter(d => d.sim).forEach(dv => {
      pilot[dv.key] = real.map(p => {
        const w = toWide(p); const r = {};
        COND_KEYS.forEach(k => { r[k] = w[dv.key + '_' + k]; });
        return r;
      }).filter(r => COND_KEYS.every(k => Number.isFinite(r[k])));
      bounds[dv.key] = dv.bounds || [-Infinity, Infinity];
    });
    bounds.dprime = [-2 * zMax, 2 * zMax];
    bounds.timeouts = [0, settings.trialsPerBlock];
    const { sims, params } = Stats.simulate(pilot, { n, seed, method, bounds });
    // derive consistent measures from simulated d′ and c
    sims.forEach(s => {
      s.source = 'simulated';
      COND_KEYS.forEach(k => {
        const d = s['dprime_' + k];
        const cLim = zMax - Math.abs(d) / 2;
        let c = Math.max(-cLim, Math.min(cLim, s['c_' + k]));
        s['c_' + k] = c;
        const H = Stats.phi(d / 2 - c), F = Stats.phi(-d / 2 - c);
        s['hitRate_' + k] = H; s['faRate_' + k] = F;
        s['lnBeta_' + k] = c * d; s['beta_' + k] = Math.exp(c * d);
        s['accuracy_' + k] = 50 * (H + 1 - F);
        const tl = condInfo(k, settings).time;
        if (Number.isFinite(s['meanRT_' + k])) s['meanRT_' + k] = Math.min(tl, s['meanRT_' + k]);
        if (Number.isFinite(s['timeouts_' + k])) s['timeouts_' + k] = Math.round(s['timeouts_' + k]);
      });
    });
    return { sims, params, n, seed, method, createdAt: new Date().toISOString(), basedOn: real.map(r => r.id) };
  }

  function wideToLong(w, settings) {
    return COND_KEYS.map(k => {
      const ci = condInfo(k, settings);
      return {
        source: w.source, participant: w.id, condition: k, aiBias: ci.aiBias === 'FA' ? 'false-alarm-prone' : 'miss-prone', timePressure_s: ci.time,
        dprime: w['dprime_' + k], c: w['c_' + k], beta: w['beta_' + k], lnBeta: w['lnBeta_' + k], hitRate: w['hitRate_' + k], faRate: w['faRate_' + k],
        accuracy: w['accuracy_' + k], agreeWrongAI_pct: w['agreeWrong_' + k], rejectCorrectAI_pct: w['rejectCorrect_' + k],
        trust: w['trust_' + k], meanRT_s: w['meanRT_' + k], timeouts: w['timeouts_' + k],
      };
    });
  }

  // ======================================================================
  // Console views
  // ======================================================================
  let currentTab = 'run';
  function render() {
    $$('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === currentTab));
    const v = $('#view');
    ({ run: viewRun, data: viewData, analysis: viewAnalysis, stimuli: viewStimuli, settings: viewSettings })[currentTab](v);
  }
  $('#tabs').addEventListener('click', e => {
    const b = e.target.closest('button[data-tab]');
    if (b) { currentTab = b.dataset.tab; render(); }
  });

  // ---------------- Run tab ----------------
  function nextParticipantNumber() {
    const nums = getSessions().filter(s => !s.isTest).map(s => s.participantNumber);
    return nums.length ? Math.max(...nums) + 1 : 1;
  }

  // Space the trial screen needs around the image (frame, timer bar, buttons, padding), in CSS px
  const TRIAL_CHROME_W = 20 + 32;
  const TRIAL_CHROME_H = 20 + 150;
  function fitCheck(settings, cal) {
    const ppm = cal.pxPerMm;
    const imgW = settings.imageWidthMm * ppm, imgH = imgW / 1.5;
    const maxMm = Math.floor(Math.min((screen.width - TRIAL_CHROME_W) / ppm, ((screen.height - TRIAL_CHROME_H) * 1.5) / ppm));
    return { fits: imgW + TRIAL_CHROME_W <= screen.width && imgH + TRIAL_CHROME_H <= screen.height, maxMm,
      screenWmm: Math.round(screen.width / ppm), screenHmm: Math.round(screen.height / ppm) };
  }

  function viewRun(v) {
    const settings = getSettings();
    const sessions = getSessions();
    const resumable = sessions.filter(s => s.status !== 'complete');
    const realDone = sessions.filter(s => !s.isTest && s.status === 'complete').length;
    const op = getOperator();
    const cs = calibrationStatus();
    const fit = cs.ok ? fitCheck(settings, cs.cal) : null;
    v.innerHTML = `
      <section class="card">
        <div class="row" style="justify-content:space-between;align-items:flex-start">
          <div>
            <h2>This laptop</h2>
            <p class="small muted" style="margin:0">Saved on this laptop. Fill this in once; it is stored with every session you run.</p>
          </div>
          <div class="protocol">Protocol code <b>${protocolCode(settings)}</b><span class="small muted">app v${APP_VERSION} · must match on every team laptop</span></div>
        </div>
        <div class="row" style="align-items:flex-end;margin-top:10px">
          <label class="field">Experimenter name<input type="text" id="op-name" value="${esc(op.experimenter)}" placeholder="e.g. Grant" style="width:170px"></label>
          <label class="field">Laptop (make &amp; model)<input type="text" id="op-laptop" value="${esc(op.laptop)}" placeholder="e.g. MacBook Air 13 inch M2" style="width:240px"></label>
        </div>
        <div class="calib-status ${cs.ok && fit.fits ? 'ok' : 'bad'}" style="margin-top:14px">
          <div>${!cs.ok ? `<b>Screen not calibrated.</b> ${esc(cs.reason)}`
            : fit.fits ? `<b>Screen calibrated.</b> Bag images will be ${settings.imageWidthMm} × ${Math.round(settings.imageWidthMm / 1.5)} mm on this screen (screen is about ${fit.screenWmm} × ${fit.screenHmm} mm). Calibrated ${new Date(cs.cal.at).toLocaleDateString()}.`
            : `<b>The ${settings.imageWidthMm} mm image does not fit this screen</b> (largest that fits: ${fit.maxMm} mm). Lower “Image width” in Settings to ${fit.maxMm} mm or less <i>on every team laptop</i> so the protocol codes still match.`}</div>
          <button class="btn" id="calibrate">${cs.ok ? 'Recalibrate' : 'Calibrate screen'}</button>
        </div>
      </section>
      <div class="grid2">
        <section class="card">
          <h2>Start a participant session</h2>
          <div class="row" style="align-items:flex-end">
            <label class="field">Participant number
              <input type="number" id="pnum" min="1" max="999" value="${nextParticipantNumber()}" style="width:110px">
            </label>
            <label class="inline"><input type="checkbox" id="istest"> Test / practice run (excluded from analysis)</label>
          </div>
          <p class="small muted" style="margin:6px 0 0">Use only the participant numbers assigned to you, so no two laptops create the same ID.</p>
          <div id="design-preview" style="margin-top:14px"></div>
          <div class="row" style="margin-top:14px">
            <button class="btn primary big" id="start">Start session</button>
            <label class="inline small muted"><input type="checkbox" id="fs" checked> Full screen</label>
          </div>
          <p id="start-why" class="small" style="margin-top:8px;color:var(--danger)"></p>
          <p class="small muted" style="margin-top:6px">During a session, press <b>Esc</b> to open the experimenter menu (it appears after the current trial). Data is saved after every trial.</p>
        </section>
        <section class="card">
          <h2>Progress on this laptop</h2>
          <p><b>${realDone}</b> real participant(s) complete here. Team target: 12 (3 per order).</p>
          <div class="table-wrap"><table>
            <thead><tr><th>Latin-square order</th><th class="num">Complete here</th></tr></thead>
            <tbody>${LATIN.map((row, i) => `<tr><td>${i + 1}: ${row.map(j => condInfo(COND_KEYS[j], settings).short).join(' → ')}</td>
              <td class="num">${sessions.filter(s => !s.isTest && s.status === 'complete' && s.latinRow === i + 1).length}</td></tr>`).join('')}</tbody>
          </table></div>
          <h3 style="margin-top:16px">Before each session</h3>
          <ul class="small">
            <li><b>Screen brightness all the way up</b>, charger plugged in (laptops dim on battery), Night Light / Night Shift / True Tone off.</li>
            <li>Browser zoom at 100% (Ctrl+0 / Cmd+0), no external monitor.</li>
            <li>Quiet room; notifications off (Do Not Disturb / Focus); other apps closed.</li>
            <li>Participant seated about an arm’s length (50–60 cm) from the screen.</li>
            <li>Read the scripted instructions only. Never tell participants how accurate the AI is or what kind of mistakes it makes.</li>
            <li>After the session, the JSON file downloads automatically. Send it to the data coordinator.</li>
          </ul>
        </section>
      </div>
      ${resumable.length ? `<section class="card"><h2>Unfinished sessions</h2>
        <p class="small muted">Resuming restarts the unfinished section from its first trial; finished sections are kept.</p>
        <div class="table-wrap"><table><thead><tr><th>ID</th><th>Started</th><th>Sections done</th><th></th></tr></thead><tbody>
        ${resumable.map(s => `<tr><td>${esc(s.id)}</td><td>${new Date(s.createdAt).toLocaleString()}</td>
          <td>${s.blocks.filter(b => b.done).length} / 4</td>
          <td><button class="btn" data-resume="${esc(s.id)}">Resume</button></td></tr>`).join('')}
        </tbody></table></div></section>` : ''}`;

    const saveOp = () => save(STORE_OPERATOR, { experimenter: $('#op-name').value.trim(), laptop: $('#op-laptop').value.trim() });
    const blockers = () => {
      const why = [];
      if (!$('#op-name').value.trim()) why.push('enter your name');
      if (!$('#op-laptop').value.trim()) why.push('enter the laptop model');
      if (!cs.ok) why.push('calibrate the screen');
      else if (!fit.fits) why.push('lower the image width (see above)');
      return why;
    };
    const updatePreview = () => {
      const n = Math.max(1, parseInt($('#pnum').value, 10) || 1);
      const test = $('#istest').checked;
      const id = (test ? 'TEST-' : '') + 'P' + pad2(n);
      const d = designFor(n, settings);
      const exists = sessions.some(s => s.id === id);
      $('#design-preview').innerHTML = `
        <dl class="kv"><dt>Session ID</dt><dd><b>${id}</b> ${exists ? '<span class="pill bad">already exists</span>' : ''}</dd>
        <dt>Latin-square row</dt><dd>${d.latinRow}</dd></dl>
        <div class="table-wrap" style="margin-top:8px"><table><thead><tr><th>Section</th><th>AI system name</th><th>Condition</th><th>Image set</th></tr></thead><tbody>
        ${d.blocks.map(b => `<tr><td>${b.position}</td><td>${esc(b.system)}</td><td>${condInfo(b.cond, settings).label}</td><td>S${b.imageSet}</td></tr>`).join('')}
        </tbody></table></div>`;
      const why = blockers();
      $('#start').disabled = exists || why.length > 0;
      $('#start-why').textContent = why.length ? 'Before starting: ' + why.join(', ') + '.' : '';
    };
    $('#op-name').addEventListener('input', () => { saveOp(); updatePreview(); });
    $('#op-laptop').addEventListener('input', () => { saveOp(); updatePreview(); });
    $('#pnum').addEventListener('input', updatePreview);
    $('#istest').addEventListener('change', updatePreview);
    $('#calibrate').addEventListener('click', () => viewCalibrate(v));
    updatePreview();
    $('#start').addEventListener('click', () => {
      const n = Math.max(1, parseInt($('#pnum').value, 10) || 1);
      saveOp();
      const session = createSession(n, $('#istest').checked);
      putSession(session);
      startRunner(session, $('#fs').checked);
    });
    $$('[data-resume]').forEach(b => b.addEventListener('click', () => {
      const s = getSessions().find(x => x.id === b.dataset.resume);
      if (!s) return;
      const st = calibrationStatus();
      if (!st.ok && !confirm('This screen is not calibrated as it was before (' + st.reason + ')\nImages may not be the right size. Resume anyway?')) return;
      startRunner(s, true);
    }));
  }

  // ---------------- Screen calibration ----------------
  function viewCalibrate(v) {
    const prev = getCalibration();
    let ppm = prev && Math.abs(prev.dpr - window.devicePixelRatio) < 0.01 ? prev.pxPerMm : 96 / 25.4;
    v.innerHTML = `
      <section class="card">
        <h2>Calibrate this screen</h2>
        <p>So the bag images are the <b>same physical size on every laptop</b>, the app needs to know how big a pixel is on this screen.</p>
        <ol class="small">
          <li>Set browser zoom to 100% (Ctrl+0 on Windows, Cmd+0 on Mac). Use the laptop’s own screen, not an external monitor.</li>
          <li>Hold a standard-size card (credit/debit card, UF Gator 1 ID, or driver’s licence) flat against the screen, lined up with the top-left corner of the blue rectangle.</li>
          <li>Drag the slider (or use the − / + buttons or arrow keys) until the rectangle is <b>exactly</b> the size of the card.</li>
        </ol>
        <div class="calib-area"><div id="card-rect" class="card-rect"><span>Card size<br>85.6 × 54.0 mm</span></div></div>
        <div class="row" style="margin-top:14px">
          <button class="btn" id="cal-minus">−</button>
          <input type="range" id="cal-slider" min="2" max="9" step="0.005" value="${ppm}" style="flex:1;min-width:200px">
          <button class="btn" id="cal-plus">+</button>
        </div>
        <h3 style="margin-top:18px">Optional check with a ruler</h3>
        <p class="small muted">This bar should measure exactly 10 cm.</p>
        <div id="ruler" class="ruler"></div>
        <div class="row" style="margin-top:16px">
          <button class="btn primary" id="cal-save">Save calibration</button>
          <button class="btn" id="cal-cancel">Cancel</button>
        </div>
      </section>`;
    const apply = () => {
      $('#card-rect').style.width = (CARD_W_MM * ppm) + 'px';
      $('#card-rect').style.height = (CARD_H_MM * ppm) + 'px';
      $('#ruler').style.width = (100 * ppm) + 'px';
      $('#cal-slider').value = ppm;
    };
    const nudge = d => { ppm = Math.max(2, Math.min(9, ppm + d)); apply(); };
    $('#cal-slider').addEventListener('input', e => { ppm = +e.target.value; apply(); });
    $('#cal-minus').addEventListener('click', () => nudge(-0.01));
    $('#cal-plus').addEventListener('click', () => nudge(0.01));
    const onKey = e => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); nudge(e.shiftKey ? -0.05 : -0.01); }
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); nudge(e.shiftKey ? 0.05 : 0.01); }
    };
    document.addEventListener('keydown', onKey);
    const leave = () => { document.removeEventListener('keydown', onKey); viewRun(v); };
    $('#cal-save').addEventListener('click', () => {
      save(STORE_CALIB, { pxPerMm: ppm, dpr: window.devicePixelRatio, screen: `${screen.width}x${screen.height}`, at: new Date().toISOString(), method: 'ID-1 card' });
      leave();
    });
    $('#cal-cancel').addEventListener('click', leave);
    apply();
  }

  // ---------------- Data tab ----------------
  const SESSION_COLS = ['participant', 'isTest', 'include', 'status', 'experimenter', 'laptop', 'createdAt', 'completedAt', 'latinRow', 'order',
    'protocolCode', 'appVersion', 'browser', 'screen_px', 'window_px', 'devicePixelRatio', 'pxPerMm', 'targetImageWidthMm', 'renderedImageWidthMm',
    'shrunkTrials', 'setupChecksConfirmed', 'age', 'gender', 'vision', 'screeningExp', 'aiUse'];
  function sessionRow(s) {
    const d = s.display || {}, dem = s.demographics || {}, cal = d.calibration || {};
    return {
      participant: s.id, isTest: s.isTest ? 1 : 0, include: s.include ? 1 : 0, status: s.status, experimenter: s.experimenter || '', laptop: s.laptop || '',
      createdAt: s.createdAt, completedAt: s.completedAt || '', latinRow: s.latinRow, order: (s.order || []).join(' > '),
      protocolCode: s.protocolCode || '', appVersion: s.appVersion || '', browser: s.userAgent || '', screen_px: s.screen || '', window_px: d.window || '',
      devicePixelRatio: d.devicePixelRatio, pxPerMm: cal.pxPerMm, targetImageWidthMm: d.targetImageWidthMm, renderedImageWidthMm: d.renderedImageWidthMm,
      shrunkTrials: d.shrunkTrials || 0, setupChecksConfirmed: (s.setupChecks || []).length,
      age: dem.age, gender: dem.gender, vision: dem.vision, screeningExp: dem.screeningExp, aiUse: dem.aiUse,
    };
  }
  const completeness = s => s.blocks.reduce((a, b) => a + b.trials.length + (b.done ? 1000 : 0), 0) + s.practice.trials.length;

  function viewData(v) {
    const sessions = getSessions();
    const real = sessions.filter(s => !s.isTest);
    const codes = {};
    real.forEach(s => { const c = s.protocolCode || '(none: made before v1.2)'; (codes[c] = codes[c] || []).push(s.id); });
    const codeList = Object.entries(codes);
    v.innerHTML = `
      <section class="card">
        <div class="row" style="justify-content:space-between">
          <h2 style="margin:0">Sessions (${sessions.length})</h2>
          <div class="row">
            <button class="btn" id="exp-trials">Trials CSV</button>
            <button class="btn" id="exp-summary">Condition summary CSV</button>
            <button class="btn" id="exp-sessions">Sessions &amp; hardware CSV</button>
            <button class="btn" id="exp-backup">Full backup (JSON)</button>
            <label class="btn primary">Import JSON files…<input type="file" id="imp" accept=".json,application/json" multiple hidden></label>
          </div>
        </div>
        <p class="small muted" style="margin-top:8px">Data lives in this browser only. Each teammate sends the coordinator the JSON file that downloads after each session (or a Full backup); the coordinator uses <b>Import</b> to merge them here. “Include” controls whether a completed session feeds the analysis and simulation. CSV exports leave out test runs.</p>
        ${codeList.length > 1 ? `<p class="notice">Sessions were run with <b>different protocol codes</b>, so their settings differ: ${codeList.map(([c, ids]) => `<b>${esc(c)}</b> (${ids.map(esc).join(', ')})`).join('; ')}. Check Settings on each laptop.</p>` : ''}
        <div class="table-wrap"><table>
          <thead><tr><th>Include</th><th>ID</th><th>Experimenter · laptop</th><th>Date</th><th>Status</th><th>Order</th><th>Protocol</th><th class="num">Image width</th><th class="num">Accuracy</th><th class="num">Timeouts</th><th>Demographics</th><th></th></tr></thead>
          <tbody>${sessions.length ? sessions.map(s => {
            const sums = Object.values(sessionSummaries(s));
            const acc = sums.length ? Stats.mean(sums.map(x => x.accuracy)) : NaN;
            const to = sums.reduce((a, x) => a + x.timeouts, 0);
            const d = s.display || {};
            const dem = s.demographics ? `${esc(s.demographics.age)} y, ${esc(s.demographics.gender || '—')}, vision: ${esc(s.demographics.vision)}${s.demographics.screeningExp === 'yes' ? ' <span class="pill warn">screening exp.</span>' : ''}` : '—';
            return `<tr>
              <td><input type="checkbox" data-include="${esc(s.id)}" ${s.include ? 'checked' : ''}></td>
              <td><b>${esc(s.id)}</b>${s.isTest ? ' <span class="pill">test</span>' : ''}${s.duplicateOf ? ` <span class="pill bad">duplicate of ${esc(s.duplicateOf)}</span>` : ''}</td>
              <td class="small">${esc(s.experimenter || '—')}<br><span class="muted">${esc(s.laptop || '')}</span></td>
              <td>${new Date(s.createdAt).toLocaleDateString()}</td>
              <td>${s.status === 'complete' ? '<span class="pill good">complete</span>' : `<span class="pill warn">${esc(s.status)} · ${s.blocks.filter(b => b.done).length}/4</span>`}</td>
              <td class="small">${s.latinRow}</td>
              <td class="mono">${esc(s.protocolCode || '—')}</td>
              <td class="num">${d.renderedImageWidthMm ? fmt(d.renderedImageWidthMm, 0) + ' mm' : '—'}${d.shrunkTrials ? ` <span class="pill warn" data-tip="The window was too small on ${d.shrunkTrials} trial(s), so the image was shrunk">shrunk</span>` : ''}</td>
              <td class="num">${fmt(acc, 1)}%</td><td class="num">${to}</td>
              <td class="small">${dem}</td>
              <td class="row" style="flex-wrap:nowrap">
                <button class="btn" data-json="${esc(s.id)}">JSON</button>
                <button class="btn" data-csv="${esc(s.id)}">CSV</button>
                <button class="btn danger" data-del="${esc(s.id)}">Delete</button></td></tr>`;
          }).join('') : '<tr><td colspan="12" class="muted">No sessions yet.</td></tr>'}</tbody>
        </table></div>
      </section>`;

    const find = id => getSessions().find(s => s.id === id);
    $$('[data-include]').forEach(cb => cb.addEventListener('change', () => { const s = find(cb.dataset.include); s.include = cb.checked; putSession(s); }));
    $$('[data-json]').forEach(b => b.addEventListener('click', () => { const s = find(b.dataset.json); download(`${s.id}_threat-study.json`, JSON.stringify(s, null, 1), 'application/json'); }));
    $$('[data-csv]').forEach(b => b.addEventListener('click', () => { const s = find(b.dataset.csv); download(`${s.id}_trials.csv`, toCSV(trialRows(s), TRIAL_COLS), 'text/csv'); }));
    $$('[data-del]').forEach(b => b.addEventListener('click', () => {
      if (confirm(`Permanently delete session ${b.dataset.del}? Download a backup first if you might need it. This cannot be undone.`)) { deleteSession(b.dataset.del); render(); }
    }));
    $('#exp-trials').addEventListener('click', () => {
      const rows = getSessions().filter(s => !s.isTest).flatMap(trialRows);
      download(`threat-study_trials_${today()}.csv`, toCSV(rows, TRIAL_COLS), 'text/csv');
    });
    $('#exp-summary').addEventListener('click', () => {
      const rows = getSessions().filter(s => !s.isTest).flatMap(s => Object.values(sessionSummaries(s))
        .map(x => Object.assign(summaryRow('real', s.id, x), { experimenter: s.experimenter || '', laptop: s.laptop || '' })));
      download(`threat-study_condition-summary_${today()}.csv`, toCSV(rows, SUMMARY_COLS), 'text/csv');
    });
    $('#exp-sessions').addEventListener('click', () => {
      download(`threat-study_sessions_${today()}.csv`, toCSV(getSessions().filter(s => !s.isTest).map(sessionRow), SESSION_COLS), 'text/csv');
    });
    $('#exp-backup').addEventListener('click', () => download(`threat-study_backup_${today()}.json`, JSON.stringify({ type: 'tdx-backup', exportedAt: new Date().toISOString(), sessions: getSessions() }, null, 1), 'application/json'));
    $('#imp').addEventListener('change', async e => {
      let added = 0, updated = 0, same = 0;
      const dups = [];
      for (const f of e.target.files) {
        try {
          const obj = JSON.parse(await f.text());
          const list = Array.isArray(obj) ? obj : obj.sessions ? obj.sessions : [obj];
          for (const s of list) {
            if (!s || !s.id || !s.blocks) continue;
            const existing = getSessions().find(x => x.id === s.id);
            if (!existing) { putSession(s); added++; continue; }
            if (existing.createdAt === s.createdAt) {
              // same session (e.g. a later backup): keep whichever copy has more data
              if (completeness(s) > completeness(existing)) { putSession(s); updated++; } else same++;
              continue;
            }
            // Same ID but a different session: two laptops used the same participant number.
            let n = 2; while (getSessions().some(x => x.id === `${s.id}-dup${n}`)) n++;
            const copy = Object.assign({}, s, { id: `${s.id}-dup${n}`, duplicateOf: s.id, include: false });
            putSession(copy);
            dups.push(`${s.id}: existing session by ${existing.experimenter || '?'} (${new Date(existing.createdAt).toLocaleString()}); imported one by ${s.experimenter || '?'} (${new Date(s.createdAt).toLocaleString()}) saved as ${copy.id}`);
          }
        } catch (err) { alert(`Could not read ${f.name}: ${err.message}`); }
      }
      alert(`Imported ${added} new session(s), updated ${updated}, ${same} already up to date.` +
        (dups.length ? `\n\nWARNING: ${dups.length} participant number(s) were used on two laptops:\n• ${dups.join('\n• ')}\n\nThe second copy was kept but excluded from analysis. Decide which participant keeps the number and give the other a replacement number in the same Latin-square order.` : ''));
      render();
    });
  }

  // ---------------- Analysis tab ----------------
  let analysisDataset = 'combined';
  function viewAnalysis(v) {
    const real = realParticipants();
    let sim = load(STORE_SIM, null);
    const settings = real[0] ? real[0].settings : getSettings();
    const half = settings.trialsPerBlock / 2;
    const zMax = Stats.zInv((half + 0.5) / (half + 1));

    v.innerHTML = `
      <section class="card">
        <h2>Simulation from pilot data</h2>
        ${(() => {
          const codes = [...new Set(getSessions().filter(s => s.include && s.blocks.every(b => b.done)).map(s => s.protocolCode || 'none'))];
          return codes.length > 1 ? `<p class="notice">The included sessions were run with different settings (protocol codes ${codes.map(esc).join(', ')}). See the Data tab before analysing.</p>` : '';
        })()}
        <p class="small">Uses the <b>${real.length}</b> included, completed real participant(s). For each measure, simulated participants are drawn from a multivariate normal distribution with the pilot
          mean and the pilot 4 × 4 covariance matrix across the four conditions, so each simulated person keeps the within-subject correlation seen in the pilot data.
          Values are clipped to their possible range; hit rate, false-alarm rate, accuracy and ln β are then derived from each simulated d′ and c so they stay consistent.</p>
        <div class="row" style="align-items:flex-end">
          <label class="field">Simulated participants<input type="number" id="sim-n" value="${sim ? sim.n : 88}" min="1" max="2000" style="width:110px"></label>
          <label class="field">Random seed<input type="text" id="sim-seed" value="${esc(sim ? sim.seed : 'EIN3241-G2')}" style="width:150px"></label>
          <label class="field">Method<select id="sim-method">
            <option value="covariance" ${!sim || sim.method === 'covariance' ? 'selected' : ''}>Multivariate normal (pilot covariance)</option>
            <option value="independent" ${sim && sim.method === 'independent' ? 'selected' : ''}>Independent normals (pilot means &amp; SDs)</option>
          </select></label>
          <button class="btn primary" id="sim-run" ${real.length < 2 ? 'disabled' : ''}>Generate simulated participants</button>
          ${sim ? '<button class="btn" id="sim-clear">Clear simulation</button>' : ''}
        </div>
        ${real.length < 2 ? '<p class="notice" style="margin-top:10px">Complete at least 2 real sessions to simulate (12 recommended; the covariance method needs ≥ 5).</p>' : ''}
        ${sim ? `<p class="small muted" style="margin-top:10px">Current simulation: ${sim.n} participants, seed “${esc(sim.seed)}”, ${sim.method}, generated ${new Date(sim.createdAt).toLocaleString()} from ${sim.basedOn.length} real participants.
          ${sim.basedOn.join(',') !== real.map(r => r.id).join(',') ? '<span class="pill warn">real data changed since — regenerate</span>' : ''}</p>` : ''}
      </section>
      <section class="card">
        <div class="row" style="justify-content:space-between">
          <div class="row">
            <h2 style="margin:0">Results</h2>
            <select id="ds">
              <option value="real" ${analysisDataset === 'real' ? 'selected' : ''}>Real (pilot) participants only</option>
              <option value="combined" ${analysisDataset === 'combined' ? 'selected' : ''}>Real + simulated</option>
              <option value="sim" ${analysisDataset === 'sim' ? 'selected' : ''}>Simulated only</option>
            </select>
          </div>
          <div class="row">
            <button class="btn" id="exp-long">Long-format CSV</button>
            <button class="btn" id="exp-wide">Wide-format CSV (SPSS/JASP)</button>
          </div>
        </div>
        <div id="results" style="margin-top:12px"></div>
      </section>
      <section class="card">
        <h2>Measures &amp; formulas</h2>
        <div class="grid2 small">
          <div>
            <p><b>Hit rate</b> H = (hits + 0.5) / (threat trials + 1); <b>false-alarm rate</b> F = (false alarms + 0.5) / (clear trials + 1).
              This log-linear correction (Hautus, 1995) keeps z finite when a rate is 0 or 1, which happens often with ${half} trials of each type. Timeouts are excluded.</p>
            <p><b>Sensitivity</b> d′ = z(H) − z(F). 0 = chance; larger = better at telling threat from clear bags. Maximum possible here ≈ ${fmt(2 * zMax)}.</p>
            <p><b>Criterion</b> c = −½ [z(H) + z(F)]. 0 = neutral; negative = liberal (says “threat” more); positive = conservative (says “clear” more).</p>
          </div>
          <div>
            <p><b>Likelihood ratio</b> β = exp(c · d′), so ln β = c · d′. β &lt; 1 is liberal, β &gt; 1 is conservative.</p>
            <p><b>Why c instead of β:</b> c is measured on the same z scale as d′ and is statistically independent of d′, whereas β changes with d′ (Macmillan &amp; Creelman, 2005; Stanislaw &amp; Todorov, 1999). Because time pressure is expected to change d′, c isolates the shift in bias. β is still reported for comparison with class material.</p>
            <p><b>Agreement with incorrect AI advice</b> = % of answered AI-error trials where the response matched the AI. <b>Rejection of correct AI advice</b> = % of answered AI-correct trials where the response went against the AI. <b>Trust</b> = mean of the 12 Jian et al. (2000) items (items 1–5 reverse-scored), 1–7.</p>
          </div>
        </div>
      </section>`;

    $('#ds').addEventListener('change', e => { analysisDataset = e.target.value; renderResults(); });
    const simRun = $('#sim-run');
    if (simRun) simRun.addEventListener('click', () => {
      const n = Math.max(1, parseInt($('#sim-n').value, 10) || 88);
      sim = runSimulation(real, n, $('#sim-seed').value || 'seed', $('#sim-method').value);
      save(STORE_SIM, sim);
      analysisDataset = 'combined';
      viewAnalysis(v);
    });
    const simClear = $('#sim-clear');
    if (simClear) simClear.addEventListener('click', () => { localStorage.removeItem(STORE_SIM); viewAnalysis(v); });

    function dataset() {
      const realWide = real.map(toWide);
      const simWide = sim ? sim.sims : [];
      return analysisDataset === 'real' ? realWide : analysisDataset === 'sim' ? simWide : realWide.concat(simWide);
    }
    $('#exp-long').addEventListener('click', () => {
      const rows = dataset().flatMap(w => wideToLong(w, settings));
      download(`threat-study_${analysisDataset}_long_${today()}.csv`, toCSV(rows, Object.keys(rows[0] || { source: 1 })), 'text/csv');
    });
    $('#exp-wide').addEventListener('click', () => {
      const data = dataset();
      const cols = ['source', 'id'];
      ['dprime', 'c', 'beta', 'lnBeta', 'hitRate', 'faRate', 'accuracy', 'agreeWrong', 'rejectCorrect', 'trust', 'meanRT', 'timeouts']
        .forEach(dv => COND_KEYS.forEach(k => cols.push(dv + '_' + k)));
      download(`threat-study_${analysisDataset}_wide_${today()}.csv`, toCSV(data, cols), 'text/csv');
    });

    function renderResults() {
      const data = dataset();
      const box = $('#results');
      if (!data.length) { box.innerHTML = '<p class="muted">No data for this selection yet.</p>'; return; }
      const res = {};
      DVS.forEach(dv => {
        const rows = data.map(w => ({ id: w.id, FA15: w[dv.key + '_FA15'], FA5: w[dv.key + '_FA5'], MS15: w[dv.key + '_MS15'], MS5: w[dv.key + '_MS5'] }))
          .filter(r => COND_KEYS.every(k => Number.isFinite(r[k])));
        const desc = {};
        COND_KEYS.forEach(k => { const a = rows.map(r => r[k]); desc[k] = { m: Stats.mean(a), sd: Stats.sd(a), se: Stats.sd(a) / Math.sqrt(a.length), n: a.length }; });
        res[dv.key] = { rows, desc, anova: Stats.rmAnova2x2(rows) };
      });
      box.innerHTML = `
        <p class="small muted">N = ${data.length} (${data.filter(d => d.source === 'real').length} real, ${data.filter(d => d.source === 'simulated').length} simulated). Each measure: 2 (AI bias) × 2 (time pressure) repeated-measures ANOVA, df = (1, N − 1). Error bars = ±1 SE.</p>
        ${hypothesisPanel(res, settings)}
        <div class="grid3">${DVS.map(dv => dvCard(dv, res[dv.key], settings)).join('')}</div>`;
    }
    renderResults();
  }

  function anovaRow(a, name) { return a ? a.find(x => x.effect === name) : null; }
  function statLine(r) { return r ? `F(${r.df1}, ${r.df2}) = ${fmt(r.F)}, p ${fmtP(r.p)}, η²p = ${fmt(r.partialEta2, 3)}` : 'n/a'; }

  function hypothesisPanel(res, settings) {
    const c = res.c, d = res.dprime, ag = res.agreeWrong, tr = res.trust;
    if (!c.anova) return '<p class="notice">At least 3 complete participants are needed for inferential tests.</p>';
    const sig = r => r && r.p < 0.05;
    const m = (r, k) => r.desc[k].m;
    // H1: c lower (more liberal) for FA-prone than miss-prone
    const cFA = (m(c, 'FA15') + m(c, 'FA5')) / 2, cMS = (m(c, 'MS15') + m(c, 'MS5')) / 2;
    const h1r = anovaRow(c.anova, 'AI bias');
    const h1 = sig(h1r) && cFA < cMS;
    // H2: d′ lower at short time; agreement with wrong AI higher at short time
    const dL = (m(d, 'FA15') + m(d, 'MS15')) / 2, dS = (m(d, 'FA5') + m(d, 'MS5')) / 2;
    const aL = (m(ag, 'FA15') + m(ag, 'MS15')) / 2, aS = (m(ag, 'FA5') + m(ag, 'MS5')) / 2;
    const h2d = anovaRow(d.anova, 'Time pressure'), h2a = anovaRow(ag.anova, 'Time pressure');
    const h2a_ok = sig(h2d) && dS < dL, h2b_ok = sig(h2a) && aS > aL;
    // H3: gap in c (MS − FA) larger at short time
    const gapL = m(c, 'MS15') - m(c, 'FA15'), gapS = m(c, 'MS5') - m(c, 'FA5');
    const h3r = anovaRow(c.anova, 'AI bias × Time');
    const h3 = sig(h3r) && gapS > gapL;
    const sL = Stats.pairedT(c.rows.map(r => r.FA15), c.rows.map(r => r.MS15));
    const sS = Stats.pairedT(c.rows.map(r => r.FA5), c.rows.map(r => r.MS5));
    // H4: trust lower for FA-prone
    const tFA = (m(tr, 'FA15') + m(tr, 'FA5')) / 2, tMS = (m(tr, 'MS15') + m(tr, 'MS5')) / 2;
    const h4r = anovaRow(tr.anova, 'AI bias');
    const h4 = sig(h4r) && tFA < tMS;
    const card = (cls, title, body) => `<div class="hyp ${cls}"><b>${title}</b><div class="small">${body}</div></div>`;
    const verdict = ok => (ok ? '<span class="pill good">supported</span>' : '<span class="pill bad">not supported</span>');
    return `<div class="grid2" style="margin-bottom:16px">
      ${card(h1 ? 'ok' : 'no', `H1 · AI bias shifts human bias ${verdict(h1)}`, `c with false-alarm-prone AI = ${fmt(cFA)}, with miss-prone AI = ${fmt(cMS)} (predicted: FA-prone lower). Main effect of AI bias on c: ${statLine(h1r)}.`)}
      ${card(h2a_ok && h2b_ok ? 'ok' : h2a_ok || h2b_ok ? 'partial' : 'no', `H2 · Time pressure ${h2a_ok && h2b_ok ? verdict(true) : h2a_ok || h2b_ok ? '<span class="pill warn">partly supported</span>' : verdict(false)}`,
        `d′ at ${settings.timeLong} s = ${fmt(dL)}, at ${settings.timeShort} s = ${fmt(dS)}; ${statLine(h2d)}.<br>Agreement with incorrect AI at ${settings.timeLong} s = ${fmt(aL, 1)}%, at ${settings.timeShort} s = ${fmt(aS, 1)}%; ${statLine(h2a)}.`)}
      ${card(h3 ? 'ok' : 'no', `H3 · Interaction ${verdict(h3)}`, `Gap in c (miss-prone − FA-prone): ${fmt(gapL)} at ${settings.timeLong} s vs ${fmt(gapS)} at ${settings.timeShort} s (predicted: larger at ${settings.timeShort} s). Interaction: ${statLine(h3r)}.<br>
        Simple effects of AI bias on c: ${settings.timeLong} s t(${sL.df}) = ${fmt(sL.t)}, p ${fmtP(sL.p)}; ${settings.timeShort} s t(${sS.df}) = ${fmt(sS.t)}, p ${fmtP(sS.p)}.`)}
      ${card(h4 ? 'ok' : 'no', `H4 · Cry-wolf trust effect ${verdict(h4)}`, `Trust in false-alarm-prone AI = ${fmt(tFA)}, miss-prone AI = ${fmt(tMS)} (predicted: FA-prone lower). Main effect of AI bias on trust: ${statLine(h4r)}.`)}
    </div>
    <p class="small muted">“Supported” means p &lt; .05 in the predicted direction. Check final numbers in SPSS, JASP or R using the wide-format export.</p>`;
  }

  function dvCard(dv, r, settings) {
    const unit = dv.unit === '%' ? '%' : dv.unit ? ' ' + dv.unit : '';
    const dec = dv.unit === '%' ? 1 : 2;
    return `<div class="card dv-card" style="margin:0">
      <h3>${dv.label}</h3>
      <p class="small muted">${dv.hyp}</p>
      ${interactionChart(dv, r.desc, settings)}
      <div class="table-wrap"><table class="small">
        <thead><tr><th>Condition</th><th class="num">M</th><th class="num">SD</th></tr></thead>
        <tbody>${COND_KEYS.map(k => `<tr><td>${condInfo(k, settings).short}</td><td class="num">${fmt(r.desc[k].m, dec)}${unit}</td><td class="num">${fmt(r.desc[k].sd, dec)}</td></tr>`).join('')}</tbody>
      </table></div>
      ${r.anova ? `<div class="table-wrap" style="margin-top:8px"><table class="small">
        <thead><tr><th>Effect</th><th class="num">F</th><th class="num">p</th><th class="num">η²p</th></tr></thead>
        <tbody>${r.anova.map(a => `<tr><td>${a.effect}</td><td class="num">${fmt(a.F)}</td><td class="num">${a.p < 0.05 ? '<b>' : ''}${a.p < 0.001 ? '<.001' : fmt(a.p, 3)}${a.p < 0.05 ? '</b>' : ''}</td><td class="num">${fmt(a.partialEta2, 3)}</td></tr>`).join('')}</tbody>
      </table></div>` : ''}
    </div>`;
  }

  function niceTicks(lo, hi, count) {
    const span = hi - lo || 1;
    const step0 = span / count;
    const mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 2.5, 5, 10].map(x => x * mag).find(x => x >= step0);
    const t = [];
    for (let v = Math.floor(lo / step) * step; v <= hi + 1e-9; v += step) t.push(+v.toFixed(10));
    return t;
  }

  function interactionChart(dv, desc, settings) {
    const W = 340, H = 210, m = { l: 40, r: 78, t: 12, b: 34 };
    const pts = COND_KEYS.map(k => desc[k]).filter(d => Number.isFinite(d.m));
    if (pts.length < 4) return '<p class="muted small">Not enough data.</p>';
    let lo = Math.min(...COND_KEYS.map(k => desc[k].m - (desc[k].se || 0)));
    let hi = Math.max(...COND_KEYS.map(k => desc[k].m + (desc[k].se || 0)));
    if (dv.zero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
    if (dv.unit === '%' && lo >= 0) lo = 0;
    const padv = (hi - lo) * 0.12 || 0.5; lo -= dv.unit === '%' && lo === 0 ? 0 : padv; hi += padv;
    const ticks = niceTicks(lo, hi, 4);
    lo = Math.min(lo, ticks[0]); hi = Math.max(hi, ticks[ticks.length - 1]);
    const x = i => m.l + 40 + i * (W - m.l - m.r - 80);
    const y = v => m.t + (H - m.t - m.b) * (1 - (v - lo) / (hi - lo));
    const series = [
      { name: 'FA-prone AI', color: 'var(--series-1)', keys: ['FA15', 'FA5'] },
      { name: 'Miss-prone AI', color: 'var(--series-2)', keys: ['MS15', 'MS5'] },
    ];
    const dec = dv.unit === '%' ? 1 : 2;
    let svg = `<div class="legend">${series.map(s => `<span><i style="background:${s.color}"></i>${s.name}</span>`).join('')}</div>
      <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(dv.label)} by condition">`;
    ticks.forEach(t => {
      svg += `<line x1="${m.l}" x2="${W - m.r + 10}" y1="${y(t)}" y2="${y(t)}" stroke="${t === 0 && dv.zero ? '#b9b8b2' : 'var(--grid)'}" stroke-width="1"/>
        <text x="${m.l - 6}" y="${y(t) + 4}" text-anchor="end">${+t.toFixed(3)}</text>`;
    });
    [settings.timeLong + ' s', settings.timeShort + ' s'].forEach((lab, i) => { svg += `<text x="${x(i)}" y="${H - m.b + 18}" text-anchor="middle">${lab}</text>`; });
    svg += `<text class="axis-title" x="${(m.l + W - m.r) / 2}" y="${H - 2}" text-anchor="middle">Time per image</text>`;
    series.forEach((s, si) => {
      const off = si === 0 ? -5 : 5;
      const p = s.keys.map((k, i) => ({ k, x: x(i) + off, d: desc[k] }));
      svg += `<line x1="${p[0].x}" y1="${y(p[0].d.m)}" x2="${p[1].x}" y2="${y(p[1].d.m)}" stroke="${s.color}" stroke-width="2"/>`;
      p.forEach(q => {
        const se = q.d.se || 0;
        svg += `<line x1="${q.x}" x2="${q.x}" y1="${y(q.d.m - se)}" y2="${y(q.d.m + se)}" stroke="${s.color}" stroke-width="1.5"/>
          <circle cx="${q.x}" cy="${y(q.d.m)}" r="4.5" fill="${s.color}" stroke="var(--surface)" stroke-width="2"/>
          <circle cx="${q.x}" cy="${y(q.d.m)}" r="14" fill="transparent" data-tip="${esc(`${s.name}, ${q.k.endsWith('15') ? settings.timeLong : settings.timeShort} s — M = ${fmt(q.d.m, dec)}, SE = ${fmt(se, dec)}, n = ${q.d.n}`)}"/>`;
      });
      svg += `<text x="${p[1].x + 10}" y="${y(p[1].d.m) + 4}" style="fill:var(--text-2)">${s.name.replace(' AI', '')}</text>`;
    });
    return svg + '</svg>';
  }

  // tooltip
  document.addEventListener('mouseover', e => {
    const t = e.target.closest && e.target.closest('[data-tip]');
    const tip = $('#tooltip');
    if (!t) { tip.hidden = true; return; }
    tip.textContent = t.getAttribute('data-tip'); tip.hidden = false;
  });
  document.addEventListener('mousemove', e => {
    const tip = $('#tooltip');
    if (!tip.hidden) { tip.style.left = Math.min(window.innerWidth - 270, e.clientX + 14) + 'px'; tip.style.top = (e.clientY + 14) + 'px'; }
  });

  // ---------------- Stimuli tab ----------------
  let stimSet = 'P';
  function viewStimuli(v) {
    const settings = getSettings();
    const per = stimSet === 'P' ? Math.ceil(settings.practiceTrials / 2) : settings.trialsPerBlock / 2;
    v.innerHTML = `<section class="card">
      <div class="row" style="justify-content:space-between">
        <h2 style="margin:0">Stimulus preview</h2>
        <div class="row">
          <select id="set-pick">${['P', 1, 2, 3, 4].map(s => `<option value="${s}" ${String(stimSet) === String(s) ? 'selected' : ''}>${s === 'P' ? 'Practice set' : 'Image set S' + s}</option>`).join('')}</select>
          <span class="pill">difficulty: ${esc(settings.difficulty)}</span>
        </div>
      </div>
      <p class="small muted" style="margin-top:8px">Every image is generated from its ID, so the same set looks identical on every computer. Sets are rotated across conditions with the Latin square. Use this page during pilot testing to check that threats are findable at ${settings.timeLong} s but challenging at ${settings.timeShort} s; adjust difficulty in Settings if needed.</p>
      <div class="thumbs" id="thumbs"></div></section>`;
    $('#set-pick').addEventListener('change', e => { stimSet = e.target.value === 'P' ? 'P' : +e.target.value; viewStimuli(v); });
    const set = Stimuli.buildImageSet(stimSet === 'P' ? 'P' : stimSet - 1, per, settings.difficulty);
    const all = [...set.threat, ...set.clear];
    const box = $('#thumbs');
    all.forEach(img => {
      const fig = document.createElement('figure');
      const cv = document.createElement('canvas');
      Stimuli.renderBag(cv, img);
      fig.appendChild(cv);
      const cap = document.createElement('figcaption');
      cap.innerHTML = `<b>${img.id}</b> · ${img.isThreat ? 'threat (' + img.threatVariant + ')' : 'clear'}`;
      fig.appendChild(cap);
      box.appendChild(fig);
    });
  }

  // ---------------- Settings tab ----------------
  function viewSettings(v) {
    const s = getSettings();
    const anyData = getSessions().some(x => !x.isTest);
    const rates = aiRates(s);
    v.innerHTML = `
      ${anyData ? '<p class="notice">Real sessions already exist. Changing settings now makes later participants differ from earlier ones. Each session stores the settings it was run with.</p><br>' : ''}
      <div class="grid2">
        <section class="card stack">
          <h2>Design</h2>
          <div class="row">
            <label class="field">Trials per section<select id="s-trials">
              ${[20, 40].map(n => `<option ${s.trialsPerBlock === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
            <label class="field">Long time limit (s)<input type="number" id="s-long" value="${s.timeLong}" min="1" max="60" style="width:90px"></label>
            <label class="field">Short time limit (s)<input type="number" id="s-short" value="${s.timeShort}" min="1" max="60" style="width:90px"></label>
          </div>
          <label class="field">AI error mix (AI accuracy is always 80%)<select id="s-minor">
            ${Array.from({ length: Math.floor(Math.round(s.trialsPerBlock * 0.2) / 2) + 1 }, (_, m) => {
              const n = Math.round(s.trialsPerBlock * 0.2);
              return `<option value="${m}" ${s.minorityErrors === m ? 'selected' : ''}>${m === 0 ? `Pure: ${n} errors all of the biased type` : `${n - m} of the biased type + ${m} of the other type`}</option>`;
            }).join('')}</select></label>
          <div class="row">
            <label class="field">Practice trials (no AI)<input type="number" id="s-prac" value="${s.practiceTrials}" min="2" max="20" style="width:90px"></label>
            <label class="field">Practice time limit (s)<input type="number" id="s-prac-t" value="${s.practiceTime}" min="1" max="60" style="width:90px"></label>
            <label class="field">Image difficulty<select id="s-diff">${['easy', 'medium', 'hard'].map(d => `<option ${s.difficulty === d ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
          </div>
          <label class="field">Image width on screen (mm, same on every calibrated laptop; height is 2/3 of this)
            <input type="number" id="s-imgw" value="${s.imageWidthMm}" min="100" max="400" step="5" style="width:110px"></label>
          <label class="field">AI system names (one per section position, keeps trust from carrying over)
            <input type="text" id="s-names" value="${esc(s.systemNames.join(', '))}"></label>
        </section>
        <section class="card stack">
          <h2>Trial timing &amp; feedback</h2>
          <label class="field">Feedback after each trial<select id="s-fb">
            <option value="full" ${s.feedback === 'full' ? 'selected' : ''}>Correct / incorrect + what the bag contained</option>
            <option value="none" ${s.feedback === 'none' ? 'selected' : ''}>No feedback in AI sections (practice still gets feedback)</option>
          </select></label>
          <div class="row">
            <label class="field">Feedback duration (ms)<input type="number" id="s-fbms" value="${s.feedbackMs}" min="300" max="5000" step="100" style="width:110px"></label>
            <label class="field">Fixation cross (ms)<input type="number" id="s-fix" value="${s.fixationMs}" min="0" max="3000" step="100" style="width:110px"></label>
            <label class="field">Gap between trials (ms)<input type="number" id="s-iti" value="${s.itiMs}" min="0" max="3000" step="100" style="width:110px"></label>
          </div>
          <label class="inline"><input type="checkbox" id="s-auto" ${s.autoDownload ? 'checked' : ''}> Download the session’s JSON file automatically when it ends</label>
          <label class="field">Consent text shown to participants<textarea id="s-consent">${esc(s.consentText)}</textarea></label>
        </section>
      </div>
      <section class="card">
        <h2>AI error schedule (for your Methods section)</h2>
        <p class="small">Each section has ${rates.plan.N} bags (${rates.plan.N / 2} threat, ${rates.plan.N / 2} clear) and the AI is wrong on ${rates.plan.nErr} of them (80% accurate).
          The errors fall on trials ${rates.plan.positions.map(p => p + 1).join(', ')} in every section — never in the first 5. Correct-AI trials are shuffled around them per participant (no more than 4 threat or clear bags in a row).</p>
        <div class="table-wrap"><table>
          <thead><tr><th>AI condition</th><th class="num">AI hits</th><th class="num">AI misses</th><th class="num">AI false alarms</th><th class="num">AI correct rejections</th><th class="num">AI hit rate</th><th class="num">AI false-alarm rate</th><th class="num">AI accuracy</th></tr></thead>
          <tbody>${[['False-alarm-prone', rates.FA], ['Miss-prone', rates.MS]].map(([n, r]) => `<tr><td>${n}</td><td class="num">${r.hits}</td><td class="num">${r.misses}</td><td class="num">${r.fas}</td><td class="num">${r.crs}</td>
            <td class="num">${(r.hitRate * 100).toFixed(0)}%</td><td class="num">${(r.faRate * 100).toFixed(0)}%</td><td class="num">${(r.accuracy * 100).toFixed(0)}%</td></tr>`).join('')}</tbody>
        </table></div>
      </section>
      <div class="row"><button class="btn primary" id="s-save">Save settings</button><button class="btn" id="s-reset">Reset to defaults</button><span id="s-msg" class="small muted"></span></div>
      <section class="card" style="margin-top:16px">
        <h2>Share settings with the team</h2>
        <p class="small">Every laptop must run the same settings. Check that the <b>protocol code</b> on the Run tab is identical on all laptops (current code: <b class="mono">${protocolCode(s)}</b>). If you change anything here, download the settings file and have each teammate load it.</p>
        <div class="row"><button class="btn" id="s-export">Download settings file</button>
          <label class="btn">Load settings file…<input type="file" id="s-import" accept=".json,application/json" hidden></label></div>
      </section>`;

    $('#s-trials').addEventListener('change', () => { saveFromForm(); viewSettings(v); });
    $('#s-minor').addEventListener('change', () => { saveFromForm(); viewSettings(v); });
    function saveFromForm() {
      const names = $('#s-names').value.split(',').map(x => x.trim()).filter(Boolean);
      while (names.length < 4) names.push('SYSTEM-' + (names.length + 1));
      const next = Object.assign(getSettings(), {
        trialsPerBlock: +$('#s-trials').value, timeLong: +$('#s-long').value, timeShort: +$('#s-short').value,
        minorityErrors: +$('#s-minor').value, practiceTrials: +$('#s-prac').value, practiceTime: +$('#s-prac-t').value,
        difficulty: $('#s-diff').value, systemNames: names.slice(0, 4), feedback: $('#s-fb').value,
        feedbackMs: +$('#s-fbms').value, fixationMs: +$('#s-fix').value, itiMs: +$('#s-iti').value, imageWidthMm: +$('#s-imgw').value || DEFAULT_SETTINGS.imageWidthMm,
        autoDownload: $('#s-auto').checked, consentText: $('#s-consent').value,
      });
      const maxMinor = Math.floor(Math.round(next.trialsPerBlock * 0.2) / 2);
      next.minorityErrors = Math.min(next.minorityErrors, maxMinor);
      save(STORE_SETTINGS, next);
    }
    $('#s-save').addEventListener('click', () => { saveFromForm(); $('#s-msg').textContent = 'Saved.'; setTimeout(() => viewSettings(v), 600); });
    $('#s-reset').addEventListener('click', () => { if (confirm('Reset all settings to defaults?')) { localStorage.removeItem(STORE_SETTINGS); viewSettings(v); } });
    $('#s-export').addEventListener('click', () => {
      const cur = getSettings();
      download(`threat-study_settings_${protocolCode(cur)}.json`, JSON.stringify({ type: 'tdx-settings', protocolCode: protocolCode(cur), settings: cur }, null, 1), 'application/json');
    });
    $('#s-import').addEventListener('change', async e => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const obj = JSON.parse(await f.text());
        if (!obj || obj.type !== 'tdx-settings' || !obj.settings) throw new Error('not a settings file from this app');
        save(STORE_SETTINGS, Object.assign({}, DEFAULT_SETTINGS, obj.settings));
        const code = protocolCode(getSettings());
        alert(code === obj.protocolCode ? `Settings loaded. Protocol code is now ${code}.` : `Settings loaded, but the protocol code here (${code}) differs from the file (${obj.protocolCode}). Make sure every laptop runs the same app version.`);
        viewSettings(v);
      } catch (err) { alert('Could not load settings: ' + err.message); }
    });
  }

  // ======================================================================
  // Participant runner
  // ======================================================================
  const runner = $('#runner'), stage = $('#stage');
  let escRequested = false;
  class AbortSession extends Error {}

  document.addEventListener('keydown', e => {
    if (!runner.hidden && e.key === 'Escape') { e.preventDefault(); escRequested = true; }
  });

  async function checkEscMenu() {
    if (!escRequested) return;
    escRequested = false;
    const menu = $('#esc-menu');
    menu.hidden = false;
    const choice = await new Promise(res => {
      $('#esc-resume').onclick = () => res('resume');
      $('#esc-abort').onclick = () => res('abort');
    });
    menu.hidden = true;
    if (choice === 'abort') throw new AbortSession();
  }

  function screenHTML(inner, wide) { return `<div class="screen ${wide ? 'wide' : ''}">${inner}</div>`; }

  /** Show a screen and resolve when a [data-next] button is clicked (optionally validated). */
  function showScreen(html, opts = {}) {
    stage.innerHTML = screenHTML(html, opts.wide);
    window.scrollTo(0, 0); runner.scrollTop = 0;
    if (opts.onMount) opts.onMount(stage);
    return new Promise((resolve, reject) => {
      const handler = async e => {
        const b = e.target.closest('[data-next]');
        if (!b) return;
        const val = opts.validate ? opts.validate(stage) : true;
        if (val === false) return;
        stage.removeEventListener('click', handler);
        try { await checkEscMenu(); } catch (err) { reject(err); return; }
        resolve(val);
      };
      stage.addEventListener('click', handler);
    });
  }

  async function startRunner(session, fullscreen) {
    $('#console').hidden = true;
    runner.hidden = false;
    escRequested = false;
    if (fullscreen && document.documentElement.requestFullscreen) { try { await document.documentElement.requestFullscreen(); } catch (e) { /* ignore */ } }
    try {
      await runSession(session);
    } catch (err) {
      if (err instanceof AbortSession) {
        session.status = 'stopped'; putSession(session);
      } else {
        console.error(err);
        session.status = 'error'; session.notes += ' Error: ' + err.message; putSession(session);
        alert('Something went wrong: ' + err.message + '\nThe data collected so far is saved.');
      }
    }
    if (document.fullscreenElement) { try { await document.exitFullscreen(); } catch (e) { /* ignore */ } }
    runner.hidden = true;
    $('#console').hidden = false;
    currentTab = session.status === 'complete' ? 'data' : 'run';
    render();
  }

  async function runSession(session) {
    const S = session.settings;
    session.status = 'in-progress';

    // Experimenter setup check: shown at the start (and on every resume) so all
    // laptops are in the same state before the participant sits down.
    const SETUP_ITEMS = [
      ['brightness', '<b>Screen brightness is turned all the way up.</b>'],
      ['charger', 'Charger is plugged in (laptops dim the screen on battery).'],
      ['nightlight', 'Night Light / Night Shift / True Tone and automatic brightness are off.'],
      ['zoom', 'Browser zoom is 100% and the laptop’s own screen is used (no external monitor).'],
      ['notifications', 'Notifications are off (Do Not Disturb / Focus) and other apps are closed.'],
      ['distance', 'The participant will sit about an arm’s length (50–60 cm) from the screen.'],
    ];
    const resumed = !!session.setupChecks;
    await showScreen(`<div class="panel">
      <h1>Before we begin</h1>
      <p class="small" style="color:#8c949e">Experimenter: check each item${resumed ? ' again before resuming' : ''}.</p>
      <ul class="setup-list">${SETUP_ITEMS.map(([k, label]) => `<li><label><input type="checkbox" data-check="${k}"> <span>${label}</span></label></li>`).join('')}</ul>
      <div class="row"><button class="btn primary big" data-next>Continue</button></div></div>`,
      { validate: st => {
          if ($$('[data-check]', st).some(c => !c.checked)) { alert('Please complete every setup item before continuing.'); return false; }
          return true;
        } });
    session.setupChecks = (session.setupChecks || []).concat([{ at: new Date().toISOString(), items: SETUP_ITEMS.map(i => i[0]), resumed }]);
    session.display = Object.assign(session.display || {}, { devicePixelRatio: window.devicePixelRatio, window: `${window.innerWidth}x${window.innerHeight}` });
    putSession(session);

    if (!session.consent) {
      await showScreen(`<div class="panel">
        <h1>Consent to participate</h1>
        <p>${esc(S.consentText)}</p>
        <label class="inline" style="margin:10px 0 18px"><input type="checkbox" id="agree"> I am 18 or older and I agree to take part.</label>
        <div class="row"><button class="btn primary big" data-next>Continue</button></div></div>`,
        { validate: st => { if (!$('#agree', st).checked) { alert('Please tick the box to continue, or tell the experimenter you would like to stop.'); return false; } return true; } });
      session.consent = { agreed: true, at: new Date().toISOString() };
      putSession(session);
    }

    if (!session.demographics) {
      const dem = await showScreen(`<div class="panel">
        <h1>About you</h1>
        <div class="stack">
          <label class="field">Age<input type="number" id="d-age" min="18" max="99" style="width:120px"></label>
          <label class="field">Gender (optional)<select id="d-gender"><option value="">Prefer not to say</option><option>Woman</option><option>Man</option><option>Non-binary</option><option>Self-describe</option></select></label>
          <label class="field">Vision<select id="d-vision"><option value="">Select…</option><option value="normal">Normal</option><option value="corrected">Corrected to normal (glasses / contacts)</option><option value="other">Other / not corrected</option></select></label>
          <label class="field">Have you ever worked in security screening (e.g., TSA, X-ray baggage)?<select id="d-exp"><option value="">Select…</option><option value="no">No</option><option value="yes">Yes</option></select></label>
          <label class="field">How often do you use AI tools (e.g., ChatGPT)?<select id="d-ai"><option value="">Select…</option><option>Never</option><option>Less than monthly</option><option>Monthly</option><option>Weekly</option><option>Daily</option></select></label>
        </div>
        <div class="row" style="margin-top:18px"><button class="btn primary big" data-next>Continue</button></div></div>`,
        { validate: st => {
            const age = parseInt($('#d-age', st).value, 10);
            if (!(age >= 18 && age <= 99) || !$('#d-vision', st).value || !$('#d-exp', st).value || !$('#d-ai', st).value) { alert('Please answer each question (gender is optional).'); return false; }
            return { age, gender: $('#d-gender', st).value, vision: $('#d-vision', st).value, screeningExp: $('#d-exp', st).value, aiUse: $('#d-ai', st).value };
          } });
      session.demographics = dem;
      putSession(session);
    }

    if (!session.practice.done) {
      await showScreen(`<div class="panel">
        <h1>Your task</h1>
        <div class="callout">☀ Please keep the <b>screen brightness turned all the way up</b> and sit about an arm’s length from the screen for the whole study. Don’t change the brightness or zoom.</div>
        <p>You will play the role of an airport security screener. Each image is an X-ray of one bag. Decide whether the bag contains a <b>threat</b> or is <b>clear</b>.</p>
        <p>There are three kinds of threat: <b>knives</b>, <b>guns</b> and <b>bombs</b>. Each comes in different shapes and sizes, can appear at any angle, and may be partly hidden behind other items. Dense metal shows up dark blue; organic material (including explosives) shows up orange.</p>
        <div class="examples compact" id="ex-threats"><h4>Threats: answer THREAT</h4></div>
        <div class="examples compact" id="ex-lures"><h4>Not threats: everyday items that can look similar</h4></div>
        <p class="small">Only knives, guns and bombs count as threats. Scissors, tools, batteries, electronics, hair dryers and toys are allowed items, so a bag that contains only items like these is <b>clear</b>.</p>
        <p>Press <b>F</b> for <b>THREAT</b> or <b>J</b> for <b>CLEAR</b> (you can also click the buttons). Each bag is shown for a limited time; the bar under the image shows the time left. If time runs out, no answer is recorded, so try to answer every bag.</p>
        <p>First you will do a short practice round on your own.</p>
        <div class="row" style="margin-top:12px"><button class="btn primary big" data-next>Start practice</button></div></div>`,
        { wide: true, onMount: st => {
            const add = (box, kind, type, variant, caption) => {
              const fig = document.createElement('figure'); const cv = document.createElement('canvas');
              Stimuli.renderExample(cv, kind, type, variant);
              fig.append(cv); const fc = document.createElement('figcaption'); fc.textContent = caption; fig.append(fc); box.append(fig);
            };
            const tBox = $('#ex-threats', st), lBox = $('#ex-lures', st);
            Object.entries(Stimuli.VARIANTS).forEach(([type, vs]) => vs.forEach(v => add(tBox, 'threat', type, v, v)));
            [['scissors', 'Scissors'], ['screwdriver', 'Screwdriver'], ['wrench', 'Wrench'], ['corkscrew', 'Corkscrew'], ['hairdryer', 'Hair dryer'],
             ['toygun', 'Plastic toy'], ['batteries', 'Batteries'], ['powerbank', 'Power bank']].forEach(([k, c]) => add(lBox, 'lure', k, '', c));
          } });

      session.practice.trials = [];
      await runTrials(session, null, session.practice.plan, session.practice.trials, S.practiceTime, true);
      session.practice.done = true;
      putSession(session);

      await showScreen(`<div class="panel">
        <h1>Practice complete</h1>
        <p>In the rest of the study, an <b>AI screening system</b> will also look at each bag. Its recommendation appears on the image: a <b style="color:#ff8a87">red frame and “THREAT” label</b> or a <b style="color:#7fe0a8">green frame and “CLEAR” label</b>.</p>
        <p>There are four sections, each with a different AI system. The AI’s recommendation is advice only; <b>you make the final decision</b> on every bag.</p>
        <p>After each section you will answer a few questions about the AI system you just used.</p>
        <div class="row" style="margin-top:12px"><button class="btn primary big" data-next>Continue</button></div></div>`);
    }

    for (const block of session.blocks) {
      if (block.done) continue;
      const n = block.position;
      await showScreen(`<div class="panel">
        <h1>Section ${n} of 4</h1>
        <p>In this section you will work with the <b>${esc(block.system)}</b> AI screening system.</p>
        <p>You will have <b>${block.timeLimit} seconds</b> per bag.</p>
        <p class="small">F = THREAT · J = CLEAR</p>
        <div class="row" style="margin-top:12px"><button class="btn primary big" data-next>Begin section ${n}</button></div></div>`);
      block.trials = [];
      block.startedAt = new Date().toISOString();
      await runTrials(session, block, block.plan, block.trials, block.timeLimit, S.feedback !== 'none');
      putSession(session);

      const items = await showScreen(`<div class="panel">
        <h1>About the ${esc(block.system)} system</h1>
        <p>Rate how much each statement describes the <b>${esc(block.system)}</b> system you just worked with (1 = not at all, 7 = extremely).</p>
        <div class="table-wrap"><table class="likert">
          <thead><tr><th></th>${[1, 2, 3, 4, 5, 6, 7].map(i => `<th>${i}${i === 1 ? '<br>Not at all' : i === 7 ? '<br>Extremely' : ''}</th>`).join('')}</tr></thead>
          <tbody>${TRUST_ITEMS.map((t, qi) => `<tr data-q="${qi}"><td>${esc(t)}</td>${[1, 2, 3, 4, 5, 6, 7].map(v => `<td><input type="radio" name="q${qi}" value="${v}" aria-label="${v}"></td>`).join('')}</tr>`).join('')}</tbody>
        </table></div>
        <div class="row" style="margin-top:16px"><button class="btn primary big" data-next>Submit</button></div></div>`,
        { wide: true, validate: st => {
            const vals = TRUST_ITEMS.map((_, qi) => { const c = $(`input[name=q${qi}]:checked`, st); return c ? +c.value : null; });
            $$('tr[data-q]', st).forEach((tr, qi) => tr.classList.toggle('missing', vals[qi] == null));
            if (vals.some(x => x == null)) { alert('Please answer every statement (missing ones are highlighted).'); return false; }
            return vals;
          } });
      block.trust = { items, score: trustScore(items), at: new Date().toISOString() };
      block.endedAt = new Date().toISOString();
      block.done = true;
      putSession(session);

      if (n < 4) {
        await showScreen(`<div class="panel"><h1>Short break</h1><p>Section ${n} of 4 is done. Take a moment to rest your eyes, then continue when you are ready.</p>
          <div class="row" style="margin-top:12px"><button class="btn primary big" data-next>Continue</button></div></div>`);
      }
    }

    session.status = 'complete';
    session.completedAt = new Date().toISOString();
    putSession(session);
    if (S.autoDownload) download(`${session.id}_threat-study_${today()}.json`, JSON.stringify(session, null, 1), 'application/json');
    await showScreen(`<div class="panel"><h1>Thank you!</h1><p>You have finished the study. Please let the experimenter know.</p>
      <p class="small" style="margin-top:24px;color:#8c949e">Experimenter: data for ${esc(session.id)} is saved${S.autoDownload ? ' and the JSON file has been downloaded' : ''}.</p>
      <div class="row" style="margin-top:12px"><button class="btn" data-next>Return to console</button></div></div>`);
  }

  // Pre-render all images for a list of trials
  function prerender(plan, difficulty) {
    const map = {};
    plan.forEach(t => {
      const cv = document.createElement('canvas');
      Stimuli.renderBag(cv, { id: t.imageId, isThreat: t.truth === 'threat', threatType: t.threatType, threatVariant: t.threatVariant, difficulty });
      map[t.imageId] = cv;
    });
    return map;
  }

  async function runTrials(session, block, plan, out, timeLimit, feedback) {
    const S = session.settings;
    stage.innerHTML = screenHTML('<p style="text-align:center;color:#8c949e">Loading images…</p>');
    await sleep(30);
    const canvases = prerender(plan, S.difficulty);
    for (const t of plan) {
      await checkEscMenu();
      stage.innerHTML = '<div class="fixation">+</div>';
      await sleep(S.fixationMs);
      const r = await runOneTrial(session, t, block, canvases[t.imageId], timeLimit);
      const followedAI = block ? (r.response === 'timeout' ? null : r.response === t.aiLabel) : null;
      const correct = r.response === t.truth;
      const outcome = r.response === 'timeout' ? 'timeout' : t.truth === 'threat' ? (r.response === 'threat' ? 'hit' : 'miss') : (r.response === 'threat' ? 'fa' : 'cr');
      out.push(Object.assign({}, t, { response: r.response, rtMs: r.rt, inputMethod: r.method, imageWidthMm: r.imageWidthMm, correct, followedAI, outcome, feedbackShown: !!feedback, timestamp: new Date().toISOString() }));
      putSession(session);
      if (feedback) {
        const contents = t.truth === 'threat' ? `This bag contained a <b>threat</b> (${esc(t.threatVariant || t.threatType)}).` : 'This bag was <b>clear</b>.';
        stage.innerHTML = `<div class="feedback">${r.response === 'timeout'
          ? '<div class="big to">Time’s up</div><p>No answer was recorded.</p>'
          : correct ? '<div class="big ok">✓ Correct</div>' : '<div class="big bad">✗ Incorrect</div>'}<p>${contents}</p></div>`;
        await sleep(S.feedbackMs);
      }
      stage.innerHTML = '';
      await sleep(S.itiMs);
    }
  }

  /** Pixels per mm to use for this session: current calibration if still valid, else the one saved with the session. */
  function sessionPxPerMm(session) {
    const st = calibrationStatus();
    if (st.ok) return st.cal.pxPerMm;
    const c = session.display && session.display.calibration;
    return c ? c.pxPerMm : null;
  }

  /** Draw the X-ray at a fixed physical width; shrink only if the window is too small, and record it. */
  function sizeTrialImage(session, canvas) {
    const trial = stage.querySelector('.trial');
    const ppm = sessionPxPerMm(session);
    const targetMm = session.settings.imageWidthMm || DEFAULT_SETTINGS.imageWidthMm;
    let w = ppm ? targetMm * ppm : Math.min(900, window.innerWidth - 52);
    canvas.style.width = w + 'px'; trial.style.width = (w + 20) + 'px';
    const other = trial.offsetHeight - canvas.offsetHeight;
    const availW = window.innerWidth - 32 - 20;
    const availH = window.innerHeight - other - 24;
    let shrunk = false;
    if (w > availW || w / 1.5 > availH) {
      w = Math.floor(Math.min(availW, availH * 1.5));
      canvas.style.width = w + 'px'; trial.style.width = (w + 20) + 'px';
      shrunk = true;
    }
    if (!session.display) session.display = { targetImageWidthMm: targetMm, shrunkTrials: 0 };
    const mm = ppm ? w / ppm : null;
    session.display.renderedImageWidthMm = mm == null ? null : Math.round(mm * 10) / 10;
    if (shrunk) session.display.shrunkTrials = (session.display.shrunkTrials || 0) + 1;
    return mm == null ? null : Math.round(mm * 10) / 10;
  }

  function runOneTrial(session, t, block, canvas, timeLimit) {
    return new Promise(resolve => {
      // The AI's advice is shown ON the image: a red/green frame around it and a
      // label overlaid at the top centre (over the empty area above the bag).
      const badge = block
        ? `<div class="ai-badge ${t.aiLabel}"><span class="sys">${esc(block.system)} AI</span><span>${t.aiLabel === 'threat' ? '⚠ THREAT' : '✓ CLEAR'}</span></div>`
        : '<div class="ai-badge none">Practice: no AI assistance</div>';
      stage.innerHTML = `<div class="trial">
        <div class="xray-wrap ${block ? 'ai-' + t.aiLabel : ''}" id="xw">${badge}</div>
        <div class="timer" id="tm"><div></div></div>
        <div class="resp"><button data-r="threat">THREAT<kbd>F</kbd></button><button data-r="clear">CLEAR<kbd>J</kbd></button></div></div>`;
      $('#xw').insertBefore(canvas, $('#xw').firstChild);
      const imageWidthMm = sizeTrialImage(session, canvas);
      const bar = $('#tm > div'), tm = $('#tm');
      let onset = null, done = false, raf = 0, to = 0;
      const finish = (response, method) => {
        if (done || onset == null) return;
        done = true;
        const rt = response === 'timeout' ? null : performance.now() - onset;
        cancelAnimationFrame(raf); clearTimeout(to);
        document.removeEventListener('keydown', onKey);
        resolve({ response, rt, method: response === 'timeout' ? '' : method, imageWidthMm });
      };
      const onKey = e => {
        if (e.repeat) return;
        const k = e.key.toLowerCase();
        if (k === 'f') finish('threat', 'key');
        else if (k === 'j') finish('clear', 'key');
      };
      stage.querySelector('.resp').addEventListener('click', e => { const b = e.target.closest('[data-r]'); if (b) finish(b.dataset.r, 'click'); });
      document.addEventListener('keydown', onKey);
      // onset = first frame after the image is painted (with a fallback so a
      // throttled/background tab can never leave a trial hanging)
      let started = false;
      const start = () => {
        if (started) return;
        started = true;
        onset = performance.now();
        to = setTimeout(() => finish('timeout'), timeLimit * 1000);
        const tick = () => {
          const left = Math.max(0, 1 - (performance.now() - onset) / (timeLimit * 1000));
          bar.style.transform = `scaleX(${left})`;
          tm.classList.toggle('low', left < 0.3);
          if (!done) raf = requestAnimationFrame(tick);
        };
        tick();
      };
      requestAnimationFrame(() => requestAnimationFrame(start));
      setTimeout(start, 100);
    });
  }

  render();
})();
