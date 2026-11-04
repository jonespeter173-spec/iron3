/* IronCoach engine – multi-race planner: Ironman, 70.3, XC ski 15/25/50 km; strength; readiness. */
(function (root) {
const SPORTS = ["swim", "bike", "run", "ski", "strength"];
const DAY = 86400000;
const iso = d => d.toISOString().slice(0, 10);
const toD = s => new Date(s + "T00:00:00Z");
const addDays = (s, n) => iso(new Date(toD(s).getTime() + n * DAY));
const diffDays = (a, b) => Math.round((toD(a) - toD(b)) / DAY);
const weekday = s => (toD(s).getUTCDay() + 6) % 7; // 0=Mon
const todayIso = () => { const n = new Date(); return iso(new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()))); };
const r5 = m => Math.max(0, Math.round(m / 5) * 5);
const paceKm = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}/km`;
const pace100 = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}/100m`;

function defaultAthlete() {
  const y = new Date().getFullYear() + 1;
  return { name: "Peter", ftp: 250, runThr: 270, css: 105, lthr: 165, maxHours: 14, minHours: 7,
    restDay: 0, longBikeDay: 5, longRunDay: 6,
    strengthDays: 2, skiEnabled: true, skiMonths: [12, 1, 2, 3], skiShare: 0.35,
    races: [
      { date: `${y}-01-10`, name: "Ski race (15 km)", dist: "ski15", pri: "C" },
      { date: `${y}-01-24`, name: "Ski race (25 km)", dist: "ski25", pri: "B" },
      { date: `${y}-02-20`, name: "Ski marathon (50 km)", dist: "ski50", pri: "A" },
      { date: `${y}-06-12`, name: "Half Ironman", dist: "70.3", pri: "B" },
      { date: `${y}-08-29`, name: "Ironman", dist: "IM", pri: "A" }] };
}
function migrateAthlete(a) {
  if (a.races) return a;
  const races = [];
  if (a.raceDate) races.push({ date: a.raceDate, name: a.raceName || "Ironman", dist: "IM", pri: "A" });
  (a.skiRaces || []).forEach(r => races.push({ date: r.date, name: r.name, dist: (r.km || 25) <= 20 ? "ski15" : (r.km || 25) <= 37 ? "ski25" : "ski50", pri: r.pri || "B" }));
  const out = { ...a, races }; delete out.raceDate; delete out.raceName; delete out.skiRaces; return out;
}

/* ---------- load ---------- */
function estimateTss(r, a) {
  if (r.tss > 0) return r.tss;
  const hrs = (r.min || 0) / 60; if (hrs <= 0) return 0;
  let i = null;
  if (r.sport === "bike" && r.power > 0) i = r.power * 1.05 / a.ftp;
  else if (r.sport === "run" && r.km > 0) i = a.runThr / (r.min * 60 / r.km);
  else if (r.sport === "swim" && r.km > 0) { i = Math.min(a.css / (r.min * 60 / (r.km * 10)), 1.2); return +(hrs * i ** 3 * 100).toFixed(1); }
  if (i == null && r.hr > 0) i = r.hr / a.lthr;
  if (i == null) i = { strength: 0.6, ski: 0.75 }[r.sport] || 0.7;
  i = Math.max(0.4, Math.min(i, 1.2));
  return +(hrs * i * i * 100).toFixed(1);
}
function loadMetrics(acts, a, through) {
  through = through || todayIso();
  const daily = {};
  acts.forEach(r => { daily[r.date] = (daily[r.date] || 0) + estimateTss(r, a); });
  let start = addDays(through, -120);
  const ds = Object.keys(daily).sort(); if (ds.length && ds[0] < start) start = ds[0];
  let ctl = 0, atl = 0; const out = [];
  for (let d = start; d <= through; d = addDays(d, 1)) {
    const t = daily[d] || 0, tsb = ctl - atl;
    ctl += (t - ctl) / 42; atl += (t - atl) / 7;
    out.push({ date: d, tss: t, ctl, atl, tsb });
  }
  return out;
}
function recentWeeklyHours(acts, weeks = 4) {
  const c = addDays(todayIso(), -7 * weeks);
  return +(acts.filter(r => r.date >= c).reduce((s, r) => s + r.min, 0) / 60 / weeks).toFixed(1);
}

