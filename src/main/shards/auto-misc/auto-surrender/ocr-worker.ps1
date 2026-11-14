$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

function Write-Result($value) {
  [Console]::WriteLine(($value | ConvertTo-Json -Compress -Depth 5))
}

try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  Add-Type -AssemblyName System.Drawing
  $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]
  $null = [Windows.Globalization.Language, Windows.Globalization, ContentType=WindowsRuntime]
  $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
  $null = [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType=WindowsRuntime]
  $null = [Windows.Storage.Streams.DataWriter, Windows.Storage.Streams, ContentType=WindowsRuntime]

  $script:asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and
    $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  } | Select-Object -First 1

  function Await-Operation($operation, [Type]$resultType) {
    $task = $script:asTask.MakeGenericMethod($resultType).Invoke($null, @($operation))
    $task.GetAwaiter().GetResult()
  }

  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage(
    [Windows.Globalization.Language]::new('zh-Hans-CN'))
  if ($null -eq $engine) {
    Write-Result @{ type = 'error'; error = 'ocr-language-unavailable' }
    exit 1
  }

  # This helper owns its DPI context; Electron's process is left untouched.
  Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class AkariSurrenderCapture {
  [StructLayout(LayoutKind.Sequential)] struct Rect { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] struct Point { public int X, Y; }
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
  [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr window, out Rect rect);
  [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr window, ref Point point);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();

  public static Bitmap Capture(double x, double y, double width, double height) {
    var window = GetForegroundWindow();
    uint pid;
    GetWindowThreadProcessId(window, out pid);
    // A window may disappear while Alt-Tab is changing focus.
    try {
      using (var process = Process.GetProcessById((int)pid)) {
        if (!String.Equals(process.ProcessName, "League of Legends", StringComparison.OrdinalIgnoreCase)) return null;
      }
    } catch (ArgumentException) { return null; }
      catch (InvalidOperationException) { return null; }
    Rect rect;
    var origin = new Point();
    if (!GetClientRect(window, out rect) || !ClientToScreen(window, ref origin)) return null;
    int clientWidth = rect.Right - rect.Left, clientHeight = rect.Bottom - rect.Top;
    if (clientWidth <= 0 || clientHeight <= 0) return null;
    int left = (int)(clientWidth * x / 100), top = (int)(clientHeight * y / 100);
    int w = Math.Min(clientWidth - left, Math.Max(1, (int)(clientWidth * width / 100)));
    int h = Math.Min(clientHeight - top, Math.Max(1, (int)(clientHeight * height / 100)));
    var bitmap = new Bitmap(w, h, PixelFormat.Format32bppArgb);
    try {
      using (var graphics = Graphics.FromImage(bitmap)) {
        graphics.CopyFromScreen(origin.X + left, origin.Y + top, 0, 0, bitmap.Size);
      }
      if (GetForegroundWindow() != window) { bitmap.Dispose(); return null; }
      return bitmap;
    } catch { bitmap.Dispose(); throw; }
  }

  public static Bitmap Prepare(Bitmap source, int maxDimension, bool vote) {
    var bitmap = new Bitmap(source.Width, source.Height, PixelFormat.Format32bppArgb);
    using (var graphics = Graphics.FromImage(bitmap)) graphics.DrawImageUnscaled(source, 0, 0);
    var data = bitmap.LockBits(new Rectangle(0, 0, bitmap.Width, bitmap.Height), ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
    try {
      var pixels = new byte[data.Stride * data.Height];
      Marshal.Copy(data.Scan0, pixels, 0, pixels.Length);
      for (int y = 0; y < bitmap.Height; y++) {
        for (int x = 0; x < bitmap.Width; x++) {
          int i = y * data.Stride + x * 4;
          int b = pixels[i], g = pixels[i + 1], r = pixels[i + 2];
          bool yellow = r > 130 && g > 80 && r > b * 1.35 && g > b * 1.2;
          byte value = yellow ? (byte)0 : (byte)255;
          // Preserve the panel's turquoise title; the chat mode filters yellow announcements.
          if (!vote) pixels[i] = pixels[i + 1] = pixels[i + 2] = value;
          pixels[i + 3] = 255;
        }
      }
      Marshal.Copy(pixels, 0, data.Scan0, pixels.Length);
    } finally { bitmap.UnlockBits(data); }
    double scale = Math.Min(2.0, (double)maxDimension / Math.Max(bitmap.Width, bitmap.Height));
    var scaled = new Bitmap(bitmap, Math.Max(1, (int)(bitmap.Width * scale)), Math.Max(1, (int)(bitmap.Height * scale)));
    bitmap.Dispose();
    return scaled;
  }
}
'@
  $null = [AkariSurrenderCapture]::SetProcessDPIAware()
  Write-Result @{ type = 'ready' }
} catch {
  Write-Result @{ type = 'error'; error = 'ocr-initialization-failed' }
  exit 1
}

while ($null -ne ($line = [Console]::ReadLine())) {
  $request = $null
  $bitmap = $null
  $prepared = $null
  $memory = $null
  $randomAccess = $null
  $softwareBitmap = $null
  $writer = $null
  try {
    $request = $line | ConvertFrom-Json
    $timer = [Diagnostics.Stopwatch]::StartNew()
    if ($request.image) {
      $inputStream = [IO.MemoryStream]::new([Convert]::FromBase64String($request.image))
      try {
        $image = [Drawing.Bitmap]::new($inputStream)
        try { $bitmap = [Drawing.Bitmap]::new($image) } finally { $image.Dispose() }
      } finally { $inputStream.Dispose() }
    } else {
      $region = $request.region
      $bitmap = [AkariSurrenderCapture]::Capture($region.x, $region.y, $region.width, $region.height)
    }
    if ($null -eq $bitmap) {
      Write-Result @{ id = $request.id; type = 'result'; text = ''; skipped = $true; durationMs = 0 }
      continue
    }
    $prepared = [AkariSurrenderCapture]::Prepare($bitmap, [Windows.Media.Ocr.OcrEngine]::MaxImageDimension, ($request.mode -eq 'vote'))
    $memory = [IO.MemoryStream]::new()
    $prepared.Save($memory, [Drawing.Imaging.ImageFormat]::Png)
    $randomAccess = [Windows.Storage.Streams.InMemoryRandomAccessStream]::new()
    $writer = [Windows.Storage.Streams.DataWriter]::new($randomAccess)
    $writer.WriteBytes($memory.ToArray())
    $null = Await-Operation $writer.StoreAsync() ([uint32])
    $null = $writer.DetachStream()
    $randomAccess.Seek(0)
    $decoder = Await-Operation ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($randomAccess)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $softwareBitmap = Await-Operation $decoder.GetSoftwareBitmapAsync() ([Windows.Graphics.Imaging.SoftwareBitmap])
    $result = Await-Operation $engine.RecognizeAsync($softwareBitmap) ([Windows.Media.Ocr.OcrResult])
    Write-Result @{ id = $request.id; type = 'result'; text = $result.Text; durationMs = $timer.ElapsedMilliseconds; skipped = $false }
  } catch {
    Write-Result @{ id = $request.id; type = 'error'; error = 'ocr-scan-failed' }
  } finally {
    foreach ($resource in @($writer, $softwareBitmap, $randomAccess, $memory, $prepared, $bitmap)) {
      if ($null -ne $resource) { $resource.Dispose() }
    }
  }
}
