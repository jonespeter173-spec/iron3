/* IronCoach mobile app UI – multi-race */
const E = window.Engine, RT = E.RACE_TYPES;
const ICON = { swim: "🏊", bike: "🚴", run: "🏃", ski: "⛷️", strength: "🏋️", race: "🏁", other: "🚶" };
const PHC = { Base: "#90caf9", Build: "#ffb74d", Peak: "#e57373", Taper: "#81c784", Recovery: "#b0bec5" };
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const raceIcon = d => RT[d] && RT[d].sport === "ski" ? "⛷️" : "🏁";
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmtD = (s, o = { weekday: "short", month: "short", day: "numeric" }) => new Date(s + "T12:00:00").toLocaleDateString(undefined, o);

/* ---------------- state (saved on device) ---------------- */
const load = (k, d) => { try { const v = localStorage.getItem("ic_" + k); return v ? JSON.parse(v) : d; } catch { return d; } };
const save = (k, v) => localStorage.setItem("ic_" + k, JSON.stringify(v));
const st = {
  athlete: load("athlete", E.defaultAthlete()),
  acts: load("acts", null), well: load("well", null), source: load("source", "demo"),
  plan: load("plan", null), planKey: load("planKey", ""),
  ai: load("ai", { key: "", endpoint: "", model: "gpt-4o" }), aiResult: load("aiResult", null), chat: load("chat", []),
  tab: "today", week: null,
};
if (!st.acts) { const d = E.demoData(); st.acts = d.acts; st.well = d.well; st.source = "demo"; }
st.athlete = E.migrateAthlete({ ...E.defaultAthlete(), ...(st.athlete.races ? {} : { races: undefined }), ...st.athlete });
if (!st.athlete.races) st.athlete.races = E.defaultAthlete().races;
save("athlete", st.athlete);

const upcoming = () => st.athlete.races.filter(r => r.date >= E.todayIso() && RT[r.dist]).sort((a, b) => a.date < b.date ? -1 : 1);

let metrics, ready;
function recompute(force) {
  metrics = E.loadMetrics(st.acts, st.athlete);
  ready = E.readiness(metrics, st.well);
  const key = JSON.stringify([st.athlete, st.acts.length, st.acts.at(-1)?.date, E.todayIso()]);
  if (force || !st.plan || st.planKey !== key) {
    const prev = {}; (st.plan || []).forEach(p => { if (p.status !== "planned") prev[p.date + p.title] = p.status; });
    st.plan = E.applyReadiness(E.generatePlan(st.athlete, st.acts), ready);
    st.plan.forEach(p => { if (prev[p.date + p.title]) p.status = prev[p.date + p.title]; });
    st.planKey = key; st.aiResult = null;
    save("plan", st.plan); save("planKey", key); save("aiResult", null);
  }
}
function persist() { ["athlete", "acts", "well", "source", "plan", "ai", "aiResult", "chat"].forEach(k => save(k, st[k])); }
function toast(t) { const el = $("#toast"); el.textContent = t; el.classList.remove("hidden"); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.add("hidden"), 2400); }

/* ---------------- helpers ---------------- */
function sessCard(p) {
  return `<div class="card sess ${p.intensity} ${p.status}" data-id="${p.id}">
    <div class="t">${p.intensity === "race" ? "" : (ICON[p.sport] || "")} ${esc(p.title)}</div>
    <div class="m">${p.min ? (p.intensity === "race" ? "est. " + E.hm(p.min) : p.min + " min") : ""}<span class="pill ${p.intensity}">${p.intensity}</span></div>
    <div class="d">${esc(p.desc)}</div>${p.note ? `<div class="note">${esc(p.note)}</div>` : ""}</div>`;
}
function groupByDate(list) {
  let out = "", last = "";
  list.forEach(p => { if (p.date !== last) { out += `<h3>${fmtD(p.date)}</h3>`; last = p.date; } out += sessCard(p); });
  return out;
}
function header() {
  const up = upcoming(), nA = up.find(r => r.pri === "A"), nx = up[0], t = E.todayIso();
  const cd = r => { const d = E.diffDays(r.date, t); return d >= 14 ? `${(d / 7).toFixed(1)} wk` : `${d} d`; };
  $("#hdrTitle").textContent = nA ? `${raceIcon(nA.dist)} ${nA.name} · ${cd(nA)}` : "IronCoach";
  $("#hdrSub").textContent = nx ? (nx !== nA ? `Next: ${nx.name} (${nx.pri}) in ${cd(nx)}` : `Next A race`) : "Add a race to build your plan";
  $("#readyBadge").textContent = `${ready.status === "green" ? "🟢" : ready.status === "amber" ? "🟡" : "🔴"} ${ready.score}`;
}
const noRaces = () => `<div class="card">No upcoming races. Go to <b>🏁 Races</b> and add at least one race to build your plan.</div>`;