/* ---------- races ---------- */
const RACE_TYPES = {
  "IM":   { sport: "tri", label: "Ironman", taperW: 2, peakW: 3, buildW: 8, maxScale: 1.0, recW: 2,
            bikeIF: [.68, .75], runF: 1.12, swimF: 1.06, longRideCap: 360, longRunCap: 165, swimKm: 3.8, bikeKm: 180.2, runKm: 42.2, fade: .06, tr: 10,
            ov: { A: { t: 14, f: .6, r: 14, cap: 30 }, B: { t: 7, f: .7, r: 10, cap: 30 }, C: { t: 5, f: .8, r: 7, cap: 40 } }, protect: 21 },
  "70.3": { sport: "tri", label: "Half Ironman 70.3", taperW: 1, peakW: 3, buildW: 7, maxScale: .85, recW: 1,
            bikeIF: [.76, .83], runF: 1.05, swimF: 1.03, longRideCap: 210, longRunCap: 110, swimKm: 1.9, bikeKm: 90, runKm: 21.1, fade: .03, tr: 6,
            ov: { A: { t: 7, f: .6, r: 7, cap: 40 }, B: { t: 4, f: .7, r: 5, cap: 45 }, C: { t: 2, f: .85, r: 3, cap: 60 } }, protect: 10 },
  "ski15": { sport: "ski", label: "XC ski 15 km", km: 15, kmh: 20, taperW: 0, peakW: 2, buildW: 6, maxScale: .9, recW: 0,
            ov: { A: { t: 3, f: .6, r: 2, cap: 60 }, B: { t: 2, f: .8, r: 1, cap: 75 }, C: { t: 1, f: .9, r: 1, cap: 90 } }, protect: 5 },
  "ski25": { sport: "ski", label: "XC ski 25 km", km: 25, kmh: 19, taperW: 0, peakW: 2, buildW: 6, maxScale: .9, recW: 0,
            ov: { A: { t: 4, f: .6, r: 3, cap: 45 }, B: { t: 2, f: .8, r: 2, cap: 60 }, C: { t: 1, f: .9, r: 1, cap: 90 } }, protect: 7 },
  "ski50": { sport: "ski", label: "XC ski 50 km", km: 50, kmh: 18, taperW: 0, peakW: 2, buildW: 6, maxScale: .9, recW: 0,
            ov: { A: { t: 5, f: .6, r: 4, cap: 40 }, B: { t: 3, f: .75, r: 3, cap: 45 }, C: { t: 2, f: .85, r: 2, cap: 60 } }, protect: 10 },
};
const hm = m => { m = Math.round(m); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`; };
function estFinish(a, dist) {
  const T = RACE_TYPES[dist];
  if (T.sport === "ski") { const t = T.km / T.kmh * 60; return { total: t, text: `~${hm(t)}` }; }
  const swim = T.swimKm * 10 * a.css * T.swimF / 60;
  const w = a.ftp * (T.bikeIF[0] + T.bikeIF[1]) / 2, kmh = Math.max(22, Math.min(42, 33 * Math.cbrt(w / 190)));
  const bike = T.bikeKm / kmh * 60, run = T.runKm * a.runThr * (T.runF + T.fade) / 60, total = swim + bike + run + T.tr;
  return { swim, bike, run, total, text: `~${hm(total)} (swim ${hm(swim)} · bike ${hm(bike)} · run ${hm(run)})` };
}
const monday = d => addDays(d, -weekday(d));
function pickTargets(races) {
  const tri = races.filter(r => RACE_TYPES[r.dist].sport === "tri");
  let t = tri.filter(r => r.pri === "A");
  if (!t.length) t = tri.filter(r => r.pri === "B");
  if (!t.length) t = tri;
  if (!t.length) t = races.filter(r => r.pri === "A");
  if (!t.length) t = races.slice(-1);
  const out = []; t.forEach(r => { if (!out.length || monday(out.at(-1).date) < monday(r.date)) out.push(r); });
  return out;
}

/* ---------- plan ---------- */
const SPLIT = { Base: { swim: .19, bike: .43, run: .27, strength: .11 }, Build: { swim: .17, bike: .50, run: .26, strength: .07 },
  Peak: { swim: .15, bike: .54, run: .28, strength: .03 }, Taper: { swim: .20, bike: .50, run: .27, strength: .03 } };
const S = (date, sport, title, min, desc, intensity) => ({ date, sport, title, min: r5(min), desc, intensity, status: "planned", note: "" });

function strengthSessions(phase, rec, n, ski) {
  const pole = ski ? " Poling power: single-arm cable pulldowns, triceps pushdowns, med-ball slams." : "";
  if (n <= 0) return [];
  if (rec || phase === "Taper") return [["Strength: mobility & activation", "Bodyweight squats, glute bridges, band work, core, 30' mobility. No heavy loading."]];
  if (phase === "Base") return [
    ["Strength: Max (lower)", "Back squat 4x5 @ RPE 8, Romanian deadlift 3x6, Bulgarian split squat 3x8/leg, calf raises 3x12, Copenhagen plank." + pole],
    ["Strength: Max (upper + core)", "Pull-ups 4x6, single-arm row 3x8, overhead press 3x6, Pallof press, dead bugs, hanging knee raises." + pole],
    ["Strength: plyo & core", "Box jumps 4x5, lateral bounds 3x6/side (skate-specific), step-ups, core circuit."]].slice(0, n);
  if (phase === "Build") return [
    ["Strength: Power & maintenance", "Trap-bar deadlift 3x3 explosive, jump squats 3x5, lateral bounds 3x6/side, pull-ups 3x5." + pole],
    ["Strength: maintenance (upper/core)", "Rows, push-ups, Pallof press, side plank, single-leg RDL 2x8."]].slice(0, Math.min(n, 2));
  return [["Strength: maintenance", "2x5 trap-bar deadlift (light, fast), single-leg RDL, core, mobility."]];
}
const strengthWeekdays = a => [2, 4, 1].filter(d => d !== a.restDay).slice(0, a.strengthDays);

function hoursCurve(a, m, startH, T, eventIdx = new Set()) {
  const maxH = a.maxHours * (T.maxScale || 1), start = Math.max(a.minHours, Math.min(startH, maxH)), out = [];
  const buildN = Math.max(m - T.taperW, 1); let since = 0;
  for (let i = 0; i < m; i++) {
    const wo = m - i; let h, rec = false;
    if (T.taperW >= 1 && wo === 1) h = maxH * (T.taperW >= 2 ? .40 : .50);
    else if (T.taperW >= 2 && wo === 2) h = maxH * .65;
    else {
      const f = Math.min(i / Math.max(buildN - 3, 1), 1); h = start + (maxH - start) * f; since++;
      // recovery every 4th week, but pulled onto weeks that contain an A/B race
      const ev = eventIdx.has(i), soonEv = [1, 2].some(k => eventIdx.has(i + k));
      if (wo > T.taperW + 1 && (ev || (since >= 4 && !soonEv) || since >= 5)) { h *= ev ? .75 : .65; rec = true; since = 0; }
    }
    out.push({ h: Math.min(Math.max(h, 1), maxH), rec });
  }
  return out;
}
function phaseFor(wo, T) {
  if (wo <= T.taperW) return "Taper";
  if (wo <= T.taperW + T.peakW) return "Peak";
  if (wo <= T.taperW + T.peakW + T.buildW) return "Build";
  return "Base";
}
function skiQuality(focus, phase, rec, hr) {
  const b = x => Math.round(hr * x);
  if (rec) return ["Skate technique", `Easy ${b(.81)}-${b(.89)} bpm. No-pole skating 4x5', V2 balance drills, V2A on gentle climbs.`, "easy"];
  if (focus === "ski15") return ["Skate ski VO2 (15 km focus)", `Warm-up 20'. 5x4' at ${b(1.02)}+ bpm on rolling terrain, 3' easy. 6x20s sprint starts — 15 km is fast from the gun.`, "hard"];
  if (focus === "ski25") return ["Skate ski threshold (25 km focus)", `Warm-up 20'. 4x8' at ${b(.95)}-${hr} bpm, 3' easy. V1 climbs, V2 flats, fast transitions.`, "hard"];
  if (focus === "ski50") return ["Skate ski long threshold (50 km focus)", `Warm-up 20'. 3x15' at ${b(.90)}-${b(.95)} bpm, 5' easy. Keep V2 technique tidy when tired.`, "hard"];
  return phase === "Base"
    ? ["Skate ski threshold", `Warm-up 20'. 5x6' at ${b(.95)}-${hr} bpm (V1 climbs, V2 flats), 2' easy. 10x15s speed.`, "hard"]
    : ["Skate ski VO2 / race-pace", `Warm-up 20'. 6x4' at ${b(1.02)}+ bpm on rolling terrain, 3' easy.`, "hard"];
}

