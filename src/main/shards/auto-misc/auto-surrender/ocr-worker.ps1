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

  static Rectangle RegionBounds(int width, int height, double[] region) {
    int left = (int)(width * region[0] / 100), top = (int)(height * region[1] / 100);
    int w = Math.Min(width - left, Math.Max(1, (int)(width * region[2] / 100)));
    int h = Math.Min(height - top, Math.Max(1, (int)(height * region[3] / 100)));
    return new Rectangle(left, top, w, h);
  }

  static Bitmap[] Crop(Bitmap source, Rectangle chat, Rectangle panel) {
    var chatBitmap = source.Clone(chat, PixelFormat.Format32bppArgb);
    try {
      return new[] { chatBitmap, source.Clone(panel, PixelFormat.Format32bppArgb) };
    } catch { chatBitmap.Dispose(); throw; }
  }

  // Image-file smoke checks use the same pixel bounds and cropping as live capture.
  public static Bitmap[] Crop(Bitmap source, double[] chat, double[] panel) {
    return Crop(source, RegionBounds(source.Width, source.Height, chat), RegionBounds(source.Width, source.Height, panel));
  }

  public static Bitmap[] Capture(double[] chat, double[] panel) {
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
    var chatBounds = RegionBounds(clientWidth, clientHeight, chat);
    var panelBounds = RegionBounds(clientWidth, clientHeight, panel);
    var captureBounds = Rectangle.Union(chatBounds, panelBounds);
    // One screen read for both regions; default regions only copy the bottom half.
    using (var bitmap = new Bitmap(captureBounds.Width, captureBounds.Height, PixelFormat.Format32bppArgb)) {
      using (var graphics = Graphics.FromImage(bitmap)) {
        graphics.CopyFromScreen(origin.X + captureBounds.Left, origin.Y + captureBounds.Top, 0, 0, bitmap.Size);
      }
      if (GetForegroundWindow() != window) return null;
      chatBounds.Offset(-captureBounds.Left, -captureBounds.Top);
      panelBounds.Offset(-captureBounds.Left, -captureBounds.Top);
      return Crop(bitmap, chatBounds, panelBounds);
    }
  }

  public static Bitmap Prepare(Bitmap source, int maxDimension, bool vote) {
    // Each crop is owned by this request and recognized once; preprocess it in place.
    var bitmap = source;
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

function Read-BitmapText([Drawing.Bitmap]$bitmap, [bool]$vote) {
  $prepared = $null
  $memory = $null
  $randomAccess = $null
  $softwareBitmap = $null
  $writer = $null
  try {
    $prepared = [AkariSurrenderCapture]::Prepare($bitmap, [Windows.Media.Ocr.OcrEngine]::MaxImageDimension, $vote)
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
    return $result.Text
  } finally {
    foreach ($resource in @($writer, $softwareBitmap, $randomAccess, $memory, $prepared)) {
      if ($null -ne $resource) { $resource.Dispose() }
    }
  }
}

while ($null -ne ($line = [Console]::ReadLine())) {
  $request = $null
  $bitmaps = $null
  try {
    $request = $line | ConvertFrom-Json
    $timer = [Diagnostics.Stopwatch]::StartNew()
    $chat = $request.regions.chat
    $panel = $request.regions.panel
    $chatBounds = [double[]]@($chat.x, $chat.y, $chat.width, $chat.height)
    $panelBounds = [double[]]@($panel.x, $panel.y, $panel.width, $panel.height)
    if ($request.image) {
      $inputStream = [IO.MemoryStream]::new([Convert]::FromBase64String($request.image))
      try {
        $image = [Drawing.Bitmap]::new($inputStream)
        try { $bitmaps = [AkariSurrenderCapture]::Crop($image, $chatBounds, $panelBounds) }
        finally { $image.Dispose() }
      } finally { $inputStream.Dispose() }
    } else {
      $bitmaps = [AkariSurrenderCapture]::Capture($chatBounds, $panelBounds)
    }
    if ($null -eq $bitmaps) {
      Write-Result @{ id = $request.id; type = 'result'; chatText = ''; panelText = ''; skipped = $true; durationMs = 0 }
      continue
    }
    # Recognize distinct crops from the same capture, with each region's existing preprocessing.
    $panelText = Read-BitmapText $bitmaps[1] $true
    $chatText = Read-BitmapText $bitmaps[0] $false
    Write-Result @{ id = $request.id; type = 'result'; chatText = $chatText; panelText = $panelText; durationMs = $timer.ElapsedMilliseconds; skipped = $false }
  } catch {
    Write-Result @{ id = $request.id; type = 'error'; error = 'ocr-scan-failed' }
  } finally {
    foreach ($bitmap in $bitmaps) {
      if ($null -ne $bitmap) { $bitmap.Dispose() }
    }
  }
}