/* ---------------- views ---------------- */
function vToday() {
  if (!st.plan.length) return noRaces();
  const t = E.todayIso(), a = st.athlete, m = metrics.at(-1), m7 = metrics.at(-8);
  const today = st.plan.filter(p => p.date === t), next = st.plan.filter(p => p.date > t && p.date <= E.addDays(t, 3));
  const wk = E.addDays(t, -E.weekday(t)), wkPlan = st.plan.filter(p => p.date >= wk && p.date < E.addDays(wk, 7) && p.intensity !== "race");
  const done = wkPlan.filter(p => p.status === "done").reduce((s, p) => s + p.min, 0), tot = wkPlan.reduce((s, p) => s + (p.status !== "skipped" ? p.min : 0), 0);
  const well = (st.well || []).find(w => w.date === t) || {}, nx = upcoming()[0];
  return `
  <div class="kpis">
    <div class="kpi"><small>Phase</small><b>${esc((st.plan[0] || {}).phase || "-")}</b><small>${esc((st.plan[0] || {}).targetName ? "→ " + st.plan[0].targetName : "")}</small></div>
    <div class="kpi"><small>Next race</small><b>${nx ? E.diffDays(nx.date, t) + " d" : "-"}</b><small>${nx ? esc(nx.name) + ` <span class="pri ${nx.pri}">${nx.pri}</span>` : ""}</small></div>
    <div class="kpi"><small>Fitness (CTL)</small><b>${m.ctl.toFixed(0)}</b><small>${(m.ctl - m7.ctl >= 0 ? "+" : "") + (m.ctl - m7.ctl).toFixed(1)} 7d · form ${m.tsb.toFixed(0)}</small></div>
    <div class="kpi"><small>This week</small><b>${(done / 60).toFixed(1)}/${(tot / 60).toFixed(1)}h</b><small>done / planned</small></div>
  </div>
  <h2>Today · ${fmtD(t, { weekday: "long", month: "short", day: "numeric" })}</h2>
  ${today.length ? today.map(sessCard).join("") : `<div class="card">😴 Rest day — mobility, sleep and fuel well.</div>`}
  <p class="muted">Tap a session to mark it done, skip it, or see details.</p>
  <h2>Readiness ${ready.score}/100</h2>
  <div class="card"><div class="bar"><i style="width:${ready.score}%;background:${ready.status === "green" ? "#2e7d32" : ready.status === "amber" ? "#f9a825" : "#c62828"}"></i></div>
    <ul>${ready.reasons.map(r => `<li>${esc(r)}</li>`).join("")}</ul>
    <h3>Morning check-in</h3>
    <div class="row"><div><label>HRV (ms)</label><input id="ciHrv" type="number" inputmode="decimal" value="${well.hrv ?? ""}"></div>
    <div><label>Sleep (h)</label><input id="ciSleep" type="number" inputmode="decimal" step="0.1" value="${well.sleep ?? ""}"></div>
    <div><label>Resting HR</label><input id="ciRhr" type="number" inputmode="numeric" value="${well.rhr ?? ""}"></div></div>
    <button class="btn sec" id="ciSave">Save check-in & adapt plan</button></div>
  <h2>Next 3 days</h2>${groupByDate(next) || `<div class="card muted">Nothing planned.</div>`}
  <h2>Zones</h2>
  <div class="card"><table><tr><th></th><th>Easy/Z2</th><th>70.3</th><th>IM</th><th>Threshold</th></tr>
  <tr><td>🚴</td><td>${Math.round(a.ftp * .56)}-${Math.round(a.ftp * .75)} W</td><td>${Math.round(a.ftp * .76)}-${Math.round(a.ftp * .83)} W</td><td>${Math.round(a.ftp * .68)}-${Math.round(a.ftp * .75)} W</td><td>${a.ftp} W</td></tr>
  <tr><td>🏃</td><td>${E.paceKm(a.runThr * 1.25)}</td><td>${E.paceKm(a.runThr * 1.05)}</td><td>${E.paceKm(a.runThr * 1.12)}</td><td>${E.paceKm(a.runThr)}</td></tr>
  <tr><td>🏊</td><td>${E.pace100(a.css * 1.1)}</td><td>${E.pace100(a.css * 1.03)}</td><td>${E.pace100(a.css * 1.06)}</td><td>${E.pace100(a.css)}</td></tr>
  </table>
  ${a.skiEnabled ? `<table style="margin-top:8px"><tr><th>⛷️ Skate</th><th>Easy</th><th>50 km</th><th>25 km</th><th>15 km</th></tr>
  <tr><td>HR</td><td>${Math.round(a.lthr * .81)}-${Math.round(a.lthr * .89)}</td><td>${Math.round(a.lthr * .90)}-${Math.round(a.lthr * .95)}</td><td>${Math.round(a.lthr * .95)}-${a.lthr}</td><td>${a.lthr}+</td></tr></table>` : ""}</div>`;
}