function buildWeek(a, ws, hours, phase, rec, ctx) {
  const P = phase === "Recovery" ? "Base" : phase; if (phase === "Recovery") rec = true;
  const sp = SPLIT[P], m = {}; for (const k in sp) m[k] = hours * 60 * sp[k];
  const ftp = a.ftp, rp = a.runThr, css = a.css, hr = a.lthr, TT = RACE_TYPES[ctx.tri], im = ctx.tri === "IM";
  const z2w = `${Math.round(ftp * .56)}-${Math.round(ftp * .75)} W`, z2p = `${paceKm(rp * 1.2)}-${paceKm(rp * 1.3)}`, z2hr = `${Math.round(hr * .81)}-${Math.round(hr * .89)} bpm`;
  const rpw = `${Math.round(ftp * TT.bikeIF[0])}-${Math.round(ftp * TT.bikeIF[1])} W`, rpp = paceKm(rp * TT.runF), lbl = im ? "IM" : "70.3";
  const days = [...Array(7)].map((_, i) => addDays(ws, i)); const out = [];

  // race week for a triathlon target
  if (ctx.raceWeek && ctx.target && RACE_TYPES[ctx.target.dist].sport === "tri") {
    const R = ctx.target, T = RACE_TYPES[R.dist], est = estFinish(a, R.dist), rim = R.dist === "IM";
    const w = `${Math.round(ftp * T.bikeIF[0])}-${Math.round(ftp * T.bikeIF[1])} W`;
    days.forEach(d => {
      if (d === R.date) out.push(S(d, "race", `🏁 ${R.name} (${T.label}, ${R.pri}-race)`, est.total,
        `Swim steady ${pace100(css * T.swimF)}. Bike ${w} — don't exceed it. Run: first ${rim ? 10 : 5} km at ${paceKm(rp * (T.runF + .06))}, then settle at ${paceKm(rp * T.runF)}. ` +
        `Fuel ${rim ? "60-90" : "60-80"} g carbs/hr plus fluids and sodium. Est. finish ${est.text}.`, "race"));
      else if (d < R.date) {
        const dd = diffDays(R.date, d);
        if (dd === 1) out.push(S(d, "bike", "Bike check + 3x1' at race power", 25, "Easy spin, check gears/brakes/tyres. Rack bike. Feet up.", "easy"));
        else if (dd === 2) out.push(S(d, "swim", "Swim openers", 25, `Easy 1000m with 6x50m at ${pace100(css * T.swimF)}.`, "easy"));
        else if (dd === 3) out.push(S(d, "run", "Run openers", rim ? 25 : 30, `20' easy + ${rim ? "4x1'" : "4x2'"} at ${paceKm(rp * T.runF)}.`, "easy"));
        else if (dd === 4) out.push(S(d, "bike", "Bike openers", rim ? 50 : 60, `Z2 with 3x${rim ? 5 : 8}' at ${w}.`, "moderate"));
        else if (weekday(d) !== a.restDay) out.push(S(d, dd % 2 ? "swim" : "run", dd % 2 ? "Easy swim" : "Easy run", 30, "Relaxed, technique focus.", "easy"));
      } else out.push(S(d, "other", "Recovery: walk or easy spin", 20, "Very easy movement only. Eat, hydrate, sleep.", "easy"));
    });
    return out;
  }

  const month = toD(ws).getUTCMonth() + 1, skiTarget = !!(ctx.target && RACE_TYPES[ctx.target.dist].sport === "ski");
  const inSeason = a.skiEnabled && a.skiMonths.includes(month) && (P === "Base" || P === "Build" || skiTarget || !!ctx.skiFocus);
  const share = skiTarget ? Math.max(a.skiShare, .5) : a.skiShare;
  let skiTot = 0;
  if (inSeason) { skiTot = (m.bike + m.run) * share; m.bike *= 1 - share; m.run *= 1 - share; }
  const longBike = m.bike * (P !== "Base" ? .45 : .40), longRun = m.run * .38;
  const midBike = (m.bike - longBike) / 2, runRest = (m.run - longRun) / 2, swimE = m.swim / 3;
  let bq, rq, sq;
  if (rec) { bq = ["Bike Z2 + cadence drills", `Z2 ${z2w}. 6x1' high cadence (100+ rpm).`, "easy"]; rq = ["Run Z2 + strides", `Z2 ${z2p}, finish with 6x20s strides.`, "easy"];
    sq = ["Swim technique", "Drills: catch-up, fist, 6-kick switch. Easy aerobic.", "easy"]; }
  else if (P === "Base") { bq = ["Bike tempo", `3x12' at ${Math.round(ftp * .8)}-${Math.round(ftp * .87)} W, 5' easy between. Rest Z2.`, "moderate"];
    rq = ["Run aerobic + hills", `Z2 ${z2p} with 8x30s hill strides.`, "moderate"]; sq = ["Swim CSS", `10x100m at ${pace100(css)} r15s.`, "hard"]; }
  else if (P === "Build") {
    bq = im ? ["Bike threshold", `4x10' at ${Math.round(ftp * .92)}-${ftp} W, 4' easy. Rest Z2.`, "hard"] : ["Bike sweet-spot (70.3)", `3x15' at ${Math.round(ftp * .88)}-${Math.round(ftp * .93)} W, 5' easy.`, "hard"];
    rq = ["Run threshold", `3x2km at ${paceKm(rp)} r2'. Rest Z2.`, "hard"]; sq = ["Swim CSS", `4x400m at ${pace100(css * 1.02)} r20s.`, "hard"]; }
  else {
    bq = [`Bike ${lbl} race-pace`, im ? `2x40' at ${rpw} (IM power), 10' easy.` : `3x20' at ${rpw} (70.3 power), 5' easy.`, "moderate"];
    rq = [`Run ${lbl} race-pace`, im ? `3x15' at ${rpp}, 3' easy.` : `3x12' at ${rpp}, 3' easy.`, "moderate"];
    sq = [`Swim ${lbl} race-pace`, im ? `3x1000m at ${pace100(css * TT.swimF)} r30s.` : `5x400m at ${pace100(css * TT.swimF)} r20s.`, "moderate"]; }
  if (skiTarget && !rec && (P === "Peak" || P === "Taper")) { rq = ["Run Z2 + strides", `Z2 ${z2p}, 6x20s strides.`, "easy"]; sq = ["Swim aerobic + drills", `Easy 400s at ${pace100(css * 1.1)} with drills.`, "easy"]; }
  const kq = skiQuality(ctx.skiFocus, P, rec, hr);
  const late = (P === "Build" || P === "Peak") && !rec;
  const lbDesc = `Steady Z2 ${z2w}` + (late ? `; last ${im ? 60 : 40}' at ${rpw} (${lbl} power)` : "") + ". Practise fuelling 60-90 g carbs/hr.";
  const lrDesc = `Z2 ${z2p}` + (late ? `; final ${im ? 20 : 15}' at ${rpp}` : "") + `. Cap at ${hm(TT.longRunCap)}.`;
  const brick = late && !inSeason;
  if (inSeason && kq[2] === "hard") bq = ["Bike Z2 + cadence drills", `Z2 ${z2w}. 6x1' high cadence.`, "easy"];
  const by = {}, add = (wd, s) => (by[wd] = by[wd] || []).push(s);
  add(1, S(days[1], "bike", bq[0], inSeason ? midBike * 2 : midBike, bq[1], bq[2]));
  add(1, S(days[1], "swim", "Swim aerobic", swimE, `Continuous 400s at ${pace100(css * 1.1)}.`, "easy"));
  add(2, S(days[2], "run", rq[0], runRest, rq[1], rq[2]));
  add(3, S(days[3], "swim", sq[0], swimE, sq[1], sq[2]));
  add(3, inSeason ? S(days[3], "ski", kq[0], skiTot * .35, kq[1], kq[2]) : S(days[3], "bike", "Bike Z2", midBike, `Z2 ${z2w}.`, "easy"));
  add(4, S(days[4], "swim", "Swim endurance / OWS", swimE, "Long steady swim; sighting every 6 strokes.", "easy"));
  add(4, S(days[4], "run", "Run easy", runRest, `Z1-Z2 ${z2p}.`, "easy"));
  const lift = strengthSessions(P, rec, a.strengthDays, a.skiEnabled), lm = m.strength / Math.max(lift.length, 1);
  strengthWeekdays(a).forEach((wd, i) => { if (lift[i]) add(wd, S(days[wd], "strength", lift[i][0], lm, lift[i][1], /Max|Power/.test(lift[i][0]) ? "moderate" : "easy")); });
  add(a.longBikeDay, S(days[a.longBikeDay], "bike", "Long ride", Math.min(longBike, TT.longRideCap), lbDesc, brick ? "moderate" : "easy"));
  if (brick) add(a.longBikeDay, S(days[a.longBikeDay], "run", "Brick run off the bike", P === "Build" ? 20 : 30, `Straight off bike at ${rpp}.`, "moderate"));
  if (inSeason) {
    const cap = { ski15: 120, ski25: 150, ski50: 210 }[ctx.skiFocus] || 180;
    const extra = ctx.skiFocus === "ski50" ? " Include 3x20' at 50 km race effort and practise feeding every 10-15 km." : ctx.skiFocus === "ski15" ? " Include 6x2' fast surges." : " Include 4x3' race-tempo on rolling terrain.";
    add(a.longRunDay, S(days[a.longRunDay], "ski", "Long skate ski", Math.min(skiTot * .65, cap), `Steady Z2 ${z2hr}. Mix V1/V2/V2A.${extra} Fuel 60 g carbs/hr.`, "easy"));
    add(a.longRunDay, S(days[a.longRunDay], "run", "Run off skis", Math.min(longRun * .5, 45), `Easy Z2 ${z2p} straight after skiing.`, "easy"));
  } else add(a.longRunDay, S(days[a.longRunDay], "run", "Long run", Math.min(longRun, TT.longRunCap), lrDesc, "easy"));
  for (const wd in by) if (+wd !== a.restDay) out.push(...by[wd]);
  return out;
}

