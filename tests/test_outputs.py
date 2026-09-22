"""Pytest verification for the css-shape-editor task.

One test per editor feature (parametrized over driver_lib.CHECKS), each asserting
the corresponding check in driver_lib.compute(). The bounded-continuous reward
(fraction passing) is written to reward.txt by test.sh via write_reward.py; these
tests provide the per-feature ctrf report so partial progress is visible in
analysis.
"""

import pytest

import driver_lib


@pytest.fixture(scope="session")
def result():
    return driver_lib.compute(force=True)


def test_app_loads(result):
    assert result["load_error"] is None, result["load_error"]


@pytest.mark.parametrize("name", [c[0] for c in driver_lib.CHECKS])
def test_feature(name, result):
    c = result["checks"][name]
    assert c["ok"], f"{name}: {c['detail']}"
