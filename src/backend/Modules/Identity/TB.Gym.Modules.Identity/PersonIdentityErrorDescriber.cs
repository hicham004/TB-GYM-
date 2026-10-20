using Microsoft.AspNetCore.Identity;

namespace TB.Gym.Modules.Identity;

/// <summary>
/// ASP.NET Identity's refusals in TB Gym's own words (audit AUTH-6): a password that misses a rule says
/// what to add, a spent link says so instead of "Invalid token.", and a wrong current password is not
/// "Incorrect password.". The codes stay Identity's, so callers can still tell the refusals apart.
/// </summary>
public sealed class PersonIdentityErrorDescriber : IdentityErrorDescriber
{
    public override IdentityError PasswordTooShort(int length) =>
        Describe(nameof(PasswordTooShort), $"Use at least {length} characters.");

    public override IdentityError PasswordRequiresDigit() =>
        Describe(nameof(PasswordRequiresDigit), "Add a number.");

    public override IdentityError PasswordRequiresLower() =>
        Describe(nameof(PasswordRequiresLower), "Add a lowercase letter.");

    public override IdentityError PasswordRequiresUpper() =>
        Describe(nameof(PasswordRequiresUpper), "Add a capital letter.");

    public override IdentityError PasswordRequiresNonAlphanumeric() =>
        Describe(nameof(PasswordRequiresNonAlphanumeric), "Add a symbol, such as ! or #.");

    public override IdentityError PasswordRequiresUniqueChars(int uniqueChars) =>
        Describe(nameof(PasswordRequiresUniqueChars), $"Use at least {uniqueChars} different characters.");

    public override IdentityError PasswordMismatch() =>
        Describe(nameof(PasswordMismatch), "Your current password isn't right.");

    public override IdentityError InvalidToken() =>
        Describe(nameof(InvalidToken), "This link has expired or was already used.");

    public override IdentityError DuplicateEmail(string email) =>
        Describe(nameof(DuplicateEmail), "An account already uses this email.");

    public override IdentityError DuplicateUserName(string userName) =>
        Describe(nameof(DuplicateUserName), "An account already uses this email.");

    public override IdentityError InvalidEmail(string? email) =>
        Describe(nameof(InvalidEmail), "Enter a valid email address.");

    public override IdentityError InvalidUserName(string? userName) =>
        Describe(nameof(InvalidUserName), "Enter a valid email address.");

    public override IdentityError ConcurrencyFailure() =>
        Describe(nameof(ConcurrencyFailure), "Your account changed at the same moment. Try again.");

    public override IdentityError DefaultError() =>
        Describe(nameof(DefaultError), "That didn't work. Try again.");

    private static IdentityError Describe(string code, string description) =>
        new() { Code = code, Description = description };
}
