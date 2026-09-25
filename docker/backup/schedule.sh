#!/bin/sh
# Runs backup.sh once a day at TB_GYM_BACKUP_HOUR_UTC (default 0, which is 02:00 or 03:00 in Beirut).
# A plain loop rather than cron, so the container's environment reaches the backup unchanged.
set -eu

hour="${TB_GYM_BACKUP_HOUR_UTC:-0}"
case "$hour" in
    '' | *[!0-9]*) echo "TB_GYM_BACKUP_HOUR_UTC must be 0-23" >&2; exit 2 ;;
esac
[ "$hour" -le 23 ] || { echo "TB_GYM_BACKUP_HOUR_UTC must be 0-23" >&2; exit 2; }

trap 'exit 0' TERM INT
mkdir -p "${TB_GYM_BACKUP_STATE_DIR:-/var/lib/tb-gym-backup}"
date -u +%s >"${TB_GYM_BACKUP_STATE_DIR:-/var/lib/tb-gym-backup}/started"
echo "backup: daily at ${hour}:00 UTC"

while true; do
    now="$(date -u +%s)"
    next=$((now / 86400 * 86400 + hour * 3600))
    [ "$next" -gt "$now" ] || next=$((next + 86400))
    sleep $((next - now)) &
    wait $!
    backup.sh || true
done
