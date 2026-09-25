#!/bin/sh
# Lists or restores the encrypted off-server backups that backup.sh writes.
#
#   restore.sh list
#   restore.sh <backup-name | latest> <target-database> <age-key-file>
#
# The age key file is the owner's offline private key (it starts with AGE-SECRET-KEY-). The target
# database must be new or empty: a restore never overwrites a database that already has tables. The
# restore runs in one transaction, so a failure leaves nothing half-restored.
set -eu

: "${TB_GYM_BACKUP_BUCKET:?TB_GYM_BACKUP_BUCKET is not set}"
prefix="${TB_GYM_BACKUP_PREFIX:-postgres}"
remote="offsite:$TB_GYM_BACKUP_BUCKET/$prefix"

die() { echo "restore: $*" >&2; exit 2; }
usage() { die "usage: restore.sh list | restore.sh <backup-name|latest> <target-database> <age-key-file>"; }

[ $# -ge 1 ] || usage
if [ "$1" = list ]; then
    [ $# -eq 1 ] || usage
    rclone lsl --include "*.dump.age" "$remote/" | sort -k4
    exit 0
fi

[ $# -eq 3 ] || usage
name="$1"
target="$2"
identity="$3"
case "$target" in
    '' | *[!a-z0-9_]*) die "the target database name may use only lowercase letters, digits and _" ;;
esac
[ -r "$identity" ] || die "cannot read the key file $identity"

if [ "$name" = latest ]; then
    name="$(rclone lsf --files-only --include "*.dump.age" "$remote/" | sort | tail -n 1)"
    [ -n "$name" ] || die "no backups found in $remote"
fi

exists="$(psql --dbname=postgres --tuples-only --no-align \
    --command="SELECT 1 FROM pg_database WHERE datname = '$target'")"
if [ "$exists" = 1 ]; then
    tables="$(psql --dbname="$target" --tuples-only --no-align --command="
        SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind IN ('r', 'p')
          AND n.nspname NOT IN ('pg_catalog', 'information_schema')
          AND n.nspname NOT LIKE 'pg_toast%'")"
    [ "$tables" -eq 0 ] || die "database $target already has tables; restore into a new name, or drop it first"
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

echo "restore: downloading $name"
rclone copyto "$remote/$name" "$work/$name"
echo "restore: decrypting"
age --decrypt --identity "$identity" --output "$work/plain.dump" "$work/$name" ||
    die "could not decrypt; is this the private key that matches TB_GYM_BACKUP_AGE_RECIPIENT?"
pg_restore --list "$work/plain.dump" >/dev/null

[ "$exists" = 1 ] || createdb "$target"
echo "restore: restoring into $target"
pg_restore --dbname="$target" --no-owner --no-privileges --exit-on-error --single-transaction \
    "$work/plain.dump"

echo "restore: done. Rows per table in $target:"
psql --dbname="$target" --tuples-only --no-align --field-separator=' ' <<'SQL'
SELECT format('SELECT %L, count(*) FROM %I.%I', schemaname || '.' || tablename, schemaname, tablename)
FROM pg_tables
WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
ORDER BY schemaname, tablename
\gexec
SQL
psql --dbname="$target" --tuples-only --no-align \
    --command='SELECT '"'"'last migration: '"'"' || max("MigrationId") FROM platform."__EFMigrationsHistory"'
