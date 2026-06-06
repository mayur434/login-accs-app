"""
End-to-End API Test Suite for Login Module via API Mesh.

Tests ALL GraphQL operations:
  LoginModule:
    1. Config health check (getConfig)
    2. Update Config (updateConfig)
    3. Init Identity (initIdentity)
    4. Generate OTP by mobile
    5. Generate OTP by email
    6. Validate OTP → get customer_token
    7. Customer registration flow (register → OTP → validate)
    8. Customer update flow
    9. Google SSO (if configured)
    10. Delete Config (deleteConfig) — restore original
  Commerce Proxy:
    11. storeConfig
    12. categories
    13. cmsPage
    14. customer (auth required)
  Negative/Edge Cases:
    15. Empty input, invalid OTP, unauthorized access

Each test records: pass/fail, response time, status code, errors.
"""

import time
import sys
from dataclasses import dataclass, field
from typing import List, Optional
from config import Config
from client import MeshClient, GraphQLResponse
from queries import (
    GET_CONFIG,
    UPDATE_CONFIG,
    DELETE_CONFIG,
    INIT_IDENTITY,
    GENERATE_OTP_BY_MOBILE,
    GENERATE_OTP_BY_EMAIL,
    VALIDATE_OTP,
    CUSTOMER_REGISTER,
    CUSTOMER_UPDATE,
    GOOGLE_SSO,
    COMMERCE_STORE_CONFIG,
    COMMERCE_CMS_PAGE,
    COMMERCE_CATEGORIES,
    COMMERCE_CUSTOMER_BY_TOKEN,
)


@dataclass
class TestResult:
    """Single test case result."""
    name: str
    suite: str
    passed: bool
    response_time_ms: float = 0.0
    status_code: int = 0
    error: Optional[str] = None
    details: Optional[dict] = None


@dataclass
class SuiteResult:
    """Aggregated results for the full run."""
    results: List[TestResult] = field(default_factory=list)
    start_time: float = 0.0
    end_time: float = 0.0

    @property
    def total(self) -> int:
        return len(self.results)

    @property
    def passed(self) -> int:
        return sum(1 for r in self.results if r.passed)

    @property
    def failed(self) -> int:
        return sum(1 for r in self.results if not r.passed)

    @property
    def duration_s(self) -> float:
        return self.end_time - self.start_time

    @property
    def avg_response_ms(self) -> float:
        times = [r.response_time_ms for r in self.results if r.response_time_ms > 0]
        return sum(times) / len(times) if times else 0

    @property
    def p95_response_ms(self) -> float:
        times = sorted([r.response_time_ms for r in self.results if r.response_time_ms > 0])
        if not times:
            return 0
        idx = int(len(times) * 0.95)
        return times[min(idx, len(times) - 1)]


