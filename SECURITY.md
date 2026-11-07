# Security

NSQ Medicine Tracker is a **public, read-only dashboard over public government data**. It has no user accounts, no logins, no forms that save anything, and no API. That shapes what "secure" means here: the main risks are leaking a key through GitHub, letting the one search box run unintended SQL, letting the downloader be pointed at other sites, and shipping packages with known holes. All of those are covered below.

Run the full audit any time, and before every push:

```
pip install -r requirements-dev.txt
python -m nsq security
```

It checks known-vulnerable packages (pip-audit), risky code (bandit), secrets in the files git publishes, secrets anywhere in git history, and private files tracked by git. It exits with an error if anything fails.

## Audit results (October 2026)

| Check | Result | What was done |
|---|---|---|
| API keys hidden | PASS | The only key (Anthropic, optional, for `--llm`) is read from the `ANTHROPIC_API_KEY` environment variable by the SDK. It is never written to code, logs or output files. The online dashboard needs no key at all. |
| Environment variables | PASS | All five are listed in `.env.example` (no real values). `NSQ_REQUEST_DELAY` is now validated: a bad value falls back to 3 s, and it can never go below 1 s. |
| Admin routes | Not applicable | There are none. The dashboard has no admin pages, settings or write actions. Developer menu options are hidden from visitors (`toolbarMode = "viewer"`). |
| Authentication | Not applicable | Deliberately public: the data is CDSCO's own public alerts. Adding a login would protect nothing. |
| User access | Not applicable | One access level: read-only. The database is opened `read_only=True`. |
| Sanitise forms | FIXED | The batch lookup box (the only text input) is limited to 60 characters, needs at least 2, and is passed to SQL only as a parameter. `%` and `_` are escaped, so they are searched literally. |
| SQL injection | FIXED | Before: visitor text was pasted into SQL with only quote-doubling. Now every query that uses a visitor's choice is parameterised (`?`). Tested with `x' OR 1=1 --` and `'; SELECT * FROM read_text('/etc/passwd') --`: both return 0 rows, no error. |
| Database access | FIXED | The dashboard opens DuckDB read-only with `enable_external_access = false` and `lock_configuration = true`. Even a crafted query cannot read or write files, reach the network, attach another database, install extensions or switch these settings back (all tested). |
| XSS | PASS | No `unsafe_allow_html` anywhere. Tables and charts render data as text, so `<script>` in the data shows as plain text (tested). "Source PDF" links are only clickable if they start with `https://cdsco.gov.in/` or `https://cdscoonline.gov.in/`. |
| Rate limiting | ADDED | One new search per second per visitor. Query results are cached with a cap (256 entries, 1 hour), so a flood of unique searches cannot fill the server's memory. Each search returns at most 500 rows. Streamlit Community Cloud also limits each app's resources. |
| API endpoints | Not applicable | There is no API. The downloader's outbound requests are restricted (next row). |
| Outbound requests | FIXED | The downloader only fetches HTTPS URLs on `cdsco.gov.in` and `cdscoonline.gov.in` (an `http://` CDSCO link is upgraded). A link page or redirect pointing anywhere else is refused, and files over 100 MB are refused. It waits at least 1 s between requests. |
| CORS | PASS | `enableCORS = true` and `enableXsrfProtection = true` in `.streamlit/config.toml`. Tested: a request from another origin gets no `Access-Control-Allow-Origin` header, so browsers block other sites from reading responses. |
| Security headers | Limited | Streamlit does not let an app set its own HTTP headers. On Streamlit Community Cloud the platform's servers decide them. For full control (CSP, HSTS, frame options) you would host behind a reverse proxy such as Nginx or Cloudflare. For a read-only public dashboard with no logins or actions this is low risk. |
| Debug mode off | FIXED | `showErrorDetails = "none"` and `showErrorLinks = false`: visitors see a generic error, never a traceback or file path. The "no warehouse" message no longer shows the server's folder path. Full errors still go to the terminal / Cloud logs. |
| Dependencies updated | FIXED | Minimum versions raised to the first releases with no known vulnerabilities (pip-audit): requests 2.33.0 (CVE-2024-35195, CVE-2024-47081, CVE-2026-25645), lxml 6.1.0 (CVE-2026-41066), pdfminer.six 20251230 (CVE-2025-64512, CVE-2025-70559), pyarrow 23.0.1 (CVE-2024-52338, CVE-2026-25087), duckdb 1.1.0 (CVE-2024-41672), scikit-learn 1.5.0 (CVE-2024-5206), streamlit 1.54.0 (CVE-2026-33682, CVE-2026-10804), pytest 9.0.3 (CVE-2025-71176). The old minimums allowed versions with 13 known vulnerabilities. |
| Unused packages | CHECKED | None are unused. `pyarrow` (parquet files) and `lxml` (HTML parser) are used indirectly. `pytest` moved to `requirements-dev.txt` because only the tests need it. |
| Exposed files | PASS | Requests for code, config, `.env.example` and the database files over HTTP all return the normal app page, not the file. Static file serving is off and uploads are capped at 1 MB (there is no uploader). The published database contains no local file paths. |
| Password hashing | Not applicable | No passwords are stored anywhere. |
| Git secrets | PASS | The public repo (all commits) was scanned with detect-secrets and a pattern search: no keys, tokens, passwords, emails or local paths. `.gitignore` now also blocks `.env.*`, `.streamlit/secrets.toml`, `*.pem`, `*.key` and credential files. |
| Static code analysis | PASS | bandit: 0 issues. Five flagged lines were reviewed and marked with the reason (table names from fixed lists, `random` used only for sampling, an optional heading search). |

## Reporting a problem

Open an issue on the GitHub repository. Please do not include working exploit details in a public issue.
