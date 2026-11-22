"""A2.3 OFFLINE gateway policy simulation; does not initiate provider requests.

A preview is untrusted planning output, NOT a signed grant or an executable
capability. No HTTP server, API clients, credentials or dynamic URLs exist here.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from geo_rafidain_agents.runtime_policy import PolicyDecision

_SHA = re.compile(r"[0-9a-f]{64}\Z")
_MODEL = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,79}\Z")


@dataclass(frozen=True)
class OfflineGatewayPolicy:
    # Empty by default: no provider or model is enabled for live calls.
    allowed_provider: str | None = None
    allowed_models: tuple[str, ...] = ()
    max_output_tokens: int = 800
    max_request_budget_cents: int = 25
    max_duration_seconds: int = 30

    def __post_init__(self) -> None:
        if self.allowed_provider not in (None, "openai"):
            raise ValueError("Only a fixed vetted provider label is supported")
        if (not isinstance(self.allowed_models, tuple)
                or len(self.allowed_models) > 10
                or len(set(self.allowed_models)) != len(self.allowed_models)
                or any(not isinstance(x, str) or not _MODEL.fullmatch(x) for x in self.allowed_models)):
            raise ValueError("Invalid model allowlist")
        for n, limit in (("max_output_tokens", 8000), ("max_request_budget_cents", 10000),
                         ("max_duration_seconds", 300)):
            val = getattr(self, n)
            if type(val) is not int or not 1 <= val <= limit:
                raise ValueError("Invalid gateway limit")


@dataclass(frozen=True)
class GatewayPreviewRequest:
    provider: str
    model: str
    request_digest: str
    max_output_tokens: int
    budget_cents: int
    timeout_seconds: int


@dataclass(frozen=True)
class GatewayPreviewDecision:
    code: str
    preview_permitted: bool = False
    execution_authorized: bool = False
    network_called: bool = False
    provider_credentials_used: bool = False


def evaluate_gateway_preview(policy: OfflineGatewayPolicy, request: GatewayPreviewRequest,
                             preflight: PolicyDecision) -> GatewayPreviewDecision:
    """Validate a dry-run-only request. Always return execution_authorized=False.

    PolicyDecision is an ordinary forgeable Python value; it can NEVER be
    accepted as a network authorization or sent to an SDK.
    """
    def deny(code: str) -> GatewayPreviewDecision:
        return GatewayPreviewDecision(code=code)
    if (not isinstance(policy, OfflineGatewayPolicy)
            or not isinstance(request, GatewayPreviewRequest)
            or not isinstance(preflight, PolicyDecision)):
        return deny("INVALID_INPUT")
    if (preflight.preflight_passed is not True or preflight.code != "PREFLIGHT_ONLY"
            or preflight.execution_authorized is not False
            or not isinstance(preflight.request_digest, str)
            or not _SHA.fullmatch(preflight.request_digest)):
        return deny("NO_VALID_OFFLINE_PREFLIGHT")
    if (not isinstance(request.request_digest, str)
            or not _SHA.fullmatch(request.request_digest)
            or request.request_digest != preflight.request_digest):
        return deny("REQUEST_BINDING_MISMATCH")
    if (not isinstance(request.provider, str) or request.provider != "openai"
            or policy.allowed_provider != "openai"):
        return deny("PROVIDER_DENIED")
    if (not isinstance(request.model, str) or not _MODEL.fullmatch(request.model)
            or request.model not in policy.allowed_models):
        return deny("MODEL_DENIED")
    for value, max_value in ((request.max_output_tokens, policy.max_output_tokens),
                             (request.budget_cents, policy.max_request_budget_cents),
                             (request.timeout_seconds, policy.max_duration_seconds)):
        if type(value) is not int or not 1 <= value <= max_value:
            return deny("LIMIT_DENIED")
    return GatewayPreviewDecision(code="OFFLINE_PREVIEW_ONLY", preview_permitted=True)