class E2ETestRunner:
    """Executes all E2E test scenarios against the API Mesh."""

    def __init__(self):
        Config.validate()
        self.client = MeshClient()
        self.suite = SuiteResult()
        # Shared state across tests (OTP references, tokens, etc.)
        self._otp_ref_id: Optional[str] = None
        self._otp_value: Optional[str] = None
        self._customer_token: Optional[str] = None
        self._customer_id: Optional[str] = None

    def _record(self, name: str, suite: str, resp: GraphQLResponse,
                assertion_fn=None) -> TestResult:
        """Evaluate response and record result."""
        passed = resp.success
        error = None

        if resp.exception:
            passed = False
            error = resp.exception
        elif resp.errors:
            passed = False
            error = '; '.join(e.get('message', str(e)) for e in resp.errors)

        # Custom assertion
        if passed and assertion_fn:
            try:
                assertion_fn(resp)
            except AssertionError as e:
                passed = False
                error = str(e)

        result = TestResult(
            name=name,
            suite=suite,
            passed=passed,
            response_time_ms=resp.response_time_ms,
            status_code=resp.status_code,
            error=error,
            details=resp.data,
        )
        self.suite.results.append(result)

        status = '✓' if passed else '✗'
        print(f'  {status} {name} [{resp.response_time_ms:.0f}ms]'
              + (f' — {error}' if error else ''))
        return result

    # ── Test Suites ──────────────────────────────────────────────────────

    def test_config_health(self):
        """Suite: Config — verify module is reachable and enabled."""
        print('\n━━ Config Health (getConfig) ━━')

        resp = self.client.execute(GET_CONFIG)
        self._record(
            'GET config returns full schema',
            'Config',
            resp,
            lambda r: self._assert(r.data and 'getConfig' in r.data,
                                   'getConfig missing in response'),
        )

        # Check is_enabled
        if resp.success and resp.data:
            cfg = resp.data.get('getConfig', {})
            is_enabled = cfg.get('is_enabled', False)
            result = TestResult(
                name='Module is_enabled == true',
                suite='Config',
                passed=bool(is_enabled),
                response_time_ms=0,
                error=None if is_enabled else 'Module is disabled — OTP tests will fail',
            )
            self.suite.results.append(result)
            status = '✓' if is_enabled else '⚠'
            print(f'  {status} Module is_enabled == {is_enabled}')

            # Verify all config fields are returned
            expected_fields = [
                'is_enabled', 'otp_expiration_validity', 'otp_in_response',
                'auto_register', 'google_sso_enabled', 'sms_type',
                'email_smtp_port', 'email_subject',
            ]
            missing = [f for f in expected_fields if f not in cfg]
            result2 = TestResult(
                name='Config returns all expected fields',
                suite='Config',
                passed=len(missing) == 0,
                response_time_ms=0,
                error=f'Missing fields: {missing}' if missing else None,
            )
            self.suite.results.append(result2)
            status = '✓' if result2.passed else '✗'
            print(f'  {status} Config schema completeness ({len(expected_fields)} fields)')

    def test_update_config(self):
        """Suite: Config — update config and verify changes persist."""
        print('\n━━ Update Config (updateConfig) ━━')

        # Save original perf_logging value to restore later
        resp_before = self.client.execute(GET_CONFIG)
        original_perf = False
        if resp_before.success and resp_before.data:
            original_perf = resp_before.data.get('getConfig', {}).get('perf_logging', False)

        # Toggle perf_logging
        new_value = not original_perf
        resp = self.client.execute(UPDATE_CONFIG, {
            'input': {'perf_logging': new_value}
        })

        def check_update(r):
            data = r.data.get('updateConfig', {})
            self._assert(
                data.get('perf_logging') == new_value,
                f"perf_logging not updated: expected {new_value}, got {data.get('perf_logging')}",
            )

        self._record('Update config (toggle perf_logging)', 'Config', resp, check_update)

        # Verify the change persists with a fresh GET
        resp_verify = self.client.execute(GET_CONFIG)

        def check_persisted(r):
            cfg = r.data.get('getConfig', {})
            self._assert(
                cfg.get('perf_logging') == new_value,
                f"Change not persisted: expected {new_value}, got {cfg.get('perf_logging')}",
            )

        self._record('Verify config update persisted', 'Config', resp_verify, check_persisted)

        # Restore original value
        self.client.execute(UPDATE_CONFIG, {'input': {'perf_logging': original_perf}})

    def test_init_identity(self):
        """Suite: Admin — init-identity (DB collection + indexes)."""
        print('\n━━ Init Identity ━━')

        resp = self.client.execute(INIT_IDENTITY)

        def check(r):
            data = r.data.get('initIdentity', {})
            self._assert(data.get('success'), f"initIdentity failed: {data}")
            self._assert(data.get('collection'), 'collection name missing')

        self._record('Init Identity → success + collection', 'Admin', resp, check)

    def test_generate_otp_mobile(self):
        """Suite: OTP — generate OTP by mobile number."""
        print('\n━━ Generate OTP (Mobile) ━━')

        resp = self.client.execute(GENERATE_OTP_BY_MOBILE, {
            'input': {'mobile': Config.TEST_MOBILE}
        })

        def check(r):
            data = r.data.get('generateOtpAction', {})
            self._assert(data.get('otpReferenceId'), 'otpReferenceId missing')
            self._otp_ref_id = data.get('otpReferenceId')
            self._otp_value = data.get('otpValue')  # Only present if otp_in_response=true

        self._record('Generate OTP by mobile', 'OTP', resp, check)

    def test_generate_otp_email(self):
        """Suite: OTP — generate OTP by email."""
        print('\n━━ Generate OTP (Email) ━━')

        resp = self.client.execute(GENERATE_OTP_BY_EMAIL, {
            'input': {'email': Config.TEST_EMAIL}
        })

        def check(r):
            data = r.data.get('generateOtpAction', {})
            self._assert(data.get('otpReferenceId'), 'otpReferenceId missing')

        self._record('Generate OTP by email', 'OTP', resp, check)

    def test_validate_otp(self):
        """Suite: OTP — validate OTP and get customer_token."""
        print('\n━━ Validate OTP ━━')

        if not self._otp_ref_id:
            result = TestResult(
                name='Validate OTP',
                suite='OTP',
                passed=False,
                error='Skipped — no otpReferenceId from generate step',
            )
            self.suite.results.append(result)
            print(f'  ⊘ {result.name} — {result.error}')
            return

        if not self._otp_value:
            result = TestResult(
                name='Validate OTP',
                suite='OTP',
                passed=False,
                error='Skipped — otp_in_response is disabled; cannot validate without OTP value. '
                      'Enable otp_in_response in config or set OTP value manually.',
            )
            self.suite.results.append(result)
            print(f'  ⊘ {result.name} — {result.error}')
            return

        resp = self.client.execute(VALIDATE_OTP, {
            'input': {
                'otpReferenceId': self._otp_ref_id,
                'otpValue': self._otp_value,
            }
        })

        def check(r):
            data = r.data.get('validateOtpAction', {})
            self._assert(data.get('success'), f"success=false: {data.get('message')}")
            self._assert(data.get('customer_token'), 'customer_token missing')
            self._customer_token = data.get('customer_token')
            customer = data.get('customer', {})
            if customer:
                self._customer_id = customer.get('customer_id')

        self._record('Validate OTP → get token', 'OTP', resp, check)

    def test_registration_flow(self):
        """Suite: Registration — full register → OTP → validate cycle."""
        print('\n━━ Registration Flow ━━')

        # Step 1: Register (generates OTP with flowType=register)
        resp = self.client.execute(CUSTOMER_REGISTER, {
            'input': {
                'operation': 'register',
                'mobile': Config.REG_MOBILE,
                'firstname': Config.REG_FIRSTNAME,
                'lastname': Config.REG_LASTNAME,
            }
        })

        reg_otp_ref = None
        reg_otp_val = None

        def check_register(r):
            nonlocal reg_otp_ref, reg_otp_val
            data = r.data.get('customerAction', {})
            # Could be otpReferenceId (new user) or error (existing user → 409)
            if data.get('error'):
                raise AssertionError(f"Registration error: {data['error']}")
            self._assert(data.get('otpReferenceId'), 'otpReferenceId missing from register')
            reg_otp_ref = data.get('otpReferenceId')
            reg_otp_val = data.get('otpValue')

        result = self._record('Register customer (generate OTP)', 'Registration', resp, check_register)

        # Step 2: Validate registration OTP (only if OTP available)
        if result.passed and reg_otp_ref and reg_otp_val:
            resp2 = self.client.execute(VALIDATE_OTP, {
                'input': {
                    'otpReferenceId': reg_otp_ref,
                    'otpValue': reg_otp_val,
                }
            })

            def check_validate(r):
                data = r.data.get('validateOtpAction', {})
                self._assert(data.get('success'), f"validate failed: {data.get('message')}")
                self._assert(data.get('customer_token'), 'customer_token missing')

            self._record('Validate registration OTP → token', 'Registration', resp2, check_validate)
        elif result.passed and reg_otp_ref and not reg_otp_val:
            skip = TestResult(
                name='Validate registration OTP',
                suite='Registration',
                passed=False,
                error='Skipped — otp_in_response disabled, cannot auto-validate',
            )
            self.suite.results.append(skip)
            print(f'  ⊘ {skip.name} — {skip.error}')

    def test_customer_update(self):
        """Suite: Customer Update — update details with token."""
        print('\n━━ Customer Update ━━')

        if not self._customer_token or not self._customer_id:
            skip = TestResult(
                name='Update customer details',
                suite='Customer',
                passed=False,
                error='Skipped — no customer_token/customer_id from previous steps',
            )
            self.suite.results.append(skip)
            print(f'  ⊘ {skip.name} — {skip.error}')
            return

        resp = self.client.execute(CUSTOMER_UPDATE, {
            'input': {
                'operation': 'updateCustomerDetails',
                'customer_token': self._customer_token,
                'customer_id': str(self._customer_id),
                'firstname': 'UpdatedFirst',
                'lastname': 'UpdatedLast',
            }
        })

        def check(r):
            data = r.data.get('customerAction', {})
            self._assert(data.get('success'), f"update failed: {data.get('error') or data.get('message')}")
            customer = data.get('customer', {})
            self._assert(
                customer.get('firstname') == 'UpdatedFirst',
                f"firstname mismatch: {customer.get('firstname')}",
            )

        self._record('Update customer firstname/lastname', 'Customer', resp, check)

    def test_google_sso(self):
        """Suite: Google SSO — exchange token (only if configured)."""
        print('\n━━ Google SSO ━━')

        if not Config.TEST_GOOGLE_TOKEN:
            skip = TestResult(
                name='Google SSO sign-in',
                suite='GoogleSSO',
                passed=False,
                error='Skipped — TEST_GOOGLE_TOKEN not configured',
            )
            self.suite.results.append(skip)
            print(f'  ⊘ {skip.name} — {skip.error}')
            return

        resp = self.client.execute(GOOGLE_SSO, {
            'input': {'google_token': Config.TEST_GOOGLE_TOKEN}
        })

        def check(r):
            data = r.data.get('googleSsoAction', {})
            self._assert(data.get('success'), f"SSO failed: {data.get('message')}")
            self._assert(data.get('customer_token'), 'customer_token missing')

        self._record('Google SSO → customer_token', 'GoogleSSO', resp, check)

    def test_commerce_store_config(self):
        """Suite: Commerce Proxy — storeConfig query."""
        print('\n━━ Commerce: storeConfig ━━')

        resp = self.client.execute(COMMERCE_STORE_CONFIG)

        def check(r):
            data = r.data.get('storeConfig', {})
            self._assert(data.get('store_name'), 'store_name missing')
            self._assert(data.get('base_currency_code'), 'base_currency_code missing')

        self._record('Commerce storeConfig → store_name + currency', 'Commerce', resp, check)

    def test_commerce_categories(self):
        """Suite: Commerce Proxy — categories query."""
        print('\n━━ Commerce: categories ━━')

        resp = self.client.execute(COMMERCE_CATEGORIES)

        def check(r):
            data = r.data.get('categories', {})
            items = data.get('items', [])
            self._assert(isinstance(items, list), 'categories items is not a list')
            self._assert(len(items) > 0, 'No categories returned')

        self._record('Commerce categories → items list', 'Commerce', resp, check)

    def test_commerce_cms_page(self):
        """Suite: Commerce Proxy — cmsPage query."""
        print('\n━━ Commerce: cmsPage ━━')

        resp = self.client.execute(COMMERCE_CMS_PAGE, {
            'identifier': 'home'
        })

        def check(r):
            data = r.data.get('cmsPage', {})
            # cmsPage may return null if 'home' doesn't exist — that's OK
            # We just verify the query reaches Commerce without error
            pass

        self._record('Commerce cmsPage query executes', 'Commerce', resp, check)

    def test_commerce_customer_no_auth(self):
        """Suite: Commerce Proxy — customer query without auth → error."""
        print('\n━━ Commerce: customer (no auth) ━━')

        resp = self.client.execute(COMMERCE_CUSTOMER_BY_TOKEN)

        # Should fail with auth error (no token)
        result = TestResult(
            name='Commerce customer without auth → authorization error',
            suite='Commerce',
            passed=not resp.success or bool(resp.errors),
            response_time_ms=resp.response_time_ms,
            status_code=resp.status_code,
            error=None if (not resp.success or resp.errors) else 'Should require auth token',
        )
        self.suite.results.append(result)
        status = '✓' if result.passed else '✗'
        print(f'  {status} {result.name} [{resp.response_time_ms:.0f}ms]')

    def test_commerce_customer_with_auth(self):
        """Suite: Commerce Proxy — customer query with token from OTP flow."""
        print('\n━━ Commerce: customer (authenticated) ━━')

        if not self._customer_token:
            skip = TestResult(
                name='Commerce customer with auth',
                suite='Commerce',
                passed=False,
                error='Skipped — no customer_token from OTP flow',
            )
            self.suite.results.append(skip)
            print(f'  ⊘ {skip.name} — {skip.error}')
            return

        resp = self.client.execute(
            COMMERCE_CUSTOMER_BY_TOKEN,
            headers={'Authorization': f'Bearer {self._customer_token}'}
        )

        def check(r):
            data = r.data.get('customer', {})
            self._assert(data.get('email') or data.get('firstname'),
                         'customer data missing (email or firstname)')

        self._record('Commerce customer with token → profile', 'Commerce', resp, check)

    def test_negative_cases(self):
        """Suite: Negative — verify proper error handling."""
        print('\n━━ Negative Cases ━━')

        # 1. Generate OTP with no input
        resp = self.client.execute(GENERATE_OTP_BY_MOBILE, {
            'input': {}
        })
        self._record(
            'Generate OTP empty input → error',
            'Negative',
            resp,
            lambda r: self._assert(
                not r.data.get('generateOtpAction', {}).get('otpReferenceId'),
                'Should not return otpReferenceId for empty input',
            ) if r.success else None,
        )

        # 2. Validate OTP with invalid reference
        resp = self.client.execute(VALIDATE_OTP, {
            'input': {
                'otpReferenceId': 'invalid_ref_12345',
                'otpValue': '000000',
            }
        })
        self._record(
            'Validate OTP invalid ref → error',
            'Negative',
            resp,
            lambda r: self._assert(not r.success or (
                r.data and not r.data.get('validateOtpAction', {}).get('success')
            ), 'Should reject invalid OTP reference'),
        )

        # 3. Validate OTP with wrong value (if we have a valid ref)
        if self._otp_ref_id:
            resp = self.client.execute(VALIDATE_OTP, {
                'input': {
                    'otpReferenceId': self._otp_ref_id,
                    'otpValue': '000000',
                }
            })
            self._record(
                'Validate OTP wrong value → rejected',
                'Negative',
                resp,
                lambda r: self._assert(not r.success or (
                    r.data and not r.data.get('validateOtpAction', {}).get('success')
                ), 'Should reject wrong OTP value'),
            )

        # 4. Customer update without token
        resp = self.client.execute(CUSTOMER_UPDATE, {
            'input': {
                'operation': 'updateCustomerDetails',
                'customer_id': '999999',
                'firstname': 'Hacker',
            }
        })
        self._record(
            'Update without token → error',
            'Negative',
            resp,
            lambda r: self._assert(
                not r.success or not r.data.get('customerAction', {}).get('success'),
                'Should reject update without customer_token',
            ),
        )

        # 5. Generate OTP with invalid mobile format
        resp = self.client.execute(GENERATE_OTP_BY_MOBILE, {
            'input': {'mobile': '123'}
        })
        self._record(
            'Generate OTP invalid mobile → error',
            'Negative',
            resp,
            lambda r: self._assert(
                not r.data.get('generateOtpAction', {}).get('otpReferenceId'),
                'Should reject invalid mobile number',
            ) if r.success else None,
        )

        # 6. Generate OTP with invalid email format
        resp = self.client.execute(GENERATE_OTP_BY_EMAIL, {
            'input': {'email': 'not-an-email'}
        })
        self._record(
            'Generate OTP invalid email → error',
            'Negative',
            resp,
            lambda r: self._assert(
                not r.data.get('generateOtpAction', {}).get('otpReferenceId'),
                'Should reject invalid email format',
            ) if r.success else None,
        )

    def test_response_times(self):
        """Suite: Performance — verify response times are within thresholds."""
        print('\n━━ Performance Thresholds ━━')

        # Threshold: 95th percentile should be under 3000ms for mesh
        p95 = self.suite.p95_response_ms
        threshold_ms = 3000

        result = TestResult(
            name=f'P95 response time < {threshold_ms}ms',
            suite='Performance',
            passed=p95 < threshold_ms,
            response_time_ms=p95,
            error=f'P95 = {p95:.0f}ms exceeds {threshold_ms}ms threshold' if p95 >= threshold_ms else None,
        )
        self.suite.results.append(result)
        status = '✓' if result.passed else '✗'
        print(f'  {status} P95 = {p95:.0f}ms (threshold: {threshold_ms}ms)')

        # Average should be under 2000ms
        avg = self.suite.avg_response_ms
        avg_threshold = 2000
        result2 = TestResult(
            name=f'Avg response time < {avg_threshold}ms',
            suite='Performance',
            passed=avg < avg_threshold,
            response_time_ms=avg,
            error=f'Avg = {avg:.0f}ms exceeds {avg_threshold}ms' if avg >= avg_threshold else None,
        )
        self.suite.results.append(result2)
        status = '✓' if result2.passed else '✗'
        print(f'  {status} Avg = {avg:.0f}ms (threshold: {avg_threshold}ms)')

    # ── Runner ───────────────────────────────────────────────────────────

    def run_all(self) -> SuiteResult:
        """Execute all test suites in order."""
        self.suite.start_time = time.time()

        print('╔══════════════════════════════════════════════════════════╗')
        print('║   Login Module — E2E API Test Suite (Full Coverage)     ║')
        print(f'║   Endpoint: {self.client.endpoint[:42]:<42} ║')
        print('╚══════════════════════════════════════════════════════════╝')

        # LoginModule operations
        self.test_config_health()
        self.test_update_config()
        self.test_init_identity()
        self.test_generate_otp_mobile()
        self.test_generate_otp_email()
        self.test_validate_otp()
        self.test_registration_flow()
        self.test_customer_update()
        self.test_google_sso()

        # Commerce proxy operations
        self.test_commerce_store_config()
        self.test_commerce_categories()
        self.test_commerce_cms_page()
        self.test_commerce_customer_no_auth()
        self.test_commerce_customer_with_auth()

        # Edge cases & performance
        self.test_negative_cases()
        self.test_response_times()

        self.suite.end_time = time.time()
        self.client.close()

        self._print_summary()
        return self.suite

    def _print_summary(self):
        """Print final summary."""
        s = self.suite
        print('\n' + '═' * 58)
        print(f'  RESULTS: {s.passed}/{s.total} passed, {s.failed} failed')
        print(f'  Duration: {s.duration_s:.2f}s | Avg: {s.avg_response_ms:.0f}ms | P95: {s.p95_response_ms:.0f}ms')
        print('═' * 58)

        if s.failed > 0:
            print('\n  FAILURES:')
            for r in s.results:
                if not r.passed:
                    print(f'    ✗ [{r.suite}] {r.name}: {r.error}')

    @staticmethod
    def _assert(condition, message='Assertion failed'):
        if not condition:
            raise AssertionError(message)


if __name__ == '__main__':
    runner = E2ETestRunner()
    result = runner.run_all()
    sys.exit(0 if result.failed == 0 else 1)
