#!/bin/sh
# One encrypted PostgreSQL backup, uploaded off the server.
#
#   pg_dump (custom format) -> checked with pg_restore --list -> encrypted with age -> uploaded with
#   rclone -> backups older than TB_GYM_BACKUP_KEEP_DAYS pruned -> heartbeat pinged.
#
# The server holds only the age *public* key, so neither this server nor the storage bucket can read
# a backup. The private key lives offline with the owner and is needed only to restore.
#
# Needs: PGHOST, PGUSER, PGPASSWORD, PGDATABASE; TB_GYM_BACKUP_AGE_RECIPIENT; TB_GYM_BACKUP_BUCKET;
# the rclone remote "offsite" (RCLONE_CONFIG_OFFSITE_* variables). Optional:
# TB_GYM_BACKUP_PREFIX (default postgres), TB_GYM_BACKUP_KEEP_DAYS (default 30),
# TB_GYM_BACKUP_HEARTBEAT_URL (for example a healthchecks.io ping URL).
set -eu

: "${PGDATABASE:?PGDATABASE is not set}"
: "${TB_GYM_BACKUP_AGE_RECIPIENT:?TB_GYM_BACKUP_AGE_RECIPIENT (the age public key) is not set}"
: "${TB_GYM_BACKUP_BUCKET:?TB_GYM_BACKUP_BUCKET is not set}"
prefix="${TB_GYM_BACKUP_PREFIX:-postgres}"
keep_days="${TB_GYM_BACKUP_KEEP_DAYS:-30}"
state_dir="${TB_GYM_BACKUP_STATE_DIR:-/var/lib/tb-gym-backup}"
heartbeat="${TB_GYM_BACKUP_HEARTBEAT_URL:-}"

log() { printf '%s backup: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

ping_heartbeat() {
    [ -n "$heartbeat" ] || return 0
    curl --fail --silent --show-error --max-time 10 --retry 3 "$heartbeat$1" >/dev/null ||
        log "could not reach the heartbeat URL"
}

work="$(mktemp -d)"
finished=0
on_exit() {
    rm -rf "$work"
    if [ "$finished" -ne 1 ]; then
        mkdir -p "$state_dir" && date -u +%s >"$state_dir/last-failure"
        log "FAILED"
        ping_heartbeat /fail
    fi
}
trap on_exit EXIT

stamp="$(date -u +%Y-%m-%dT%H%M%SZ)"
name="$PGDATABASE-$stamp.dump.age"

log "dumping $PGDATABASE"
pg_dump --format=custom --compress=6 --file="$work/plain.dump"
# An archive whose table of contents cannot be read cannot be restored; better to fail loudly now.
pg_restore --list "$work/plain.dump" >/dev/null

age --encrypt --recipient "$TB_GYM_BACKUP_AGE_RECIPIENT" --output "$work/$name" "$work/plain.dump"
rm -f "$work/plain.dump"

log "uploading $name ($(wc -c <"$work/$name") bytes)"
rclone copyto "$work/$name" "offsite:$TB_GYM_BACKUP_BUCKET/$prefix/$name"

# Pruned only after a successful upload, so a run of failures never eats the last good backups.
rclone delete --min-age "${keep_days}d" --include "*.dump.age" \
    "offsite:$TB_GYM_BACKUP_BUCKET/$prefix/"

mkdir -p "$state_dir"
date -u +%s >"$state_dir/last-success"
finished=1
log "done"
ping_heartbeat ""
