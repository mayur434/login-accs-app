"""
Configuration loader for API test suite.
Reads from .env file or environment variables.
"""

import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env from api-tests directory
_env_path = Path(__file__).parent / '.env'
if _env_path.exists():
    load_dotenv(_env_path)
else:
    # Fall back to .env.example for reference
    _example = Path(__file__).parent / '.env.example'
    if _example.exists():
        load_dotenv(_example)


class Config:
    MESH_ENDPOINT = os.getenv('MESH_ENDPOINT', '')
    ADMIN_ENDPOINT = os.getenv('ADMIN_ENDPOINT', '') or os.getenv('MESH_ENDPOINT', '')

    # Test users
    TEST_MOBILE = os.getenv('TEST_MOBILE', '9876543210')
    TEST_EMAIL = os.getenv('TEST_EMAIL', 'testuser@example.com')
    REG_MOBILE = os.getenv('REG_MOBILE', '9876500001')
    REG_EMAIL = os.getenv('REG_EMAIL', 'newuser-test@example.com')
    REG_FIRSTNAME = os.getenv('REG_FIRSTNAME', 'TestFirst')
    REG_LASTNAME = os.getenv('REG_LASTNAME', 'TestLast')

    # Google SSO
    TEST_GOOGLE_TOKEN = os.getenv('TEST_GOOGLE_TOKEN', '')

    # Load testing
    LOAD_TEST_USERS = int(os.getenv('LOAD_TEST_USERS', '10'))
    LOAD_TEST_SPAWN_RATE = int(os.getenv('LOAD_TEST_SPAWN_RATE', '2'))
    LOAD_TEST_DURATION = int(os.getenv('LOAD_TEST_DURATION', '60'))

    # Timeouts
    REQUEST_TIMEOUT = int(os.getenv('REQUEST_TIMEOUT', '30'))

    # Flags
    VERBOSE = os.getenv('VERBOSE', 'false').lower() == 'true'

    @classmethod
    def validate(cls):
        """Ensure critical config is present."""
        if not cls.MESH_ENDPOINT:
            raise ValueError(
                'MESH_ENDPOINT is required. Set it in api-tests/.env or as an environment variable.'
            )
        return True