function weekSummary() {
  const wk = {}; st.plan.forEach(p => { const w = wk[p.week] = wk[p.week] || { week: p.week, start: p.date, phase: p.phase, min: 0, races: [], target: p.targetName };
    if (p.date < w.start) w.start = p.date; if (p.intensity === "race") w.races.push(p); else if (p.status !== "skipped") w.min += p.min; });
  return Object.values(wk).sort((a, b) => a.week - b.week);
}
function vPlan() {
  if (!st.plan.length) return noRaces();
  const ws = weekSummary();
  if (st.week == null || !ws.find(w => w.week === st.week)) st.week = ws[0].week;
  const maxH = Math.max(...ws.map(w => w.min / 60), 1), W = 340, H = 130, bw = W / ws.length;
  const bars = ws.map((w, i) => { const h = w.min / 60 / maxH * (H - 30); return `<rect x="${i * bw + 1}" y="${H - h}" width="${Math.max(bw - 2, 1)}" height="${h}" rx="2" fill="${PHC[w.phase.split(" ")[0]] || "#ccc"}" ${w.week === st.week ? 'stroke="#0d47a1" stroke-width="2"' : ""} data-week="${w.week}"/>`
    + w.races.map((r, k) => { const big = / A-race/.test(r.title), cx = i * bw + bw / 2, y = H - h - 6 - k * 9, ski = r.sport === "ski";
      return `<path d="M${cx - (big ? 5 : 3.5)} ${y} L${cx + (big ? 5 : 3.5)} ${y} L${cx} ${y + (big ? 8 : 6)} Z" fill="${ski ? "#1565c0" : "#c62828"}" data-week="${w.week}"/>`; }).join(""); }).join("");
  const cur = ws.find(w => w.week === st.week), start = E.addDays(cur.start, -E.weekday(cur.start));
  let grid = "";
  for (let i = 0; i < 7; i++) {
    const d = E.addDays(start, i), ss = st.plan.filter(p => p.date === d);
    grid += `<div class="wd"><div class="h ${d === E.todayIso() ? "today" : ""}">${DAYS[i]}<br>${+d.slice(8)}</div>` +
      (ss.length ? ss.map(p => `<div class="mini ${p.intensity}" data-id="${p.id}">${p.intensity === "race" ? (p.sport === "ski" ? "⛷️" : "🏁") + " RACE" : ICON[p.sport] + " " + (p.min || "") + "′"}${p.status === "done" ? "✓" : ""}${p.note && p.note.startsWith("🤖") ? "🤖" : ""}</div>`).join("") : `<div class="muted" style="text-align:center">rest</div>`) + `</div>`;
  }
  return `<h2>Season — tap a bar</h2><div class="card"><svg viewBox="0 0 ${W} ${H}">${bars}</svg>
    <div class="legend">${Object.entries(PHC).map(([k, c]) => `<b style="background:${c}"></b>${k}`).join("")}<br><b style="background:#c62828"></b>Tri race <b style="background:#1565c0"></b>Ski race (bigger = A)</div></div>
    <div class="row"><button class="btn sec" id="wkPrev">◀</button><button class="btn sec" id="wkNow">This week</button><button class="btn sec" id="wkNext">▶</button></div>
    <h2>Week ${cur.week} · ${esc(cur.phase)} · ${(cur.min / 60).toFixed(1)} h${cur.target ? ` · → ${esc(cur.target)}` : ""}</h2>
    <div class="week">${grid}</div>${groupByDate(st.plan.filter(p => p.week === st.week))}`;
}

function vRaces() {
  const t = E.todayIso(), all = st.athlete.races.slice().sort((a, b) => a.date < b.date ? -1 : 1);
  const up = all.filter(r => r.date >= t), past = all.filter(r => r.date < t);
  const targets = E.pickTargets(up.filter(r => RT[r.dist]).map(r => ({ ...r, pri: r.pri || "B" }))).map(r => r.date + r.name);
  const row = r => { const i = st.athlete.races.indexOf(r), d = E.diffDays(r.date, t), est = RT[r.dist] ? E.estFinish(st.athlete, r.dist) : null;
    return `<div class="card race-row" data-race="${i}"><div class="big">${raceIcon(r.dist)}</div>
      <div><b>${esc(r.name)}</b> <span class="pri ${r.pri}">${r.pri}</span>${targets.includes(r.date + r.name) ? ' <span class="pill race">plan peaks here</span>' : ""}
      <div class="muted">${RT[r.dist] ? RT[r.dist].label : r.dist} · ${fmtD(r.date, { weekday: "short", year: "numeric", month: "short", day: "numeric" })}</div>
      ${est ? `<div class="muted">Est. ${esc(est.text)}</div>` : ""}</div>
      <div class="cd">${d >= 0 ? (d >= 14 ? (d / 7).toFixed(1) + " wk" : d + " d") : "done"}<small>${d >= 0 ? "to go" : ""}</small></div></div>`; };
  return `<button class="btn" id="addRace">+ Add race</button>
  <h2>Upcoming (${up.length})</h2>${up.map(row).join("") || `<div class="card muted">No upcoming races.</div>`}
  <div class="card muted"><b>How priorities work</b><br>
  <span class="pri A">A</span> Goal race. Triathlon A races get full periodization (Base → Build → Peak → Taper) and post-race recovery weeks. Ski A races get a 3–5 day taper.<br>
  <span class="pri B">B</span> Important. Short taper (2–7 days by distance), and that week becomes a lighter week.<br>
  <span class="pri C">C</span> Training race. 1–5 lighter days before and minimal disruption.<br>
  With no triathlon A race, the plan peaks for your next B triathlon, then for a ski A race.</div>
  ${past.length ? `<h2>Past races</h2>${past.reverse().map(row).join("")}` : ""}`;
}
function raceSheet(i) {
  const r = i >= 0 ? st.athlete.races[i] : { date: E.addDays(E.todayIso(), 60), name: "", dist: "70.3", pri: "B" };
  $("#sheetBody").innerHTML = `<h2 style="margin-top:0">${i >= 0 ? "Edit race" : "Add race"}</h2>
    <label>Race name</label><input id="rName" value="${esc(r.name)}" placeholder="e.g. Ironman Canada">
    <label>Distance</label><select id="rDist">${Object.entries(RT).map(([k, v]) => `<option value="${k}" ${k === r.dist ? "selected" : ""}>${v.sport === "ski" ? "⛷️" : "🏁"} ${v.label}</option>`).join("")}</select>
    <div class="row"><div><label>Date</label><input id="rDate" type="date" value="${r.date}"></div>
    <div><label>Priority</label><select id="rPri">${["A", "B", "C"].map(p => `<option ${p === r.pri ? "selected" : ""}>${p}</option>`).join("")}</select></div></div>
    <button class="btn" id="rSave">Save race</button>${i >= 0 ? `<button class="btn del" id="rDel">Delete race</button>` : ""}<button class="btn sec" id="rCancel">Cancel</button>`;
  $("#sheet").classList.remove("hidden");
  $("#rSave").onclick = () => {
    const nr = { name: $("#rName").value.trim() || RT[$("#rDist").value].label, dist: $("#rDist").value, date: $("#rDate").value, pri: $("#rPri").value };
    if (!nr.date) return toast("Pick a date");
    if (i >= 0) st.athlete.races[i] = nr; else st.athlete.races.push(nr);
    save("athlete", st.athlete); recompute(true); $("#sheet").classList.add("hidden"); render(); toast("Race saved — plan rebuilt");
  };
  if (i >= 0) $("#rDel").onclick = () => { if (!confirm("Delete this race?")) return; st.athlete.races.splice(i, 1); save("athlete", st.athlete); recompute(true); $("#sheet").classList.add("hidden"); render(); toast("Race deleted"); };
  $("#rCancel").onclick = () => $("#sheet").classList.add("hidden");
}

