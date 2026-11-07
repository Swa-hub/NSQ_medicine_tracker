/* NSQ Medicine Tracker: renders site/data.json (and, on demand, site/flags.json).
   All text from the data goes in with textContent, never as HTML. */
(function () {
  "use strict";

  var SVGNS = "http://www.w3.org/2000/svg";
  var NF = new Intl.NumberFormat("en-IN");
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August",
    "September", "October", "November", "December"];
  var SECTION = { central: "Central labs", state: "State labs", spurious: "Fake (spurious)", unknown: "Not stated" };
  var REASON = {
    "assay": ["Wrong strength", "The amount of active ingredient was outside the allowed range."],
    "dissolution": ["Doesn't dissolve properly", "The tablet or capsule did not release its medicine fast enough in a test fluid."],
    "description": ["Looks wrong", "Colour, shape, smell or markings did not match what the medicine should look like."],
    "disintegration": ["Doesn't break down", "The tablet did not break apart within the time allowed."],
    "sterility": ["Not sterile", "Living microbes were found in a medicine that must be germ-free, such as an injection."],
    "uniformity / weight": ["Uneven dose", "Tablets or capsules in the batch varied too much in weight or content."],
    "identification": ["Wrong ingredient", "The test could not confirm the medicine named on the label."],
    "ph": ["Wrong pH", "The liquid was more acidic or alkaline than allowed."],
    "particulate matter": ["Visible particles", "Particles were found floating in an injection or infusion."],
    "endotoxin / microbial": ["Bacterial contamination", "Bacterial toxins or too many microbes were found."],
    "impurities": ["Too many impurities", "Unwanted substances were above the allowed limit."],
    "spurious": ["Fake (spurious)", "Not made by the company named on the label, or made to imitate another medicine."]
  };

  var D = null, FLAGS = null, flagsPromise = null, FX = {};
  var $ = function (id) { return document.getElementById(id); };
  var fmt = function (n) { return NF.format(n); };
  var pct = function (x) { return Math.round(x * 100) + "%"; };
  var mShort = function (ym) { if (!ym) return ""; var p = String(ym).split("-"); return MONTHS[+p[1] - 1].slice(0, 3) + " " + p[0]; };
  var mLong = function (ym) { if (!ym) return ""; var p = String(ym).split("-"); return MONTHS[+p[1] - 1] + " " + p[0]; };
  var css = function (v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); };
  // "Aceclofenac and Paracetamol Tablets 100 mg/325 mg (Acepar-100)" -> "Aceclofenac and Paracetamol"
  var FORM_WORD = /\s+(Tablets?|Capsules?|Injections?|Syrup|Suspension|Oral|Eye|Ear|Nasal|Gel|Cream|Ointment|Drops|Solution|Infusion|Powder|Gastro-Resistant|Prolonged|Sustained|Extended|Film|Dispersible|Chewable|IP|BP|USP)\b/i;
  var shortDrug = function (s) {
    if (!s) return "Medicine not named";
    var t = String(s).replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
    var m = t.match(FORM_WORD);
    t = m && m.index > 2 ? t.slice(0, m.index) : t;
    return t.replace(/\s+(for|with|and|in)$/i, "");
  };
  var reasonName = function (r) { return REASON[r] ? REASON[r][0] : (r ? r.charAt(0).toUpperCase() + r.slice(1) : "Not stated"); };
  var isDark = function () {
    var t = document.documentElement.getAttribute("data-theme");
    if (t === "dark") return true;
    if (t === "light") return false;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  };
  // One teal ramp for magnitude (dark site): low = near the card colour, high = bright.
  var RAMP_LIGHT = ["#0f3f40", "#13584f", "#18735f", "#1e8f70", "#26ab84", "#4cc8a0", "#8ee3c6"];
  var RAMP_DARK = RAMP_LIGHT;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function svg(tag, attrs) {
    var e = document.createElementNS(SVGNS, tag);
    for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) e.setAttribute(k, attrs[k]);
    return e;
  }
  function niceTicks(max, n) {
    n = n || 4;
    if (!(max > 0)) return [0, 1];
    var raw = max / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
    var step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
    var out = [];
    for (var v = 0; v <= max + step * 0.999; v += step) out.push(Math.round(v * 100) / 100);
    if (out[out.length - 1] < max) out.push(out[out.length - 1] + step);
    return out;
  }

  // ---------------------------------------------------------------- tooltip
  var tip = $("tip");
  function showTip(evt, head, rows) {
    tip.replaceChildren();
    tip.appendChild(el("div", "t-head", head));
    rows.forEach(function (r) {
      var row = el("div", "t-row");
      var k = el("span", r.line ? "key line" : "key");
      if (r.color) k.style.background = r.color; else k.style.visibility = "hidden";
      row.appendChild(k);
      row.appendChild(el("b", null, r.value));
      row.appendChild(el("span", null, r.label));
      tip.appendChild(row);
    });
    tip.hidden = false;
    var pad = 14, w = tip.offsetWidth, h = tip.offsetHeight;
    var x = evt.clientX + pad, y = evt.clientY + pad;
    if (x + w > window.innerWidth - 8) x = evt.clientX - w - pad;
    if (y + h > window.innerHeight - 8) y = evt.clientY - h - pad;
    tip.style.left = Math.max(8, x) + "px";
    tip.style.top = Math.max(8, y) + "px";
  }
  function hideTip() { tip.hidden = true; }
  window.addEventListener("scroll", hideTip, { passive: true });

  function legend(box, items) {
    box.replaceChildren();
    items.forEach(function (it) {
      var s = el("span");
      var k = el("i", it.line ? "key line" : "key");
      k.style.background = it.color;
      s.appendChild(k);
      s.appendChild(document.createTextNode(it.label));
      box.appendChild(s);
    });
  }
  function dataTable(box, head, rows, text) {
    box.replaceChildren();
    var wrap = el("div", "table-scroll"), t = el("table", text ? "data text" : "data"), thead = el("thead"), tr = el("tr");
    head.forEach(function (h) { tr.appendChild(el("th", null, h)); });
    thead.appendChild(tr); t.appendChild(thead);
    var tb = el("tbody");
    rows.forEach(function (r) {
      var row = el("tr");
      r.forEach(function (c) { row.appendChild(el("td", null, c)); });
      tb.appendChild(row);
    });
    t.appendChild(tb); wrap.appendChild(t); box.appendChild(wrap);
  }

  // ---------------------------------------------------------------- dashboard
  var ICONS = {
    batch: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>',
    alert: '<path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17.2v.3"/>',
    factory: '<path d="M3 20V10l5 3V10l5 3V10l5 3V4h3v16z"/><path d="M3 20h18"/>',
    layers: '<path d="M12 4l9 4.5-9 4.5-9-4.5z"/><path d="M3 13l9 4.5 9-4.5M3 17l9 4.5 9-4.5"/>',
    pill: '<rect x="3" y="8.5" width="18" height="7" rx="3.5" transform="rotate(-35 12 12)"/><path d="M9.2 8.1l5.6 7.8"/>'
  };
  function icon(name) {
    var s = document.createElementNS(SVGNS, "svg");
    s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("aria-hidden", "true");
    // Static, hard-coded icon paths (not data), so building them from markup is safe.
    var tmp = new DOMParser().parseFromString('<svg xmlns="' + SVGNS + '">' + ICONS[name] + "</svg>", "image/svg+xml");
    Array.prototype.slice.call(tmp.documentElement.childNodes).forEach(function (n) { s.appendChild(document.importNode(n, true)); });
    return s;
  }
  function lastVsPrior(arr) {
    // Sum of the last 12 months against the 12 before, as a % change (null if there isn't 24 months of data).
    if (!arr || arr.length < 24) return null;
    var sum = function (a, b) { var t = 0; for (var i = a; i < b; i++) t += arr[i]; return t; };
    var n = arr.length, last = sum(n - 12, n), prior = sum(n - 24, n - 12);
    return prior ? (last - prior) / prior : null;
  }
  function kpis() {
    var c = D.cov, M = D.monthly, n = M.months.length, box = $("kpis");
    var nsq = M.months.map(function (_, i) { return (M.central ? M.central[i] : 0) + (M.state ? M.state[i] : 0) + (M.unknown ? M.unknown[i] : 0); });
    var cards = [
      { ico: "alert", alert: true, label: "Flagged batches (NSQ)", value: fmt(c.flags - c.spurious), delta: lastVsPrior(nsq),
        note: mShort(c.first) + " to " + mShort(c.last) },
      { ico: "pill", alert: true, label: "Fake batches", value: fmt(c.spurious), delta: lastVsPrior(M.spurious || null),
        note: "Spurious, using another name" },
      { ico: "factory", label: "Manufacturers involved", value: fmt(c.companies),
        note: fmt(c.sites) + " factory sites" },
      { ico: "layers", label: "States with factories", value: fmt(D.states.length),
        note: fmt(c.drugs) + " medicines flagged" }
    ];
    box.replaceChildren();
    cards.forEach(function (k) {
      var card = el("div", "kpi" + (k.alert ? " alert" : ""));
      card.appendChild(icon(k.ico));
      var body = el("div", "kpi-body");
      body.appendChild(el("span", "kpi-label", k.label));
      var row = el("div", "kpi-row");
      row.appendChild(el("span", "kpi-value", k.value));
      if (k.delta != null) {
        var up = k.delta > 0.005, down = k.delta < -0.005;
        var d = el("span", "kpi-delta " + (up ? "up" : down ? "down" : "flat"),
          (up ? "↑ +" : down ? "↓ " : "") + (Math.round(k.delta * 1000) / 10) + "%");
        d.title = "Last 12 months against the 12 months before";
        row.appendChild(d);
      }
      body.appendChild(row);
      body.appendChild(el("span", "kpi-note", k.delta != null ? k.note + ". Change vs prior 12 months" : k.note));
      card.appendChild(body);
      box.appendChild(card);
    });
  }

  var totalRange = "12";
  function totals() {
    var M = D.monthly;
    return M.months.map(function (_, i) {
      return ["central", "state", "spurious", "unknown"].reduce(function (s, k) { return s + (M[k] ? M[k][i] : 0); }, 0);
    });
  }
  function drawTotal() {
    var box = $("chart-total");
    if (!box || !box.clientWidth) return;
    box.replaceChildren();
    var all = D.monthly.months, T = totals();
    var start = totalRange === "12" ? Math.max(0, all.length - 12) : 0;
    var months = all.slice(start), vals = T.slice(start);
    var W = Math.max(280, box.clientWidth), H = W < 560 ? 230 : 280;
    var m = { l: 40, r: 6, t: 22, b: 26 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
    var ticks = niceTicks(Math.max.apply(null, vals.concat([1]))), yMax = ticks[ticks.length - 1];
    var band = iw / months.length, bw = Math.max(2, Math.min(months.length <= 18 ? 44 : 24, band * 0.72));
    var y = function (v) { return m.t + ih - (v / yMax) * ih; };
    var teal = css("--teal");
    var g = svg("svg", { width: W, height: H, viewBox: "0 0 " + W + " " + H, role: "img",
      "aria-label": "Column chart of flagged batches per month. The numbers are in the table below." });
    var defs = svg("defs", {}), lg = svg("linearGradient", { id: "tealfade", x1: 0, x2: 0, y1: 0, y2: 1 });
    lg.appendChild(svg("stop", { offset: "0%", "stop-color": teal }));
    lg.appendChild(svg("stop", { offset: "100%", "stop-color": css("--teal-2") }));
    defs.appendChild(lg); g.appendChild(defs);
    ticks.forEach(function (t) {
      g.appendChild(svg("line", { x1: m.l, x2: W - m.r, y1: y(t), y2: y(t), stroke: t === 0 ? css("--axis") : css("--grid"), "stroke-width": 1 }));
      var tx = svg("text", { x: m.l - 8, y: y(t) + 4, "text-anchor": "end" }); tx.textContent = fmt(t); g.appendChild(tx);
    });
    var labels = months.length <= 18;
    months.forEach(function (mo, i) {
      var x0 = m.l + band * i + (band - bw) / 2, v = vals[i], yt = y(v), h = m.t + ih - yt;
      if (h > 0.5) {
        var r = Math.min(4, h, bw / 2);
        g.appendChild(svg("path", { fill: "url(#tealfade)", d: "M" + x0 + "," + (m.t + ih) + "V" + (yt + r) + "Q" + x0 + "," + yt + " " + (x0 + r) + "," + yt +
          "H" + (x0 + bw - r) + "Q" + (x0 + bw) + "," + yt + " " + (x0 + bw) + "," + (yt + r) + "V" + (m.t + ih) + "Z" }));
      }
      if (labels) { var vt = svg("text", { x: x0 + bw / 2, y: yt - 6, "text-anchor": "middle", "class": "val" }); vt.textContent = fmt(v); g.appendChild(vt); }
      var hit = svg("rect", { x: m.l + band * i, y: m.t, width: band, height: ih, fill: "transparent" });
      hit.addEventListener("pointermove", function (e) { showTip(e, mLong(mo), [{ color: teal, value: fmt(v), label: "flagged batches" }]); });
      hit.addEventListener("pointerleave", hideTip);
      g.appendChild(hit);
      var mm = +mo.split("-")[1];
      var show = labels ? true : (mm === 1 || i === 0);
      if (show) {
        var tx = svg("text", { x: m.l + band * i + band / 2, y: H - 6, "text-anchor": "middle" });
        tx.textContent = labels ? (band < 34 ? MONTHS[mm - 1].slice(0, 1) : MONTHS[mm - 1].slice(0, 3)) : mo.split("-")[0];
        g.appendChild(tx);
      }
    });
    box.appendChild(g);
    dataTable($("total-table"), ["Month", "Flagged batches"], months.map(function (mo, i) { return [mShort(mo), fmt(vals[i])]; }).reverse());
  }
  function dashChart() {
    document.querySelectorAll(".seg button").forEach(function (b) {
      b.addEventListener("click", function () {
        totalRange = b.dataset.range;
        document.querySelectorAll(".seg button").forEach(function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
        drawTotal();
      });
    });
    drawTotal();
  }

  function gridTable(table, head, rows) {
    table.replaceChildren();
    var thead = el("thead"), tr = el("tr");
    head.forEach(function (h) { var th = el("th", h.n ? "n" : null, h.label); th.scope = "col"; tr.appendChild(th); });
    thead.appendChild(tr); table.appendChild(thead);
    var tb = el("tbody");
    rows.forEach(function (r) {
      var row = el("tr");
      r.forEach(function (cell, i) {
        var td = el("td", head[i].cls || (head[i].n ? "n" : null));
        if (cell && typeof cell === "object") { td.appendChild(el("span", null, cell.main)); td.appendChild(el("small", null, cell.sub)); }
        else td.textContent = cell;
        row.appendChild(td);
      });
      tb.appendChild(row);
    });
    table.appendChild(tb);
  }
  function offendersTable() {
    var O = D.offenders, ix = {};
    O.cols.forEach(function (c, i) { ix[c] = i; });
    $("offenders-h").textContent = "Repeat-offender factories (flagged in 3+ months)";
    gridTable($("offenders-table"),
      [{ label: "#", cls: "rank" }, { label: "Manufacturer" }, { label: "State", cls: "nw" }, { label: "Months", n: 1 }, { label: "Batches", n: 1 }, { label: "Medicines", n: 1 }],
      O.rows.slice(0, 5).map(function (r, i) {
        return [String(i + 1), { main: r[ix.company_name] || "Unnamed manufacturer", sub: r[ix.district] || "" }, r[ix.state] || "",
          fmt(r[ix.months_flagged]), fmt(r[ix.total_flags]), fmt(r[ix.distinct_drugs])];
      }));
  }

  // Tile map: one square per state or union territory, placed roughly where it is.
  // (A drawn outline map is avoided on purpose: its borders would have to match India's official map.)
  var TILES = [
    ["JK", "Jammu and Kashmir", 2, 0], ["LA", "Ladakh", 3, 0],
    ["CH", "Chandigarh", 1, 1], ["PB", "Punjab", 2, 1], ["HP", "Himachal Pradesh", 3, 1], ["UK", "Uttarakhand", 4, 1], ["SK", "Sikkim", 7, 1], ["AR", "Arunachal Pradesh", 9, 1],
    ["RJ", "Rajasthan", 1, 2], ["HR", "Haryana", 2, 2], ["DL", "Delhi", 3, 2], ["UP", "Uttar Pradesh", 4, 2], ["BR", "Bihar", 5, 2], ["AS", "Assam", 8, 2], ["NL", "Nagaland", 9, 2],
    ["GJ", "Gujarat", 0, 3], ["MP", "Madhya Pradesh", 2, 3], ["CG", "Chhattisgarh", 4, 3], ["JH", "Jharkhand", 5, 3], ["WB", "West Bengal", 6, 3], ["ML", "Meghalaya", 8, 3], ["MN", "Manipur", 9, 3],
    ["DN", "Dadra and Nagar Haveli and Daman and Diu", 0, 4], ["MH", "Maharashtra", 2, 4], ["TG", "Telangana", 3, 4], ["OD", "Odisha", 5, 4], ["TR", "Tripura", 8, 4], ["MZ", "Mizoram", 9, 4],
    ["GA", "Goa", 1, 5], ["KA", "Karnataka", 2, 5], ["AP", "Andhra Pradesh", 3, 5],
    ["LD", "Lakshadweep", 0, 6], ["KL", "Kerala", 2, 6], ["TN", "Tamil Nadu", 3, 6], ["PY", "Puducherry", 4, 6], ["AN", "Andaman and Nicobar Islands", 7, 6]
  ];
  var TEAL_RAMP = ["#0f3f40", "#13584f", "#18735f", "#1e8f70", "#26ab84", "#4cc8a0", "#8ee3c6"];
  function statesMap() {
    var S = {}, max = 0;
    D.states.forEach(function (r) { S[r[0]] = { flags: r[1], sites: r[2] }; if (r[1] > max) max = r[1]; });
    var steps = niceTicks(max, 4);
    var bins = steps.slice(1);
    var colorFor = function (v) {
      if (!v) return css("--zero");
      for (var i = 0; i < bins.length; i++) if (v <= bins[i]) return TEAL_RAMP[Math.min(TEAL_RAMP.length - 1, Math.round((i + 1) * (TEAL_RAMP.length - 1) / bins.length))];
      return TEAL_RAMP[TEAL_RAMP.length - 1];
    };
    var box = $("tilemap"), cell = 40, gap = 0, cols = 10, rows = 7;
    box.replaceChildren();
    var g = svg("svg", { viewBox: "0 0 " + (cols * cell) + " " + (rows * cell), role: "img",
      "aria-label": "Tile map of flagged batches by state. The same numbers are in the table." });
    TILES.forEach(function (t) {
      var v = S[t[1]] ? S[t[1]].flags : 0, x = t[2] * cell, yy = t[3] * cell;
      var fill = colorFor(v);
      var r = svg("rect", { x: x + 2, y: yy + 2, width: cell - 4, height: cell - 4, rx: 6, fill: fill, "class": "tile" });
      r.addEventListener("pointermove", function (e) {
        showTip(e, t[1], [{ value: v ? fmt(v) : "None", label: v === 1 ? "flagged batch" : "flagged batches" }].concat(
          v ? [{ value: fmt(S[t[1]].sites), label: S[t[1]].sites === 1 ? "factory" : "factories" }] : []));
      });
      r.addEventListener("pointerleave", hideTip);
      g.appendChild(r);
      var tx = svg("text", { x: x + cell / 2, y: yy + cell / 2 + 4, "text-anchor": "middle",
        fill: v && TEAL_RAMP.indexOf(fill) >= 4 ? "#04201b" : css("--ink-2") });
      tx.textContent = t[0];
      g.appendChild(tx);
    });
    box.appendChild(g);
    var lg = el("div", "map-legend");
    var prev = 0;
    bins.slice().reverse().forEach(function (b, ri) {
      var i = bins.length - 1 - ri, lo = i === 0 ? 1 : steps[i] + 1;
      var s = el("span"), sw = el("i");
      sw.style.background = colorFor(b);
      s.appendChild(sw);
      s.appendChild(document.createTextNode(fmt(lo) + " to " + fmt(b)));
      lg.appendChild(s);
    });
    var z = el("span"), zi = el("i"); zi.style.background = css("--zero"); z.appendChild(zi); z.appendChild(document.createTextNode("None")); lg.appendChild(z);
    box.appendChild(lg);
    gridTable($("states-table"), [{ label: "State" }, { label: "Batches", n: 1 }],
      D.states.slice(0, 8).map(function (r) { return [r[0], fmt(r[1])]; }));
  }

  var searchNow = null;
  function hitCard(F, r) {
    var c = F.ix, card = el("div", "hit");
    var add = function (label, value, cls) {
      var d = el("div"); d.appendChild(el("dt", null, label));
      var dd = el("dd", cls || null);
      if (value instanceof Node) dd.appendChild(value); else dd.textContent = value;
      d.appendChild(dd); card.appendChild(d);
    };
    add("Batch No.", r[c.batch_no] || "Not given", "bno");
    add("Medicine", r[c.drug_name] ? shortDrug(r[c.drug_name]) : "Not named");
    card.lastChild.title = r[c.drug_name] || "";
    var maker = el("span", null, r[c.company_name] || r[c.manufacturer_raw] || "Not named");
    if (r[c.mfr_state]) { maker.appendChild(el("span", "when", r[c.mfr_state])); }
    add(r[c.is_spurious] ? "Name on the label" : "Manufacturer", maker);
    var wrap = el("span");
    wrap.appendChild(el("span", "pill " + (r[c.is_spurious] ? "fake" : "nsq"), r[c.is_spurious] ? "Fake (spurious)" : "NSQ (failed)"));
    wrap.appendChild(el("span", "when", (r[c.is_spurious] ? "" : reasonName(r[c.reason_primary]) + ", ") + mShort(r[c.report_month])));
    add("Status", wrap);
    return card;
  }
  function dashLookup() {
    var form = $("dash-form"), q = $("dash-q"), out = $("dash-results");
    var hint = function () {
      out.replaceChildren();
      var p = el("p", "dash-hint", "Search all " + fmt(D.cov.flags) + " flagged batches by batch number, medicine or manufacturer. Try ");
      var ex = D.latest.rows.length ? D.latest.rows[D.latest.rows.length - 1][1] : "";
      var b1 = el("button", null, "paracetamol"); b1.type = "button";
      b1.addEventListener("click", function () { q.value = "paracetamol"; run(); });
      p.appendChild(b1);
      if (ex) {
        p.appendChild(document.createTextNode(" or "));
        var b2 = el("button", null, ex); b2.type = "button";
        b2.addEventListener("click", function () { q.value = ex; run(); });
        p.appendChild(b2);
      }
      p.appendChild(document.createTextNode("."));
      out.appendChild(p);
    };
    var run = function () {
      var t = q.value.trim().toLowerCase();
      if (t.length < 2) { hint(); return; }
      out.replaceChildren(el("p", "dash-hint", "Searching..."));
      loadFlags().then(function (F) {
        var hits = [];
        for (var i = 0; i < F.rows.length; i++) if (F.hay[i].indexOf(t) >= 0) hits.push(F.rows[i]);
        out.replaceChildren();
        if (!hits.length) {
          out.appendChild(el("p", "dash-hint", "No flagged batch matches “" + q.value.trim() + "”. That only means it is not in these alerts, not that it was tested."));
          return;
        }
        hits.slice(0, 2).forEach(function (r) { out.appendChild(hitCard(F, r)); });
        var p = el("p", "dash-hint", fmt(hits.length) + (hits.length === 1 ? " match. " : " matches, newest first. "));
        if (hits.length > 2) {
          var b = el("button", null, "See all " + fmt(hits.length) + " in Search"); b.type = "button";
          b.addEventListener("click", function () { go("search"); if (searchNow) searchNow(q.value.trim()); });
          p.appendChild(b);
        }
        out.appendChild(p);
      }).catch(function () { out.replaceChildren(el("p", "dash-hint", "The batch list did not load. Check your connection and try again.")); });
    };
    form.addEventListener("submit", function (e) { e.preventDefault(); run(); });
    q.addEventListener("focus", function () { loadFlags().catch(function () {}); }, { once: true });
    hint();
  }

  // ---------------------------------------------------------------- monthly
  function monthlySeries() {
    var M = D.monthly;
    // Colour follows the entity, never its position: central blue, state orange, fakes aqua.
    var COLOR = { central: "--s1", state: "--s2", spurious: "--s3", unknown: "--muted" };
    return ["central", "state", "spurious", "unknown"].filter(function (k) { return M[k]; }).map(function (k) {
      return { key: k, name: SECTION[k], values: M[k], color: css(COLOR[k]) };
    });
  }
  function monthly() {
    var M = D.monthly, S = monthlySeries(), n = M.months.length;
    var totals = M.months.map(function (_, i) { return S.reduce(function (s, x) { return s + x.values[i]; }, 0); });
    var share = function (from, to) {
      var st = 0, all = 0;
      for (var i = from; i < to; i++) { all += totals[i]; st += (M.state ? M.state[i] : 0); }
      return all ? st / all : 0;
    };
    var sub = "Each column is one month, split by who reported the failure.";
    if (n >= 24 && M.state) {
      sub += " State labs reported " + pct(share(n - 12, n)) + " of failures in the last 12 months, against " + pct(share(0, 12)) + " in the first 12.";
    }
    $("monthly-sub").textContent = sub;
    legend($("monthly-legend"), S.map(function (s) { return { label: s.name, color: s.color }; }));
    drawMonthly();
    dataTable($("monthly-table"), ["Month"].concat(S.map(function (s) { return s.name; }), ["Total"]),
      M.months.map(function (m, i) { return [mShort(m)].concat(S.map(function (s) { return fmt(s.values[i]); }), [fmt(totals[i])]); }).reverse());
  }
  function drawMonthly() {
    var box = $("chart-monthly"), M = D.monthly, S = monthlySeries(), months = M.months;
    box.replaceChildren();
    var W = Math.max(280, box.clientWidth), H = W < 560 ? 240 : 320;
    var m = { l: 40, r: 6, t: 10, b: 28 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
    var totals = months.map(function (_, i) { return S.reduce(function (s, x) { return s + x.values[i]; }, 0); });
    var ticks = niceTicks(Math.max.apply(null, totals)), yMax = ticks[ticks.length - 1];
    var band = iw / months.length, bw = Math.max(2, Math.min(24, band * 0.7));
    var y = function (v) { return m.t + ih - (v / yMax) * ih; };
    var g = svg("svg", { width: W, height: H, viewBox: "0 0 " + W + " " + H, role: "img",
      "aria-label": "Column chart of flagged batches per month, " + mShort(months[0]) + " to " + mShort(months[months.length - 1]) + ". The numbers are in the table below." });
    ticks.forEach(function (t) {
      g.appendChild(svg("line", { x1: m.l, x2: W - m.r, y1: y(t), y2: y(t), stroke: t === 0 ? css("--axis") : css("--grid"), "stroke-width": 1 }));
      var tx = svg("text", { x: m.l - 8, y: y(t) + 4, "text-anchor": "end" }); tx.textContent = fmt(t); g.appendChild(tx);
    });
    var hl = svg("rect", { x: 0, y: m.t, width: band, height: ih, fill: css("--hover"), visibility: "hidden" });
    g.appendChild(hl);
    months.forEach(function (mo, i) {
      var cx = m.l + band * i + band / 2, acc = 0;
      var segs = S.map(function (s) { return { s: s, v: s.values[i] }; }).filter(function (x) { return x.v > 0; });
      segs.forEach(function (x, j) {
        var yTop = y(acc + x.v), yBot = y(acc) - (j > 0 ? 2 : 0);
        acc += x.v;
        var h = yBot - yTop;
        if (h < 0.5) return;
        var x0 = cx - bw / 2;
        if (j === segs.length - 1) {
          var r = Math.min(4, h, bw / 2);
          g.appendChild(svg("path", { fill: x.s.color, d: "M" + x0 + "," + yBot + "V" + (yTop + r) + "Q" + x0 + "," + yTop + " " + (x0 + r) + "," + yTop +
            "H" + (x0 + bw - r) + "Q" + (x0 + bw) + "," + yTop + " " + (x0 + bw) + "," + (yTop + r) + "V" + yBot + "Z" }));
        } else {
          g.appendChild(svg("rect", { x: x0, y: yTop, width: bw, height: h, fill: x.s.color }));
        }
      });
      var hit = svg("rect", { x: m.l + band * i, y: m.t, width: band, height: ih, fill: "transparent" });
      hit.addEventListener("pointermove", function (e) {
        hl.setAttribute("x", m.l + band * i); hl.setAttribute("visibility", "visible");
        showTip(e, mLong(mo), [{ value: fmt(totals[i]), label: "flagged in total" }].concat(
          S.map(function (s) { return { color: s.color, value: fmt(s.values[i]), label: s.name }; })));
      });
      hit.addEventListener("pointerleave", function () { hl.setAttribute("visibility", "hidden"); hideTip(); });
      g.appendChild(hit);
    });
    var every = months.length > 30 ? 12 : months.length > 12 ? 6 : 1;
    months.forEach(function (mo, i) {
      var mm = +mo.split("-")[1];
      var show = every === 12 ? mm === 1 : every === 6 ? (mm === 1 || mm === 7) : true;
      if (i === 0 && !show && every === 12) show = true;
      if (!show) return;
      var tx = svg("text", { x: m.l + band * i + band / 2, y: H - 8, "text-anchor": "middle" });
      tx.textContent = every === 12 ? mo.split("-")[0] : mShort(mo);
      g.appendChild(tx);
    });
    box.appendChild(g);
  }

  // ---------------------------------------------------------------- factories
  var factoryShown = 10;
  function factories() {
    var O = D.offenders, ix = {};
    O.cols.forEach(function (c, i) { ix[c] = i; });
    FX = ix;
    $("factories-h").textContent = fmt(O.rows.length) + " factories were flagged in 3 or more different months";
    var months = D.monthly.months, axis = $("factory-axis");
    axis.replaceChildren();
    axis.appendChild(el("span"));
    var ax = el("div", "ax");
    months.forEach(function (mo, i) {
      if (mo.split("-")[1] !== "01" && i !== 0) return;
      var s = el("span", null, mo.split("-")[0]);
      s.style.left = (months.length > 1 ? (i / (months.length - 1)) * 100 : 50) + "%";
      ax.appendChild(s);
    });
    axis.appendChild(ax);
    axis.appendChild(el("span"));
    renderFactoryList();
    var more = $("factory-more");
    more.hidden = O.rows.length <= factoryShown;
    more.textContent = "Show all " + fmt(O.rows.length) + " factories";
    more.onclick = function () { factoryShown = O.rows.length; more.hidden = true; renderFactoryList(); };
  }
  function renderFactoryList() {
    var O = D.offenders, list = $("factory-list");
    list.replaceChildren();
    O.rows.slice(0, factoryShown).forEach(function (r) {
      var li = el("li"), id = r[FX.site_id];
      var btn = el("button", "f-row");
      btn.type = "button";
      btn.setAttribute("aria-expanded", "false");
      var name = el("div", "f-name");
      name.appendChild(el("b", null, r[FX.company_name] || "Unnamed manufacturer"));
      name.appendChild(el("span", null, [r[FX.district], r[FX.state]].filter(Boolean).join(", ") || "Location not found"));
      var strip = el("div", "f-strip");
      strip.dataset.site = id;
      var num = el("div", "f-num");
      num.appendChild(el("b", null, r[FX.months_flagged] + " months"));
      num.appendChild(document.createTextNode(fmt(r[FX.total_flags]) + " batches"));
      btn.appendChild(name); btn.appendChild(strip); btn.appendChild(num);
      li.appendChild(btn);
      btn.addEventListener("click", function () { toggleFactory(li, btn, id, r); });
      list.appendChild(li);
    });
    drawStrips();
  }
  function drawStrips() {
    var months = D.monthly.months, idx = {};
    months.forEach(function (m, i) { idx[m] = i; });
    var color = css("--teal"), axisC = css("--grid");
    document.querySelectorAll(".f-strip").forEach(function (box) {
      box.replaceChildren();
      var W = Math.max(120, box.clientWidth), H = 24, pad = 6;
      var g = svg("svg", { width: W, height: H, viewBox: "0 0 " + W + " " + H, "aria-hidden": "true" });
      g.appendChild(svg("line", { x1: pad, x2: W - pad, y1: H / 2, y2: H / 2, stroke: axisC, "stroke-width": 1 }));
      (D.offenders.months[box.dataset.site] || []).forEach(function (p) {
        var i = idx[p[0]];
        if (i == null) return;
        var x = pad + (months.length > 1 ? i / (months.length - 1) : 0.5) * (W - pad * 2);
        g.appendChild(svg("circle", { cx: x, cy: H / 2, r: Math.min(7, 2.5 + Math.sqrt(p[1]) * 1.2), fill: color, "fill-opacity": 0.85 }));
      });
      box.appendChild(g);
    });
  }
  function toggleFactory(li, btn, id, r) {
    var open = li.querySelector(".f-detail");
    if (open) { open.remove(); btn.setAttribute("aria-expanded", "false"); return; }
    btn.setAttribute("aria-expanded", "true");
    var det = el("div", "f-detail");
    det.appendChild(el("p", null, "Loading this factory's batches..."));
    li.appendChild(det);
    loadFlags().then(function (F) {
      var c = F.ix, rows = F.rows.filter(function (x) { return x[c.site_id] === id && !x[c.is_spurious]; });
      det.replaceChildren();
      det.appendChild(el("p", null, fmt(rows.length) + " flagged batches, first " + mShort(r[FX.first_flag_month]) +
        ", latest " + mShort(r[FX.last_flag_month]) + ". Written " + r[FX.spellings_seen] + " different ways in CDSCO's lists."));
      var box = el("div", "numbers");
      dataTable(box, ["Month", "Medicine", "Batch", "Failed test", "Reported by"], rows.slice(0, 80).map(function (x) {
        return [mShort(x[c.report_month]), x[c.drug_name] || "", x[c.batch_no] || "", reasonName(x[c.reason_primary]), SECTION[x[c.section]] || x[c.section] || ""];
      }), true);
      det.appendChild(box);
      if (rows.length > 80) det.appendChild(el("p", null, "Showing the latest 80. Search the batch lookup for the rest."));
    }).catch(function () {
      det.replaceChildren(el("p", null, "The batch list did not load. Try again in a moment."));
    });
  }

  // ---------------------------------------------------------------- bars
  function hbars(box, items, color) {
    box.replaceChildren();
    var max = Math.max.apply(null, items.map(function (it) { return it.value; }).concat([1]));
    items.forEach(function (it) {
      var row = el("div", "bar-row");
      var lab = el("div", "bar-label", it.label);
      if (it.small) lab.appendChild(el("small", null, it.small));
      var track = el("div", "bar-track"), bar = el("div", "bar");
      bar.style.width = "calc(" + (it.value / max * 100) + "% - " + (it.value / max * 60) + "px)";
      bar.style.background = color;
      var val = el("span", "bar-val", fmt(it.value));
      track.appendChild(bar); track.appendChild(val);
      row.appendChild(lab); row.appendChild(track);
      box.appendChild(row);
    });
  }
  function where() {
    var rows = D.districts;
    if (!rows.length) { $("where-sub").textContent = "No district could be found for the flagged factories yet."; return; }
    var top = rows[0];
    $("where-sub").textContent = "Top " + rows.length + " districts by flagged batches, fakes left out. Factories in " + top[1] + ", " + top[0] +
      " account for " + fmt(top[2]) + " of them.";
    hbars($("where-bars"), rows.map(function (r) {
      return { label: r[1] + ", " + r[0], small: fmt(r[3]) + (r[3] === 1 ? " factory" : " factories"), value: r[2] };
    }), css("--teal"));
  }
  var whyForm = "All";
  function why() {
    var forms = {};
    D.reasons.forEach(function (r) { forms[r[0]] = (forms[r[0]] || 0) + r[2]; });
    var names = Object.keys(forms).sort(function (a, b) { return forms[b] - forms[a]; });
    var chips = $("why-chips");
    chips.replaceChildren();
    ["All"].concat(names).forEach(function (f) {
      var b = el("button", "chip", f === "All" ? "All forms" : f.charAt(0).toUpperCase() + f.slice(1));
      b.type = "button";
      b.setAttribute("aria-pressed", f === whyForm ? "true" : "false");
      b.addEventListener("click", function () { whyForm = f; why(); });
      chips.appendChild(b);
    });
    var agg = {};
    D.reasons.forEach(function (r) { if (whyForm === "All" || r[0] === whyForm) agg[r[1]] = (agg[r[1]] || 0) + r[2]; });
    var items = Object.keys(agg).map(function (k) { return { key: k, value: agg[k] }; })
      .sort(function (a, b) { return b.value - a.value; });
    var total = items.reduce(function (s, x) { return s + x.value; }, 0);
    $("why-sub").textContent = items.length ? "The most common failure" + (whyForm === "All" ? "" : " for " + whyForm + "s") + " is " +
      reasonName(items[0].key).toLowerCase() + ": " + pct(items[0].value / total) + " of " + fmt(total) + " flagged batches." : "No failure reasons recorded.";
    hbars($("why-bars"), items.map(function (it) { return { label: reasonName(it.key), value: it.value }; }), css("--teal"));
  }
  function glossary() {
    var box = $("glossary"), seen = {};
    box.replaceChildren();
    D.reasons.forEach(function (r) { seen[r[1]] = 1; });
    Object.keys(REASON).filter(function (k) { return seen[k]; }).forEach(function (k) {
      var d = el("div");
      d.appendChild(el("dt", null, REASON[k][0]));
      d.appendChild(el("dd", null, REASON[k][1]));
      box.appendChild(d);
    });
  }

  // ---------------------------------------------------------------- gaps
  function gaps() {
    var H = D.heat, box = $("heat");
    box.replaceChildren();
    if (!H || !H.states.length) {
      $("gaps-sub").textContent = "No state lists have been read yet.";
      $("heat-legend").replaceChildren();
      return;
    }
    var cells = 0, empty = 0, max = 0;
    H.z.forEach(function (row) { row.forEach(function (v) { cells++; if (!v) empty++; if (v > max) max = v; }); });
    $("gaps-sub").textContent = "Each row is a state's drug control lab, each square a month. In " + pct(empty / cells) +
      " of state-months no failure was reported. A blank month can mean no testing or no report, not safe medicines.";
    var ramp = isDark() ? RAMP_DARK : RAMP_LIGHT, zero = css("--zero");
    var colorFor = function (v) { return v ? ramp[Math.min(ramp.length - 1, Math.floor((v - 1) / Math.max(1, max) * ramp.length))] : zero; };
    var lg = $("heat-legend");
    lg.replaceChildren();
    lg.appendChild(document.createTextNode("Flagged batches: none"));
    var r = el("span", "ramp");
    var z = el("i"); z.style.background = zero; r.appendChild(z);
    ramp.forEach(function (c) { var i = el("i"); i.style.background = c; r.appendChild(i); });
    lg.appendChild(r);
    lg.appendChild(document.createTextNode(fmt(max) + " in a month"));
    box.style.gridTemplateColumns = "150px repeat(" + H.months.length + ", minmax(9px, 1fr))";
    H.states.forEach(function (st, si) {
      box.appendChild(el("div", "h-state", st));
      H.z[si].forEach(function (v, mi) {
        var c = el("div", "h-cell");
        c.style.background = colorFor(v);
        c.dataset.s = si; c.dataset.m = mi;
        box.appendChild(c);
      });
    });
    box.appendChild(el("div"));
    H.months.forEach(function (mo, i) {
      var a = el("div", "h-axis", mo.split("-")[1] === "01" ? mo.split("-")[0] : "");
      a.dataset.m = i;
      box.appendChild(a);
    });
    box.onpointermove = function (e) {
      var t = e.target;
      if (!t.classList || !t.classList.contains("h-cell")) { hideTip(); return; }
      var v = H.z[+t.dataset.s][+t.dataset.m];
      showTip(e, H.states[+t.dataset.s] + ", " + mShort(H.months[+t.dataset.m]),
        [{ value: v ? fmt(v) : "None", label: v === 1 ? "flagged batch reported" : "flagged batches reported" }]);
    };
    box.onpointerleave = hideTip;
    var sc = box.parentNode;
    requestAnimationFrame(function () { sc.scrollLeft = sc.scrollWidth; });  // narrow screens start at the latest months
    var pend = $("pending");
    pend.replaceChildren();
    if (D.pending && D.pending.length) {
      pend.appendChild(el("p", null, "States CDSCO's NSQ portal lists as not yet reported:"));
      D.pending.slice(0, 3).forEach(function (p) {
        var line = el("p");
        line.appendChild(el("b", null, mLong(p[0]) + ": "));
        line.appendChild(document.createTextNode(p[1].join(", ")));
        pend.appendChild(line);
      });
    }
  }

  // ---------------------------------------------------------------- fakes
  function fakes() {
    var Qr = D.qr, box = $("fakes-bars");
    box.replaceChildren();
    if (!Qr.length) {
      $("fakes-sub").textContent = "None of the brands on the QR-code list appear in the alerts yet.";
      $("fakes-legend").replaceChildren();
      return;
    }
    var fakeN = Qr.reduce(function (s, r) { return s + r[1]; }, 0), failN = Qr.reduce(function (s, r) { return s + r[2]; }, 0);
    var parts = [];
    if (fakeN) parts.push(fmt(fakeN) + " fake batches");
    if (failN) parts.push(fmt(failN) + " batches that failed a test");
    $("fakes-sub").textContent = "Since August 2023 India's top 300 brands must carry a QR code so buyers can check them. Since then, " +
      parts.join(" and ") + " carried one of these brand names. Brands are matched by their first word, so check a row before quoting it.";
    var cS = css("--s3"), cN = css("--s1");
    var series = [];
    if (fakeN) series.push({ i: 1, color: cS, label: "Fake (spurious)", word: "fake" });
    if (failN) series.push({ i: 2, color: cN, label: "Failed a test", word: "failed" });
    legend($("fakes-legend"), series.length > 1 ? series : []);
    var max = Math.max.apply(null, Qr.map(function (r) { return Math.max(r[1], r[2]); }).concat([1]));
    Qr.forEach(function (r) {
      var row = el("div", "bar-row");
      row.appendChild(el("div", "bar-label", r[0]));
      var track = el("div", "bar-track");
      series.map(function (sr) { return [r[sr.i], sr.color, sr.word]; }).forEach(function (x) {
        var line = el("div", "bar-line"), bar = el("div", "bar");
        bar.style.width = "calc(" + (x[0] / max * 100) + "% - " + (x[0] / max * 80) + "px)";
        bar.style.background = x[1];
        line.appendChild(bar);
        var v = el("span", "bar-val", fmt(x[0]) + " ");
        v.appendChild(el("small", null, x[2]));
        line.appendChild(v);
        track.appendChild(line);
      });
      row.appendChild(track);
      box.appendChild(row);
    });
  }

  // ---------------------------------------------------------------- watch list
  function watch() {
    var M = D.model, body = $("watch-body");
    body.replaceChildren();
    if (M.skipped) {
      $("watch-sub").textContent = "The model needs at least a year of alerts before it can be tested fairly. " + (M.reason || "");
      return;
    }
    $("watch-sub").textContent = "Each month a model ranks the factories already flagged at least once by how likely they are to be flagged again. Tested on " +
      M.test_months + " months it never saw, its top " + M.top_k + " held " + pct(M.model_precision_at_k) + " of factories that were flagged next, against " +
      pct(M.baseline_precision_at_k) + " for a simple rule: rank by flags in the last 6 months.";
    var tiles = el("div", "tiles");
    [[pct(M.model_precision_at_k), "model's top " + M.top_k + " flagged next month"],
      [pct(M.baseline_precision_at_k), "simple rule's top " + M.top_k],
      [M.months_model_beats_baseline + " of " + M.test_months, "test months the model won (" + M.months_tied + " tied)"]].forEach(function (t) {
      var d = el("div", "tile");
      d.appendChild(el("span", "v", t[0]));
      d.appendChild(el("span", "l", t[1]));
      tiles.appendChild(d);
    });
    body.appendChild(tiles);
    var lg = el("div", "legend");
    body.appendChild(lg);
    legend(lg, [{ label: "Model", color: css("--s1"), line: true }, { label: "Simple rule", color: css("--s2"), line: true }]);
    var ch = el("div", "chart");
    ch.id = "chart-model";
    body.appendChild(ch);
    drawModel();
    var det = el("details", "numbers");
    det.appendChild(el("summary", null, "Show the numbers"));
    var tb = el("div");
    dataTable(tb, ["Test month", "Model", "Simple rule"], M.monthly.map(function (r) { return [mShort(r[0]), pct(r[1]), pct(r[2])]; }));
    det.appendChild(tb);
    body.appendChild(det);
    body.appendChild(el("h3", null, "Most likely to be flagged in " + mLong(M.watch_list_month)));
    var ol = el("ol", "watch-list");
    M.watch.slice(0, 10).forEach(function (w) {
      var li = el("li");
      li.appendChild(el("span", "rank", "#" + w[0]));
      var who = el("div", "who");
      who.appendChild(el("b", null, w[1] || "Unnamed manufacturer"));
      who.appendChild(el("span", null, [w[3], w[2]].filter(Boolean).join(", ") + ". " + fmt(w[5]) + " batches flagged in the last 6 months"));
      li.appendChild(who);
      var meter = el("div", "meter"), track = el("div", "meter-track"), fill = el("div", "meter-fill");
      fill.style.width = (w[4] * 100).toFixed(1) + "%";
      track.appendChild(fill);
      meter.appendChild(track);
      meter.appendChild(el("span", null, pct(w[4])));
      meter.setAttribute("aria-label", "Risk score " + pct(w[4]));
      li.appendChild(meter);
      ol.appendChild(li);
    });
    body.appendChild(ol);
    body.appendChild(el("p", "note", M.caveat));
  }
  function drawModel() {
    var box = $("chart-model");
    if (!box) return;
    box.replaceChildren();
    var R = D.model.monthly, W = Math.max(280, box.clientWidth), H = 260;
    var m = { l: 44, r: 12, t: 12, b: 28 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
    var x = function (i) { return m.l + (R.length > 1 ? i / (R.length - 1) : 0.5) * iw; };
    var y = function (v) { return m.t + ih - v * ih; };
    var bg = css("--bg"), cols = [css("--s1"), css("--s2")], names = ["Model", "Simple rule"];
    var g = svg("svg", { width: W, height: H, viewBox: "0 0 " + W + " " + H, role: "img",
      "aria-label": "Line chart of the model's and the simple rule's monthly hit rate. The numbers are in the table below." });
    [0, 0.25, 0.5, 0.75, 1].forEach(function (t) {
      g.appendChild(svg("line", { x1: m.l, x2: W - m.r, y1: y(t), y2: y(t), stroke: t === 0 ? css("--axis") : css("--grid"), "stroke-width": 1 }));
      var tx = svg("text", { x: m.l - 8, y: y(t) + 4, "text-anchor": "end" }); tx.textContent = pct(t); g.appendChild(tx);
    });
    var cross = svg("line", { y1: m.t, y2: m.t + ih, stroke: css("--axis"), "stroke-width": 1, visibility: "hidden" });
    g.appendChild(cross);
    [1, 2].forEach(function (k, si) {
      var d = R.map(function (r, i) { return (i ? "L" : "M") + x(i) + "," + y(r[k]); }).join("");
      g.appendChild(svg("path", { d: d, fill: "none", stroke: cols[si], "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }));
    });
    [1, 2].forEach(function (k, si) {
      R.forEach(function (r, i) { g.appendChild(svg("circle", { cx: x(i), cy: y(r[k]), r: 4, fill: cols[si], stroke: bg, "stroke-width": 2 })); });
    });
    var step = Math.max(1, Math.ceil(R.length * 64 / iw));  // about 64px per label, so they never overlap
    R.forEach(function (r, i) {
      if (i % step) return;
      var tx = svg("text", { x: x(i), y: H - 8, "text-anchor": "middle" }); tx.textContent = mShort(r[0]); g.appendChild(tx);
    });
    var hit = svg("rect", { x: m.l, y: m.t, width: iw, height: ih, fill: "transparent" });
    hit.addEventListener("pointermove", function (e) {
      var rect = g.getBoundingClientRect(), px = e.clientX - rect.left;
      var i = Math.max(0, Math.min(R.length - 1, Math.round((px - m.l) / iw * (R.length - 1))));
      cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i)); cross.setAttribute("visibility", "visible");
      showTip(e, mLong(R[i][0]), [1, 2].map(function (k, si) { return { color: cols[si], line: true, value: pct(R[i][k]), label: names[si] }; }));
    });
    hit.addEventListener("pointerleave", function () { cross.setAttribute("visibility", "hidden"); hideTip(); });
    g.appendChild(hit);
    box.appendChild(g);
  }

  // ---------------------------------------------------------------- lookup
  function loadFlags() {
    if (!flagsPromise) {
      flagsPromise = fetch("flags.json").then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      }).then(function (j) {
        var ix = {};
        j.cols.forEach(function (c, i) { ix[c] = i; });
        j.ix = ix;
        j.hay = j.rows.map(function (r) {
          return [r[ix.batch_no], r[ix.drug_name], r[ix.manufacturer_raw], r[ix.company_name]].join(" ").toLowerCase();
        });
        FLAGS = j;
        return j;
      });
      flagsPromise.catch(function () { flagsPromise = null; });
    }
    return flagsPromise;
  }
  function lookup() {
    var q = $("q"), status = $("q-status"), list = $("q-results"), timer = null, shown = 20, lastHits = [];
    var more = el("button", "more", "Show 20 more");
    more.type = "button"; more.hidden = true;
    list.after(more);
    var tries = el("div", "tries");
    tries.appendChild(document.createTextNode("Try:"));
    var words = [];
    (D.latest.rows || []).forEach(function (r) {
      var k = shortDrug(r[0]).split(" ")[0];
      if (k.length > 3 && words.indexOf(k) < 0) words.push(k);
    });
    words = words.slice(0, 3);
    if (D.latest.rows.length && D.latest.rows[D.latest.rows.length - 1][1]) words.push(D.latest.rows[D.latest.rows.length - 1][1]);
    words.forEach(function (w) {
      var b = el("button", "chip", w);
      b.type = "button";
      b.addEventListener("click", function () { q.value = w; shown = 20; run(); });
      tries.appendChild(b);
    });
    status.before(tries);
    var draw = function (F) {
      var c = F.ix;
      list.replaceChildren();
      lastHits.slice(0, shown).forEach(function (r) {
        var li = el("li");
        li.appendChild(el("span", "r-month", mShort(r[c.report_month])));
        var drug = el("div", "r-drug");
        var name = el("b", null, r[c.drug_name] || "Medicine not named");
        if (r[c.is_spurious]) name.appendChild(el("span", "badge", "Fake"));
        drug.appendChild(name);
        drug.appendChild(el("span", null, r[c.manufacturer_raw] || ""));
        li.appendChild(drug);
        li.appendChild(el("span", "r-bno", r[c.batch_no] || "No batch number"));
        var why = el("div", "r-why", r[c.is_spurious] ? "Fake (spurious)" : reasonName(r[c.reason_primary]));
        why.appendChild(el("span", null, (SECTION[r[c.section]] || "") + (r[c.source_file] ? ". Source: " + r[c.source_file] + (r[c.page] ? ", page " + r[c.page] : "") : "")));
        li.appendChild(why);
        list.appendChild(li);
      });
      more.hidden = lastHits.length <= shown;
    };
    more.addEventListener("click", function () { shown += 20; if (FLAGS) draw(FLAGS); });
    var run = function () {
      var t = q.value.trim().toLowerCase();
      list.replaceChildren();
      more.hidden = true;
      if (!t) { status.textContent = ""; return; }
      if (t.length < 2) { status.textContent = "Type at least 2 characters."; return; }
      status.textContent = "Searching...";
      loadFlags().then(function (F) {
        if (q.value.trim().toLowerCase() !== t) return;
        var c = F.ix, hits = [];
        for (var i = 0; i < F.rows.length; i++) if (F.hay[i].indexOf(t) >= 0) hits.push(F.rows[i]);
        status.textContent = hits.length ? fmt(hits.length) + (hits.length === 1 ? " flagged batch matches, newest first." : " flagged batches match, newest first.") :
          "No flagged batch matches “" + q.value.trim() + "”. That only means it is not in these alerts, not that the medicine was tested.";
        lastHits = hits;
        draw(F);
      }).catch(function () { status.textContent = "The batch list did not load. Check your connection and try again."; });
    };
    q.addEventListener("input", function () { clearTimeout(timer); shown = 20; timer = setTimeout(run, 180); });
    searchNow = function (term) { q.value = term; shown = 20; run(); };
    q.addEventListener("focus", function () { loadFlags().catch(function () {}); }, { once: true });
  }

  // ---------------------------------------------------------------- method + footer
  function method() {
    var box = $("quality");
    box.replaceChildren();
    var P = D.parse || {};
    var li0 = el("li");
    li0.appendChild(el("span", "ok", "✓"));
    li0.appendChild(el("span", null, fmt(P.files || 0) + " lists read. " + fmt(P.ok || 0) + " of the " + fmt((P.ok || 0) + (P.mismatch || 0)) +
      " that state their totals matched them exactly."));
    box.appendChild(li0);
    D.quality.filter(function (r) { return r[0] !== "rows match stated totals"; }).slice(0, 8).forEach(function (r) {
      var li = el("li"), pass = r[1] === "PASS";
      li.appendChild(el("span", pass ? "ok" : "warn", pass ? "✓" : "!"));
      li.appendChild(el("span", null, r[0].charAt(0).toUpperCase() + r[0].slice(1) + ": " + r[2] + (pass ? "" : " (" + r[1].toLowerCase() + ")")));
      box.appendChild(li);
    });
    $("foot-text").textContent = "Data from CDSCO's monthly drug alerts, " + mLong(D.cov.first) + " to " + mLong(D.cov.last) +
      ". Updated " + D.generated + ". Built with Python, DuckDB and scikit-learn." +
      (D.label === "SAMPLE" ? " This copy shows invented sample data." : "");
  }

  // ---------------------------------------------------------------- views
  var VIEWS = ["dashboard", "analysis", "search", "about"], done = {}, current = null;
  var RENDER = {
    dashboard: function () { kpis(); dashChart(); dashLookup(); offendersTable(); statesMap(); },
    analysis: function () { monthly(); factories(); where(); why(); glossary(); gaps(); fakes(); watch(); },
    search: function () { lookup(); },
    about: function () { method(); }
  };
  function go(view, scrollTo) {
    if (VIEWS.indexOf(view) < 0) view = "dashboard";
    VIEWS.forEach(function (v) { $("view-" + v).hidden = v !== view; });
    document.querySelectorAll(".tab").forEach(function (t) {
      if (t.dataset.view === view) t.setAttribute("aria-current", "page"); else t.removeAttribute("aria-current");
    });
    if (!done[view]) { done[view] = true; RENDER[view](); }
    current = view;
    hideTip();
    try { history.replaceState(null, "", "#" + view); } catch (e) { /* ignore */ }
    var target = scrollTo && $(scrollTo);
    if (target) target.scrollIntoView({ block: "start" }); else window.scrollTo(0, 0);
  }
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("[data-view]");
    if (!a) return;
    e.preventDefault();
    go(a.dataset.view, a.dataset.scroll);
  });

  // ---------------------------------------------------------------- boot
  function renderAll() {
    $("sample-note").hidden = D.label !== "SAMPLE";
    $("about-lede").textContent = "Every month India's drug regulator, CDSCO, lists the medicine batches its labs found not of standard quality, or fake. This site joins every list from " +
      mLong(D.cov.first) + " to " + mLong(D.cov.last) + " and traces each batch back to the factory that made it.";
    method();
    done.about = true;
    var start = (location.hash || "").slice(1);
    go(VIEWS.indexOf(start) >= 0 ? start : "dashboard");
  }
  var resizeTimer = null;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (!D) return;
      if (done.dashboard) drawTotal();
      if (done.analysis) { drawMonthly(); drawStrips(); drawModel(); }
    }, 150);
  });

  fetch("data.json").then(function (r) {
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }).then(function (d) { D = d; renderAll(); }).catch(function () { $("load-error").hidden = false; });
})();
