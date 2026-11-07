"""Build the data files for the static website in site/.

    python -m nsq site        (also runs as part of python -m nsq publish)

Writes two files the page reads:
  site/data.json   everything the charts need (small, loads first)
  site/flags.json  every flagged batch, for the batch lookup and factory pages
                   (loaded only when someone opens those)
"""
from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

from . import config
from .warehouse import query

SITE_DIR = config.ROOT / "site"


def _ym(s: pd.Series) -> pd.Series:
    return pd.to_datetime(s).dt.strftime("%Y-%m")


def _rows(df: pd.DataFrame) -> list:
    return df.astype(object).where(df.notna(), None).values.tolist()


def _json_default(o):
    return o.item() if hasattr(o, "item") else str(o)


def build_site(paths: config.Paths, out_dir: Path = SITE_DIR) -> dict:
    Q = lambda sql: query(paths, sql)  # noqa: E731
    d: dict = {"label": config.dataset_label(paths),
               "generated": pd.Timestamp.now().strftime("%Y-%m-%d")}

    cov = Q("""SELECT min(report_month) a, max(report_month) b, count(DISTINCT report_month) n_months,
                      count(*) n_flags, sum(is_spurious::INT) n_spurious, count(DISTINCT site_id) n_sites,
                      count(DISTINCT company_id) n_companies, count(DISTINCT mfr_key) n_spellings,
                      count(DISTINCT drug_generic) n_drugs FROM fct_flags""").iloc[0]
    d["cov"] = {"first": pd.Timestamp(cov["a"]).strftime("%Y-%m"), "last": pd.Timestamp(cov["b"]).strftime("%Y-%m"),
                "months": int(cov["n_months"]), "flags": int(cov["n_flags"]), "spurious": int(cov["n_spurious"]),
                "sites": int(cov["n_sites"]), "companies": int(cov["n_companies"]),
                "spellings": int(cov["n_spellings"]), "drugs": int(cov["n_drugs"])}

    m = Q("SELECT report_month, section, sum(flags) flags FROM mart_monthly GROUP BY ALL ORDER BY 1")
    m["month"] = _ym(m["report_month"])
    piv = m.pivot_table(index="month", columns="section", values="flags", aggfunc="sum", fill_value=0)
    d["monthly"] = {"months": list(piv.index), **{c: [int(v) for v in piv[c]] for c in piv.columns}}

    latest = Q("""SELECT drug_name, batch_no, reason_primary, company_name, mfr_state, section, is_spurious,
                         coalesce(drug_generic, drug_name) AS generic
                  FROM fct_flags WHERE report_month = (SELECT max(report_month) FROM fct_flags)
                  ORDER BY is_spurious DESC, reason_primary, drug_name""")
    distinct = latest.drop_duplicates("generic")  # different medicines, so the strip isn't one drug eight times
    nsq = distinct[~distinct["is_spurious"]]
    one_per_reason = nsq.drop_duplicates("reason_primary")  # show the range of failures, then fill up
    nsq = pd.concat([one_per_reason, nsq[~nsq.index.isin(one_per_reason.index)]])
    pick = pd.concat([distinct[distinct["is_spurious"]].head(2), nsq.head(8)]).head(8)
    pick = pick.drop(columns=["generic"])
    pick["is_spurious"] = pick["is_spurious"].astype(int)
    d["latest"] = {"month": d["cov"]["last"], "count": int(len(latest)), "rows": _rows(pick)}

    ro = Q("""SELECT site_id, company_name, state, district, months_flagged, total_flags, distinct_drugs,
                     flags_last_12m, first_flag_month, last_flag_month, spellings_seen
              FROM mart_repeat_offenders ORDER BY months_flagged DESC, total_flags DESC""")
    ro["first_flag_month"] = _ym(ro["first_flag_month"])
    ro["last_flag_month"] = _ym(ro["last_flag_month"])
    sm = Q("""SELECT site_id, report_month, count(*) n FROM fct_flags
              WHERE NOT is_spurious AND site_id IS NOT NULL GROUP BY 1, 2""")
    sm["month"] = _ym(sm["report_month"])
    by_site = {s: g.sort_values("month")[["month", "n"]].values.tolist() for s, g in sm.groupby("site_id")
               if s in set(ro["site_id"])}
    d["offenders"] = {"cols": list(ro.columns), "rows": _rows(ro), "months": by_site}

    # Where the flagged factories are, by state (fakes left out: they carry an innocent company's name).
    d["states"] = _rows(Q("""SELECT mfr_state AS state, count(*) AS flags, count(DISTINCT site_id) AS sites
                             FROM fct_flags WHERE NOT is_spurious AND mfr_state IS NOT NULL
                             GROUP BY 1 ORDER BY 2 DESC"""))
    d["districts"] = _rows(Q("""SELECT state, district, flags, sites FROM mart_district
                                WHERE district <> 'Unknown' ORDER BY flags DESC LIMIT 15"""))
    d["reasons"] = _rows(Q("SELECT drug_form, reason_primary, flags FROM mart_reasons"))

    s = Q("SELECT report_month, state, flags_reported FROM mart_state_reporting")
    if len(s):
        s["month"] = _ym(s["report_month"])
        hp = s.pivot_table(index="state", columns="month", values="flags_reported", fill_value=0)
        hp = hp.reindex(columns=d["monthly"]["months"], fill_value=0)
        hp = hp.loc[hp.sum(axis=1).sort_values(ascending=False).index]
        d["heat"] = {"states": list(hp.index), "months": list(hp.columns), "z": hp.astype(int).values.tolist()}
    else:
        d["heat"] = None
    pend = Q("SELECT report_month, state FROM mart_pending_states ORDER BY 1 DESC, 2")
    pend["report_month"] = _ym(pend["report_month"])
    d["pending"] = pend.groupby("report_month", sort=False)["state"].apply(list).reset_index().values.tolist()

    d["qr"] = _rows(Q("""SELECT qr_brand, sum(is_spurious::INT) spurious, sum((NOT is_spurious)::INT) nsq
                         FROM mart_qr_brands WHERE report_month >= DATE '2023-08-01'
                         GROUP BY 1 ORDER BY 2 DESC, 3 DESC"""))

    ex = paths.exports
    mpath = ex / "model_metrics.json"
    mt = json.loads(mpath.read_text(encoding="utf-8")) if mpath.exists() else {"skipped": True,
                                                                               "reason": "Model not run yet."}
    if mt.get("skipped"):
        d["model"] = {"skipped": True, "reason": mt.get("reason", "")}
    else:
        d["model"] = {k: mt[k] for k in ("top_k", "model_precision_at_k", "baseline_precision_at_k",
                                         "months_model_beats_baseline", "test_months", "months_tied",
                                         "watch_list_month", "caveat", "test_period")}
        mm = pd.read_csv(ex / "model_monthly.csv")
        d["model"]["monthly"] = _rows(mm[["period", "model_precision_at_k", "baseline_precision_at_k"]])
        wl = pd.read_csv(ex / "watch_list.csv").head(mt["top_k"])
        d["model"]["watch"] = _rows(wl[["rank", "company_name", "state", "district", "risk_score",
                                        "flags_6m", "total_flags", "site_id"]])

    qp = ex / "quality_report.csv"
    d["quality"] = _rows(pd.read_csv(qp).fillna("")) if qp.exists() else []
    pq = Q("SELECT count_check, count(*) n FROM mart_parse_quality GROUP BY 1")
    d["parse"] = {"files": int(pq["n"].sum()), **{r["count_check"]: int(r["n"]) for _, r in pq.iterrows()}}

    f = Q("""SELECT report_month, drug_name, batch_no, manufacturer_raw, reason_raw, reason_primary, section,
                    is_spurious, site_id, company_name, mfr_state, source_file, page
             FROM fct_flags ORDER BY report_month DESC, drug_name""")
    f["report_month"] = _ym(f["report_month"])
    f["is_spurious"] = f["is_spurious"].astype(int)
    flags = {"cols": list(f.columns), "rows": _rows(f)}

    out_dir.mkdir(parents=True, exist_ok=True)
    data_txt = json.dumps(d, separators=(",", ":"), default=_json_default)
    flags_txt = json.dumps(flags, separators=(",", ":"), default=_json_default)
    (out_dir / "data.json").write_text(data_txt, encoding="utf-8")
    (out_dir / "flags.json").write_text(flags_txt, encoding="utf-8")
    print(f"Website data written to {out_dir}: data.json {len(data_txt) / 1e3:.0f} KB, "
          f"flags.json {len(flags_txt) / 1e3:.0f} KB ({d['label']} data)")
    return d
