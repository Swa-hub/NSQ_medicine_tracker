"""Runs the whole demo pipeline on the sample data: python -m pytest -m slow"""
import json

import pandas as pd
import pytest

from nsq.__main__ import main


@pytest.mark.slow
def test_demo_pipeline(tmp_path):
    main(["demo", "--data-dir", str(tmp_path)])
    q = pd.read_csv(tmp_path / "exports" / "quality_report.csv")
    assert not (q["status"] == "FAIL").any(), q.to_string()
    m = json.loads((tmp_path / "exports" / "model_metrics.json").read_text())
    assert m["dataset"] == "SAMPLE"
    assert 0 <= m["model_precision_at_k"] <= 1
    assert (tmp_path / "exports" / "powerbi" / "fct_flags.csv").exists()
    assert "SAMPLE DATA" in (tmp_path / "exports" / "findings.md").read_text()
    # The website data builds from the same warehouse and has every section the page reads.
    from nsq import config
    from nsq.site import build_site
    out = tmp_path / "site_out"
    d = build_site(config.get_paths(tmp_path), out_dir=out)
    for key in ("cov", "monthly", "latest", "offenders", "states", "districts", "reasons", "heat", "qr", "model", "quality", "parse"):
        assert key in d, key
    assert d["label"] == "SAMPLE" and d["cov"]["flags"] > 0 and d["latest"]["rows"]
    flags = json.loads((out / "flags.json").read_text())
    assert len(flags["rows"]) == d["cov"]["flags"]
