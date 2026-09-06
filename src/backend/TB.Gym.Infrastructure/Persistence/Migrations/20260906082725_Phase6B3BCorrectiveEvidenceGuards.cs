using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class Phase6B3BCorrectiveEvidenceGuards : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION identity.assert_account_action_mail_token_minted()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    IF OLD."Status" = 'Processing' AND NEW."Status" = 'Materialized'
                       AND NOT EXISTS (
                           SELECT 1 FROM identity."ActionMailAttempts" a
                           WHERE a."RequestId" = OLD."Id"
                             AND a."ClaimToken" = OLD."ClaimToken"
                             AND a."AttemptNumber" = NEW."AttemptCount"
                             AND a."TokenMintedAtUtc" IS NOT NULL) THEN
                        RAISE EXCEPTION 'An account action mail request cannot be materialized before its token mint is recorded' USING ERRCODE = '23514';
                    END IF;
                    RETURN NEW;
                END;
                $function$;

                CREATE TRIGGER assert_account_action_mail_token_minted
                BEFORE UPDATE ON identity."ActionMailRequests"
                FOR EACH ROW EXECUTE FUNCTION identity.assert_account_action_mail_token_minted();

                CREATE OR REPLACE FUNCTION identity.assert_successful_account_action_mail_attempt_minted()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    IF OLD."Outcome" = 'Started' AND NEW."Outcome" = 'Succeeded'
                       AND NEW."TokenMintedAtUtc" IS NULL THEN
                        RAISE EXCEPTION 'A successful account action mail attempt must record its token mint first' USING ERRCODE = '23514';
                    END IF;
                    RETURN NEW;
                END;
                $function$;

                CREATE TRIGGER assert_successful_account_action_mail_attempt_minted
                BEFORE UPDATE ON identity."ActionMailAttempts"
                FOR EACH ROW EXECUTE FUNCTION identity.assert_successful_account_action_mail_attempt_minted();
                """);

            migrationBuilder.Sql(ProviderEvidenceGuards);

        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                DROP TRIGGER IF EXISTS assert_successful_account_action_mail_attempt_minted ON identity."ActionMailAttempts";
                DROP FUNCTION IF EXISTS identity.assert_successful_account_action_mail_attempt_minted();
                DROP TRIGGER IF EXISTS assert_account_action_mail_token_minted ON identity."ActionMailRequests";
                DROP FUNCTION IF EXISTS identity.assert_account_action_mail_token_minted();

                DROP TRIGGER IF EXISTS assert_provider_event_bookkeeping_from_event ON notifications."ProviderEvents";
                DROP TRIGGER IF EXISTS assert_provider_event_bookkeeping_from_message ON notifications."ProviderMessages";
                DROP FUNCTION IF EXISTS notifications.assert_provider_event_bookkeeping();
                """);

            migrationBuilder.Sql(OriginalProviderEvidenceGuards);

        }

        private const string ProviderEvidenceGuards =
            """
            CREATE OR REPLACE FUNCTION notifications.assert_provider_event_bookkeeping()
            RETURNS trigger LANGUAGE plpgsql AS $function$
            DECLARE
                message_id uuid;
                tenant_id uuid;
                message notifications."ProviderMessages"%ROWTYPE;
                actual_count integer;
                actual_last timestamptz;
            BEGIN
                IF TG_TABLE_NAME = 'ProviderEvents' THEN
                    message_id := NEW."ProviderMessageRecordId";
                    tenant_id := NEW."TenantId";
                ELSE
                    message_id := NEW."Id";
                    tenant_id := NEW."TenantId";
                END IF;
                SELECT * INTO message FROM notifications."ProviderMessages" m
                WHERE m."TenantId" = tenant_id AND m."Id" = message_id;
                SELECT count(*)::integer, max(e."ReceivedAtUtc") INTO actual_count, actual_last
                FROM notifications."ProviderEvents" e
                WHERE e."TenantId" = tenant_id AND e."ProviderMessageRecordId" = message_id;
                IF message."Id" IS NULL OR message."EventCount" <> actual_count
                   OR message."LastEventReceivedAtUtc" IS DISTINCT FROM actual_last THEN
                    RAISE EXCEPTION 'Provider message event bookkeeping must equal its append-only event history' USING ERRCODE = '23514';
                END IF;
                RETURN NULL;
            END;
            $function$;

            CREATE CONSTRAINT TRIGGER assert_provider_event_bookkeeping_from_message
            AFTER INSERT OR UPDATE ON notifications."ProviderMessages"
            DEFERRABLE INITIALLY DEFERRED
            FOR EACH ROW EXECUTE FUNCTION notifications.assert_provider_event_bookkeeping();
            CREATE CONSTRAINT TRIGGER assert_provider_event_bookkeeping_from_event
            AFTER INSERT ON notifications."ProviderEvents"
            DEFERRABLE INITIALLY DEFERRED
            FOR EACH ROW EXECUTE FUNCTION notifications.assert_provider_event_bookkeeping();

            CREATE OR REPLACE FUNCTION notifications.assert_provider_event_fact()
            RETURNS trigger LANGUAGE plpgsql AS $function$
            DECLARE
                message notifications."ProviderMessages"%ROWTYPE;
                matching_fact boolean;
            BEGIN
                SELECT * INTO message FROM notifications."ProviderMessages" m
                WHERE m."TenantId" = NEW."TenantId" AND m."Id" = NEW."ProviderMessageRecordId";
                IF NOT FOUND OR message."Adapter" <> NEW."Adapter" THEN
                    RAISE EXCEPTION 'Provider evidence must describe a provider message accepted by the same adapter and workspace' USING ERRCODE = '23514';
                END IF;

                matching_fact := CASE NEW."EventType"
                    WHEN 'RecipientServerAccepted' THEN message."RecipientServerAcceptedAtUtc" = NEW."OccurredAtUtc"
                    WHEN 'Bounced' THEN message."BouncedAtUtc" = NEW."OccurredAtUtc" AND message."BounceClass" = NEW."BounceClass"
                    WHEN 'Complained' THEN message."ComplainedAtUtc" = NEW."OccurredAtUtc"
                    WHEN 'DeliveryDelayed' THEN message."DelayedAtUtc" = NEW."OccurredAtUtc"
                    WHEN 'Failed' THEN message."FailedAtUtc" = NEW."OccurredAtUtc" AND message."FailureCode" = NEW."FailureCode"
                    WHEN 'ProviderSuppressed' THEN message."ProviderSuppressedAtUtc" = NEW."OccurredAtUtc"
                    WHEN 'ProviderAccepted' THEN false
                    ELSE false
                END;

                IF NEW."AppliedNewFact" AND NOT COALESCE(matching_fact, false) THEN
                    RAISE EXCEPTION 'A provider event marked as a new fact must exactly match the fact recorded on its message' USING ERRCODE = '23514';
                END IF;
                IF NOT NEW."AppliedNewFact" AND NEW."EventType" <> 'ProviderAccepted' AND NOT EXISTS (
                    SELECT 1 FROM notifications."ProviderEvents" e
                    WHERE e."TenantId" = NEW."TenantId"
                      AND e."ProviderMessageRecordId" = NEW."ProviderMessageRecordId"
                      AND e."EventType" = NEW."EventType"
                      AND e."AppliedNewFact"
                      AND e."Id" <> NEW."Id") THEN
                    RAISE EXCEPTION 'A restated provider fact requires the earlier event that established it' USING ERRCODE = '23514';
                END IF;
                RETURN NULL;
            END;
            $function$;

            CREATE OR REPLACE FUNCTION notifications.assert_email_suppression_evidence()
            RETURNS trigger LANGUAGE plpgsql AS $function$
            DECLARE
                message notifications."ProviderMessages"%ROWTYPE;
                evidence notifications."ProviderEvents"%ROWTYPE;
            BEGIN
                SELECT * INTO message FROM notifications."ProviderMessages" m
                WHERE m."TenantId" = NEW."TenantId" AND m."Id" = NEW."SourceProviderMessageId";
                SELECT * INTO evidence FROM notifications."ProviderEvents" e
                WHERE e."TenantId" = NEW."TenantId" AND e."Id" = NEW."SourceProviderEventId";
                IF message."Id" IS NULL OR evidence."Id" IS NULL
                   OR evidence."ProviderMessageRecordId" <> message."Id"
                   OR NOT evidence."AppliedNewFact"
                   OR NEW."SuppressedAtUtc" <> evidence."ReceivedAtUtc" THEN
                    RAISE EXCEPTION 'A suppression must name the exact newly applied event that established it' USING ERRCODE = '23514';
                END IF;
                IF message."RecipientUserId" <> NEW."UserId"
                   OR message."RecipientAddressFingerprint" <> NEW."AddressFingerprint"
                   OR message."FingerprintKeyId" <> NEW."FingerprintKeyId" THEN
                    RAISE EXCEPTION 'A suppression applies to the exact member and mailbox its evidence was sent to' USING ERRCODE = '23514';
                END IF;
                IF NOT (
                    (NEW."Reason" = 'PermanentBounce' AND evidence."EventType" = 'Bounced' AND evidence."BounceClass" = 'Permanent')
                    OR (NEW."Reason" = 'Complaint' AND evidence."EventType" = 'Complained')
                    OR (NEW."Reason" = 'ProviderSuppressed' AND evidence."EventType" = 'ProviderSuppressed')) THEN
                    RAISE EXCEPTION 'A suppression reason must match the verified event that caused it' USING ERRCODE = '23514';
                END IF;
                RETURN NULL;
            END;
            $function$;
            """;

        private const string OriginalProviderEvidenceGuards =
            """
            CREATE OR REPLACE FUNCTION notifications.assert_provider_event_fact()
            RETURNS trigger LANGUAGE plpgsql AS $function$
            DECLARE message notifications."ProviderMessages"%ROWTYPE;
            BEGIN
                SELECT * INTO message FROM notifications."ProviderMessages" m
                WHERE m."TenantId" = NEW."TenantId" AND m."Id" = NEW."ProviderMessageRecordId";
                IF NOT FOUND OR message."Adapter" <> NEW."Adapter" THEN
                    RAISE EXCEPTION 'Provider evidence must describe a provider message of the same workspace' USING ERRCODE = '23514';
                END IF;
                IF NEW."AppliedNewFact" AND NOT (
                    (NEW."EventType" = 'RecipientServerAccepted' AND message."RecipientServerAcceptedAtUtc" IS NOT NULL)
                    OR (NEW."EventType" = 'Bounced' AND message."BouncedAtUtc" IS NOT NULL AND message."BounceClass" = NEW."BounceClass")
                    OR (NEW."EventType" = 'Complained' AND message."ComplainedAtUtc" IS NOT NULL)
                    OR (NEW."EventType" = 'DeliveryDelayed' AND message."DelayedAtUtc" IS NOT NULL)
                    OR (NEW."EventType" = 'Failed' AND message."FailedAtUtc" IS NOT NULL)
                    OR (NEW."EventType" = 'ProviderSuppressed' AND message."ProviderSuppressedAtUtc" IS NOT NULL)) THEN
                    RAISE EXCEPTION 'A provider event that claims a new fact must have recorded it on its message' USING ERRCODE = '23514';
                END IF;
                IF NEW."AppliedNewFact" AND NEW."EventType" = 'ProviderAccepted' THEN
                    RAISE EXCEPTION 'A provider acceptance event establishes no new fact' USING ERRCODE = '23514';
                END IF;
                RETURN NULL;
            END;
            $function$;

            CREATE OR REPLACE FUNCTION notifications.assert_email_suppression_evidence()
            RETURNS trigger LANGUAGE plpgsql AS $function$
            DECLARE
                message notifications."ProviderMessages"%ROWTYPE;
                evidence notifications."ProviderEvents"%ROWTYPE;
            BEGIN
                SELECT * INTO message FROM notifications."ProviderMessages" m
                WHERE m."TenantId" = NEW."TenantId" AND m."Id" = NEW."SourceProviderMessageId";
                SELECT * INTO evidence FROM notifications."ProviderEvents" e
                WHERE e."TenantId" = NEW."TenantId" AND e."Id" = NEW."SourceProviderEventId";
                IF message."Id" IS NULL OR evidence."Id" IS NULL OR evidence."ProviderMessageRecordId" <> message."Id" THEN
                    RAISE EXCEPTION 'A suppression must name the event that established it, on its own message' USING ERRCODE = '23514';
                END IF;
                IF message."RecipientUserId" <> NEW."UserId"
                   OR message."RecipientAddressFingerprint" <> NEW."AddressFingerprint"
                   OR message."FingerprintKeyId" <> NEW."FingerprintKeyId" THEN
                    RAISE EXCEPTION 'A suppression applies to the exact member and mailbox its evidence was sent to' USING ERRCODE = '23514';
                END IF;
                IF NOT (
                    (NEW."Reason" = 'PermanentBounce' AND evidence."EventType" = 'Bounced' AND evidence."BounceClass" = 'Permanent')
                    OR (NEW."Reason" = 'Complaint' AND evidence."EventType" = 'Complained')
                    OR (NEW."Reason" = 'ProviderSuppressed' AND evidence."EventType" = 'ProviderSuppressed')) THEN
                    RAISE EXCEPTION 'A suppression reason must match the verified event that caused it' USING ERRCODE = '23514';
                END IF;
                RETURN NULL;
            END;
            $function$;
            """;
    }
}
