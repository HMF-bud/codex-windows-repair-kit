using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

// Native entry point for CODEX_CLI_PATH. All bytes travel through redirected
// pipes, so closing the desktop connection also closes the adapter connection.
internal static class CodexPathAdapter
{
    [DllImport("mpr.dll", CharSet = CharSet.Unicode)]
    private static extern int WNetGetConnection(string name, StringBuilder remote, ref int size);

    private static async Task Forward(Stream source, Stream destination)
    {
        byte[] buffer = new byte[8192];
        int count;
        while ((count = await source.ReadAsync(buffer, 0, buffer.Length)) != 0)
        {
            await destination.WriteAsync(buffer, 0, count);
            // JSONL messages are smaller than the default pipe buffer. Flush each
            // chunk so initialize and short requests are delivered immediately.
            await destination.FlushAsync();
        }
    }

    private static string Quote(string value)
    {
        var result = new StringBuilder("\"");
        int slashes = 0;
        foreach (char c in value)
        {
            if (c == '\\') { slashes++; continue; }
            result.Append('\\', c == '"' ? slashes * 2 + 1 : slashes);
            result.Append(c);
            slashes = 0;
        }
        result.Append('\\', slashes * 2);
        return result.Append('"').ToString();
    }

    internal static bool UsesStdioAdapter(string[] args)
    {
        int index = 0;
        // The desktop currently puts -c before app-server. Do not mistake a
        // prompt, config value or command argument containing app-server for it.
        while (index < args.Length)
        {
            string arg = args[index];
            if (arg == "-c" || arg == "--config" || arg == "--enable" || arg == "--disable") { index += 2; continue; }
            if (arg.StartsWith("--config=") || (arg.StartsWith("-c") && arg.Length > 2)) { index++; continue; }
            if (arg != "app-server") return false;
            for (int n = index + 1; n < args.Length; n++)
            {
                if (args[n] == "--help" || args[n] == "-h" || args[n] == "daemon" ||
                    args[n] == "generate-ts" || args[n] == "generate-json-schema") return false;
            }
            return true;
        }
        return false;
    }

    private static Dictionary<string, object> ResolveRuntime(string root, bool needNode)
    {
        string powershell = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),
            "WindowsPowerShell", "v1.0", "powershell.exe");
        var info = new ProcessStartInfo(powershell, "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File " +
            Quote(Path.Combine(root, "Resolve-Runtime.ps1")) + (needNode ? " -NeedNode" : ""));
        info.UseShellExecute = false;
        info.CreateNoWindow = true;
        info.RedirectStandardOutput = true;
        info.RedirectStandardError = true;
        info.StandardOutputEncoding = Encoding.UTF8;
        using (var resolver = Process.Start(info))
        {
            Task<string> output = resolver.StandardOutput.ReadToEndAsync();
            Task<string> error = resolver.StandardError.ReadToEndAsync();
            if (!resolver.WaitForExit(20000)) { resolver.Kill(); throw new Exception("Installed package discovery timed out. Use -Rollback."); }
            Task.WaitAll(output, error);
            if (resolver.ExitCode != 0) throw new Exception("Installed package discovery failed: " + error.Result.Trim());
            return new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(output.Result);
        }
    }

    public static int Main(string[] args)
    {
        try
        {
            string root = AppDomain.CurrentDomain.BaseDirectory;
            bool useAdapter = UsesStdioAdapter(args);
            var runtime = ResolveRuntime(root, useAdapter);
            string backend = (string)runtime["backendPath"];
            var arguments = new StringBuilder();
            if (useAdapter) arguments.Append(Quote(Path.Combine(root, "desktop-entry.cjs"))).Append(' ').Append(Quote(backend));
            foreach (string arg in args) arguments.Append(' ').Append(Quote(arg));
            var info = new ProcessStartInfo(useAdapter ? (string)runtime["nodePath"] : backend, arguments.ToString());
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            info.RedirectStandardInput = true;
            info.RedirectStandardOutput = true;
            info.RedirectStandardError = true;
            // Preserve cwd and inherited environment. Set the real CLI identity
            // for children, as the desktop normally does for its original core.
            info.EnvironmentVariables["CODEX_CLI_PATH"] = backend;
            if (useAdapter)
            {
                // The desktop drops this routing hint for custom CLI overrides.
                // Derive it from the OS registration, never from a stale config.
                // It does not grant permissions; the original sandbox still checks them.
                if (!info.EnvironmentVariables.ContainsKey("CODEX_WINDOWS_SANDBOX_PACKAGE_FAMILY"))
                    info.EnvironmentVariables["CODEX_WINDOWS_SANDBOX_PACKAGE_FAMILY"] = (string)runtime["sandboxPackageFamily"];
                var config = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(
                    File.ReadAllText(Path.Combine(root, "..", "local", "startup.json")));
                int size = 32768;
                var share = new StringBuilder(size);
                if (WNetGetConnection((string)config["drive"], share, ref size) == 0)
                    info.EnvironmentVariables["CODEX_PATH_ADAPTER_MAPPED_SHARE"] = share.ToString();
                else
                    info.EnvironmentVariables.Remove("CODEX_PATH_ADAPTER_MAPPED_SHARE");
            }
            using (var child = Process.Start(info))
            {
                // Do not wait for the parent's stdin after the child has exited.
                Task input = Task.Run(async () => {
                    try { await Forward(Console.OpenStandardInput(), child.StandardInput.BaseStream); }
                    catch (IOException) { }
                    finally { try { child.StandardInput.Close(); } catch (InvalidOperationException) { } }
                });
                Task output = Forward(child.StandardOutput.BaseStream, Console.OpenStandardOutput());
                Task error = Forward(child.StandardError.BaseStream, Console.OpenStandardError());
                child.WaitForExit();
                Task.WaitAll(output, error);
                return child.ExitCode;
            }
        }
        catch (Exception error)
        {
            Console.Error.WriteLine("Codex path adapter: " + error.Message);
            return 1;
        }
    }
}
