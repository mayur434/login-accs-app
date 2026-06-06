"""
Locust-based load testing for Login Module API Mesh.

Simulates realistic user traffic patterns:
  - 40% Generate OTP (login flow start)
  - 25% Validate OTP (login completion)
  - 20% Get Config (page load / health check)
  - 10% Customer Registration
  - 5%  Customer Update

Usage:
  # Web UI mode (interactive dashboard):
  locust -f load_test.py --host=https://graph.adobe.io/api/<mesh-id>/graphql

  # Headless mode (CI/CD):
  locust -f load_test.py --host=https://graph.adobe.io/api/<mesh-id>/graphql \
    --headless -u 10 -r 2 --run-time 60s --csv=reports/load

  # Or use the runner script:
  python run_tests.py --load
"""

import os
import sys
import random
import string

# Add parent dir to path for imports
sys.path.insert(0, os.path.dirname(__file__))

from locust import HttpUser, task, between, events
from queries import (
    GET_CONFIG,
    GENERATE_OTP_BY_MOBILE,
    GENERATE_OTP_BY_EMAIL,
    VALIDATE_OTP,
    CUSTOMER_REGISTER,
    CUSTOMER_UPDATE,
)


def random_mobile():
    """Generate random 10-digit Indian mobile number."""
    return '9' + ''.join(random.choices(string.digits, k=9))


def random_email():
    """Generate random email for load testing."""
    suffix = ''.join(random.choices(string.ascii_lowercase + string.digits, k=8))
    return f'loadtest-{suffix}@test.example.com'


class LoginModuleUser(HttpUser):
    """Simulates a user interacting with the Login Module via API Mesh."""

    wait_time = between(1, 3)  # 1-3s between requests (realistic pacing)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._otp_refs = []  # Store OTP references for validate step
        self._customer_tokens = []  # Store tokens for update step

    def _graphql(self, name: str, query: str, variables: dict = None):
        """Execute a GraphQL request with Locust tracking."""
        payload = {'query': query}
        if variables:
            payload['variables'] = variables

        with self.client.post(
            '',  # host already includes the full mesh endpoint
            json=payload,
            headers={'Content-Type': 'application/json'},
            name=name,
            catch_response=True,
        ) as response:
            if response.status_code != 200:
                response.failure(f'HTTP {response.status_code}')
                return None

            try:
                body = response.json()
            except ValueError:
                response.failure('Non-JSON response')
                return None

            if body.get('errors'):
                error_msg = body['errors'][0].get('message', 'GraphQL error')
                # Don't mark expected business errors as failures
                if any(k in error_msg.lower() for k in ['not found', 'disabled', 'invalid', 'already exists']):
                    response.success()
                else:
                    response.failure(error_msg)
                return body

            response.success()
            return body

    @task(20)
    def get_config(self):
        """Health check / page load — fetch public config."""
        self._graphql('GetConfig', GET_CONFIG)

    @task(40)
    def generate_otp(self):
        """Generate OTP for a random mobile number."""
        mobile = random_mobile()
        result = self._graphql('GenerateOTP', GENERATE_OTP_BY_MOBILE, {
            'input': {'mobile': mobile}
        })

        if result and result.get('data', {}).get('generateOtpAction', {}).get('otpReferenceId'):
            otp_data = result['data']['generateOtpAction']
            self._otp_refs.append({
                'ref': otp_data['otpReferenceId'],
                'value': otp_data.get('otpValue'),  # Only if otp_in_response=true
            })
            # Keep only last 5 refs to avoid memory growth
            self._otp_refs = self._otp_refs[-5:]

    @task(25)
    def validate_otp(self):
        """Validate OTP (uses stored reference if available, else random)."""
        if self._otp_refs:
            otp = self._otp_refs.pop(0)
            ref_id = otp['ref']
            value = otp.get('value') or ''.join(random.choices(string.digits, k=6))
        else:
            # Random invalid attempt (tests error path performance)
            ref_id = f'otp_loadtest_{"".join(random.choices(string.ascii_lowercase, k=10))}'
            value = ''.join(random.choices(string.digits, k=6))

        result = self._graphql('ValidateOTP', VALIDATE_OTP, {
            'input': {
                'otpReferenceId': ref_id,
                'otpValue': value,
            }
        })

        if result:
            token = result.get('data', {}).get('validateOtpAction', {}).get('customer_token')
            customer = result.get('data', {}).get('validateOtpAction', {}).get('customer', {})
            if token and customer:
                self._customer_tokens.append({
                    'token': token,
                    'customer_id': customer.get('customer_id'),
                })
                self._customer_tokens = self._customer_tokens[-3:]

    @task(10)
    def register_customer(self):
        """Register a new customer."""
        self._graphql('RegisterCustomer', CUSTOMER_REGISTER, {
            'input': {
                'operation': 'register',
                'mobile': random_mobile(),
                'firstname': 'LoadTest',
                'lastname': 'User',
            }
        })

    @task(5)
    def update_customer(self):
        """Update customer details (uses stored token if available)."""
        if self._customer_tokens:
            cust = self._customer_tokens[0]
            self._graphql('UpdateCustomer', CUSTOMER_UPDATE, {
                'input': {
                    'operation': 'updateCustomerDetails',
                    'customer_token': cust['token'],
                    'customer_id': str(cust['customer_id']),
                    'firstname': f'Load{random.randint(1, 999)}',
                }
            })
        else:
            # No token available — attempt without (tests error path)
            self._graphql('UpdateCustomer', CUSTOMER_UPDATE, {
                'input': {
                    'operation': 'updateCustomerDetails',
                    'customer_id': '0',
                    'firstname': 'NoToken',
                }
            })


# ── Event hooks for summary stats ────────────────────────────────────────

@events.quitting.add_listener
def on_quitting(environment, **kwargs):
    """Print summary on exit."""
    stats = environment.runner.stats
    if stats.total.num_failures > stats.total.num_requests * 0.1:
        print('\n⚠ WARNING: >10% failure rate detected during load test!')
