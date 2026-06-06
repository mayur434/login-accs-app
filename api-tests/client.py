"""
GraphQL client for API Mesh requests.
Handles request construction, timing, and error extraction.
"""

import time
import requests
from dataclasses import dataclass, field
from typing import Optional
from config import Config


@dataclass
class GraphQLResponse:
    """Structured response from a GraphQL request."""
    success: bool
    status_code: int
    data: Optional[dict] = None
    errors: Optional[list] = None
    response_time_ms: float = 0.0
    raw_response: Optional[dict] = None
    exception: Optional[str] = None


class MeshClient:
    """GraphQL client targeting the API Mesh endpoint."""

    def __init__(self, endpoint: str = None, timeout: int = None):
        self.endpoint = endpoint or Config.MESH_ENDPOINT
        self.timeout = timeout or Config.REQUEST_TIMEOUT
        self.session = requests.Session()
        self.session.headers.update({
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        })

    def execute(self, query: str, variables: dict = None, headers: dict = None) -> GraphQLResponse:
        """Execute a GraphQL query/mutation and return structured response."""
        payload = {'query': query}
        if variables:
            payload['variables'] = variables

        merged_headers = {**self.session.headers}
        if headers:
            merged_headers.update(headers)

        start = time.perf_counter()
        try:
            resp = self.session.post(
                self.endpoint,
                json=payload,
                headers=merged_headers,
                timeout=self.timeout,
            )
            elapsed_ms = (time.perf_counter() - start) * 1000

            try:
                body = resp.json()
            except ValueError:
                return GraphQLResponse(
                    success=False,
                    status_code=resp.status_code,
                    response_time_ms=elapsed_ms,
                    exception=f'Non-JSON response: {resp.text[:200]}',
                )

            errors = body.get('errors')
            data = body.get('data')

            return GraphQLResponse(
                success=resp.ok and not errors,
                status_code=resp.status_code,
                data=data,
                errors=errors,
                response_time_ms=elapsed_ms,
                raw_response=body,
            )

        except requests.exceptions.Timeout:
            elapsed_ms = (time.perf_counter() - start) * 1000
            return GraphQLResponse(
                success=False,
                status_code=0,
                response_time_ms=elapsed_ms,
                exception=f'Request timed out after {self.timeout}s',
            )
        except requests.exceptions.RequestException as e:
            elapsed_ms = (time.perf_counter() - start) * 1000
            return GraphQLResponse(
                success=False,
                status_code=0,
                response_time_ms=elapsed_ms,
                exception=str(e),
            )

    def close(self):
        self.session.close()
