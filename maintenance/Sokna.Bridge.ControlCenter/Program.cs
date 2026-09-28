using System.Text.Json;
using System.Text.Json.Nodes;

namespace Sokna.Bridge.ControlCenter;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Contains("--self-test", StringComparer.OrdinalIgnoreCase))
            return SelfTest(args);

        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new MainForm());
        return 0;
    }

    private static int SelfTest(string[] args)
    {
        try
        {
            var root = GetArg(args, "--install-root") ?? AppContext.BaseDirectory;
            root = Path.GetFullPath(root);
            var output = GetArg(args, "--output");
            var configPath = Path.Combine(root, "config.json");
            var manifestPath = Path.Combine(root, "manifests", "installed-manifest.json");
            var extensionPath = Path.Combine(root, "extension", "manifest.json");
            var ok = File.Exists(configPath) && File.Exists(manifestPath) && File.Exists(extensionPath);
            var result = new
            {
                ok,
                schema = "sokna-control-center-self-test-v1",
                install_root = root,
                config = File.Exists(configPath),
                manifest = File.Exists(manifestPath),
                extension = File.Exists(extensionPath)
            };
            if (!string.IsNullOrWhiteSpace(output))
                File.WriteAllText(Path.GetFullPath(output), JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true }));
            return ok ? 0 : 2;
        }
        catch { return 10; }
    }

    private static string? GetArg(string[] args, string key)
    {
        for (var i = 0; i < args.Length - 1; i++)
            if (string.Equals(args[i], key, StringComparison.OrdinalIgnoreCase))
                return args[i + 1];
        return null;
    }
}