function generatePlan(a, acts, start) {
  start = start || todayIso();
  const races = (a.races || []).filter(r => r.date && r.date >= start && RACE_TYPES[r.dist]).map(r => ({ ...r, pri: r.pri || "B" })).sort((x, y) => x.date < y.date ? -1 : 1);
  if (!races.length) return [];
  const targets = pickTargets(races), w0 = monday(start);
  const nW = diffDays(monday(races.at(-1).date), w0) / 7 + 1, wi = d => diffDays(monday(d), w0) / 7;
  const weeks = []; let s = 0, prev = null;
  targets.forEach(T => {
    const e = wi(T.date), spec = RACE_TYPES[T.dist], n = e - s + 1; if (n <= 0) return;
    const r = prev ? Math.min(RACE_TYPES[prev.dist].recW, n - 1) : 0;
    for (let j = 0; j < r; j++) weeks[s + j] = { h: a.maxHours * [.45, .65][j], phase: "Recovery", target: T };
    const startH = prev ? Math.max(a.minHours, a.maxHours * .6) : (recentWeeklyHours(acts) || a.minHours);
    const ev = new Set(races.filter(x => x !== T && x.pri !== "C").map(x => wi(x.date) - (s + r)).filter(k => k >= 0 && k < n - r));
    hoursCurve(a, n - r, startH, spec, ev).forEach((c, j) => {
      const idx = s + r + j, wo = e - idx + 1;
      weeks[idx] = { h: c.h, phase: phaseFor(wo, spec) + (c.rec ? (ev.has(j) ? " (race week)" : " (recovery)") : ""), rec: c.rec && !ev.has(j), target: T, raceWeek: idx === e };
    });
    s = e + 1; prev = T;
  });
  const recAfter = prev ? RACE_TYPES[prev.dist].recW : 0;
  for (let i = s; i < nW; i++) weeks[i] = i - s < recAfter ? { h: a.maxHours * .5, phase: "Recovery", target: null } : { h: a.maxHours * .6, phase: "Base", target: null };
  let rows = [];
  weeks.forEach((w, i) => {
    if (!w) return;
    const ws = addDays(w0, 7 * i);
    const nextTri = races.find(r => r.date >= ws && RACE_TYPES[r.dist].sport === "tri");
    const tri = w.target && RACE_TYPES[w.target.dist].sport === "tri" ? w.target.dist : nextTri ? nextTri.dist : "IM";
    const skiR = races.filter(r => RACE_TYPES[r.dist].sport === "ski" && r.date >= ws && r.date <= addDays(ws, 42));
    const skiFocus = (skiR.find(r => r.pri === "A") || skiR[0] || {}).dist || null;
    buildWeek(a, ws, w.h, w.phase.split(" ")[0], !!w.rec, { target: w.target, raceWeek: w.raceWeek, tri, skiFocus })
      .forEach(x => { if (x.date >= start) rows.push({ ...x, week: i + 1, phase: w.phase, weekHours: +w.h.toFixed(1), targetName: w.target ? w.target.name : "" }); });
  });
  const triT = new Set(targets.filter(t => RACE_TYPES[t.dist].sport === "tri").map(t => t.date + t.name));
  rows = applyRaceOverlays(rows, a, races.filter(r => !triT.has(r.date + r.name)), targets);
  rows.forEach((r, i) => r.id = r.date + "-" + i);
  return rows;
}

