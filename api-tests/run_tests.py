#!/usr/bin/env python3
"""
Unified test runner for Login Module API Test Suite.

Usage:
  # Run E2E tests (default):
  python run_tests.py

  # Run E2E + generate HTML report:
  python run_tests.py --report

  # Run load test (headless):
  python run_tests.py --load

  # Run load test with custom params:
  python run_tests.py --load --users 20 --rate 5 --duration 120

  # Run E2E + load test:
  python run_tests.py --all

  # Generate report from previous load test CSV:
  python run_tests.py --load-report ./reports/load
"""

import argparse
import os
import subprocess
import sys
from pathlib import Path

# Ensure we're running from the api-tests directory
os.chdir(Path(__file__).parent)
sys.path.insert(0, str(Path(__file__).parent))

from config import Config


def run_e2e(generate_report: bool = True) -> int:
    """Run E2E test suite and optionally generate HTML report."""
    print('\n┌──────────────────────────────────────────┐')
    print('│  Running E2E API Tests                   │')
    print('└──────────────────────────────────────────┘\n')

    Config.validate()

    from test_e2e import E2ETestRunner
    from report import generate_report as gen_report

    runner = E2ETestRunner()
    result = runner.run_all()

    if generate_report:
        report_path = gen_report(
            result,
            title='E2E Test Run',
            endpoint=Config.MESH_ENDPOINT,
        )
        print(f'\n  📄 Report: {report_path}')

    return 0 if result.failed == 0 else 1


def run_load_test(users: int = None, rate: int = None, duration: int = None) -> int:
    """Run Locust load test in headless mode."""
    print('\n┌──────────────────────────────────────────┐')
    print('│  Running Load Test                       │')
    print('└──────────────────────────────────────────┘\n')

    Config.validate()

    users = users or Config.LOAD_TEST_USERS
    rate = rate or Config.LOAD_TEST_SPAWN_RATE
    duration = duration or Config.LOAD_TEST_DURATION

    reports_dir = Path(__file__).parent / 'reports'
    reports_dir.mkdir(exist_ok=True)
    csv_prefix = str(reports_dir / 'load')

    cmd = [
        sys.executable, '-m', 'locust',
        '-f', 'load_test.py',
        f'--host={Config.MESH_ENDPOINT}',
        '--headless',
        f'-u', str(users),
        f'-r', str(rate),
        f'--run-time={duration}s',
        f'--csv={csv_prefix}',
        '--csv-full-history',
    ]

    print(f'  Users: {users} | Spawn rate: {rate}/s | Duration: {duration}s')
    print(f'  Target: {Config.MESH_ENDPOINT}')
    print(f'  CSV output: {csv_prefix}_*.csv\n')

    exit_code = subprocess.call(cmd)

    # Generate load test report from CSV
    from report import generate_load_test_report
    report_path = generate_load_test_report(str(reports_dir), title='Load Test Results')
    if report_path:
        print(f'\n  📄 Load Report: {report_path}')

    return exit_code


def main():
    parser = argparse.ArgumentParser(
        description='Login Module API Test Suite Runner',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python run_tests.py              # E2E tests + report
  python run_tests.py --load       # Load test only
  python run_tests.py --all        # E2E + load test
  python run_tests.py --load --users 50 --rate 10 --duration 300
        """,
    )
    parser.add_argument('--e2e', action='store_true', help='Run E2E tests (default if no flag)')
    parser.add_argument('--load', action='store_true', help='Run load test')
    parser.add_argument('--all', action='store_true', help='Run E2E + load test')
    parser.add_argument('--no-report', action='store_true', help='Skip HTML report generation')
    parser.add_argument('--users', type=int, help='Load test: number of concurrent users')
    parser.add_argument('--rate', type=int, help='Load test: spawn rate (users/sec)')
    parser.add_argument('--duration', type=int, help='Load test: duration in seconds')
    parser.add_argument('--load-report', type=str, help='Generate report from existing CSV directory')

    args = parser.parse_args()

    # If --load-report, just generate report from CSV
    if args.load_report:
        from report import generate_load_test_report
        path = generate_load_test_report(args.load_report)
        print(f'Report: {path}')
        return 0

    # Default to E2E if no specific flag
    run_e2e_flag = args.e2e or args.all or (not args.load)
    run_load_flag = args.load or args.all

    exit_code = 0

    if run_e2e_flag:
        code = run_e2e(generate_report=not args.no_report)
        exit_code = max(exit_code, code)

    if run_load_flag:
        code = run_load_test(
            users=args.users,
            rate=args.rate,
            duration=args.duration,
        )
        exit_code = max(exit_code, code)

    return exit_code


if __name__ == '__main__':
    sys.exit(main())
