# Nightly encrypted PostgreSQL backups to off-server object storage, and the matching restore.
# The PostgreSQL client tools come from the same major version as the database; age encrypts and
# rclone uploads to any S3-compatible store (Cloudflare R2, Backblaze B2, Wasabi, AWS S3...).
FROM postgres:18.4-alpine

# The storage remote is configured entirely from RCLONE_CONFIG_OFFSITE_* variables; the empty file
# only stops rclone announcing on every run that it has none.
RUN apk add --no-cache age rclone curl \
    && mkdir -p /root/.config/rclone && touch /root/.config/rclone/rclone.conf

COPY backup.sh restore.sh schedule.sh healthcheck.sh /usr/local/bin/
# Tolerate a Windows checkout: a script with CRLF endings fails with "not found" under sh.
RUN sed -i 's/\r$//' /usr/local/bin/backup.sh /usr/local/bin/restore.sh \
        /usr/local/bin/schedule.sh /usr/local/bin/healthcheck.sh \
    && chmod 0755 /usr/local/bin/backup.sh /usr/local/bin/restore.sh \
        /usr/local/bin/schedule.sh /usr/local/bin/healthcheck.sh

ENTRYPOINT []
CMD ["schedule.sh"]