function lineChart(series, W = 340, H = 180) {
  const all = series.flatMap(s => s.data), lo = Math.min(0, ...all), hi = Math.max(...all, 1), n = series[0].data.length;
  const x = i => i / Math.max(n - 1, 1) * W, y = v => H - 14 - (v - lo) / (hi - lo) * (H - 24);
  return `<svg viewBox="0 0 ${W} ${H}"><line x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}" stroke="#999" stroke-dasharray="3 3" stroke-width=".5"/>${series.map(s => s.bars
    ? s.data.map((v, i) => `<rect x="${x(i) - 1}" y="${y(v)}" width="2" height="${y(0) - y(v)}" fill="${s.color}"/>`).join("")
    : `<polyline fill="none" stroke="${s.color}" stroke-width="${s.w || 2}" ${s.dash ? 'stroke-dasharray="4 3"' : ""} points="${s.data.map((v, i) => x(i).toFixed(1) + "," + y(v).toFixed(1)).join(" ")}"/>`).join("")}
    <text x="2" y="10" font-size="9" fill="#888">${hi.toFixed(0)}</text></svg>
    <div class="legend">${series.map(s => `<b style="background:${s.color}"></b>${s.name}`).join("")}</div>`;
}
function vFitness() {
  const m = metrics.slice(-120), t = E.todayIso(), sp = {}, c8 = E.addDays(t, -56);
  st.acts.filter(a => a.date >= c8).forEach(a => sp[a.sport] = (sp[a.sport] || 0) + a.min / 60);
  const tot = Object.values(sp).reduce((s, v) => s + v, 0) || 1, hrv = (st.well || []).filter(w => w.hrv > 0).slice(-60);
  return `<h2>Fitness, fatigue & form (120 days)</h2><div class="card">${lineChart([
    { name: "Daily TSS", color: "#cfd8dc", data: m.map(x => x.tss), bars: true }, { name: "Fitness", color: "#1565c0", data: m.map(x => x.ctl), w: 3 },
    { name: "Fatigue", color: "#e91e63", data: m.map(x => x.atl) }, { name: "Form", color: "#fb8c00", data: m.map(x => x.tsb), dash: true }])}</div>
  <h2>Last 8 weeks by sport</h2><div class="card">${Object.entries(sp).sort((a, b) => b[1] - a[1]).map(([k, v]) =>
    `<div style="margin:6px 0">${ICON[k] || ""} ${k} · ${v.toFixed(1)} h<div class="bar"><i style="width:${v / tot * 100}%;background:#1565c0"></i></div></div>`).join("") || "No data"}</div>
  ${hrv.length > 2 ? `<h2>HRV</h2><div class="card">${lineChart([{ name: "HRV (ms)", color: "#6a1b9a", data: hrv.map(w => +w.hrv) }], 340, 120)}</div>` : ""}
  <h2>Recent activities</h2><div class="card"><table>${st.acts.slice().sort((a, b) => a.date < b.date ? 1 : -1).slice(0, 25).map(a =>
    `<tr><td>${fmtD(a.date, { month: "short", day: "numeric" })}</td><td>${ICON[a.sport] || ""} ${esc(a.name)}</td><td>${Math.round(a.min)}′</td><td>${E.estimateTss(a, st.athlete).toFixed(0)} TSS</td></tr>`).join("")}</table>
  <p class="muted">Source: ${st.source === "demo" ? "demo data — import your Garmin CSV in Settings" : "Garmin import"} · ${st.acts.length} activities</p></div>`;
}
function vCoach() {
  const r = st.aiResult, has = !!st.ai.key;
  return `${has ? "" : `<div class="warn">Add an OpenAI or Azure OpenAI key in <b>Settings → AI coach</b> to enable this. The plan already adapts to your races and readiness without it.</div>`}
  <button class="btn" id="aiReview" ${has && st.plan.length ? "" : "disabled"}>🤖 Review & optimise next 14 days</button>
  ${r ? `<h2>Coach's assessment</h2><div class="card">${esc(r.summary || "")}${(r.focus || []).length ? `<ul>${r.focus.map(f => `<li><b>${esc(f)}</b></li>`).join("")}</ul>` : ""}</div>
     ${(r.adjustments || []).length ? `<h2>Changes applied</h2>${r.adjustments.map(a => `<div class="card"><b>${fmtD(a.date)} · ${esc(a.action)}</b> — ${esc(a.title || a.match_title || "")} ${a.duration_min ? a.duration_min + "′" : ""}<div class="note">${esc(a.reason || "")}</div></div>`).join("")}` : ""}` : ""}
  <h2>Ask your coach</h2><div class="chat" id="chatBox">${st.chat.map(m => `<div class="msg ${m.role}">${esc(m.content)}</div>`).join("")}</div>
  <textarea id="chatIn" rows="2" placeholder="e.g. Should I race the 25 km hard 4 weeks before my 50 km?" ${has ? "" : "disabled"}></textarea>
  <div class="row"><button class="btn" id="chatSend" ${has ? "" : "disabled"}>Send</button><button class="btn sec" id="chatClear">Clear chat</button></div>`;
}
function vSettings() {
  const a = st.athlete, opt = sel => DAYS.map((d, j) => `<option value="${j}" ${j === sel ? "selected" : ""}>${d}</option>`).join("");
  const n = (id, lbl, v, extra = "") => `<div><label>${lbl}</label><input id="${id}" type="number" inputmode="decimal" value="${v}" ${extra}></div>`;
  return `<h2>Athlete</h2><div class="card">
    <label>Name</label><input id="sName" value="${esc(a.name)}">
    <div class="row">${n("sFtp", "Bike FTP (W)", a.ftp)}${n("sLthr", "LT heart rate", a.lthr)}</div>
    <div class="row"><div><label>Run threshold pace (/km)</label><input id="sRun" value="${E.paceKm(a.runThr).replace("/km", "")}" placeholder="4:30"></div>
      <div><label>Swim CSS (/100m)</label><input id="sCss" value="${E.pace100(a.css).replace("/100m", "")}" placeholder="1:45"></div></div>
    <div class="row">${n("sMin", "Min hours/week", a.minHours, 'step="0.5"')}${n("sMax", "Max hours/week", a.maxHours, 'step="0.5"')}</div>
    <div class="row"><div><label>Rest day</label><select id="sRest">${opt(a.restDay)}</select></div>
      <div><label>Long ride</label><select id="sLB">${opt(a.longBikeDay)}</select></div><div><label>Long run/ski</label><select id="sLR">${opt(a.longRunDay)}</select></div></div>
    <p class="muted">Races are managed in the 🏁 Races tab.</p></div>
  <h2>🏋️ Cross-training</h2><div class="card">
    <label>Weightlifting sessions / week</label><select id="sStr">${[0, 1, 2, 3].map(i => `<option ${i === a.strengthDays ? "selected" : ""}>${i}</option>`).join("")}</select>
    <label><input type="checkbox" id="sSki" style="width:auto" ${a.skiEnabled ? "checked" : ""}> ⛷️ Cross-country skate skiing in winter</label>
    <div id="skiBox" ${a.skiEnabled ? "" : 'style="display:none"'}>
      <label>Ski season months</label><div class="chips">${MONTHS.map((m, i) => `<button class="chip ${a.skiMonths.includes(i + 1) ? "on" : ""}" data-month="${i + 1}">${m}</button>`).join("")}</div>
      <label>Share of bike+run moved to skiing in season: <b id="shareLbl">${Math.round(a.skiShare * 100)}%</b></label><input id="sShare" type="range" min="0" max="0.6" step="0.05" value="${a.skiShare}">
    </div></div>
  <button class="btn" id="saveSettings">Save & rebuild plan</button>
  <h2>⌚ Garmin data</h2><div class="card">
    <p class="muted">On connect.garmin.com (Chrome → ⋮ → Desktop site): <b>Activities → All Activities</b>, scroll back ~4 months, then <b>Export CSV</b>.</p>
    <label>Activities CSV</label><input type="file" id="fAct" accept=".csv,text/csv,text/comma-separated-values">
    <label>Optional wellness CSV (date, hrv, sleep_hours, resting_hr)</label><input type="file" id="fWell" accept=".csv,text/csv">
    <button class="btn sec" id="useDemo">Reset to demo data</button>
    <p class="muted">Currently: ${st.source === "demo" ? "demo data" : "your Garmin data"} · ${st.acts.length} activities</p></div>
  <h2>🤖 AI coach</h2><div class="card">
    <label>OpenAI or Azure OpenAI API key</label><input id="aiKey" type="password" value="${esc(st.ai.key)}" autocomplete="off">
    <label>Azure endpoint (leave blank for OpenAI)</label><input id="aiEp" value="${esc(st.ai.endpoint)}" placeholder="https://yourname.openai.azure.com">
    <label>Model / deployment name</label><input id="aiModel" value="${esc(st.ai.model)}">
    <p class="muted">Your key is stored only on this phone.</p><button class="btn sec" id="saveAi">Save AI settings</button></div>
  <h2>📤 Export & backup</h2><div class="card">
    <button class="btn sec" id="expIcs">📅 Export plan to calendar (.ics)</button>
    <button class="btn sec" id="expCsv">⬇️ Export plan (CSV)</button>
    <button class="btn sec" id="expBackup">💾 Backup all data</button>
    <label>Restore backup</label><input type="file" id="fRestore" accept=".json,application/json"></div>
  <p class="muted" style="text-align:center">IronCoach is a training aid, not medical advice.</p>`;
}

