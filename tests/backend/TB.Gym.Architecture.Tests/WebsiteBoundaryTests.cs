using System.Text.RegularExpressions;

namespace TB.Gym.Architecture.Tests;

/// <summary>
/// What the public website's deployment has to keep (UI plan R6.2g): the Talk-to-us form rate-limited
/// at nginx before the API, the edge sending exactly that path through nginx, and analytics that
/// loads from this origin alone, with the CSP untouched.
/// </summary>
/// <remarks>
/// Asserted on the files a deployment ships rather than on a description of them, as the
/// action-mail boundary tests do for the referrer policy.
/// </remarks>
[TestClass]
public sealed partial class WebsiteBoundaryTests
{
    private const string ContactPath = "/api/website/contact-requests";

    [TestMethod]
    public void NginxRateLimitsTheContactFormByVisitorAddressBeforeTheApi()
    {
        var nginx = ReadRepositoryFile("src", "web", "nginx.conf");

        Assert.Contains(
            "limit_req_zone $binary_remote_addr zone=tb_gym_contact:",
            nginx,
            StringComparison.Ordinal,
            "nginx declares no allowance keyed on the visitor's address for the Talk-to-us form.");
        var location = Block(nginx, $"location = {ContactPath} {{");
        Assert.Contains("limit_req zone=tb_gym_contact", location, StringComparison.Ordinal);
        Assert.Contains("limit_req_status 429;", location, StringComparison.Ordinal);
        Assert.Contains("proxy_pass http://api:8080;", location, StringComparison.Ordinal);

        // Behind the edge every connection comes from one address; the visitor's is forwarded.
        Assert.Contains("set_real_ip_from 172.30.0.10;", nginx, StringComparison.Ordinal);
        Assert.Contains("real_ip_header X-Forwarded-For;", nginx, StringComparison.Ordinal);
    }

    [TestMethod]
    public void TheEdgeSendsOnlyTheContactFormThroughNginx()
    {
        var caddy = ReadRepositoryFile("docker", "caddy", "Caddyfile");

        Assert.Contains($"@contact path {ContactPath}\n", caddy.Replace("\r\n", "\n"), StringComparison.Ordinal);
        Assert.Contains("reverse_proxy web:80", Block(caddy, "handle @contact {"), StringComparison.Ordinal);
        // Before the API block: Caddy keeps handle blocks in file order when a matcher names several paths.
        Assert.IsLessThan(
            caddy.IndexOf("@api path", StringComparison.Ordinal),
            caddy.IndexOf("@contact path", StringComparison.Ordinal),
            "The contact route must come before the API route in the Caddyfile.");

        // And the API trusts the web container as a proxy, at the fixed address the compose file gives it.
        var compose = ReadRepositoryFile("compose.production.yaml");
        Assert.Contains("ReverseProxy__TrustedProxies__1: 172.30.0.11", compose, StringComparison.Ordinal);
        Assert.Contains("ipv4_address: 172.30.0.11", compose, StringComparison.Ordinal);
    }

    [TestMethod]
    public void AnalyticsLoadsFromThisOriginAloneAndTheCspIsUnchanged()
    {
        var nginx = ReadRepositoryFile("src", "web", "nginx.conf");

        // Quoted: nginx reads an unquoted {1,64} in a regex as a block opener.
        Assert.Contains("location ~ \"^/stats/(pa-", nginx, StringComparison.Ordinal, "nginx does not proxy Plausible's site script.");
        var events = Block(nginx, "location = /stats/event {");
        Assert.Contains("https://plausible.io/api/event", events, StringComparison.Ordinal);
        Assert.Contains("X-Forwarded-For $proxy_add_x_forwarded_for", events, StringComparison.Ordinal);
        // The policy that keeps every script and connection on this origin, exactly as before R6.2g.
        Assert.Contains(
            "add_header Content-Security-Policy \"default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' ws: wss:\" always;",
            nginx,
            StringComparison.Ordinal,
            "The CSP changed; analytics must fit inside the same-origin policy, not loosen it.");
        Assert.DoesNotContain("plausible.io", ReadRepositoryFile("src", "web", "src", "index.html"), StringComparison.Ordinal);

        // The settings behind it reach both processes and are off while empty.
        var compose = ReadRepositoryFile("compose.production.yaml");
        foreach (var setting in new[] { "Website__ContactRecipient", "Website__WhatsAppNumber", "Website__Analytics__Script" })
        {
            Assert.Contains(setting + ":", compose, StringComparison.Ordinal, $"{setting} is not passed to the containers.");
        }
    }

