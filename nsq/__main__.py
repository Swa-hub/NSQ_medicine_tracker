"""Command line: python -m nsq <command> [--data-dir DIR]

Real data (run on your own computer, it needs internet):
  python -m nsq collect             index the Alerts page + download PDFs (+ portal files you saved)
  python -m nsq build               parse -> clean -> link -> warehouse -> checks -> model -> exports
  python -m nsq all                 collect + build

Demo with invented sample data (no internet needed):
  python -m nsq demo                writes everything to data_demo/

Put the dashboard online:
  python -m nsq publish             copy the built database to site_data/ and the website data to site/
  python -m nsq site                only rebuild the website data in site/
  python -m nsq security            security audit: packages, code, secrets (run before every push)

Single stages: index, download, portal, parse, clean, link, warehouse, quality,
model, export, report, score-review
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
import time

from . import config


def _stage(name: str):
    print(f"\n== {name} ==", flush=True)
    return time.time()


def cmd_index(p, a):
    import requests

    from .scrape_index import build_index
    try:
        df = build_index(p)
    except requests.RequestException as e:
        sys.exit(f"Could not reach the CDSCO Alerts page ({e}).\n"
                 "Check your internet connection. If the site answers 403, set a browser-like "
                 "user agent: $env:NSQ_USER_AGENT = 'Mozilla/5.0' (PowerShell) or "
                 "export NSQ_USER_AGENT='Mozilla/5.0' (Mac).")
    kept = df[df["doc_type"].isin(config.DRUG_LIST_TYPES)] if len(df) else df
    print(f"Indexed {len(df)} files on the Alerts page; {len(kept)} are drug-quality lists.")


def cmd_download(p, a):
    from .download import download_all
    download_all(p, start_year=a.start_year, limit=a.limit)


def cmd_portal(p, a):
    from .portal import load_portal
    load_portal(p)


def cmd_parse(p, a):
    from .parse_pdf import parse_all
    from .portal import load_portal
    load_portal(p)
    rows, summary = parse_all(p, use_llm=a.llm)
    checks = summary["count_check"].value_counts().to_dict() if "count_check" in summary else {}
    print(f"Parsed {len(rows)} rows from {len(summary)} files. Count checks: {checks}")


def cmd_clean(p, a):
    from .clean import clean_rows
    clean_rows(p)


def cmd_link(p, a):
    from .entities import link
    m = link(p)
    print(f"{m['company_id'].nunique()} companies, {m['site_id'].nunique()} sites")


def cmd_warehouse(p, a):
    from .warehouse import build
    build(p)


def cmd_quality(p, a):
    from .quality import run_checks
    res = run_checks(p)
    print(res.to_string(index=False))
    if a.strict and (res["status"] == "FAIL").any():
        sys.exit(1)


def cmd_model(p, a):
    from .model import train_and_evaluate
    metrics = train_and_evaluate(p, horizon=a.horizon, top_k=a.top_k)
    if metrics.get("skipped"):
        print(metrics["reason"])
        return
    print(json.dumps({k: v for k, v in metrics.items() if k != "monthly"}, indent=2))


def cmd_export(p, a):
    from .export import export_all
    export_all(p)


def cmd_report(p, a):
    from .report import write_report
    path = write_report(p)
    print(f"Wrote {path}")


def cmd_score_review(p, a):
    import pandas as pd
    f = p.exports / "match_review_sample.csv"
    df = pd.read_csv(f)
    done = df["correct"].astype(str).str.lower().isin(["yes", "no", "y", "n"])
    if not done.any():
        print(f"Fill the 'correct' column in {f} with yes/no first.")
        return
    ok = df.loc[done, "correct"].astype(str).str.lower().str.startswith("y").mean()
    print(f"Matching accuracy on {int(done.sum())} hand-checked pairs: {ok:.1%}")


PUBLISH_FILES = ("model_metrics.json", "model_monthly.csv", "watch_list.csv",
                 "quality_report.csv", "findings.md")


def cmd_publish(p, a):
    """Copy what the dashboard needs into site_data/, which goes to GitHub so the
    online dashboard (Streamlit Community Cloud) can read it."""
    import shutil
    if not p.warehouse.exists():
        sys.exit("No warehouse yet. Run `python -m nsq build` first.")
    out = config.get_paths(config.ROOT / "site_data")
    if out.data.resolve() == p.data.resolve():
        sys.exit("--data-dir is already site_data.")
    out.warehouse.parent.mkdir(parents=True, exist_ok=True)
    out.exports.mkdir(parents=True, exist_ok=True)
    shutil.copy2(p.warehouse, out.warehouse)
    for f in PUBLISH_FILES:
        src, dst = p.exports / f, out.exports / f
        if src.exists():
            shutil.copy2(src, dst)
        else:
            dst.unlink(missing_ok=True)
    if p.dataset_label.exists():
        shutil.copy2(p.dataset_label, out.dataset_label)
    else:
        out.dataset_label.unlink(missing_ok=True)
    mb = out.warehouse.stat().st_size / 1e6
    from .site import build_site
    build_site(p)
    print(f"Published {config.dataset_label(p)} data to {out.data} ({mb:.1f} MB database) and site/.\n"
          "Next: git add site_data site && git commit -m \"Update data\" && git push")
    if mb > 90:
        print("Warning: GitHub rejects files over 100 MB.")


LEAK_REGEX = (r"sk-ant-[A-Za-z0-9_-]{10,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}"
                  r"|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----"
                  r"|(api[_-]?key|secret|password|token)\s*[=:]\s*['\"][^'\"\s]{8,}['\"]")


def cmd_security(p, a):
    """Run every security check: known-vulnerable packages, risky code, secrets in
    files and in git history. Needs: pip install -r requirements-dev.txt"""
    import re
    import shutil
    import subprocess  # nosec B404
    root = config.ROOT
    results = []

    def run(name, cmd):
        if shutil.which(cmd[0]) is None and cmd[0] != sys.executable:
            results.append((name, "SKIPPED", f"install it: pip install -r requirements-dev.txt"))
            return
        r = subprocess.run(cmd, cwd=root, capture_output=True, text=True)  # nosec B603
        out = (r.stdout + r.stderr).strip()
        results.append((name, "PASS" if r.returncode == 0 else "FAIL", out[-1500:]))

    print("Running security checks (this can take a minute)...")
    run("Known vulnerabilities in packages (pip-audit)",
        ["pip-audit", "-r", "requirements.txt", "--progress-spinner", "off"])
    run("Risky code patterns (bandit)", ["bandit", "-q", "-r", "nsq", "app", "flows"])

    # Secrets in the files git would publish, and in every past commit.
    in_git = (root / ".git").exists() and shutil.which("git")
    if in_git:
        files = subprocess.run(["git", "ls-files"], cwd=root, capture_output=True,  # nosec B603 B607
                               text=True).stdout.split()
        history = subprocess.run(["git", "log", "-p", "--all"], cwd=root, capture_output=True,  # nosec B603 B607
                                 text=True, errors="replace").stdout
    else:
        files = [str(f.relative_to(root)) for d in ("nsq", "app", "flows", "tests") for f in (root / d).rglob("*.py")]
        files += [f for f in ("README.md", "WALKTHROUGH.md", "requirements.txt", ".env.example") if (root / f).exists()]
        history = ""
    pat = re.compile(LEAK_REGEX, re.I)
    hits = []
    for f in files:
        fp = root / f
        if fp.suffix in {".py", ".md", ".txt", ".toml", ".json", ".csv", ".yml", ".yaml", ".cfg", ".ini", ""} \
                or fp.name.startswith(".env"):
            try:
                for i, line in enumerate(fp.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
                    if pat.search(line) and "LEAK_REGEX" not in line:
                        hits.append(f"{f}:{i}")
            except OSError:
                continue
    hist_hits = [ln[:80] for ln in history.splitlines() if ln.startswith("+") and pat.search(ln)
                 and "LEAK_REGEX" not in ln]
    results.append(("Secrets in project files", "FAIL" if hits else "PASS", ", ".join(hits[:20])))
    results.append(("Secrets in git history",
                    "SKIPPED" if not in_git else ("FAIL" if hist_hits else "PASS"),
                    "not a git folder" if not in_git else "\n".join(hist_hits[:10])))

    # Files that must never be published.
    if in_git:
        bad = [f for f in files if re.search(r"(^|/)\.env($|\.)(?!example)|secrets\.toml$|\.pem$|\.key$|"
                                             r"^data/(raw|interim|warehouse|exports)/", f)]
        results.append(("Private files tracked by git", "FAIL" if bad else "PASS", ", ".join(bad[:20])))

    for name, status, detail in results:
        print(f"\n[{status}] {name}")
        if status != "PASS" and detail:
            print("   " + detail.replace("\n", "\n   "))
    failed = [r for r in results if r[1] == "FAIL"]
    print(f"\n{len(results) - len(failed)} of {len(results)} checks passed or skipped.")
    if failed:
        sys.exit(1)


def cmd_site(p, a):
    from .site import build_site
    if not p.warehouse.exists():
        sys.exit("No warehouse yet. Run `python -m nsq build` first.")
    build_site(p)


def cmd_build(p, a):
    for name, fn in (("parse", cmd_parse), ("clean", cmd_clean), ("link", cmd_link),
                     ("warehouse", cmd_warehouse), ("quality", cmd_quality), ("model", cmd_model),
                     ("export", cmd_export), ("report", cmd_report)):
        t = _stage(name)
        fn(p, a)
        print(f"   ({time.time() - t:.1f}s)")


def cmd_collect(p, a):
    for name, fn in (("index", cmd_index), ("download", cmd_download)):
        t = _stage(name)
        fn(p, a)
        print(f"   ({time.time() - t:.1f}s)")


def cmd_all(p, a):
    cmd_collect(p, a)
    cmd_build(p, a)


def cmd_demo(p, a):
    from .sample import make_sample
    if a.data_dir is None:
        p = config.get_paths(config.ROOT / "data_demo")
    t = _stage("make sample data (invented companies)")
    print(make_sample(p.ensure()), f"({time.time() - t:.1f}s)")
    cmd_build(p, a)
    print(f"\nDemo ready in {p.data}. Start the dashboard with:\n"
          f"  streamlit run app/dashboard.py -- --data-dir {p.data}")


COMMANDS = {
    "index": cmd_index, "download": cmd_download, "portal": cmd_portal, "parse": cmd_parse,
    "clean": cmd_clean, "link": cmd_link, "warehouse": cmd_warehouse, "quality": cmd_quality,
    "model": cmd_model, "export": cmd_export, "report": cmd_report,
    "score-review": cmd_score_review, "build": cmd_build, "collect": cmd_collect,
    "all": cmd_all, "demo": cmd_demo, "publish": cmd_publish, "security": cmd_security, "site": cmd_site,
}


def main(argv=None):
    ap = argparse.ArgumentParser(prog="python -m nsq", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=COMMANDS)
    ap.add_argument("--data-dir", default=None, help="data folder (default: data/, demo: data_demo/)")
    ap.add_argument("--start-year", type=int, default=config.DEFAULT_START_YEAR)
    ap.add_argument("--limit", type=int, default=None, help="download only the N newest files (for a test run)")
    ap.add_argument("--llm", action="store_true", help="use an LLM for pages the table parser can't read")
    ap.add_argument("--horizon", type=int, default=1, help="model: predict a flag within N months")
    ap.add_argument("--top-k", type=int, default=20, help="model: size of the watch list")
    ap.add_argument("--strict", action="store_true", help="quality: exit with an error if a check fails")
    ap.add_argument("-v", "--verbose", action="store_true")
    a = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO if a.verbose else logging.WARNING,
                        format="%(levelname)s %(name)s: %(message)s")
    paths = config.get_paths(a.data_dir).ensure()
    COMMANDS[a.command](paths, a)


if __name__ == "__main__":
    main()
