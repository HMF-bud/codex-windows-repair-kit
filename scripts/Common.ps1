$ErrorActionPreference = 'Stop'
function Write-KitJson($Path, $Value) {
    [IO.File]::WriteAllText($Path, ($Value | ConvertTo-Json -Depth 12), (New-Object Text.UTF8Encoding($false)))
}
function Get-KitMapping([string]$Drive) {
    if (-not ('KitWindowsMapping' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class KitWindowsMapping {
    [DllImport("mpr.dll", CharSet=CharSet.Unicode)]
    public static extern int WNetGetConnection(string name, StringBuilder remote, ref int size);
}
'@
    }
    $size = 32768
    $buffer = New-Object Text.StringBuilder($size)
    $result = [KitWindowsMapping]::WNetGetConnection($Drive, $buffer, [ref]$size)
    if ($result -ne 0) { throw "Drive $Drive is not mapped in this user session (Windows error $result). Map it first; do not run as another administrator." }
    return $buffer.ToString().TrimEnd('\')
}
function Send-KitEnvironmentNotice {
    if (-not ('KitEnvironmentNotice' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class KitEnvironmentNotice {
    [DllImport("user32.dll", CharSet=CharSet.Unicode)]
    public static extern IntPtr SendMessageTimeout(IntPtr window, uint msg, UIntPtr wp, string lp, uint flags, uint timeout, out UIntPtr result);
}
'@
    }
    $result = [UIntPtr]::Zero
    [void][KitEnvironmentNotice]::SendMessageTimeout([IntPtr]0xffff, 0x001a, [UIntPtr]::Zero, 'Environment', 2, 3000, [ref]$result)
}