    /// <summary>
    /// The signed-out first load (audit A11b): the three pages the build renders ahead of time reach a visitor
    /// only, so a page that arrives pre-rendered need not ask who is signed in (UIQ-13, AUTH-12), and a missing
    /// file answers 404 with the shell, so a crawler is told the address does not exist (AUTH-10).
    /// </summary>
    [TestMethod]
    public void NginxGivesThePrerenderedPagesToVisitorsOnlyAndAMissingFileA404()
    {
        var nginx = ReadRepositoryFile("src", "web", "nginx.conf").Replace("\r\n", "\n");

        var visitor = Block(nginx, "map $http_cookie $tb_gym_visitor {");
        StringAssert.Matches(visitor, new Regex(@"""~\(\^\|;\\s\*\)\(__Host-\)\?tb-gym\\\.auth=""\s+signed-in;"));
        var documents = Block(nginx, "map \"$tb_gym_visitor $uri\" $tb_gym_document {");
        StringAssert.Matches(documents, new Regex(@"default\s+/index\.csr\.html;"));
        foreach (var (address, document) in new[]
        {
            ("/", "/index.html"),
            ("/changelog", "/changelog/index.html"),
            ("/auth/sign-in", "/auth/sign-in/index.html"),
        })
        {
            StringAssert.Matches(documents, new Regex($@"""visitor {Regex.Escape(address)}""\s+{Regex.Escape(document)};"));
            var location = Block(nginx, $"location = {address} {{");
            Assert.Contains("try_files $tb_gym_document =404;", location, StringComparison.Ordinal, address);
            // Chosen afresh on every visit: a copy kept from before signing in must not be shown after.
            Assert.Contains("expires -1;", location, StringComparison.Ordinal, address);
        }

        // Another spelling of a pre-rendered page gets the shell; a missing file is a 404 carrying the shell.
        const string otherSpelling = "location ~ (^|/)index\\.html$|/$ {";
        const string missingFile = "location ~ \\.[A-Za-z0-9]+$ {";
        Assert.Contains("try_files /index.csr.html =404;", Block(nginx, otherSpelling), StringComparison.Ordinal);
        Assert.Contains("try_files $uri =404;", Block(nginx, missingFile), StringComparison.Ordinal);
        Assert.Contains("error_page 404 /index.csr.html;", nginx, StringComparison.Ordinal);
        Assert.DoesNotContain("proxy_intercept_errors", nginx, StringComparison.Ordinal, "The API's own 404s must pass through.");
        // nginx tries regular expressions in the order they are written: both come after every proxied path.
        foreach (var proxied in new[] { "location ~ \"^/stats/(pa-", "location ~ ^/(api|health|hubs|openapi)(/|$) {" })
        {
            Assert.IsLessThan(nginx.IndexOf(otherSpelling, StringComparison.Ordinal), nginx.IndexOf(proxied, StringComparison.Ordinal), proxied);
            Assert.IsLessThan(nginx.IndexOf(missingFile, StringComparison.Ordinal), nginx.IndexOf(proxied, StringComparison.Ordinal), proxied);
        }
    }

    /// <summary>The text from a line that starts a brace block to its closing brace at the same indent.</summary>
    private static string Block(string text, string opener)
    {
        var start = text.IndexOf(opener, StringComparison.Ordinal);
        Assert.IsGreaterThan(-1, start, $"No block starts with '{opener}'.");
        var end = ClosingBrace().Match(text, start + opener.Length);
        Assert.IsTrue(end.Success, $"The block '{opener}' never closes.");
        return text[start..end.Index];
    }

    [GeneratedRegex(@"\r?\n\s*\}")]
    private static partial Regex ClosingBrace();

    private static string ReadRepositoryFile(params string[] parts)
    {
        var path = Path.Combine([RepositoryRoot(), .. parts]);
        Assert.IsTrue(File.Exists(path), $"{path} is missing.");
        return File.ReadAllText(path);
    }

    private static string RepositoryRoot()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "TB.Gym.slnx")))
        {
            directory = directory.Parent;
        }

        Assert.IsNotNull(directory, "The repository root could not be located from the test output directory.");
        return directory.FullName;
    }
}
