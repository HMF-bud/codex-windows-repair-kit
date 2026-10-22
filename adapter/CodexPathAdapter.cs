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

    public static int Main(string[] args)
    {
        try
        {
            string root = AppDomain.CurrentDomain.BaseDirectory;
            var config = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(
                File.ReadAllText(Path.Combine(root, "..", "local", "startup.json")));
            var arguments = new StringBuilder(Quote(Path.Combine(root, "desktop-entry.cjs")));
            foreach (string arg in args) arguments.Append(' ').Append(Quote(arg));
            var info = new ProcessStartInfo((string)config["nodePath"], arguments.ToString());
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            info.RedirectStandardInput = true;
            info.RedirectStandardOutput = true;
            info.RedirectStandardError = true;
            int size = 32768;
            var share = new StringBuilder(size);
            if (WNetGetConnection((string)config["drive"], share, ref size) == 0)
                info.EnvironmentVariables["CODEX_PATH_ADAPTER_MAPPED_SHARE"] = share.ToString();
            else
                info.EnvironmentVariables.Remove("CODEX_PATH_ADAPTER_MAPPED_SHARE");
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
