# API Test Suite — Login Module

End-to-end API automation + load testing for the Login Module via API Mesh.

## Quick Start

```bash
cd api-tests

# 1. Install dependencies
pip install -r requirements.txt

# 2. Configure
cp .env.example .env
# Edit .env → set MESH_ENDPOINT to your API Mesh GraphQL URL

# 3. Run E2E tests
python run_tests.py

# 4. Run load test
python run_tests.py --load
```

## Structure

```
api-tests/
├── .env.example       # Environment config template
├── config.py          # Config loader
├── client.py          # GraphQL client with timing
├── queries.py         # All GraphQL queries/mutations
├── test_e2e.py        # E2E test scenarios
├── load_test.py       # Locust load test definitions
├── report.py          # HTML report generator
├── run_tests.py       # Unified runner CLI
└── reports/           # Generated reports (gitignored)
```

## Commands

| Command | Description |
|---------|-------------|
| `python run_tests.py` | Run E2E tests + generate HTML report |
| `python run_tests.py --load` | Run headless load test |
| `python run_tests.py --all` | E2E + load test |
| `python run_tests.py --load --users 50 --rate 10 --duration 300` | Custom load params |
| `python run_tests.py --no-report` | E2E without HTML report |
| `locust -f load_test.py --host=<MESH_URL>` | Locust Web UI (http://localhost:8089) |

## E2E Test Coverage

| Suite | Tests |
|-------|-------|
| Config | Health check, is_enabled verification |
| OTP | Generate by mobile, generate by email, validate OTP |
| Registration | Full register → OTP → validate cycle |
| Customer | Update details with token |
| Google SSO | Token exchange (if configured) |
| Negative | Empty input, invalid OTP ref, wrong OTP, no token |
| Performance | P95 < 3000ms, Avg < 2000ms thresholds |

## Load Test Traffic Pattern

| Operation | Weight | Description |
|-----------|--------|-------------|
| Generate OTP | 40% | Login flow starts |
| Validate OTP | 25% | Login completions |
| Get Config | 20% | Page load / health |
| Register | 10% | New user signup |
| Update | 5% | Profile updates |

## Reports

Reports are saved to `api-tests/reports/`:
- `report_YYYYMMDD_HHMMSS.html` — E2E test report
- `load_report_YYYYMMDD_HHMMSS.html` — Load test report
- `latest.html` — Always the most recent E2E report
- `load_*.csv` — Raw Locust CSV data

## Prerequisites

- Python 3.9+
- `otp_in_response: true` in app_config (required for automated OTP validation)
- Module `is_enabled: true`
- Test user must exist in Commerce for login flow tests

## CI/CD Integration

```yaml
# GitHub Actions example
- name: Run API Tests
  run: |
    cd api-tests
    pip install -r requirements.txt
    python run_tests.py --all --users 5 --duration 30
  env:
    MESH_ENDPOINT: ${{ secrets.MESH_ENDPOINT }}
    TEST_MOBILE: "9876543210"
```
