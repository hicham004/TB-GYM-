#!/bin/sh
# Healthy while the last backup succeeded within 26 hours, or while the container is younger than that
# and nothing has failed yet. Unhealthy as soon as the latest run failed.
state="${TB_GYM_BACKUP_STATE_DIR:-/var/lib/tb-gym-backup}"
now="$(date -u +%s)"
limit=$((26 * 3600))
success="$(cat "$state/last-success" 2>/dev/null || echo 0)"
failure="$(cat "$state/last-failure" 2>/dev/null || echo 0)"
started="$(cat "$state/started" 2>/dev/null || echo "$now")"

[ "$failure" -gt "$success" ] && exit 1
[ $((now - success)) -le "$limit" ] && exit 0
[ "$success" -eq 0 ] && [ $((now - started)) -le "$limit" ] && exit 0
exit 1
