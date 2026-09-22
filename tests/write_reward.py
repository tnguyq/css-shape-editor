"""Compute the bounded-continuous reward (fraction of editor feature checks that
pass, in [0, 1]) and write it to /logs/verifier/reward.txt."""

import os

import driver_lib

os.makedirs("/logs/verifier", exist_ok=True)
res = driver_lib.compute(force=True)
with open("/logs/verifier/reward.txt", "w") as fh:
    fh.write(f"{res['reward']:.6f}\n")
print(f"reward: {res['reward']} ({res['passed']}/{res['total']} feature checks)")
for name, c in res["checks"].items():
    print(f"  [{'PASS' if c['ok'] else 'FAIL'}] {name}: {c['detail']}")
