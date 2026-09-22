#!/bin/bash
# Grade the css-shape-editor task. reward_type = bounded_continuous: we write the
# float reward (fraction of feature checks passing), not a 0/1.
#
# Shared-mode verifier: this runs inside the agent's container (built from the
# official Playwright image, environment/Dockerfile) and can read the agent's /app
# output. The grading toolchain is installed HERE at verify time (NOT baked into
# the agent image) -- so the image stays base+WORKDIR (passes test_deps_not_in_image
# and avoids the large pip layer the VMVM registry push rejected). Chromium is
# already baked in the base (build 1148, matched to playwright 1.49.1), so NO
# browser download happens -- avoiding the blocked Playwright CDN. PyPI is reachable
# at verify time. CHROMIUM_PATH is left unset, so driver_lib.py uses the managed
# (matched) Chromium.
set -u

# Guarantee a reward file exists BEFORE anything that can fail, so any failure
# becomes an honest 0.0 rather than a RewardFileNotFoundError.
mkdir -p /logs/verifier
echo 0 > /logs/verifier/reward.txt

# Pinned grading toolchain from PyPI (no browser download -- Chromium is baked in
# the base at $PLAYWRIGHT_BROWSERS_PATH=/ms-playwright, matched to 1.49.1).
python3 -m pip install --no-cache-dir \
  playwright==1.49.1 \
  pytest==8.3.4 \
  pytest-json-ctrf==0.3.5

cd /tests || exit 1

# Compute the reward once (drives the agent's app in headless Chromium, caches
# the per-feature result); overwrites the placeholder 0 with the real float.
python3 write_reward.py

# Per-feature pass/fail report (reads the same cached result).
python3 -m pytest --ctrf /logs/verifier/ctrf.json /tests/test_outputs.py -rA

# Final safety net: restore a 0 if the reward file went missing.
if [ ! -f /logs/verifier/reward.txt ]; then
  echo 0 > /logs/verifier/reward.txt
fi
