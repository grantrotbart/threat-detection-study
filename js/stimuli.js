/* =========================================================================
   stimuli.js — procedural X-ray baggage images
   Every image is generated from a text seed, so the same image ID always
   produces the exact same picture on every computer (matched image sets).
   ========================================================================= */
(function (global) {
  'use strict';

  // ---------- seeded RNG ----------
  function hashString(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function makeRng(seed) {
    const r = mulberry32(hashString(String(seed)));
    const rng = () => r();
    rng.range = (a, b) => a + (b - a) * r();
    rng.int = (a, b) => Math.floor(a + (b - a + 1) * r());
    rng.pick = (arr) => arr[Math.floor(r() * arr.length)];
    rng.chance = (p) => r() < p;
    rng.shuffle = (arr) => {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(r() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    };
    return rng;
  }

  // ---------- X-ray material colors (multiply-blended on white) ----------
  // Organic = orange, mixed = green, inorganic/metal = blue, dense metal = navy.
  const MAT = {
    organic: [232, 150, 60],
    organicLight: [240, 190, 120],
    mixed: [110, 170, 80],
    metal: [70, 110, 200],
    dense: [25, 45, 120],
  };
  function rgba(m, a) { return `rgba(${m[0]},${m[1]},${m[2]},${a})`; }

  const W = 720, H = 480;

  // ---------- drawing helpers ----------
  function withTransform(ctx, x, y, rot, s, fn) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s, s); fn(); ctx.restore();
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function blob(ctx, rng, cx, cy, rx, ry, points) {
    const n = points || 9;
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const k = rng.range(0.7, 1.15);
      pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
    }
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const p0 = pts[i], p1 = pts[(i + 1) % n];
      const mx = (p0[0] + p1[0]) / 2, my = (p0[1] + p1[1]) / 2;
      if (i === 0) ctx.moveTo(mx, my); else ctx.quadraticCurveTo(p0[0], p0[1], mx, my);
    }
    const p0 = pts[0], p1 = pts[1];
    ctx.quadraticCurveTo(p0[0], p0[1], (p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2);
    ctx.closePath();
  }

  // ---------- clutter objects (benign) ----------
  const CLUTTER = {
    clothing(ctx, rng, b) {
      const cx = rng.range(b.x + 60, b.x + b.w - 60), cy = rng.range(b.y + 50, b.y + b.h - 50);
      const layers = rng.int(2, 4);
      for (let i = 0; i < layers; i++) {
        ctx.fillStyle = rgba(MAT.organicLight, rng.range(0.25, 0.45));
        blob(ctx, rng, cx + rng.range(-30, 30), cy + rng.range(-20, 20), rng.range(70, 150), rng.range(40, 90), 10);
        ctx.fill();
      }
      // seams / folds
      ctx.strokeStyle = rgba(MAT.organic, 0.35); ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(cx + rng.range(-90, 90), cy + rng.range(-50, 50));
        ctx.quadraticCurveTo(cx + rng.range(-90, 90), cy + rng.range(-50, 50), cx + rng.range(-90, 90), cy + rng.range(-50, 50));
        ctx.stroke();
      }
    },
    book(ctx, rng, b) {
      withTransform(ctx, rng.range(b.x + 60, b.x + b.w - 60), rng.range(b.y + 50, b.y + b.h - 50), rng.range(-0.6, 0.6), 1, () => {
        const w = rng.range(80, 130), h = rng.range(100, 150);
        ctx.fillStyle = rgba(MAT.organic, rng.range(0.45, 0.65));
        ctx.fillRect(-w / 2, -h / 2, w, h);
        ctx.fillStyle = rgba(MAT.organic, 0.3);
        ctx.fillRect(-w / 2, -h / 2, 10, h);
      });
    },
    bottle(ctx, rng, b) {
      withTransform(ctx, rng.range(b.x + 40, b.x + b.w - 40), rng.range(b.y + 40, b.y + b.h - 40), rng.range(0, Math.PI * 2), rng.range(0.8, 1.2), () => {
        ctx.fillStyle = rgba(rng.chance(0.5) ? MAT.organic : MAT.mixed, 0.55);
        roundRect(ctx, -18, -50, 36, 90, 14); ctx.fill();
        ctx.fillStyle = rgba(MAT.metal, 0.6);
        ctx.fillRect(-9, -64, 18, 16);
      });
    },
    laptop(ctx, rng, b) {
      withTransform(ctx, rng.range(b.x + 140, b.x + b.w - 140), rng.range(b.y + 90, b.y + b.h - 90), rng.range(-0.25, 0.25), rng.range(0.85, 1.05), () => {
        ctx.fillStyle = rgba(MAT.metal, 0.28);
        roundRect(ctx, -150, -95, 300, 190, 8); ctx.fill();
        ctx.fillStyle = rgba(MAT.metal, 0.45);
        for (let i = 0; i < 4; i++) ctx.fillRect(-130 + i * 34, 30, 28, 50); // battery cells
        ctx.fillStyle = rgba(MAT.mixed, 0.45);
        ctx.fillRect(10, -70, 110, 70); // board
        ctx.fillStyle = rgba(MAT.dense, 0.5);
        for (let i = 0; i < 6; i++) ctx.fillRect(rng.range(15, 110), rng.range(-65, -10), rng.range(6, 14), rng.range(6, 14));
        ctx.strokeStyle = rgba(MAT.metal, 0.55); ctx.lineWidth = 3;
        ctx.strokeRect(-150, -95, 300, 190);
      });
    },
    charger(ctx, rng, b) {
      const x = rng.range(b.x + 40, b.x + b.w - 40), y = rng.range(b.y + 40, b.y + b.h - 40);
      withTransform(ctx, x, y, rng.range(0, Math.PI * 2), 1, () => {
        ctx.fillStyle = rgba(MAT.metal, 0.55);
        roundRect(ctx, -22, -16, 44, 32, 5); ctx.fill();
        ctx.fillStyle = rgba(MAT.dense, 0.5);
        ctx.fillRect(-12, -8, 24, 16);
      });
      ctx.strokeStyle = rgba(MAT.mixed, 0.6); ctx.lineWidth = rng.range(2, 4);
      ctx.beginPath(); ctx.moveTo(x, y);
      ctx.bezierCurveTo(x + rng.range(-160, 160), y + rng.range(-120, 120), x + rng.range(-160, 160), y + rng.range(-120, 120), x + rng.range(-200, 200), y + rng.range(-120, 120));
      ctx.stroke();
    },
    cable(ctx, rng, b) {
      ctx.strokeStyle = rgba(rng.chance(0.5) ? MAT.mixed : MAT.metal, 0.55); ctx.lineWidth = rng.range(2, 5);
      ctx.beginPath();
      const x = rng.range(b.x, b.x + b.w), y = rng.range(b.y, b.y + b.h);
      ctx.moveTo(x, y);
      for (let i = 0; i < 3; i++) {
        ctx.bezierCurveTo(rng.range(b.x, b.x + b.w), rng.range(b.y, b.y + b.h), rng.range(b.x, b.x + b.w), rng.range(b.y, b.y + b.h), rng.range(b.x, b.x + b.w), rng.range(b.y, b.y + b.h));
      }
      ctx.stroke();
    },
    shoe(ctx, rng, b) {
      withTransform(ctx, rng.range(b.x + 70, b.x + b.w - 70), rng.range(b.y + 40, b.y + b.h - 40), rng.range(0, Math.PI * 2), rng.range(0.8, 1.1), () => {
        ctx.fillStyle = rgba(MAT.organic, 0.5);
        ctx.beginPath(); ctx.ellipse(0, 0, 85, 32, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = rgba(MAT.organic, 0.35);
        ctx.beginPath(); ctx.ellipse(-20, 0, 50, 22, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = rgba(MAT.metal, 0.5);
        for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc(-50 + i * 18, -18, 2.5, 0, 7); ctx.fill(); }
      });
    },
    phone(ctx, rng, b) {
      withTransform(ctx, rng.range(b.x + 40, b.x + b.w - 40), rng.range(b.y + 40, b.y + b.h - 40), rng.range(0, Math.PI * 2), 1, () => {
        ctx.fillStyle = rgba(MAT.metal, 0.5);
        roundRect(ctx, -22, -42, 44, 84, 7); ctx.fill();
        ctx.fillStyle = rgba(MAT.dense, 0.45);
        ctx.fillRect(-15, -10, 30, 40);
      });
    },
    keys(ctx, rng, b) {
      const x = rng.range(b.x + 30, b.x + b.w - 30), y = rng.range(b.y + 30, b.y + b.h - 30);
      ctx.strokeStyle = rgba(MAT.dense, 0.7); ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, y, 10, 0, 7); ctx.stroke();
      const n = rng.int(2, 4);
      for (let i = 0; i < n; i++) {
        withTransform(ctx, x, y, rng.range(0, Math.PI * 2), 1, () => {
          ctx.fillStyle = rgba(MAT.dense, 0.7);
          ctx.beginPath(); ctx.arc(22, 0, 8, 0, 7); ctx.fill();
          ctx.fillRect(28, -3, 28, 6);
          ctx.fillRect(46, 2, 4, 5); ctx.fillRect(52, 2, 4, 4);
        });
      }
    },
    coins(ctx, rng, b) {
      const x = rng.range(b.x + 30, b.x + b.w - 30), y = rng.range(b.y + 30, b.y + b.h - 30);
      const n = rng.int(2, 6);
      for (let i = 0; i < n; i++) {
        ctx.fillStyle = rgba(MAT.dense, rng.range(0.55, 0.75));
        ctx.beginPath(); ctx.arc(x + rng.range(-25, 25), y + rng.range(-25, 25), rng.range(7, 12), 0, 7); ctx.fill();
      }
    },
    umbrella(ctx, rng, b) {
      withTransform(ctx, rng.range(b.x + 120, b.x + b.w - 120), rng.range(b.y + 40, b.y + b.h - 40), rng.range(-0.5, 0.5), 1, () => {
        ctx.fillStyle = rgba(MAT.organicLight, 0.35);
        ctx.beginPath(); ctx.ellipse(0, 0, 120, 18, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = rgba(MAT.metal, 0.6); ctx.lineWidth = 2;
        for (let i = -3; i <= 3; i++) { ctx.beginPath(); ctx.moveTo(-110, i * 4); ctx.lineTo(110, i * 2); ctx.stroke(); }
        ctx.lineWidth = 4; ctx.strokeStyle = rgba(MAT.dense, 0.55);
        ctx.beginPath(); ctx.moveTo(-125, 0); ctx.lineTo(125, 0); ctx.stroke();
        ctx.beginPath(); ctx.arc(135, 10, 12, -Math.PI / 2, Math.PI / 2); ctx.stroke();
      });
    },
    pen(ctx, rng, b) {
      withTransform(ctx, rng.range(b.x + 40, b.x + b.w - 40), rng.range(b.y + 40, b.y + b.h - 40), rng.range(0, Math.PI * 2), 1, () => {
        ctx.fillStyle = rgba(MAT.mixed, 0.55); ctx.fillRect(-60, -5, 120, 10);
        ctx.fillStyle = rgba(MAT.metal, 0.75); ctx.fillRect(40, -6, 22, 12);
        ctx.fillStyle = rgba(MAT.dense, 0.7); ctx.fillRect(-62, -2, 30, 4);
      });
    },
    // metal distractors that share features with threats (elongated, dense)
    spoon(ctx, rng, b) {
      withTransform(ctx, rng.range(b.x + 50, b.x + b.w - 50), rng.range(b.y + 40, b.y + b.h - 40), rng.range(0, Math.PI * 2), rng.range(0.9, 1.2), () => {
        ctx.fillStyle = rgba(MAT.dense, 0.6);
        ctx.beginPath(); ctx.ellipse(45, 0, 20, 13, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.moveTo(-60, -4); ctx.lineTo(26, -3); ctx.lineTo(26, 3); ctx.lineTo(-60, 5); ctx.closePath(); ctx.fill();
      });
    },
    tool(ctx, rng, b) { // wrench / multitool-like metal bar
      withTransform(ctx, rng.range(b.x + 50, b.x + b.w - 50), rng.range(b.y + 40, b.y + b.h - 40), rng.range(0, Math.PI * 2), rng.range(0.8, 1.1), () => {
        ctx.fillStyle = rgba(MAT.dense, 0.6);
        roundRect(ctx, -55, -7, 110, 14, 6); ctx.fill();
        ctx.beginPath(); ctx.arc(-55, 0, 14, 0, 7); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.beginPath(); ctx.arc(-58, 0, 6, 0, 7); ctx.fill();
        ctx.globalCompositeOperation = 'multiply';
      });
    },
    toiletries(ctx, rng, b) {
      const x = rng.range(b.x + 60, b.x + b.w - 60), y = rng.range(b.y + 50, b.y + b.h - 50);
      ctx.fillStyle = rgba(MAT.organicLight, 0.4);
      roundRect(ctx, x - 70, y - 40, 140, 80, 20); ctx.fill();
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = rgba(rng.pick([MAT.organic, MAT.mixed, MAT.metal]), 0.5);
        roundRect(ctx, x - 60 + i * 30, y - 30 + rng.range(0, 15), 22, rng.range(35, 55), 6); ctx.fill();
      }
    },
    belt(ctx, rng, b) {
      const x = rng.range(b.x + 80, b.x + b.w - 80), y = rng.range(b.y + 60, b.y + b.h - 60);
      ctx.strokeStyle = rgba(MAT.organic, 0.5); ctx.lineWidth = 12;
      ctx.beginPath(); ctx.ellipse(x, y, rng.range(50, 80), rng.range(30, 50), rng.range(0, 3), 0, Math.PI * 1.8); ctx.stroke();
      ctx.strokeStyle = rgba(MAT.dense, 0.7); ctx.lineWidth = 5;
      ctx.strokeRect(x + rng.range(30, 60), y - 12, 24, 28);
    },
  };
  const CLUTTER_WEIGHTS = [
    ['clothing', 3], ['book', 1], ['bottle', 2], ['charger', 2], ['cable', 2], ['shoe', 1.5],
    ['phone', 1], ['keys', 1], ['coins', 1], ['umbrella', 0.7], ['pen', 1.5], ['spoon', 1.2],
    ['tool', 1.2], ['toiletries', 1], ['belt', 0.8],
  ];
  function pickClutter(rng) {
    const total = CLUTTER_WEIGHTS.reduce((s, w) => s + w[1], 0);
    let r = rng() * total;
    for (const [name, w] of CLUTTER_WEIGHTS) { if ((r -= w) <= 0) return name; }
    return 'clothing';
  }

  // ---------- extra clutter (benign, ordinary items) ----------
  function at(ctx, rng, b, margin, fn, rot, scale) {
    withTransform(ctx, rng.range(b.x + margin, b.x + b.w - margin), rng.range(b.y + margin * 0.7, b.y + b.h - margin * 0.7),
      rot == null ? rng.range(0, Math.PI * 2) : rot, scale || 1, fn);
  }
  Object.assign(CLUTTER, {
    headphones(ctx, rng, b) {
      at(ctx, rng, b, 60, () => {
        ctx.strokeStyle = rgba(MAT.mixed, 0.55); ctx.lineWidth = 7;
        ctx.beginPath(); ctx.arc(0, 10, 48, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
        ctx.strokeStyle = rgba(MAT.metal, 0.5); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 10, 44, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
        for (const s of [-1, 1]) {
          ctx.fillStyle = rgba(MAT.mixed, 0.5); ctx.beginPath(); ctx.ellipse(s * 44, 8, 15, 22, 0, 0, 7); ctx.fill();
          ctx.fillStyle = rgba(MAT.dense, 0.55); ctx.beginPath(); ctx.arc(s * 44, 8, 7, 0, 7); ctx.fill();
        }
      });
    },
    glasses(ctx, rng, b) {
      at(ctx, rng, b, 40, () => {
        ctx.strokeStyle = rgba(MAT.metal, 0.6); ctx.lineWidth = 2.5;
        for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(s * 22, 0, 18, 13, 0, 0, 7); ctx.stroke(); }
        ctx.beginPath(); ctx.moveTo(-4, -2); ctx.quadraticCurveTo(0, -7, 4, -2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-40, -3); ctx.lineTo(-62, 4); ctx.moveTo(40, -3); ctx.lineTo(62, 4); ctx.stroke();
      });
    },
    watch(ctx, rng, b) {
      at(ctx, rng, b, 30, () => {
        ctx.fillStyle = rgba(MAT.organic, 0.5); ctx.fillRect(-9, -40, 18, 80);
        ctx.fillStyle = rgba(MAT.dense, 0.65); ctx.beginPath(); ctx.arc(0, 0, 15, 0, 7); ctx.fill();
        ctx.fillStyle = rgba(MAT.metal, 0.5); ctx.beginPath(); ctx.arc(0, 0, 20, 0, 7); ctx.fill();
      });
    },
    tablet(ctx, rng, b) {
      at(ctx, rng, b, 110, () => {
        ctx.fillStyle = rgba(MAT.metal, 0.3); roundRect(ctx, -90, -65, 180, 130, 10); ctx.fill();
        ctx.fillStyle = rgba(MAT.metal, 0.4); ctx.fillRect(-70, -45, 85, 90);
        ctx.fillStyle = rgba(MAT.mixed, 0.45); ctx.fillRect(28, -40, 40, 80);
        ctx.fillStyle = rgba(MAT.dense, 0.45); for (let i = 0; i < 4; i++) ctx.fillRect(34, -32 + i * 18, 10, 8);
      }, rng.range(-0.4, 0.4));
    },
    jar(ctx, rng, b) {
      at(ctx, rng, b, 40, () => {
        ctx.fillStyle = rgba(MAT.organic, 0.7); roundRect(ctx, -26, -32, 52, 64, 10); ctx.fill();
        ctx.fillStyle = rgba(MAT.metal, 0.65); ctx.fillRect(-28, -40, 56, 10);
      });
    },
    flashlight(ctx, rng, b) {
      at(ctx, rng, b, 60, () => {
        ctx.fillStyle = rgba(MAT.metal, 0.55); roundRect(ctx, -55, -10, 90, 20, 6); ctx.fill();
        ctx.fillStyle = rgba(MAT.metal, 0.6); roundRect(ctx, 32, -16, 26, 32, 5); ctx.fill();
        ctx.fillStyle = rgba(MAT.dense, 0.55); ctx.fillRect(-48, -6, 24, 12); ctx.fillRect(-20, -6, 24, 12);
      });
    },
    socks(ctx, rng, b) {
      const x = rng.range(b.x + 40, b.x + b.w - 40), y = rng.range(b.y + 40, b.y + b.h - 40);
      for (let i = 0; i < rng.int(2, 4); i++) {
        ctx.fillStyle = rgba(MAT.organicLight, rng.range(0.35, 0.55));
        blob(ctx, rng, x + rng.range(-40, 40), y + rng.range(-25, 25), rng.range(22, 34), rng.range(16, 26), 8); ctx.fill();
      }
    },
    camera(ctx, rng, b) {
      at(ctx, rng, b, 60, () => {
        ctx.fillStyle = rgba(MAT.metal, 0.5); roundRect(ctx, -50, -30, 100, 60, 8); ctx.fill();
        ctx.fillStyle = rgba(MAT.dense, 0.55); ctx.beginPath(); ctx.arc(10, 0, 22, 0, 7); ctx.fill();
        ctx.fillStyle = rgba(MAT.dense, 0.4); ctx.beginPath(); ctx.arc(10, 0, 12, 0, 7); ctx.fill();
        ctx.fillStyle = rgba(MAT.mixed, 0.5); ctx.fillRect(-44, -22, 22, 44);
      });
    },
    snacks(ctx, rng, b) {
      at(ctx, rng, b, 50, () => {
        ctx.fillStyle = rgba(MAT.organic, rng.range(0.35, 0.55));
        roundRect(ctx, -45, -28, 90, 56, 6); ctx.fill();
        ctx.fillStyle = rgba(MAT.organic, 0.25);
        for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc(rng.range(-35, 35), rng.range(-18, 18), rng.range(5, 9), 0, 7); ctx.fill(); }
      });
    },
    hanger(ctx, rng, b) {
      at(ctx, rng, b, 70, () => {
        ctx.strokeStyle = rgba(MAT.metal, 0.6); ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(-70, 25); ctx.lineTo(0, -15); ctx.lineTo(70, 25); ctx.closePath(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, -15); ctx.lineTo(0, -28); ctx.arc(8, -28, 8, Math.PI, Math.PI * 2.2); ctx.stroke();
      });
    },
  });
  CLUTTER_WEIGHTS.push(['headphones', 1], ['glasses', 0.8], ['watch', 0.8], ['tablet', 0.8], ['jar', 0.8], ['flashlight', 0.8],
    ['socks', 1.5], ['camera', 0.7], ['snacks', 1], ['hanger', 0.6]);

  // ---------- look-alike lures (benign, but share features with threats) ----------
  // Drawn at the origin; every bag (threat or clear) gets the same number of
  // lures from the same random process, so they never signal the answer.
  const LURES = {
    scissors(ctx, a, t) {
      const L = t.range(55, 80);
      for (const s of [-1, 1]) {
        withTransform(ctx, 0, 0, s * t.range(0.08, 0.25), 1, () => {
          ctx.fillStyle = rgba(MAT.dense, a);
          ctx.beginPath(); ctx.moveTo(0, -3 * s); ctx.lineTo(L, s * 1); ctx.lineTo(L * 0.92, s * 6); ctx.lineTo(0, s * 6); ctx.closePath(); ctx.fill();
          ctx.strokeStyle = rgba(MAT.mixed, 0.7); ctx.lineWidth = 6;
          ctx.beginPath(); ctx.ellipse(-24, s * 10, 16, 10, 0, 0, 7); ctx.stroke();
        });
      }
      ctx.fillStyle = rgba(MAT.dense, a); ctx.beginPath(); ctx.arc(0, 0, 4, 0, 7); ctx.fill();
    },
    hairdryer(ctx, a, t) {
      const L = t.range(80, 105);
      ctx.fillStyle = rgba(MAT.mixed, 0.5); roundRect(ctx, -L / 2, -20, L, 40, 18); ctx.fill();
      ctx.fillStyle = rgba(MAT.mixed, 0.5); roundRect(ctx, L / 2 - 6, -14, 24, 28, 4); ctx.fill();
      ctx.fillStyle = rgba(MAT.mixed, 0.55); ctx.save(); ctx.rotate(0.25); roundRect(ctx, -L / 2 + 8, 10, 22, 60, 8); ctx.fill(); ctx.restore();
      ctx.fillStyle = rgba(MAT.dense, a * 0.8); ctx.beginPath(); ctx.arc(-L / 2 + 22, 0, 12, 0, 7); ctx.fill();
      ctx.strokeStyle = rgba(MAT.metal, 0.7); ctx.lineWidth = 2;
      ctx.beginPath(); for (let i = 0; i < 9; i++) ctx.lineTo(-L / 2 + 40 + i * 6, i % 2 ? -8 : 8); ctx.stroke();
      ctx.strokeStyle = rgba(MAT.mixed, 0.6); ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-L / 2 + 30, 70); ctx.bezierCurveTo(-40, 120, 40, 90, 70, 130); ctx.stroke();
    },
    screwdriver(ctx, a, t) {
      const L = t.range(60, 95);
      ctx.fillStyle = rgba(MAT.dense, a); ctx.fillRect(0, -3, L, 6);
      ctx.beginPath(); ctx.moveTo(L, -3); ctx.lineTo(L + 8, -1); ctx.lineTo(L + 8, 1); ctx.lineTo(L, 3); ctx.fill();
      ctx.fillStyle = rgba(MAT.mixed, 0.6); roundRect(ctx, -48, -10, 50, 20, 8); ctx.fill();
    },
    wrench(ctx, a, t) {
      const L = t.range(80, 120);
      ctx.fillStyle = rgba(MAT.dense, a); roundRect(ctx, -L / 2, -6, L, 12, 5); ctx.fill();
      // open-ended jaw (C shape) and ring end
      ctx.strokeStyle = rgba(MAT.dense, a); ctx.lineWidth = 8;
      ctx.beginPath(); ctx.arc(L / 2 + 6, 0, 11, Math.PI * 0.25, Math.PI * 1.75); ctx.stroke();
      ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(-L / 2 - 4, 0, 10, 0, 7); ctx.stroke();
    },
    batteries(ctx, a, t) {
      const n = t.int(2, 4);
      for (let i = 0; i < n; i++) {
        withTransform(ctx, t.range(-25, 25), i * 18 - n * 9, t.range(-0.3, 0.3), 1, () => {
          ctx.fillStyle = rgba(MAT.metal, 0.65); roundRect(ctx, -25, -7, 50, 14, 4); ctx.fill();
          ctx.fillStyle = rgba(MAT.dense, a); ctx.fillRect(22, -3, 6, 6); ctx.fillRect(-26, -6, 4, 12);
        });
      }
    },
    powerbank(ctx, a, t) {
      ctx.fillStyle = rgba(MAT.metal, 0.5); roundRect(ctx, -45, -24, 90, 48, 6); ctx.fill();
      ctx.fillStyle = rgba(MAT.dense, a * 0.7); for (let i = 0; i < 3; i++) ctx.fillRect(-38 + i * 26, -16, 22, 32);
      ctx.fillStyle = rgba(MAT.mixed, 0.55); ctx.fillRect(28, -12, 14, 24);
      ctx.strokeStyle = rgba(MAT.mixed, 0.6); ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(45, 0); ctx.bezierCurveTo(90, -40, 110, 40, t.range(60, 140), t.range(-60, 60)); ctx.stroke();
    },
    corkscrew(ctx, a, t) {
      ctx.fillStyle = rgba(MAT.dense, a); roundRect(ctx, -45, -6, 70, 12, 5); ctx.fill();
      ctx.strokeStyle = rgba(MAT.dense, a); ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(25, 0); for (let i = 0; i < 8; i++) ctx.lineTo(28 + i * 5, i % 2 ? -6 : 6); ctx.stroke();
      ctx.fillStyle = rgba(MAT.organic, 0.55); roundRect(ctx, -55, -10, 22, 20, 6); ctx.fill();
    },
    toygun(ctx, a, t) { // water pistol: plastic (organic/mixed), not dense metal
      const L = t.range(80, 110);
      ctx.fillStyle = rgba(MAT.organicLight, 0.6); roundRect(ctx, -L / 2, -22, L, 26, 10); ctx.fill();
      ctx.fillStyle = rgba(MAT.organicLight, 0.6); ctx.save(); ctx.rotate(0.3); roundRect(ctx, -L / 2 + 4, -4, 24, 50, 8); ctx.fill(); ctx.restore();
      ctx.fillStyle = rgba(MAT.organic, 0.45); ctx.beginPath(); ctx.ellipse(0, -30, 26, 14, 0, 0, 7); ctx.fill();
    },
  };
  const LURE_NAMES = Object.keys(LURES);

  // ---------- threats ----------
  // Every threat has 3 variants; size and proportions vary per image.
  const VARIANTS = {
    knife: ['kitchen knife', 'dagger', 'folding knife'],
    gun: ['pistol', 'compact pistol', 'revolver'],
    bomb: ['pipe bomb', 'explosive block', 'device in a box'],
  };

  function wire(ctx, t, x0, y0, x1, y1) {
    ctx.beginPath(); ctx.moveTo(x0, y0);
    ctx.bezierCurveTo(x0 + t.range(-40, 40), y0 + t.range(-40, 40), x1 + t.range(-40, 40), y1 + t.range(-40, 40), x1, y1);
    ctx.stroke();
  }

  function drawKnife(ctx, a, variant, t) {
    if (variant === 'dagger') {
      const L = t.range(80, 120), w = t.range(16, 24), hl = t.range(42, 58);
      ctx.fillStyle = rgba(MAT.dense, a);
      ctx.beginPath(); ctx.moveTo(0, -w / 2); ctx.lineTo(L, 0); ctx.lineTo(0, w / 2); ctx.closePath(); ctx.fill();
      ctx.fillStyle = rgba(MAT.dense, a * 0.6); ctx.fillRect(0, -1.5, L * 0.8, 3);
      ctx.fillStyle = rgba(MAT.dense, a); ctx.fillRect(-9, -w / 2 - 12, 9, w + 24);
      ctx.fillStyle = rgba(t.chance(0.5) ? MAT.organic : MAT.metal, 0.75); roundRect(ctx, -9 - hl, -7, hl, 14, 5); ctx.fill();
      ctx.fillStyle = rgba(MAT.dense, a); ctx.beginPath(); ctx.arc(-12 - hl, 0, 8, 0, 7); ctx.fill();
      return;
    }
    if (variant === 'folding knife') {
      const L = t.range(50, 75), w = t.range(12, 17), hl = t.range(55, 75);
      ctx.fillStyle = rgba(MAT.dense, a);
      ctx.beginPath(); ctx.moveTo(0, -w / 2); ctx.lineTo(L * 0.75, -w / 2); ctx.quadraticCurveTo(L * 0.95, -w / 2, L, -w * 0.2);
      ctx.quadraticCurveTo(L * 0.8, w / 2, L * 0.5, w / 2); ctx.lineTo(0, w / 2); ctx.closePath(); ctx.fill();
      ctx.fillStyle = rgba(MAT.metal, 0.7); roundRect(ctx, -hl, -w * 0.6, hl + 6, w * 1.2, w * 0.55); ctx.fill();
      ctx.fillStyle = rgba(MAT.dense, a * 0.8); ctx.fillRect(-hl + 4, -w * 0.5, hl - 4, 3); ctx.fillRect(-hl + 4, w * 0.5 - 3, hl - 4, 3);
      ctx.fillStyle = rgba(MAT.dense, a); ctx.beginPath(); ctx.arc(0, 0, 5, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(-hl + 8, 0, 3, 0, 7); ctx.fill();
      return;
    }
    // kitchen knife
    const L = t.range(85, 135), w = t.range(13, 24), hl = t.range(55, 78);
    ctx.fillStyle = rgba(MAT.dense, a);
    ctx.beginPath(); ctx.moveTo(0, -w / 2); ctx.lineTo(L * 0.72, -w / 2); ctx.quadraticCurveTo(L * 0.95, -w / 2 + 1, L, -w * 0.3);
    ctx.quadraticCurveTo(L * 0.85, w / 2, L * 0.6, w / 2); ctx.lineTo(0, w / 2); ctx.closePath(); ctx.fill();
    ctx.fillRect(-8, -w / 2 - 2, 8, w + 4);
    ctx.fillStyle = rgba(MAT.organic, 0.75); roundRect(ctx, -8 - hl, -w * 0.45, hl, w * 0.9, 6); ctx.fill();
    ctx.fillStyle = rgba(MAT.dense, a); ctx.fillRect(-6 - hl, -2.5, hl, 5);
    for (let i = 1; i <= 3; i++) { ctx.beginPath(); ctx.arc(-8 - hl * i / 4, 0, 3, 0, 7); ctx.fill(); }
  }

  function drawGun(ctx, a, variant, t) {
    ctx.lineCap = 'round';
    if (variant === 'revolver') {
      const bl = t.range(45, 85), gl = t.range(40, 52);
      ctx.fillStyle = rgba(MAT.dense, a);
      ctx.fillRect(14, -26, bl, 11);                                   // barrel
      roundRect(ctx, -14, -32, 32, 26, 6); ctx.fill();                  // cylinder
      ctx.fillStyle = rgba(MAT.dense, a * 0.6);
      for (let i = 0; i < 3; i++) ctx.fillRect(-10, -29 + i * 8, 24, 4); // chambers
      ctx.fillStyle = rgba(MAT.dense, a);
      ctx.beginPath(); ctx.moveTo(-14, -12); ctx.lineTo(-14, -30); ctx.lineTo(-26, -34); ctx.lineTo(-28, -22); ctx.lineTo(-22, -8); ctx.closePath(); ctx.fill(); // hammer/frame
      ctx.beginPath(); ctx.moveTo(-22, -10); ctx.quadraticCurveTo(-30, 10, -44, gl); ctx.lineTo(-24, gl + 4); ctx.quadraticCurveTo(-8, 16, -6, -6); ctx.closePath(); ctx.fill(); // grip
      ctx.strokeStyle = rgba(MAT.dense, a); ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(-6, -6); ctx.quadraticCurveTo(-4, 14, 10, 10); ctx.quadraticCurveTo(18, 4, 16, -8); ctx.stroke();
      ctx.lineCap = 'butt';
      return;
    }
    const compact = variant === 'compact pistol';
    const sl = compact ? t.range(72, 95) : t.range(100, 140);
    const sh = t.range(16, 23), gl = compact ? t.range(32, 42) : t.range(44, 58), slant = t.range(6, 16);
    const x0 = -sl * 0.42;
    ctx.fillStyle = rgba(MAT.dense, a);
    roundRect(ctx, x0, -sh - 10, sl, sh, 4); ctx.fill();               // slide
    ctx.fillRect(x0, -12, sl * 0.72, 8);                                // frame
    ctx.beginPath();                                                    // grip, slanted back
    ctx.moveTo(x0 + 2, -5); ctx.lineTo(x0 + 32, -5); ctx.lineTo(x0 + 32 - slant, gl);
    ctx.quadraticCurveTo(x0 + 30 - slant, gl + 6, x0 + 22 - slant, gl + 6); ctx.lineTo(x0 + 2 - slant, gl + 6);
    ctx.quadraticCurveTo(x0 - 4 - slant, gl + 6, x0 - 3 - slant, gl - 2); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = rgba(MAT.dense, a); ctx.lineWidth = 4;            // trigger guard
    ctx.beginPath(); ctx.moveTo(x0 + 33, -3); ctx.quadraticCurveTo(x0 + 32, 20, x0 + 50, 17); ctx.quadraticCurveTo(x0 + 62, 14, x0 + 62, -4); ctx.stroke();
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x0 + 46, -4); ctx.quadraticCurveTo(x0 + 48, 6, x0 + 43, 11); ctx.stroke();
    ctx.fillStyle = rgba(MAT.dense, a * 0.7);                            // barrel + magazine
    ctx.fillRect(x0 + 14, -sh - 5, sl - 14, Math.max(5, sh * 0.4));
    ctx.beginPath(); ctx.moveTo(x0 + 8, 0); ctx.lineTo(x0 + 24, 0); ctx.lineTo(x0 + 24 - slant, gl); ctx.lineTo(x0 + 8 - slant, gl); ctx.closePath(); ctx.fill();
    ctx.lineCap = 'butt';
  }

  function drawBomb(ctx, a, variant, t) {
    ctx.lineCap = 'round';
    const battery = (x, y, rot) => withTransform(ctx, x, y, rot, 1, () => {
      ctx.fillStyle = rgba(MAT.metal, 0.7); roundRect(ctx, -13, -20, 26, 40, 3); ctx.fill();
      ctx.fillStyle = rgba(MAT.dense, a); ctx.fillRect(-9, -25, 6, 6); ctx.fillRect(3, -25, 6, 6);
    });
    const timer = (x, y) => {
      ctx.fillStyle = rgba(MAT.metal, 0.6); roundRect(ctx, x - 20, y - 14, 40, 28, 4); ctx.fill();
      ctx.fillStyle = rgba(MAT.mixed, 0.6); ctx.fillRect(x - 15, y - 9, 30, 12);
      ctx.fillStyle = rgba(MAT.dense, a * 0.8); for (let i = 0; i < 4; i++) ctx.fillRect(x - 14 + i * 8, y + 6, 4, 4);
    };
    if (variant === 'pipe bomb') {
      const n = t.int(1, 3), pl = t.range(70, 110), d = t.range(18, 26);
      for (let i = 0; i < n; i++) {
        const y = (i - (n - 1) / 2) * (d + 4);
        ctx.fillStyle = rgba(MAT.dense, a * 0.75); ctx.fillRect(-pl / 2, y - d / 2, pl, d);
        ctx.fillStyle = rgba(MAT.dense, a); ctx.fillRect(-pl / 2 - 8, y - d / 2 - 3, 10, d + 6); ctx.fillRect(pl / 2 - 2, y - d / 2 - 3, 10, d + 6);
        ctx.fillStyle = rgba(MAT.organic, 0.4); ctx.fillRect(-pl / 2 + 4, y - d / 2 + 4, pl - 8, d - 8); // filler
      }
      const bx = pl / 2 + t.range(30, 50), by = t.range(-30, 30);
      battery(bx, by, t.range(-0.5, 0.5));
      ctx.strokeStyle = rgba(MAT.mixed, 0.8); ctx.lineWidth = 2.5;
      wire(ctx, t, pl / 2 + 6, 0, bx, by - 18);
      if (t.chance(0.6)) { const tx = -pl / 2 - t.range(30, 45), ty = t.range(-25, 25); timer(tx, ty); wire(ctx, t, -pl / 2 - 6, 0, tx + 18, ty); wire(ctx, t, tx, ty - 12, bx - 10, by - 18); }
    } else if (variant === 'explosive block') {
      const k = t.int(1, 3), bw = t.range(55, 85), bh = t.range(24, 38);
      for (let i = 0; i < k; i++) {
        const y = (i - (k - 1) / 2) * (bh + 3);
        ctx.fillStyle = rgba(MAT.organic, 0.85); roundRect(ctx, -bw / 2, y - bh / 2, bw, bh, 4); ctx.fill();
        ctx.fillStyle = rgba(MAT.organic, 0.5); roundRect(ctx, -bw / 2 + 4, y - bh / 2 + 4, bw - 8, bh - 8, 3); ctx.fill();
      }
      ctx.fillStyle = rgba(MAT.metal, 0.5); ctx.fillRect(-bw / 2 - 2, -3, bw + 4, 6);            // tape band
      ctx.fillStyle = rgba(MAT.dense, a); ctx.fillRect(-6, -bh / 2 - 26, 9, 32);                 // detonator
      ctx.fillStyle = rgba(MAT.mixed, 0.6); ctx.fillRect(bw / 2 + 10, -22, 34, 44);               // circuit board
      ctx.fillStyle = rgba(MAT.dense, a * 0.8); for (let i = 0; i < 5; i++) ctx.fillRect(bw / 2 + 14 + (i % 2) * 14, -18 + i * 8, 9, 6);
      const bx = t.range(-30, 30), by = bh * k / 2 + 30;
      battery(bx, by, Math.PI / 2 + t.range(-0.3, 0.3));
      ctx.strokeStyle = rgba(MAT.mixed, 0.8); ctx.lineWidth = 2.5;
      wire(ctx, t, -2, -bh / 2 - 26, bw / 2 + 12, -20); wire(ctx, t, bw / 2 + 12, 20, bx + 16, by); wire(ctx, t, 2, -bh / 2 - 26, bx - 16, by);
    } else { // device in a box
      const w = t.range(90, 130), h = t.range(60, 85);
      ctx.strokeStyle = rgba(MAT.metal, 0.75); ctx.lineWidth = 4; ctx.strokeRect(-w / 2, -h / 2, w, h);
      ctx.fillStyle = rgba(MAT.metal, 0.25); ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.fillStyle = rgba(MAT.organic, 0.8); roundRect(ctx, -w / 2 + 8, -h / 2 + 8, w * 0.45, h - 16, 3); ctx.fill();
      battery(w * 0.12, -h * 0.12, 0); battery(w * 0.3, -h * 0.12, 0);
      timer(w * 0.2, h * 0.28);
      ctx.fillStyle = rgba(MAT.dense, a); ctx.fillRect(-w / 2 + 14, -4, w * 0.3, 8);              // detonator rod
      ctx.strokeStyle = rgba(MAT.mixed, 0.8); ctx.lineWidth = 2.5;
      wire(ctx, t, -w / 2 + 14 + w * 0.3, 0, w * 0.12, -h * 0.12 - 18); wire(ctx, t, w * 0.3, -h * 0.12 - 18, w * 0.2 + 18, h * 0.28);
    }
    ctx.lineCap = 'butt';
  }
  const THREATS = { knife: drawKnife, gun: drawGun, bomb: drawBomb };

  const DIFFICULTY = {
    easy:   { clutterMin: 9,  clutterMax: 12, lureMin: 1, lureMax: 1, alphaMin: 0.75, alphaMax: 0.9,  scaleMin: 0.95, scaleMax: 1.15, occluders: 2 },
    medium: { clutterMin: 15, clutterMax: 19, lureMin: 1, lureMax: 2, alphaMin: 0.52, alphaMax: 0.72, scaleMin: 0.75, scaleMax: 1.0,  occluders: 4 },
    hard:   { clutterMin: 20, clutterMax: 25, lureMin: 2, lureMax: 3, alphaMin: 0.4,  alphaMax: 0.58, scaleMin: 0.62, scaleMax: 0.88, occluders: 6 },
  };

  /**
   * Render one bag to a canvas.
   * spec: { id, isThreat, threatType, threatVariant, difficulty }
   * The main RNG never depends on whether a threat is present, so threat and
   * clear bags have identical amounts of clutter and lures.
   */
  function renderBag(canvas, spec) {
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const rng = makeRng('bag:' + spec.id);
    const trng = makeRng('threat:' + spec.id);
    const lrng = makeRng('lure:' + spec.id);
    const diff = DIFFICULTY[spec.difficulty] || DIFFICULTY.medium;

    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'multiply';

    ctx.fillStyle = 'rgba(200,210,225,0.18)';
    for (let x = 0; x < W; x += 48) ctx.fillRect(x, 0, 3, H);

    // bag body & frame
    const bw = rng.range(580, 650), bh = rng.range(340, 385);
    const b = { x: (W - bw) / 2 + rng.range(-15, 15), y: (H - bh) / 2 + rng.range(0, 18), w: bw, h: bh };
    ctx.fillStyle = 'rgba(205,215,235,0.55)';
    roundRect(ctx, b.x, b.y, b.w, b.h, 28); ctx.fill();
    ctx.strokeStyle = rgba(MAT.metal, 0.45); ctx.lineWidth = 6;
    roundRect(ctx, b.x + 8, b.y + 8, b.w - 16, b.h - 16, 22); ctx.stroke();
    ctx.fillStyle = rgba(MAT.metal, 0.45);
    ctx.fillRect(b.x + 40, b.y + 10, 10, b.h - 20); ctx.fillRect(b.x + b.w - 50, b.y + 10, 10, b.h - 20);
    ctx.strokeStyle = rgba(MAT.dense, 0.45); ctx.lineWidth = 8;
    roundRect(ctx, b.x + b.w / 2 - 60, b.y - 22, 120, 30, 12); ctx.stroke();
    ctx.setLineDash([4, 4]); ctx.strokeStyle = rgba(MAT.metal, 0.5); ctx.lineWidth = 3;
    roundRect(ctx, b.x + 18, b.y + 18, b.w - 36, b.h - 36, 18); ctx.stroke();
    ctx.setLineDash([]);

    const inner = { x: b.x + 55, y: b.y + 28, w: b.w - 110, h: b.h - 56 };
    const nClutter = rng.int(diff.clutterMin, diff.clutterMax);
    if (rng.chance(0.55)) CLUTTER.laptop(ctx, rng, inner);
    else if (rng.chance(0.5)) CLUTTER.tablet(ctx, rng, inner);

    const occl = Math.min(diff.occluders, nClutter);
    const nLures = rng.int(diff.lureMin, diff.lureMax);
    const under = nClutter - occl;
    const lureAt = new Set(); while (lureAt.size < nLures) lureAt.add(rng.int(0, under));
    for (let i = 0; i <= under; i++) {
      if (lureAt.has(i)) {
        const name = LURE_NAMES[Math.floor(rng() * LURE_NAMES.length)];
        const lx = rng.range(inner.x + 60, inner.x + inner.w - 60), ly = rng.range(inner.y + 50, inner.y + inner.h - 50);
        const lr = rng.range(0, Math.PI * 2), ls = rng.range(0.85, 1.15), la = rng.range(diff.alphaMin, diff.alphaMax + 0.05);
        withTransform(ctx, lx, ly, lr, ls, () => LURES[name](ctx, la, lrng));
      }
      if (i < under) CLUTTER[pickClutter(rng)](ctx, rng, inner);
    }

    // threat placement is drawn from the main RNG whether or not a threat is present
    const tx = rng.range(inner.x + 90, inner.x + inner.w - 90);
    const ty = rng.range(inner.y + 60, inner.y + inner.h - 60);
    const trot = rng.range(0, Math.PI * 2);
    const tscale = rng.range(diff.scaleMin, diff.scaleMax);
    const talpha = rng.range(diff.alphaMin, diff.alphaMax);
    if (spec.isThreat) {
      const type = spec.threatType || 'knife';
      const variant = spec.threatVariant || VARIANTS[type][0];
      withTransform(ctx, tx, ty, trot, tscale * (type === 'bomb' ? 0.85 : 1), () => THREATS[type](ctx, talpha, variant, trng));
    }

    for (let i = 0; i < occl; i++) {
      const name = rng.pick(['clothing', 'cable', 'charger', 'pen', 'coins', 'bottle', 'spoon', 'socks', 'glasses', 'headphones']);
      const near = { x: tx - 140, y: ty - 100, w: 280, h: 200 };
      CLUTTER[name](ctx, rng, rng.chance(0.6) ? near : inner);
    }

    // sensor grain
    ctx.globalCompositeOperation = 'source-over';
    const img = ctx.getImageData(0, 0, W, H);
    const d = img.data;
    const nr = makeRng('noise:' + spec.id);
    for (let i = 0; i < d.length; i += 4) {
      const n = (nr() - 0.5) * 14;
      d[i] = Math.max(0, Math.min(255, d[i] + n));
      d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
      d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  /** One isolated item on a plain background (for the instructions). kind: 'threat' | 'lure' */
  function renderExample(canvas, kind, type, variant) {
    canvas.width = 300; canvas.height = 190;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 300, 190);
    ctx.globalCompositeOperation = 'multiply';
    const t = makeRng('example:' + type + variant);
    const sc = kind === 'threat' && type === 'bomb' ? 0.95 : type === 'hairdryer' || type === 'powerbank' ? 1.05 : 1.35;
    withTransform(ctx, type === 'hairdryer' || type === 'powerbank' ? 130 : 150, type === 'hairdryer' ? 70 : 90, kind === 'lure' && type === 'hairdryer' ? 0 : -0.12, sc, () => {
      if (kind === 'threat') THREATS[type](ctx, 0.75, variant, t);
      else LURES[type](ctx, 0.72, t);
    });
    ctx.globalCompositeOperation = 'source-over';
    return canvas;
  }

  /**
   * Image sets. Set s (0..3) holds perType threat images and perType clear images.
   * Threat types rotate knife → gun → bomb, and each type cycles through its 3
   * variants, so every set has the same mix.
   */
  function buildImageSet(setIndex, perType, difficulty) {
    const tag = setIndex === 'P' ? 'P' : 'S' + (setIndex + 1);
    const types = ['knife', 'gun', 'bomb'];
    const threat = [], clear = [];
    for (let i = 0; i < perType; i++) {
      const type = types[i % 3];
      const variant = VARIANTS[type][Math.floor(i / 3) % 3];
      threat.push({ id: `${tag}-T${String(i + 1).padStart(2, '0')}`, isThreat: true, threatType: type, threatVariant: variant, difficulty });
      clear.push({ id: `${tag}-C${String(i + 1).padStart(2, '0')}`, isThreat: false, threatType: '', threatVariant: '', difficulty });
    }
    return { threat, clear };
  }

  global.Stimuli = { makeRng, hashString, renderBag, renderExample, buildImageSet, DIFFICULTY, VARIANTS, LURE_NAMES };
})(window);
