"""NSQ Medicine Tracker dashboard.

Run:  streamlit run app/dashboard.py -- --data-dir data_demo
      streamlit run app/dashboard.py              (real data in data/)
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

import duckdb
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from nsq import config  # noqa: E402

# Reference palette (dataviz skill): fixed categorical order, one sequential hue.
BLUE, ORANGE, AQUA = "#2a78d6", "#eb6834", "#1baf7a"
SEQ_BLUE = ["#f0efec", "#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"]
GRID = "rgba(137,135,129,0.25)"


def data_dir() -> Path:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", default=None)
    args, _ = ap.parse_known_args(sys.argv[1:])
    if args.data_dir:
        return config.get_paths(args.data_dir).data
    if os.environ.get("NSQ_DATA_DIR"):
        return config.get_paths().data
    # data/ = your local build, site_data/ = the published snapshot (used online),
    # data_demo/ = sample data
    for name in ("data", "site_data", "data_demo"):
        p = config.get_paths(ROOT / name)
        if p.warehouse.exists():
            return p.data
    return config.get_paths(ROOT / "data").data


PATHS = config.get_paths(data_dir())
st.set_page_config(page_title="NSQ Medicine Tracker", layout="wide")


# Security: the database is opened read-only with external access switched off and
# the settings locked, so no query can read or write files, reach the network,
# attach other databases or install extensions. Values typed by visitors are only
# ever passed as query parameters, never pasted into SQL.
DB_CONFIG = {"enable_external_access": False, "lock_configuration": True}
SAFE_LINK_PREFIXES = ("https://cdsco.gov.in/", "https://www.cdsco.gov.in/",
                      "https://cdscoonline.gov.in/")
SEARCH_MIN_CHARS, SEARCH_MAX_CHARS, SEARCH_MIN_INTERVAL_S = 2, 60, 1.0


@st.cache_data(show_spinner=False, max_entries=256, ttl=3600)  # bounded: unique searches can't fill memory
def q(sql: str, params: tuple, _mtime: float) -> pd.DataFrame:
    con = duckdb.connect(str(PATHS.warehouse), read_only=True, config=DB_CONFIG)
    try:
        return con.execute(sql, list(params)).df()
    finally:
        con.close()


def Q(sql: str, params: tuple = ()) -> pd.DataFrame:
    df = q(sql, tuple(params), PATHS.warehouse.stat().st_mtime)
    if "source_url" in df.columns:  # only official CDSCO links become clickable
        df = df.copy()
        df["source_url"] = df["source_url"].where(
            df["source_url"].astype(str).str.startswith(SAFE_LINK_PREFIXES), None)
    return df


def too_fast(term: str) -> bool:
    """At most one new search per SEARCH_MIN_INTERVAL_S seconds per visitor session."""
    now = time.monotonic()
    last_term, last_t = st.session_state.get("last_search", (None, -1e9))
    if term == last_term:
        return False  # same search re-rendered (e.g. clicking another tab)
    if now - last_t < SEARCH_MIN_INTERVAL_S:
        return True
    st.session_state["last_search"] = (term, now)
    return False


def like_pattern(term: str) -> str:
    """Visitor text -> LIKE pattern that matches it literally (% and _ are not wildcards)."""
    t = term.strip().lower()[:SEARCH_MAX_CHARS]
    t = t.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{t}%"


def style(fig: go.Figure, height: int = 360) -> go.Figure:
    fig.update_layout(height=height, margin=dict(l=8, r=8, t=24, b=8), bargap=0.25,
                      legend=dict(orientation="h", y=1.08, x=0, title=None),
                      font=dict(family="system-ui, -apple-system, Segoe UI, sans-serif"))
    fig.update_xaxes(showgrid=False, title=None)
    fig.update_yaxes(gridcolor=GRID, zeroline=False, title=None)
    fig.update_traces(marker_line_width=0, selector=dict(type="bar"))
    return fig


if not PATHS.warehouse.exists():
    st.error(f"No warehouse found in the '{PATHS.data.name}' folder. Run `python -m nsq demo` (sample data) or "
             "`python -m nsq all` (real data) first.")
    st.stop()

label = config.dataset_label(PATHS)
st.title("NSQ Medicine Tracker")
st.caption("Medicine batches flagged in CDSCO's monthly alerts as Not of Standard Quality (NSQ) or spurious, "
           "linked across years to the factories that made them.")
if label == "SAMPLE":
    st.warning("**Sample data.** Every company and brand here is invented, to show how the pipeline "
               "works. Run `python -m nsq all` on your computer to load the real CDSCO alerts.")

cov = Q("""SELECT min(report_month) AS a, max(report_month) AS b, count(DISTINCT report_month) AS n_months,
                  count(*) AS flags, sum(is_spurious::INT) AS spurious, count(DISTINCT site_id) AS sites,
                  count(DISTINCT company_id) AS companies, count(DISTINCT mfr_key) AS spellings
           FROM fct_flags""").iloc[0]
c1, c2, c3, c4, c5 = st.columns(5)
c1.metric("Flagged batches", f"{int(cov['flags']):,}")
c2.metric("Months covered", int(cov['n_months']), help=f"{cov['a']:%b %Y} to {cov['b']:%b %Y}")
c3.metric("Factory sites", f"{int(cov['sites']):,}")
c4.metric("Companies", f"{int(cov['companies']):,}", help=f"from {int(cov['spellings'])} different spellings")
c5.metric("Spurious (fake) batches", int(cov['spurious']))
st.caption("A flag means one tested batch failed. It is not a verdict on a company or on other batches.")

tabs = st.tabs(["Overview", "Repeat offenders", "Where", "Why", "Testing gaps", "QR brands",
                "Watch list", "Look up a batch", "Data quality"])

# ---------------------------------------------------------------- Overview
with tabs[0]:
    m = Q("SELECT report_month, section, sum(flags) AS flags FROM mart_monthly GROUP BY ALL ORDER BY 1")
    m["section"] = m["section"].map({"central": "Central labs", "state": "State labs",
                                     "spurious": "Spurious", "unknown": "Unknown"}).fillna(m["section"])
    order = ["Central labs", "State labs", "Spurious", "Unknown"]
    fig = px.bar(m, x="report_month", y="flags", color="section", category_orders={"section": order},
                 color_discrete_map={"Central labs": BLUE, "State labs": ORANGE, "Spurious": AQUA,
                                     "Unknown": "#898781"},
                 labels={"report_month": "Month", "flags": "Flagged batches", "section": "Reported by"})
    st.subheader("Flagged batches per month")
    st.plotly_chart(style(fig), width="stretch")
    st.caption("More flags can mean more testing, not worse medicines: state labs reported more over time.")

# ---------------------------------------------------------------- Repeat offenders
with tabs[1]:
    ro = Q("""SELECT site_id, company_name, state, district, months_flagged, total_flags, distinct_drugs,
                     flags_last_12m, first_flag_month, last_flag_month, spellings_seen
              FROM mart_repeat_offenders""")
    st.subheader(f"{len(ro)} factory sites flagged in 3 or more different months")
    st.dataframe(ro, hide_index=True, width="stretch",
                 column_config={"first_flag_month": st.column_config.DateColumn("first flag", format="MMM YYYY"),
                                "last_flag_month": st.column_config.DateColumn("last flag", format="MMM YYYY"),
                                "spellings_seen": st.column_config.NumberColumn(
                                    "spellings", help="how many different ways CDSCO wrote this name")})
    if len(ro):
        pick = st.selectbox("See one site's history", ro["site_id"],
                            format_func=lambda s: f"{ro.set_index('site_id').at[s, 'company_name']} ({s})")
        h = Q("""SELECT report_month, drug_name, batch_no, reason_raw, section, manufacturer_raw,
                        source_file, page, source_url
                 FROM fct_flags WHERE site_id = ? AND NOT is_spurious ORDER BY report_month""", (pick,))
        hc = h.groupby("report_month").size().rename("flags").reset_index()
        fig = px.bar(hc, x="report_month", y="flags", color_discrete_sequence=[BLUE],
                     labels={"report_month": "Month", "flags": "Flagged batches"})
        st.plotly_chart(style(fig, 240), width="stretch")
        st.dataframe(h, hide_index=True, width="stretch",
                     column_config={"source_url": st.column_config.LinkColumn("source PDF"),
                                    "report_month": st.column_config.DateColumn("month", format="MMM YYYY")})

# ---------------------------------------------------------------- Where
with tabs[2]:
    d = Q("SELECT state, district, flags, sites FROM mart_district WHERE district <> 'Unknown' LIMIT 15")
    d["place"] = d["district"] + ", " + d["state"]
    fig = px.bar(d.iloc[::-1], x="flags", y="place", orientation="h", color_discrete_sequence=[BLUE],
                 hover_data={"sites": True, "place": False},
                 labels={"flags": "Flagged batches", "place": ""})
    st.subheader("Districts where flagged factories are")
    st.plotly_chart(style(fig, 460), width="stretch")
    st.caption("Spurious batches are excluded: a fake carries an innocent company's name and address.")

# ---------------------------------------------------------------- Why
with tabs[3]:
    forms = Q("SELECT DISTINCT drug_form FROM mart_reasons ORDER BY 1")["drug_form"].tolist()
    form = st.selectbox("Dosage form", ["All"] + forms)
    r = Q("""SELECT reason_primary, sum(flags) AS flags FROM mart_reasons
             WHERE (? = 'All' OR drug_form = ?) GROUP BY 1 ORDER BY 2 DESC""", (form, form))
    fig = px.bar(r.iloc[::-1], x="flags", y="reason_primary", orientation="h",
                 color_discrete_sequence=[BLUE], labels={"flags": "Flagged batches", "reason_primary": ""})
    st.subheader("Why batches failed" + ("" if form == "All" else f" ({form})"))
    st.plotly_chart(style(fig, 380), width="stretch")
    st.caption("Assay = wrong amount of active ingredient. Dissolution = the tablet doesn't release the "
               "drug properly. Sterility and particulate matter matter most for injections.")

# ---------------------------------------------------------------- Testing gaps
with tabs[4]:
    s = Q("SELECT report_month, state, flags_reported FROM mart_state_reporting")
    st.subheader("Which states' labs appear in each month's state list")
    if s.empty:
        st.info("No state-lab lists parsed yet.")
    else:
        s["month"] = pd.to_datetime(s["report_month"]).dt.strftime("%Y-%m")
        piv = s.pivot_table(index="state", columns="month", values="flags_reported", fill_value=0)
        piv = piv.loc[piv.sum(axis=1).sort_values(ascending=False).index]
        fig = go.Figure(go.Heatmap(z=piv.values, x=piv.columns, y=piv.index, colorscale=SEQ_BLUE,
                                   xgap=2, ygap=2, colorbar=dict(title="flags"),
                                   hovertemplate="%{y}, %{x}: %{z} flags<extra></extra>"))
        st.plotly_chart(style(fig, 520), width="stretch")
        st.caption("A pale cell is a month with no failures reported by that state. It can mean no testing "
                   "or no report, not safe medicines.")
    pend = Q("SELECT report_month, state FROM mart_pending_states ORDER BY 1 DESC, 2")
    if len(pend):
        st.markdown("**States the NSQ portal listed as not yet reported**")
        pend["report_month"] = pd.to_datetime(pend["report_month"]).dt.strftime("%Y-%m")
        st.dataframe(pend.groupby("report_month")["state"].apply(", ".join).reset_index()
                     .rename(columns={"state": "pending states"}).sort_values("report_month", ascending=False),
                     hide_index=True, width="stretch")

# ---------------------------------------------------------------- QR brands
with tabs[5]:
    qr = Q("""SELECT qr_brand, sum(is_spurious::INT) AS spurious, sum((NOT is_spurious)::INT) AS nsq
              FROM mart_qr_brands WHERE report_month >= DATE '2023-08-01' GROUP BY 1 ORDER BY 2 DESC""")
    st.subheader("QR-coded top brands in alerts since QR codes became mandatory (Aug 2023)")
    if qr.empty:
        st.info("No matches. Add the official Schedule H2 brand list to data/reference/qr_brands.csv.")
    else:
        long = qr.melt(id_vars="qr_brand", value_vars=["spurious", "nsq"], var_name="kind", value_name="batches")
        long["kind"] = long["kind"].map({"spurious": "Spurious (fake)", "nsq": "Not of standard quality"})
        fig = px.bar(long, x="qr_brand", y="batches", color="kind", barmode="group",
                     color_discrete_map={"Spurious (fake)": BLUE, "Not of standard quality": ORANGE},
                     labels={"qr_brand": "", "batches": "Batches"})
        st.plotly_chart(style(fig, 340), width="stretch")
        st.caption("Brand matching uses the brand's first word, so check each row before quoting it.")
        st.dataframe(Q("""SELECT report_month, qr_brand, is_spurious, drug_name, batch_no, manufacturer_raw,
                                  reason_raw, source_url FROM mart_qr_brands
                           WHERE report_month >= DATE '2023-08-01' ORDER BY report_month DESC"""),
                     hide_index=True, width="stretch",
                     column_config={"source_url": st.column_config.LinkColumn("source PDF"),
                                    "report_month": st.column_config.DateColumn("month", format="MMM YYYY")})

# ---------------------------------------------------------------- Watch list
with tabs[6]:
    mpath = PATHS.exports / "model_metrics.json"
    mt = json.loads(mpath.read_text()) if mpath.exists() else None
    if mt is None:
        st.info("Run `python -m nsq model` to build the watch list.")
    elif mt.get("skipped"):
        st.info(mt["reason"])
    else:
        st.subheader(f"Factories most likely to be flagged in {mt['watch_list_month']}")
        a, b, c = st.columns(3)
        a.metric(f"Model: hits in top {mt['top_k']}", f"{mt['model_precision_at_k']:.0%}",
                 f"{(mt['model_precision_at_k'] - mt['baseline_precision_at_k']) * 100:+.0f} pts vs baseline")
        b.metric("Baseline (last 6 months' flags)", f"{mt['baseline_precision_at_k']:.0%}")
        c.metric("Months the model won", f"{mt['months_model_beats_baseline']} of {mt['test_months']}",
                 help=f"tied in {mt['months_tied']}")
        mm = pd.read_csv(PATHS.exports / "model_monthly.csv")
        long = mm.melt(id_vars="period", value_vars=["model_precision_at_k", "baseline_precision_at_k"],
                       var_name="who", value_name="precision")
        long["who"] = long["who"].map({"model_precision_at_k": "Model",
                                       "baseline_precision_at_k": "Baseline"})
        fig = px.line(long, x="period", y="precision", color="who", markers=True,
                      color_discrete_map={"Model": BLUE, "Baseline": ORANGE},
                      labels={"period": "Test month", "precision": f"Share of top {mt['top_k']} flagged"})
        fig.update_traces(line_width=2, marker_size=8)
        fig.update_yaxes(tickformat=".0%", range=[0, 1.05])
        st.plotly_chart(style(fig, 300), width="stretch")
        st.caption(mt["caveat"])
        wl = pd.read_csv(PATHS.exports / "watch_list.csv").head(mt["top_k"])
        st.dataframe(wl.drop(columns=["scored_for_month"]), hide_index=True, width="stretch",
                     column_config={"risk_score": st.column_config.ProgressColumn(
                         "risk score", min_value=0.0, max_value=1.0, format="%.2f")})

# ---------------------------------------------------------------- Lookup
with tabs[7]:
    term = st.text_input("Batch number, drug or manufacturer", placeholder="e.g. paracetamol or a batch number",
                         max_chars=SEARCH_MAX_CHARS).strip()
    if term and len(term) < SEARCH_MIN_CHARS:
        st.info(f"Type at least {SEARCH_MIN_CHARS} characters.")
    elif term and too_fast(term):  # simple per-visitor rate limit
        st.warning("Searching too fast. Wait a second and try again.")
    elif term:
        pat = like_pattern(term)
        res = Q("""SELECT report_month, drug_name, batch_no, manufacturer_raw, reason_raw, section,
                          is_spurious, source_file, page, source_url FROM fct_flags
                   WHERE lower(batch_no) LIKE ? ESCAPE '\\' OR lower(drug_name) LIKE ? ESCAPE '\\'
                      OR lower(manufacturer_raw) LIKE ? ESCAPE '\\'
                   ORDER BY report_month DESC LIMIT 500""", (pat, pat, pat))
        st.write(f"{len(res)} matches" + (" (first 500)" if len(res) == 500 else ""))
        st.dataframe(res, hide_index=True, width="stretch",
                     column_config={"source_url": st.column_config.LinkColumn("source PDF"),
                                    "report_month": st.column_config.DateColumn("month", format="MMM YYYY")})

# ---------------------------------------------------------------- Quality
with tabs[8]:
    qp = PATHS.exports / "quality_report.csv"
    if qp.exists():
        st.subheader("Data quality checks")
        st.dataframe(pd.read_csv(qp), hide_index=True, width="stretch")
    st.subheader("Each file: rows parsed versus the totals the PDF states")
    st.dataframe(Q("""SELECT source_file, doc_type, rows_parsed, expected_rows, count_check,
                             stated_tested, pages FROM mart_parse_quality ORDER BY source_file DESC"""),
                 hide_index=True, width="stretch")
