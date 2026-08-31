using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Npgsql;
using TB.Gym.Infrastructure.Application;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Media;

namespace TB.Gym.Api.IntegrationTests;

public sealed partial class Phase3TrainingWorkflowTests
{
    [TestMethod]
    public void Phase6CheckInConflictsRequireTheExpectedDatabaseConstraint()
    {
        var expected = Phase6UniqueViolation(DatabaseConstraintNames.OneCheckInResponsePerAssignment);
        var unrelated = Phase6UniqueViolation("IX_Unrelated_Unique_Key");

        Assert.IsTrue(CheckInResponseApplicationService.IsConstraintViolation(
            expected,
            DatabaseConstraintNames.OneCheckInResponsePerAssignment));
        Assert.IsFalse(CheckInResponseApplicationService.IsConstraintViolation(
            unrelated,
            DatabaseConstraintNames.OneCheckInResponsePerAssignment));
    }

    [TestMethod]
    public void Phase6ProgressPhotoConflictsRequireTheExpectedDatabaseConstraint()
    {
        var expected = Phase6UniqueViolation(DatabaseConstraintNames.OneProgressPhotoPerDateAndPose);
        var unrelated = Phase6UniqueViolation("IX_Unrelated_Unique_Key");

        Assert.IsTrue(ProgressApplicationService.IsProgressPhotoDuplicate(expected));
        Assert.IsFalse(ProgressApplicationService.IsProgressPhotoDuplicate(unrelated));
    }

    [TestMethod]
    public void Phase6DecodeAdmissionIsProcessWideAcrossTenants()
    {
        using var gate = new MediaUploadConcurrencyGate(Options.Create(new MediaStorageOptions
        {
            MaxConcurrentProgressPhotoDecodes = 2,
        }));

        using var firstTenantDecode = gate.TryEnterProgressPhotoDecode();
        using var secondTenantDecode = gate.TryEnterProgressPhotoDecode();
        Assert.IsNotNull(firstTenantDecode);
        Assert.IsNotNull(secondTenantDecode);
        Assert.IsNull(gate.TryEnterProgressPhotoDecode(), "A third tenant bypassed the process cap.");

        firstTenantDecode.Dispose();
        using var admittedAfterRelease = gate.TryEnterProgressPhotoDecode();
        Assert.IsNotNull(admittedAfterRelease);
    }

    [TestMethod]
    public void Phase6ProcessDecodeAdmissionDoesNotWeakenPerTenantUploadAdmission()
    {
        using var gate = new MediaUploadConcurrencyGate(Options.Create(new MediaStorageOptions()));
        var tenantA = Guid.NewGuid();
        var tenantB = Guid.NewGuid();

        using var tenantAUpload = gate.TryEnter(tenantA);
        Assert.IsNotNull(tenantAUpload);
        Assert.IsNull(gate.TryEnter(tenantA), "The existing per-tenant serialization was weakened.");
        using var tenantBUpload = gate.TryEnter(tenantB);
        Assert.IsNotNull(tenantBUpload);
    }

    private static DbUpdateException Phase6UniqueViolation(string constraintName) =>
        new(
            "The database rejected the write.",
            new PostgresException(
                "duplicate key value violates unique constraint",
                "ERROR",
                "ERROR",
                PostgresErrorCodes.UniqueViolation,
                detail: null,
                hint: null,
                position: 0,
                internalPosition: 0,
                internalQuery: null,
                where: null,
                schemaName: null,
                tableName: null,
                columnName: null,
                dataTypeName: null,
                constraintName,
                file: null,
                line: null,
                routine: null));
}