/* ---------------- render + events ---------------- */
const VIEWS = { today: vToday, plan: vPlan, races: vRaces, fitness: vFitness, coach: vCoach, settings: vSettings };
function render() {
  header(); $("#view").innerHTML = VIEWS[st.tab]();
  document.querySelectorAll("nav button").forEach(b => b.classList.toggle("on", b.dataset.tab === st.tab));
  const cb = $("#chatBox"); if (cb) cb.scrollTop = cb.scrollHeight;
}
document.querySelectorAll("nav button").forEach(b => b.onclick = () => { st.tab = b.dataset.tab; render(); window.scrollTo(0, 0); });

function openSheet(p) {
  $("#sheetBody").innerHTML = `<div class="sess ${p.intensity}" style="padding-left:10px"><h2 style="margin-top:0">${p.intensity === "race" ? "" : ICON[p.sport] || ""} ${esc(p.title)}</h2>
    <div class="muted">${fmtD(p.date, { weekday: "long", month: "long", day: "numeric" })} · ${p.intensity === "race" ? "est. " + E.hm(p.min) : p.min + " min"} · ${p.intensity} · ${esc(p.phase)}</div>
    <p>${esc(p.desc)}</p>${p.note ? `<div class="note">${esc(p.note)}</div>` : ""}</div>
    <div class="row"><button class="btn" data-set="done">✓ Done</button><button class="btn sec" data-set="skipped">Skip</button><button class="btn sec" data-set="planned">Reset</button></div>
    <button class="btn sec" data-set="close">Close</button>`;
  $("#sheet").classList.remove("hidden");
  $("#sheetBody").onclick = e => { const s = e.target.dataset.set; if (!s) return; if (s !== "close") { p.status = s; save("plan", st.plan); } $("#sheet").classList.add("hidden"); render(); };
}
$("#sheet").onclick = e => { if (e.target.id === "sheet") $("#sheet").classList.add("hidden"); };