function applyRaceOverlays(plan, a, races, targets) {
  if (!plan.length) return plan;
  const hr = a.lthr, ftp = a.ftp, rp = a.runThr;
  races.forEach(r => {
    const T = RACE_TYPES[r.dist], pri = r.pri, o = T.ov[pri], rd = r.date, d1 = addDays(rd, -1);
    const meta = plan.find(p => p.date >= rd) || plan.at(-1), est = estFinish(a, r.dist);
    plan = plan.filter(p => (p.date !== rd && p.date !== d1) || p.intensity === "race");
    let race, open;
    if (T.sport === "ski") {
      const desc = { ski15: `Hard from the gun: 20' warm-up incl. 3x1' at race pace + 2x15s sprints. Race at ${hr}+ bpm. No feeding needed.`,
        ski25: `20' warm-up incl. 3x1' at race pace. Start controlled (~${Math.round(hr * .98)} bpm), settle at threshold, push the last 5 km. One gel at halfway.`,
        ski50: `15' easy warm-up. First half at ${Math.round(hr * .90)}-${Math.round(hr * .95)} bpm — don't chase early surges. Feed 40-60 g carbs/hr (every 10-15 km). Hold V2 technique late.` }[r.dist];
      race = S(rd, "ski", `⛷️ ${r.name} (${T.label}, ${pri}-race)`, est.total, `${desc} Est. ${est.text}.`, "race");
      open = S(d1, "ski", "Ski openers + wax test", 35, "Easy 25' + 4x45s at race pace. Test skis/wax on course if possible.", "easy");
    } else {
      const w = `${Math.round(ftp * T.bikeIF[0])}-${Math.round(ftp * T.bikeIF[1])} W`;
      race = S(rd, "race", `🏁 ${r.name} (${T.label}, ${pri}-race)`, est.total,
        `${pri === "C" ? "Training race — hold back. " : ""}Bike ${w}, run settle at ${paceKm(rp * T.runF)}. Fuel 60-90 g carbs/hr. Est. finish ${est.text}.`, "race");
      open = S(d1, "bike", "Pre-race openers", 30, `20' spin with 3x1' at ${w} + 10' jog with 4 strides. Rack bike.`, "easy");
    }
    const warn = targets.find(t => t.date > rd && t.pri === "A" && RACE_TYPES[t.dist].sport === "tri" && diffDays(t.date, rd) <= RACE_TYPES[t.dist].protect);
    if (warn) race.note = `⚠️ ${diffDays(warn.date, rd)} days before your A race (${warn.name}) — race it as training or consider skipping.`;
    plan.forEach(p => {
      if (p.intensity === "race") return;
      if (p.date >= addDays(rd, -o.t) && p.date < d1) { if (p.intensity === "hard") p.intensity = "moderate"; p.min = r5(p.min * o.f); p.note = `Taper for ${r.name}`; }
      if (p.date > rd && p.date <= addDays(rd, o.r)) { if (p.intensity !== "easy") { p.intensity = "easy"; p.title += " → easy"; } p.min = Math.min(p.min, o.cap * 2); p.note = `Recovery after ${r.name}`; }
      if (p.date === addDays(rd, 1)) { p.min = Math.min(p.min, o.cap); p.note = `Day after ${r.name} – easy recovery`; }
    });
    [race, open].forEach(x => plan.push({ ...x, week: meta.week, phase: meta.phase, weekHours: meta.weekHours, targetName: meta.targetName }));
  });
  return plan.sort((x, y) => x.date < y.date ? -1 : x.date > y.date ? 1 : 0);
}

