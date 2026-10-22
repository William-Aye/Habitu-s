"""The parity check must never pass silently in CI because the function was not served."""
import edge_client
import pytest


@pytest.fixture
def nowhere(monkeypatch):
    monkeypatch.setattr(edge_client, "URL", "http://127.0.0.1:9/functions/v1/embed-query")


def test_unreachable_fails_in_ci(nowhere, monkeypatch):
    monkeypatch.setenv("CI", "true")
    with pytest.raises(pytest.fail.Exception, match="SUPABASE_ANON_KEY"):
        edge_client.connect()


def test_unreachable_skips_locally(nowhere, monkeypatch):
    monkeypatch.delenv("CI", raising=False)
    with pytest.raises(pytest.skip.Exception, match="SUPABASE_ANON_KEY"):
        edge_client.connect()