const parsePace = s => { const p = String(s).split(":").map(Number); return p.length === 2 ? p[0] * 60 + p[1] : +p[0]; };
const readFile = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsText(f); });
async function shareOrDownload(name, text, type) {
  const P = window.Capacitor && window.Capacitor.Plugins;
  if (P && P.Filesystem && P.Share) {
    try { const r = await P.Filesystem.writeFile({ path: name, data: text, directory: "CACHE", encoding: "utf8" }); await P.Share.share({ title: name, url: r.uri, dialogTitle: "Open or save " + name }); }
    catch (e) { if (!/cancel/i.test(e.message || "")) toast("Export failed: " + e.message); }
    return;
  }
  const blob = new Blob([text], { type });
  try { const file = new File([blob], name, { type }); if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; } } catch (e) { if (e.name === "AbortError") return; }
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
}
function toIcs(plan) {
  const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//IronCoach//EN", "X-WR-CALNAME:IronCoach"], pad = n => String(n).padStart(2, "0"), ex = s => String(s).replace(/[\\,;]/g, m => "\\" + m);
  plan.filter(p => p.status !== "skipped").forEach((p, i) => {
    const d = p.date.replace(/-/g, ""), h0 = p.intensity === "race" ? 7 : 6;
    const end = new Date(Date.UTC(+p.date.slice(0, 4), +p.date.slice(5, 7) - 1, +p.date.slice(8), h0, Math.max(p.min, 15)));
    const e = `${end.getUTCFullYear()}${pad(end.getUTCMonth() + 1)}${pad(end.getUTCDate())}T${pad(end.getUTCHours())}${pad(end.getUTCMinutes())}00`;
    L.push("BEGIN:VEVENT", `UID:ironcoach-${i}-${d}@ironcoach`, `DTSTAMP:${d}T000000`, `DTSTART:${d}T${pad(h0)}0000`, `DTEND:${e}`,
      `SUMMARY:${ex((p.intensity === "race" ? "" : (ICON[p.sport] || "") + " ") + p.title + (p.intensity === "race" ? "" : ` (${p.min}m)`))}`, `DESCRIPTION:${ex(p.desc)}`, "END:VEVENT");
  });
  return L.concat("END:VCALENDAR").join("\r\n");
}
function collectSettings() {
  if (!$("#sName")) return; const a = st.athlete, v = id => $("#" + id).value;
  Object.assign(a, { name: v("sName"), ftp: +v("sFtp") || a.ftp, lthr: +v("sLthr") || a.lthr,
    runThr: parsePace(v("sRun")) || a.runThr, css: parsePace(v("sCss")) || a.css, minHours: +v("sMin") || a.minHours, maxHours: Math.max(+v("sMax") || a.maxHours, +v("sMin") || 0),
    restDay: +v("sRest"), longBikeDay: +v("sLB"), longRunDay: +v("sLR"), strengthDays: +v("sStr"), skiEnabled: $("#sSki").checked, skiShare: +v("sShare"),
    skiMonths: [...document.querySelectorAll("[data-month].on")].map(b => +b.dataset.month) });
}