/* ---------- readiness ---------- */
const avg = a => a.reduce((s, x) => s + x, 0) / a.length;
function readiness(metrics, well) {
  const tsb = metrics.length ? metrics[metrics.length - 1].tsb : 0; let score = 75; const why = [];
  if (tsb < -30) { score -= 25; why.push(`Form very low (TSB ${tsb.toFixed(0)})`); }
  else if (tsb < -15) { score -= 10; why.push(`Form low (TSB ${tsb.toFixed(0)})`); }
  else if (tsb > 10) { score += 10; why.push(`Fresh (TSB ${tsb.toFixed(0)})`); }
  const w = (well || []).slice().sort((a, b) => a.date < b.date ? -1 : 1);
  const hrv = w.filter(x => x.hrv > 0).map(x => +x.hrv);
  if (hrv.length >= 7) { const base = avg(hrv.slice(-28)), last = avg(hrv.slice(-3));
    if (last < base * .9) { score -= 20; why.push(`HRV ${last.toFixed(0)} below baseline ${base.toFixed(0)}`); } else if (last > base * 1.03) { score += 5; why.push("HRV above baseline"); } }
  const sl = w.filter(x => x.sleep > 0).map(x => +x.sleep);
  if (sl.length) { const s = avg(sl.slice(-3)); if (s < 6) { score -= 15; why.push(`Sleep low (${s.toFixed(1)} h avg)`); } else if (s >= 7.5) { score += 5; why.push(`Sleep good (${s.toFixed(1)} h)`); } }
  score = Math.max(0, Math.min(100, score));
  return { score, status: score >= 70 ? "green" : score >= 50 ? "amber" : "red", tsb, reasons: why.length ? why : ["No red flags"] };
}
function applyReadiness(plan, r, days = 2) {
  if (r.status === "green") return plan;
  const h = addDays(todayIso(), days), f = r.status === "red" ? .6 : .8;
  plan.forEach(p => { if (p.date <= h && p.intensity === "hard") { p.min = Math.round(p.min * f / 10) * 10; p.title += " → easy"; p.intensity = "easy"; p.note = `Auto-downgraded: readiness ${r.status} (${r.reasons.join("; ")})`; } });
  return plan;
}

