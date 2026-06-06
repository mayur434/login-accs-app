"""
HTML Report Generator for API test results.

Generates a detailed, self-contained HTML report with:
  - Executive summary (pass/fail/skip counts)
  - Response time distribution chart (inline SVG)
  - Per-suite breakdown table
  - Individual test details
  - Performance metrics (avg, p50, p95, p99)
  - Failure analysis
"""

import os
import time
from datetime import datetime
from pathlib import Path
from typing import List

# Attempt to use Jinja2 for templating, fall back to string formatting
try:
    from jinja2 import Template
    HAS_JINJA = True
except ImportError:
    HAS_JINJA = False


REPORT_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>API Test Report — {{ title }}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0d1117; color: #c9d1d9; padding: 24px; }
  .container { max-width: 1200px; margin: 0 auto; }
  h1 { color: #58a6ff; margin-bottom: 8px; font-size: 24px; }
  h2 { color: #79c0ff; margin: 24px 0 12px; font-size: 18px; border-bottom: 1px solid #21262d; padding-bottom: 8px; }
  .meta { color: #8b949e; font-size: 13px; margin-bottom: 24px; }
  
  .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 16px; margin-bottom: 24px; }
  .summary-card { background: #161b22; border: 1px solid #21262d; border-radius: 8px; padding: 16px; text-align: center; }
  .summary-card .value { font-size: 28px; font-weight: 700; }
  .summary-card .label { font-size: 12px; color: #8b949e; margin-top: 4px; }
  .passed .value { color: #3fb950; }
  .failed .value { color: #f85149; }
  .skipped .value { color: #d29922; }
  .time .value { color: #58a6ff; }
  
  .status-bar { height: 8px; border-radius: 4px; background: #21262d; margin-bottom: 24px; overflow: hidden; display: flex; }
  .status-bar .pass { background: #3fb950; }
  .status-bar .fail { background: #f85149; }
  .status-bar .skip { background: #d29922; }
  
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid #21262d; font-size: 13px; }
  th { background: #161b22; color: #8b949e; font-weight: 600; text-transform: uppercase; font-size: 11px; }
  tr:hover { background: #161b22; }
  
  .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; }
  .badge-pass { background: rgba(63,185,80,0.15); color: #3fb950; }
  .badge-fail { background: rgba(248,81,73,0.15); color: #f85149; }
  .badge-skip { background: rgba(210,153,34,0.15); color: #d29922; }
  
  .error-text { color: #f85149; font-size: 12px; max-width: 400px; word-break: break-word; }
  .time-text { color: #58a6ff; font-variant-numeric: tabular-nums; }
  
  .perf-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px; margin-bottom: 24px; }
  .perf-card { background: #161b22; border: 1px solid #21262d; border-radius: 6px; padding: 12px; text-align: center; }
  .perf-card .metric { font-size: 20px; font-weight: 700; color: #58a6ff; }
  .perf-card .label { font-size: 11px; color: #8b949e; margin-top: 2px; }
  
  .failures { background: rgba(248,81,73,0.05); border: 1px solid rgba(248,81,73,0.2); border-radius: 8px; padding: 16px; margin-top: 16px; }
  .failures h3 { color: #f85149; margin-bottom: 12px; font-size: 14px; }
  .failure-item { padding: 8px 0; border-bottom: 1px solid #21262d; }
  .failure-item:last-child { border-bottom: none; }
  .failure-item .name { font-weight: 600; color: #c9d1d9; }
  .failure-item .suite { color: #8b949e; font-size: 12px; }
  .failure-item .reason { color: #f85149; font-size: 12px; margin-top: 4px; }
  
  .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #21262d; color: #484f58; font-size: 12px; text-align: center; }
</style>
</head>
<body>
<div class="container">
  <h1>🧪 API Test Report</h1>
  <div class="meta">
    <strong>{{ title }}</strong> | Generated: {{ timestamp }} | Duration: {{ duration }}s | Endpoint: {{ endpoint }}
  </div>
  
  <!-- Summary Cards -->
  <div class="summary-grid">
    <div class="summary-card"><div class="value">{{ total }}</div><div class="label">Total Tests</div></div>
    <div class="summary-card passed"><div class="value">{{ passed }}</div><div class="label">Passed</div></div>
    <div class="summary-card failed"><div class="value">{{ failed }}</div><div class="label">Failed</div></div>
    <div class="summary-card skipped"><div class="value">{{ skipped }}</div><div class="label">Skipped</div></div>
    <div class="summary-card time"><div class="value">{{ pass_rate }}%</div><div class="label">Pass Rate</div></div>
  </div>
  
  <!-- Status Bar -->
  <div class="status-bar">
    <div class="pass" style="width: {{ pass_pct }}%"></div>
    <div class="fail" style="width: {{ fail_pct }}%"></div>
    <div class="skip" style="width: {{ skip_pct }}%"></div>
  </div>
  
  <!-- Performance Metrics -->
  <h2>⚡ Performance Metrics</h2>
  <div class="perf-grid">
    <div class="perf-card"><div class="metric">{{ avg_ms }}ms</div><div class="label">Average</div></div>
    <div class="perf-card"><div class="metric">{{ p50_ms }}ms</div><div class="label">P50 (Median)</div></div>
    <div class="perf-card"><div class="metric">{{ p95_ms }}ms</div><div class="label">P95</div></div>
    <div class="perf-card"><div class="metric">{{ p99_ms }}ms</div><div class="label">P99</div></div>
    <div class="perf-card"><div class="metric">{{ min_ms }}ms</div><div class="label">Min</div></div>
    <div class="perf-card"><div class="metric">{{ max_ms }}ms</div><div class="label">Max</div></div>
  </div>
  
  <!-- Results Table -->
  <h2>📋 Test Results</h2>
  <table>
    <thead>
      <tr><th>Status</th><th>Suite</th><th>Test Name</th><th>Response Time</th><th>Error</th></tr>
    </thead>
    <tbody>
      {% for r in results %}
      <tr>
        <td><span class="badge badge-{{ r.badge }}">{{ r.status }}</span></td>
        <td>{{ r.suite }}</td>
        <td>{{ r.name }}</td>
        <td class="time-text">{{ r.time_display }}</td>
        <td class="error-text">{{ r.error or '' }}</td>
      </tr>
      {% endfor %}
    </tbody>
  </table>
  
  <!-- Suite Breakdown -->
  <h2>📊 Suite Breakdown</h2>
  <table>
    <thead>
      <tr><th>Suite</th><th>Total</th><th>Passed</th><th>Failed</th><th>Avg Response</th></tr>
    </thead>
    <tbody>
      {% for s in suites %}
      <tr>
        <td>{{ s.name }}</td>
        <td>{{ s.total }}</td>
        <td style="color: #3fb950;">{{ s.passed }}</td>
        <td style="color: {{ '#f85149' if s.failed > 0 else '#8b949e' }};">{{ s.failed }}</td>
        <td class="time-text">{{ s.avg_ms }}ms</td>
      </tr>
      {% endfor %}
    </tbody>
  </table>
  
  {% if failures %}
  <!-- Failure Details -->
  <h2>❌ Failure Details</h2>
  <div class="failures">
    {% for f in failures %}
    <div class="failure-item">
      <div class="name">{{ f.name }}</div>
      <div class="suite">Suite: {{ f.suite }}</div>
      <div class="reason">{{ f.error }}</div>
    </div>
    {% endfor %}
  </div>
  {% endif %}
  
  <div class="footer">
    Login Module API Test Suite | Report generated by api-tests/report.py
  </div>
</div>
</body>
</html>"""


def _percentile(sorted_values: list, pct: float) -> float:
    """Calculate percentile from sorted list."""
    if not sorted_values:
        return 0
    idx = int(len(sorted_values) * pct)
    return sorted_values[min(idx, len(sorted_values) - 1)]


def generate_report(suite_result, title: str = 'E2E Test Run', endpoint: str = '') -> str:
    """
    Generate HTML report from SuiteResult.

    Args:
        suite_result: SuiteResult from test_e2e.py
        title: Report title
        endpoint: API endpoint tested

    Returns:
        Path to generated HTML report file.
    """
    results = suite_result.results
    total = len(results)
    passed = sum(1 for r in results if r.passed)
    failed = sum(1 for r in results if not r.passed and r.error and 'Skipped' not in r.error)
    skipped = sum(1 for r in results if r.error and 'Skipped' in str(r.error))

    # Response times
    times = sorted([r.response_time_ms for r in results if r.response_time_ms > 0])
    avg_ms = int(sum(times) / len(times)) if times else 0
    p50_ms = int(_percentile(times, 0.50))
    p95_ms = int(_percentile(times, 0.95))
    p99_ms = int(_percentile(times, 0.99))
    min_ms = int(times[0]) if times else 0
    max_ms = int(times[-1]) if times else 0

    pass_rate = round((passed / total * 100) if total > 0 else 0, 1)
    pass_pct = (passed / total * 100) if total > 0 else 0
    fail_pct = (failed / total * 100) if total > 0 else 0
    skip_pct = (skipped / total * 100) if total > 0 else 0

    # Build results list for template
    template_results = []
    for r in results:
        is_skip = r.error and 'Skipped' in str(r.error)
        if r.passed:
            badge, status_text = 'pass', 'PASS'
        elif is_skip:
            badge, status_text = 'skip', 'SKIP'
        else:
            badge, status_text = 'fail', 'FAIL'

        template_results.append({
            'badge': badge,
            'status': status_text,
            'suite': r.suite,
            'name': r.name,
            'time_display': f'{r.response_time_ms:.0f}ms' if r.response_time_ms > 0 else '—',
            'error': r.error,
        })

    # Suite breakdown
    suite_names = list(dict.fromkeys(r.suite for r in results))  # preserve order
    suites = []
    for name in suite_names:
        suite_results = [r for r in results if r.suite == name]
        s_times = [r.response_time_ms for r in suite_results if r.response_time_ms > 0]
        suites.append({
            'name': name,
            'total': len(suite_results),
            'passed': sum(1 for r in suite_results if r.passed),
            'failed': sum(1 for r in suite_results if not r.passed),
            'avg_ms': int(sum(s_times) / len(s_times)) if s_times else 0,
        })

    # Failures
    failures = [
        {'name': r.name, 'suite': r.suite, 'error': r.error}
        for r in results
        if not r.passed and r.error and 'Skipped' not in r.error
    ]

    # Render
    context = {
        'title': title,
        'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'duration': f'{suite_result.duration_s:.2f}',
        'endpoint': endpoint,
        'total': total,
        'passed': passed,
        'failed': failed,
        'skipped': skipped,
        'pass_rate': pass_rate,
        'pass_pct': pass_pct,
        'fail_pct': fail_pct,
        'skip_pct': skip_pct,
        'avg_ms': avg_ms,
        'p50_ms': p50_ms,
        'p95_ms': p95_ms,
        'p99_ms': p99_ms,
        'min_ms': min_ms,
        'max_ms': max_ms,
        'results': template_results,
        'suites': suites,
        'failures': failures,
    }

    if HAS_JINJA:
        html = Template(REPORT_TEMPLATE).render(**context)
    else:
        # Fallback: simple string replacement (limited but functional)
        html = _fallback_render(REPORT_TEMPLATE, context)

    # Write report
    reports_dir = Path(__file__).parent / 'reports'
    reports_dir.mkdir(exist_ok=True)
    timestamp_str = datetime.now().strftime('%Y%m%d_%H%M%S')
    report_path = reports_dir / f'report_{timestamp_str}.html'
    report_path.write_text(html, encoding='utf-8')

    # Also write latest symlink
    latest_path = reports_dir / 'latest.html'
    latest_path.write_text(html, encoding='utf-8')

    return str(report_path)


def _fallback_render(template: str, context: dict) -> str:
    """Simple fallback renderer when Jinja2 is not available."""
    html = template

    # Replace simple variables
    for key, value in context.items():
        if isinstance(value, (str, int, float)):
            html = html.replace('{{ ' + key + ' }}', str(value))

    # Strip Jinja blocks (won't render loops/conditionals — just remove them)
    import re
    html = re.sub(r'\{%.*?%\}', '', html)
    html = re.sub(r'\{\{.*?\}\}', '', html)

    # Add a note about limited rendering
    html = html.replace(
        '</body>',
        '<p style="color:#d29922;text-align:center;margin:16px;">Note: Install jinja2 for full report rendering (pip install jinja2)</p></body>'
    )
    return html


def generate_load_test_report(csv_dir: str, title: str = 'Load Test Results') -> str:
    """
    Generate HTML report from Locust CSV output files.

    Args:
        csv_dir: Directory containing Locust CSV output (*_stats.csv, *_stats_history.csv)
        title: Report title

    Returns:
        Path to generated HTML report file.
    """
    import csv as csv_mod

    csv_path = Path(csv_dir)
    stats_file = None
    for f in csv_path.glob('*_stats.csv'):
        stats_file = f
        break

    if not stats_file:
        print(f'No *_stats.csv found in {csv_dir}')
        return ''

    rows = []
    with open(stats_file, 'r') as f:
        reader = csv_mod.DictReader(f)
        for row in reader:
            rows.append(row)

    # Build a simple HTML table from CSV
    reports_dir = Path(__file__).parent / 'reports'
    reports_dir.mkdir(exist_ok=True)

    timestamp_str = datetime.now().strftime('%Y%m%d_%H%M%S')
    report_path = reports_dir / f'load_report_{timestamp_str}.html'

    html_rows = ''
    for row in rows:
        name = row.get('Name', row.get('name', ''))
        reqs = row.get('Request Count', row.get('# Requests', '0'))
        fails = row.get('Failure Count', row.get('# Failures', '0'))
        avg = row.get('Average Response Time', row.get('Average response time', '0'))
        p95 = row.get('95%', row.get('95% response time', '0'))
        p99 = row.get('99%', row.get('99% response time', '0'))

        html_rows += f'<tr><td>{name}</td><td>{reqs}</td><td>{fails}</td><td>{avg}ms</td><td>{p95}ms</td><td>{p99}ms</td></tr>\n'

    html = f"""<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>{title}</title>
<style>
body {{ font-family: -apple-system, sans-serif; background: #0d1117; color: #c9d1d9; padding: 24px; }}
h1 {{ color: #58a6ff; }} table {{ width: 100%; border-collapse: collapse; margin-top: 16px; }}
th, td {{ padding: 10px; text-align: left; border-bottom: 1px solid #21262d; font-size: 13px; }}
th {{ background: #161b22; color: #8b949e; }}
</style></head><body>
<h1>🔥 Load Test Report</h1>
<p>Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} | Source: {stats_file.name}</p>
<table>
<thead><tr><th>Endpoint</th><th>Requests</th><th>Failures</th><th>Avg</th><th>P95</th><th>P99</th></tr></thead>
<tbody>{html_rows}</tbody>
</table>
</body></html>"""

    report_path.write_text(html, encoding='utf-8')
    return str(report_path)