document.addEventListener("click", async e => {
  const t = e.target.closest("[data-id],[data-week],[data-month],[data-race],button");
  if (!t || t.closest("#sheet")) return;
  if (t.dataset.id) { const p = st.plan.find(x => x.id === t.dataset.id); if (p) openSheet(p); return; }
  if (t.dataset.week) { st.week = +t.dataset.week; render(); return; }
  if (t.dataset.month) { t.classList.toggle("on"); return; }
  if (t.dataset.race) { raceSheet(+t.dataset.race); return; }
  const ws = st.plan.length ? weekSummary() : [];
  switch (t.id) {
    case "wkPrev": st.week = Math.max(ws[0].week, st.week - 1); render(); break;
    case "wkNext": st.week = Math.min(ws.at(-1).week, st.week + 1); render(); break;
    case "wkNow": st.week = ws[0].week; render(); break;
    case "addRace": raceSheet(-1); break;
    case "ciSave": {
      const d = E.todayIso(); st.well = (st.well || []).filter(w => w.date !== d);
      st.well.push({ date: d, hrv: +$("#ciHrv").value || null, sleep: +$("#ciSleep").value || null, rhr: +$("#ciRhr").value || null });
      save("well", st.well); recompute(true); render(); toast(`Readiness ${ready.score} — plan updated`); break; }
    case "saveSettings": collectSettings(); save("athlete", st.athlete); recompute(true); render(); toast("Saved — plan rebuilt"); break;
    case "useDemo": { const d = E.demoData(); st.acts = d.acts; st.well = d.well; st.source = "demo"; persist(); recompute(true); render(); toast("Demo data loaded"); break; }
    case "saveAi": st.ai = { key: $("#aiKey").value.trim(), endpoint: $("#aiEp").value.trim().replace(/\/$/, ""), model: $("#aiModel").value.trim() || "gpt-4o" }; save("ai", st.ai); toast("AI settings saved"); break;
    case "expIcs": shareOrDownload("ironcoach_plan.ics", toIcs(st.plan), "text/calendar"); break;
    case "expCsv": { const k = ["date", "sport", "title", "min", "intensity", "phase", "targetName", "status", "desc", "note"];
      shareOrDownload("ironcoach_plan.csv", [k.join(",")].concat(st.plan.map(p => k.map(x => `"${String(p[x] ?? "").replace(/"/g, '""')}"`).join(","))).join("\n"), "text/csv"); break; }
    case "expBackup": shareOrDownload(`ironcoach_backup_${E.todayIso()}.json`, JSON.stringify({ athlete: st.athlete, acts: st.acts, well: st.well, source: st.source, plan: st.plan }), "application/json"); break;
    case "aiReview": aiReview(t); break;
    case "chatSend": aiChat(t); break;
    case "chatClear": st.chat = []; save("chat", []); render(); break;
  }
});
document.addEventListener("change", async e => {
  const t = e.target;
  try {
    if (t.id === "sSki") $("#skiBox").style.display = t.checked ? "" : "none";
    if (t.id === "fAct" && t.files[0]) { const acts = E.parseGarminCsv(await readFile(t.files[0])); if (!acts.length) return toast("No activities found in that file");
      if (st.source === "demo") st.well = []; st.acts = acts; st.source = "garmin"; persist(); recompute(true); render(); toast(`Imported ${acts.length} activities`); }
    if (t.id === "fWell" && t.files[0]) { st.well = E.parseWellnessCsv(await readFile(t.files[0])); persist(); recompute(true); render(); toast(`Imported ${st.well.length} wellness days`); }
    if (t.id === "fRestore" && t.files[0]) { const b = JSON.parse(await readFile(t.files[0])); Object.assign(st, b); st.athlete = E.migrateAthlete(st.athlete); persist(); recompute(true); render(); toast("Backup restored"); }
  } catch (err) { toast("Import failed: " + err.message); }
});
document.addEventListener("input", e => { if (e.target.id === "sShare") $("#shareLbl").textContent = Math.round(e.target.value * 100) + "%"; });