/* ---------- Garmin CSV ---------- */
function mapSport(t) {
  t = String(t || "").toLowerCase();
  if (/skate|cross.?country|xc ski|nordic|roller ?ski|skating_ws|classic_ws/.test(t)) return "ski";
  if (t.includes("ski") && !/resort|downhill|alpine|snowboard|jet/.test(t)) return "ski";
  if (/strength|weight|lift|gym|hiit|crossfit|yoga|pilates|mobility/.test(t)) return "strength";
  if (t.includes("swim")) return "swim";
  if (/cycl|bik|ride|virtual/.test(t)) return "bike";
  if (/run|treadmill|trail/.test(t)) return "run";
  return "other";
}
function parseCsv(text) {
  const rows = []; let row = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true; else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(f); rows.push(row); row = []; f = ""; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim()));
}
const num = v => { const s = String(v ?? "").replace(/[^0-9.\-]/g, ""); const n = parseFloat(s); return isFinite(n) ? n : null; };
const mins = v => { const p = String(v || "").trim().split(":").map(Number); if (p.some(isNaN)) return 0; return p.length === 3 ? p[0] * 60 + p[1] + p[2] / 60 : p.length === 2 ? p[0] + p[1] / 60 : p[0] || 0; };
function parseGarminCsv(text) {
  const [h, ...rows] = parseCsv(text.replace(/^\uFEFF/, "")); const H = h.map(x => x.toLowerCase().trim());
  const ix = (...n) => { for (const x of n) { const i = H.indexOf(x); if (i >= 0) return i; } return -1; };
  const c = { date: ix("date", "start time"), type: ix("activity type", "type"), title: ix("title", "activity name"), time: ix("time", "duration", "moving time"),
    dist: ix("distance"), hr: ix("avg hr", "average heart rate"), pw: ix("normalized power® (np®)", "normalized power (np)", "avg power"), tss: ix("training stress score®", "training stress score (tss)", "tss") };
  return rows.map(r => {
    const g = k => c[k] >= 0 ? r[c[k]] : null, d = new Date(String(g("date")).replace(" ", "T"));
    if (isNaN(d)) return null;
    const sport = mapSport(g("type")); let km = num(g("dist")) || 0; if (sport === "swim" && km > 50) km /= 1000;
    return { date: iso(new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))), sport, name: g("title") || sport, min: +mins(g("time")).toFixed(1), km, hr: num(g("hr")), power: num(g("pw")), tss: num(g("tss")) };
  }).filter(r => r && r.min > 0);
}
function parseWellnessCsv(text) {
  const [h, ...rows] = parseCsv(text.replace(/^\uFEFF/, "")); const H = h.map(x => x.toLowerCase().trim().replace(/ /g, "_"));
  const g = (r, k) => { const i = H.indexOf(k); return i >= 0 ? num(r[i]) : null; };
  return rows.map(r => ({ date: r[H.indexOf("date")], hrv: g(r, "hrv"), sleep: g(r, "sleep_hours"), rhr: g(r, "resting_hr") })).filter(x => x.date);
}

