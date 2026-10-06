#!/usr/bin/env bash
# Build the image and prove the container serves, without touching the real `joserah` container or volumes.
set -euo pipefail
cd "$(dirname "$0")/.."
export JOSERAH_CONTAINER=joserah-smoke JOSERAH_HOST_PORT=14747 JOSERAH_VOLUME_PREFIX=joserah-smoke
C="docker compose -p joserah-smoke -f compose.yaml"
trap '$C down -v >/dev/null 2>&1 || true' EXIT
$C build
$C up -d
curl -fsS --retry 30 --retry-all-errors --retry-connrefused --retry-delay 2 http://127.0.0.1:14747/healthz >/dev/null
# signedIn is null until the first engine probe returns; wait for the settled answer (up to ~30 s).
H=""
for _ in $(seq 1 15); do
  H=$(curl -fsS http://127.0.0.1:14747/healthz)
  [ "$H" = '{"alive":true,"signedIn":false,"lastJobOk":null}' ] && break
  sleep 2
done
echo "healthz: $H"
[ "$H" = '{"alive":true,"signedIn":false,"lastJobOk":null}' ]
[ "$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' http://127.0.0.1:14747/)" = "302 http://127.0.0.1:14747/setup" ]
docker exec joserah-smoke claude --version | grep -q '^2\.1\.289 (Claude Code)$'
[ "$(docker exec joserah-smoke id -u)" = "10001" ]
docker exec joserah-smoke test -f /home/joserah/state/setup-token
docker exec joserah-smoke sh -c 'test ! -e /workspace/keys/server'
[ "$(docker logs joserah-smoke 2>&1 | grep -c 'First start — open http://127.0.0.1:4747/setup?token=')" = "1" ]
docker port joserah-smoke | grep -q '^4747/tcp -> 127.0.0.1:14747$'
echo "smoke: ok"