/* ---------------- AI ---------------- */
const SYSTEM = `You are an expert triathlon (Ironman and Half Ironman 70.3) and cross-country skate-ski coach. The athlete has a season with MULTIPLE races of different distances (Ironman, 70.3, XC ski 15/25/50 km), each with an A/B/C priority: A = goal race (full taper, protect it), B = important (short taper, train through otherwise), C = training race (minimal disruption). They also lift weights (heavy in Base, maintenance later) and use skate skiing as winter aerobic volume. Tailor work to the distance of the next relevant race (e.g. 15 km ski = VO2/speed, 50 km = long threshold and fuelling; 70.3 = sweet-spot/higher race intensity; Ironman = durability, IM power, fuelling). Warn if B/C races sit too close to an A race. You receive the profile, race calendar, recent load (CTL/ATL/TSB), readiness, completed hours and the next 14 days of planned sessions. Improve the plan conservatively (no weekly run-volume jumps > 10%). Respond ONLY with JSON:
{"summary":"<3-5 sentence assessment>","focus":["..."],"adjustments":[{"date":"YYYY-MM-DD","match_title":"<existing session title>","action":"modify|skip|add","sport":"swim|bike|run|ski|strength","title":"<new title>","duration_min":<int>,"description":"<workout with targets>","intensity":"easy|moderate|hard","reason":"<why>"}]}
At most 6 adjustments. Never modify race sessions. Only change what genuinely improves the plan.`;
function context() {
  const t = E.todayIso(), c = E.addDays(t, -28), by = {}, done = { done: 0, skipped: 0 };
  st.acts.filter(a => a.date >= c).forEach(a => by[a.sport] = +(((by[a.sport] || 0) + a.min / 60).toFixed(1)));
  st.plan.filter(p => p.date < t).forEach(p => { if (done[p.status] != null) done[p.status]++; });
  const m = metrics.slice(-28), { races, ...athlete } = st.athlete;
  return { today: t, athlete, races: upcoming().map(r => ({ ...r, type: RT[r.dist].label, days_to_go: E.diffDays(r.date, t), est_finish: E.estFinish(st.athlete, r.dist).text })),
    current_phase: (st.plan[0] || {}).phase, building_towards: (st.plan[0] || {}).targetName,
    load: { ctl_28d_ago: +m[0].ctl.toFixed(1), ctl: +m.at(-1).ctl.toFixed(1), atl: +m.at(-1).atl.toFixed(1), tsb: +m.at(-1).tsb.toFixed(1) },
    readiness: ready, hours_by_sport_last_28d: by, recent_plan_compliance: done,
    upcoming_14d: st.plan.filter(p => p.date >= t && p.date <= E.addDays(t, 14)).map(({ date, sport, title, min, desc, intensity, phase, status }) => ({ date, sport, title, duration_min: min, description: desc, intensity, phase, status })) };
}
async function callAI(messages, json) {
  const { key, endpoint, model } = st.ai;
  const url = endpoint ? `${endpoint}/openai/deployments/${encodeURIComponent(model)}/chat/completions?api-version=2024-10-21` : "https://api.openai.com/v1/chat/completions";
  const headers = { "Content-Type": "application/json", ...(endpoint ? { "api-key": key } : { Authorization: `Bearer ${key}` }) };
  const body = { messages, temperature: json ? 0.3 : 0.4, ...(endpoint ? {} : { model }), ...(json ? { response_format: { type: "json_object" } } : {}) };
  const r = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  const j = await r.json(); if (!r.ok) throw new Error(j.error?.message || r.status);
  return j.choices[0].message.content;
}
async function aiReview(btn) {
  btn.disabled = true; btn.textContent = "Coach is reviewing your data…";
  try {
    const res = JSON.parse(await callAI([{ role: "system", content: SYSTEM }, { role: "user", content: JSON.stringify(context()) }], true));
    applyAdjustments(res); st.aiResult = res; save("aiResult", res); save("plan", st.plan); toast(`${(res.adjustments || []).length} changes applied`);
  } catch (e) { toast("AI review failed: " + e.message); }
  render();
}
function applyAdjustments(res) {
  (res.adjustments || []).forEach((a, k) => {
    const note = "🤖 " + (a.reason || ""), p = st.plan.find(x => x.date === a.date && x.title === a.match_title && x.intensity !== "race");
    if (a.action === "skip" && p) { p.status = "skipped"; p.note = note; }
    else if (a.action === "modify" && p) Object.assign(p, { sport: a.sport || p.sport, title: a.title || p.title, min: +a.duration_min || p.min, desc: a.description || p.desc, intensity: a.intensity || p.intensity, note });
    else if (a.action === "add" || a.action === "modify") {
      const ref = st.plan.find(x => x.date >= a.date) || st.plan.at(-1) || {};
      st.plan.push({ id: `ai-${Date.now()}-${k}`, date: a.date, sport: a.sport || "run", title: a.title || "AI session", min: +a.duration_min || 30, desc: a.description || "", intensity: a.intensity || "easy", status: "planned", note, week: ref.week, phase: ref.phase, weekHours: ref.weekHours, targetName: ref.targetName });
    }
  });
  st.plan.sort((x, y) => x.date < y.date ? -1 : x.date > y.date ? 1 : 0);
}
async function aiChat() {
  const q = $("#chatIn").value.trim(); if (!q) return;
  st.chat.push({ role: "user", content: q }); render(); $("#chatSend").textContent = "Thinking…"; $("#chatSend").disabled = true;
  try { st.chat.push({ role: "assistant", content: await callAI([{ role: "system", content: SYSTEM.split("Respond ONLY")[0] + "Answer conversationally and concisely using the athlete's data:\n" + JSON.stringify(context()) }, ...st.chat.slice(-12)]) }); }
  catch (e) { st.chat.push({ role: "assistant", content: "Error: " + e.message }); }
  save("chat", st.chat); render();
}

/* ---------------- boot ---------------- */
recompute(); render();
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("sw.js").catch(() => {});