/* ---------- demo ---------- */
function demoData(days = 120) {
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const acts = [], well = [], t = todayIso();
  const tmpl = { 1: [["bike", 60, .72], ["swim", 40, .8]], 2: [["run", 45, .82], ["strength", 45, .6]], 3: [["swim", 45, .85], ["bike", 50, .68]], 4: [["run", 40, .72]], 5: [["bike", 150, .66]], 6: [["run", 80, .74]] };
  for (let i = days; i > 0; i--) {
    const d = addDays(t, -i), prog = 1 + (days - i) / days * .5;
    (tmpl[weekday(d)] || []).forEach(([sp, m, it]) => {
      if (rnd() < .1) return; const mm = m * prog * (.85 + rnd() * .25);
      const km = sp === "bike" ? mm / 60 * 30 : sp === "run" ? mm * 60 / (270 / it) / 1000 : sp === "swim" ? mm * 60 / (105 / it) / 10 : 0;
      acts.push({ date: d, sport: sp, name: sp[0].toUpperCase() + sp.slice(1) + " session", min: +mm.toFixed(1), km: +km.toFixed(2), hr: Math.round(130 + 30 * it), power: sp === "bike" ? Math.round(250 * it / 1.05) : null, tss: null });
    });
    well.push({ date: d, hrv: +(62 + (rnd() - .5) * 8 - (i < 3 ? 6 : 0)).toFixed(1), sleep: +(6.2 + rnd() * 2).toFixed(1), rhr: 44 + Math.floor(rnd() * 6) });
  }
  return { acts, well };
}

root.Engine = { SPORTS, iso, addDays, diffDays, weekday, todayIso, paceKm, pace100, hm, defaultAthlete, migrateAthlete, estimateTss, loadMetrics, recentWeeklyHours,
  RACE_TYPES, estFinish, pickTargets, generatePlan, readiness, applyReadiness, parseGarminCsv, parseWellnessCsv, mapSport, demoData };
})(typeof window !== "undefined" ? window : globalThis);
