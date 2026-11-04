/* IronCoach add-on: live Garmin sync through the Cloudflare relay (/api/garmin/*).
   Load AFTER app.js:  <script src="garmin.js"></script>  */
(function () {
  const KEY = "ic_garmin", E = window.Engine;
  const DEF = { password: "", actPath: "", dailyPath: "", days: 120, chunk: 30, auto: true, last: null };
  const cfg = () => ({ ...DEF, ...(JSON.parse(localStorage.getItem(KEY) || "{}")) });
  const saveCfg = c => localStorage.setItem(KEY, JSON.stringify(c));
  const msg = t => (typeof toast === "function" ? toast(t) : console.log(t));

  async function call(c, path) {
    const r = await fetch("/api/garmin/" + path.replace(/^\//, ""), { headers: { "x-app-password": c.password } });
    const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
    if (!r.ok) throw new Error((data && data.error) || `HTTP ${r.status}`);
    return data;
  }
  // {start} {end} = YYYY-MM-DD, {startSec} {endSec} = Unix seconds
  const fill = (p, s, e) => p.replace(/\{start\}/g, s).replace(/\{end\}/g, e)
    .replace(/\{startSec\}/g, Date.parse(s + "T00:00:00Z") / 1000).replace(/\{endSec\}/g, Date.parse(e + "T23:59:59Z") / 1000 | 0);
  const firstArray = d => Array.isArray(d) ? d : d && typeof d === "object" ? (Object.values(d).find(Array.isArray) || []) : [];
  const pick = (o, ...ks) => { for (const k of ks) { const v = k.split(".").reduce((x, y) => x == null ? x : x[y], o); if (v != null && v !== "") return v; } return null; };
  const dayOf = v => { if (v == null) return null; if (typeof v === "number") return new Date((v > 1e12 ? v : v * 1000)).toISOString().slice(0, 10); return String(v).slice(0, 10); };

  function mapActivity(a) {
    const type = pick(a, "activityType", "activityType.typeKey", "activityTypeDTO.typeKey", "sportType", "type");
    const date = dayOf(pick(a, "startTimeLocal", "startTimeInSeconds", "startTimeGMT", "startTime", "calendarDate"));
    const sec = Number(pick(a, "durationInSeconds", "duration", "movingDuration", "elapsedDuration")) || 0;
    const m = Number(pick(a, "distanceInMeters", "distance")) || 0;
    if (!date || !sec) return null;
    return { date, sport: E.mapSport(typeof type === "object" ? JSON.stringify(type) : type), name: pick(a, "activityName", "name") || String(type || "Activity"),
      min: +(sec / 60).toFixed(1), km: +(m / 1000).toFixed(2), hr: Number(pick(a, "averageHeartRateInBeatsPerMinute", "averageHR", "avgHr")) || null,
      power: Number(pick(a, "normPower", "normalizedPowerInWatts", "averagePowerInWatts", "avgPower")) || null, tss: Number(pick(a, "trainingStressScore")) || null };
  }
  function mapDaily(d) {
    const date = dayOf(pick(d, "calendarDate", "date", "startTimeInSeconds")); if (!date) return null;
    const sleepS = Number(pick(d, "sleepTimeSeconds", "durationInSeconds", "sleep.durationInSeconds", "dailySleepDTO.sleepTimeSeconds")) || 0;
    return { date, hrv: Number(pick(d, "lastNightAvg", "hrvSummary.lastNightAvg", "hrv", "hrvValue")) || null,
      sleep: sleepS ? +(sleepS / 3600).toFixed(1) : (Number(pick(d, "sleepHours")) || null),
      rhr: Number(pick(d, "restingHeartRateInBeatsPerMinute", "restingHeartRate", "rhr")) || null };
  }
  async function fetchRange(c, path, mapper) {
    const out = [], end = E.todayIso();
    for (let s = E.addDays(end, -c.days); s <= end; s = E.addDays(s, c.chunk)) {
      const e = [E.addDays(s, c.chunk - 1), end].sort()[0];
      firstArray(await call(c, fill(path, s, e))).forEach(x => { const m = mapper(x); if (m) out.push(m); });
      if (!/\{(start|end)/.test(path)) break;          // path has no date range → one call only
    }
    return out;
  }
  async function sync(silent) {
    const c = cfg();
    if (!c.password || !c.actPath) { if (!silent) msg("Enter the app password and activities path first"); return; }
    try {
      if (!silent) msg("Syncing from Garmin…");
      const seen = new Set(), acts = (await fetchRange(c, c.actPath, mapActivity))
        .filter(a => { const k = a.date + a.sport + Math.round(a.min); return !seen.has(k) && seen.add(k); });
      if (!acts.length) throw new Error("Garmin returned no activities — check the activities path");
      const wasDemo = st.source === "demo"; st.acts = acts; st.source = "garmin";
      if (c.dailyPath) {
        const byDate = {}; (await fetchRange(c, c.dailyPath, mapDaily)).forEach(d => byDate[d.date] = { ...(byDate[d.date] || {}), ...Object.fromEntries(Object.entries(d).filter(([, v]) => v != null)) });
        const manual = wasDemo ? [] : (st.well || []).filter(w => !byDate[w.date]);
        st.well = manual.concat(Object.values(byDate));
      }
      c.last = new Date().toISOString(); saveCfg(c);
      persist(); recompute(true); render(); msg(`Garmin sync: ${acts.length} activities`);
    } catch (e) { msg("Garmin sync failed: " + e.message); }
  }
  async function test() {
    const c = readForm(); saveCfg(c);
    try { const r = await call(c, "_status"); msg(r.base ? "✅ Connected to Garmin" : "✅ Token OK — set GARMIN_API_BASE in Cloudflare"); }
    catch (e) { msg("❌ " + e.message); }
  }
  const v = id => document.getElementById(id);
  function readForm() {
    const c = cfg();
    return { ...c, password: v("gcPw").value, actPath: v("gcAct").value.trim(), dailyPath: v("gcDaily").value.trim(),
      days: +v("gcDays").value || 120, chunk: +v("gcChunk").value || 30, auto: v("gcAuto").checked };
  }
  function inject() {
    const anchor = v("fAct"); if (!anchor || v("gcCard")) return;
    const card = anchor.closest(".card"), c = cfg(), e = s => String(s ?? "").replace(/"/g, "&quot;");
    card.insertAdjacentHTML("beforebegin", `<div class="card" id="gcCard"><h3 style="margin-top:0">🔗 Garmin live sync</h3>
      <label>App password (same as APP_PASSWORD in Cloudflare)</label><input id="gcPw" type="password" value="${e(c.password)}" autocomplete="off">
      <label>Activities path (from Garmin Swagger docs)</label><input id="gcAct" value="${e(c.actPath)}" placeholder="path?from={start}&to={end}">
      <label>Daily health path (optional: sleep / HRV / resting HR)</label><input id="gcDaily" value="${e(c.dailyPath)}" placeholder="path?from={start}&to={end}">
      <div class="row"><div><label>Days to pull</label><input id="gcDays" type="number" value="${c.days}"></div><div><label>Days per request</label><input id="gcChunk" type="number" value="${c.chunk}"></div></div>
      <label><input id="gcAuto" type="checkbox" style="width:auto" ${c.auto ? "checked" : ""}> Auto-sync when the app opens (max every 6 h)</label>
      <p class="muted">Placeholders: {start} {end} = YYYY-MM-DD · {startSec} {endSec} = Unix seconds. Last sync: ${c.last ? new Date(c.last).toLocaleString() : "never"}</p>
      <div class="row"><button class="btn sec" id="gcTest">Test connection</button><button class="btn" id="gcSync">Save & sync now</button></div></div>`);
    v("gcTest").onclick = test;
    v("gcSync").onclick = () => { saveCfg(readForm()); sync(false); };
  }
  new MutationObserver(inject).observe(document.getElementById("view"), { childList: true });
  inject();
  const c = cfg();
  if (c.auto && c.password && c.actPath && location.protocol.startsWith("http") && (!c.last || Date.now() - Date.parse(c.last) > 6 * 3600e3)) setTimeout(() => sync(true), 1500);
  window.GarminSync = { sync, test, mapActivity, mapDaily };
})();
