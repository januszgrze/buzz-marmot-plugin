#!/bin/sh
# Local Marmot relay for dev/harness.mjs: strfry in Docker on
# ws://127.0.0.1:27777. Starts the `marmot-strfry` container, creating it on
# first use (Docker pulls dockurr/strfry then). Its config and database live
# in $MARMOT_DEV_RELAY_DIR (default ~/.buzz-marmot-dev/relay).
set -eu
dir="${MARMOT_DEV_RELAY_DIR:-$HOME/.buzz-marmot-dev/relay}"
if ! docker container inspect marmot-strfry >/dev/null 2>&1; then
  mkdir -p "$dir/strfry-db"
  cp "$(dirname "$0")/strfry.conf" "$dir/strfry.conf"
  docker create --name marmot-strfry -p 127.0.0.1:27777:7777 \
    -v "$dir/strfry-db:/app/strfry-db" -v "$dir/strfry.conf:/etc/strfry.conf:ro" \
    dockurr/strfry:1.0.4 ./strfry relay -v 1 >/dev/null
fi
docker start marmot-strfry >/dev/null
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if nc -z 127.0.0.1 27777 2>/dev/null; then echo "Marmot relay up on ws://127.0.0.1:27777"; exit 0; fi
  sleep 1
done
echo "Marmot relay did not come up; see: docker logs marmot-strfry" >&2
exit 1
