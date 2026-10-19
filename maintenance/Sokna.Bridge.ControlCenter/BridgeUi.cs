using System.Drawing;
using System.Drawing.Text;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace Sokna.Bridge.ControlCenter;

// Self-contained design system. Open Font License is embedded in the executable.
// Neither build nor runtime depends on SOKNA Cafe or a font installed on Windows.
internal static class BridgeUi
{
    internal static readonly Color Canvas = Color.FromArgb(248, 249, 247);
    internal static readonly Color Surface = Color.White;
    internal static readonly Color Brand = Color.FromArgb(20, 91, 84);
    internal static readonly Color BrandDark = Color.FromArgb(12, 67, 62);
    internal static readonly Color BrandSoft = Color.FromArgb(234, 245, 242);
    internal static readonly Color Text = Color.FromArgb(33, 42, 41);
    internal static readonly Color Muted = Color.FromArgb(91, 101, 99);
    internal static readonly Color Border = Color.FromArgb(226, 231, 228);
    internal static readonly Color Good = Color.FromArgb(35, 116, 77);
    internal static readonly Color Warning = Color.FromArgb(140, 84, 9);
    internal static readonly Color Danger = Color.FromArgb(164, 53, 53);
    internal static readonly Color DangerSoft = Color.FromArgb(255, 245, 245);

    private static readonly PrivateFontCollection EmbeddedFontCollection = new();
    private static readonly List<GCHandle> FontPins = new();
    private static readonly FontFamily PersianFamily = InitializePersianFont();
    internal static bool EmbeddedPersianFontLoaded { get; private set; }
    internal static bool NativePersianFontRegistered { get; private set; }

    // Native WinForms TextRenderer uses GDI, not the private GDI+ font list.
    [DllImport("gdi32.dll", SetLastError = true)]
    private static extern IntPtr AddFontMemResourceEx(IntPtr pbFont, uint cbFont,
        IntPtr pdv, [In, Out] ref uint pcFonts);


    private static FontFamily InitializePersianFont()
    {
        try
        {
            var assembly = typeof(BridgeUi).Assembly;
            const string path = "Sokna.Bridge.ControlCenter.Fonts.";
            foreach (var name in new[] { "Vazirmatn-Regular.ttf", "Vazirmatn-Bold.ttf" })
            {
                using var resource = assembly.GetManifestResourceStream(path + name)
                    ?? throw new FileNotFoundException("Embedded Persian font missing: " + name);
                using var buffer = new MemoryStream();
                resource.CopyTo(buffer);
                var bytes = buffer.ToArray();
                var handle = GCHandle.Alloc(bytes, GCHandleType.Pinned);
                FontPins.Add(handle); // Both font engines need the bytes until process exit.
                EmbeddedFontCollection.AddMemoryFont(handle.AddrOfPinnedObject(), bytes.Length);
                uint registeredFaces = 0;
                var gdiHandle = AddFontMemResourceEx(handle.AddrOfPinnedObject(),
                    (uint)bytes.Length, IntPtr.Zero, ref registeredFaces);
                if (gdiHandle == IntPtr.Zero || registeredFaces == 0)
                    throw new InvalidOperationException("Vazirmatn unavailable to native GDI text rendering.");
                NativePersianFontRegistered = true;
            }
            var family = EmbeddedFontCollection.Families.FirstOrDefault(f =>
                f.Name.Contains("Vazirmatn", StringComparison.OrdinalIgnoreCase))
                ?? throw new InvalidDataException("Vazirmatn embedded font family not recognized.");
            EmbeddedPersianFontLoaded = true;
            return family;
        }
        catch
        {
            EmbeddedPersianFontLoaded = false;
            NativePersianFontRegistered = false;
            return FontFamily.Families.FirstOrDefault(f =>
                f.Name.Equals("Vazirmatn", StringComparison.OrdinalIgnoreCase))
                ?? new FontFamily("Segoe UI");
        }
    }

    internal static Font Font(float points, FontStyle style = FontStyle.Regular)
    {
        var usableStyle = PersianFamily.IsStyleAvailable(style) ? style : FontStyle.Regular;
        return new Font(PersianFamily, points, usableStyle, GraphicsUnit.Point);
    }

    internal static void Prepare(Form form)
    {
        form.BackColor = Canvas;
        form.ForeColor = Text;
        form.Font = Font(11f);
        form.AutoScaleMode = AutoScaleMode.Dpi;
        form.RightToLeft = RightToLeft.Yes;
        // Mirroring the top-level HWND relocates close/minimize/maximize to the
        // LEFT on Windows. Keep standard window chrome; mirror page content only.
        form.RightToLeftLayout = false;
    }

    internal static void Button(Button button, string kind = "secondary")
    {
        button.UseVisualStyleBackColor = false;
        button.FlatStyle = FlatStyle.Flat;
        button.FlatAppearance.BorderSize = 1;
        button.Font = Font(10.2f, FontStyle.Bold);
        button.Cursor = Cursors.Hand;
        button.AutoSize = true;
        button.MinimumSize = new Size(106, 38);
        button.Padding = new Padding(13, 5, 13, 5);
        button.Margin = new Padding(4, 3, 4, 3);
        button.TextAlign = ContentAlignment.MiddleCenter;
        button.UseCompatibleTextRendering = true;
        if (kind == "primary")
        {
            button.BackColor = Brand;
            button.ForeColor = Color.White;
            button.FlatAppearance.BorderColor = Brand;
        }
        else if (kind == "danger")
        {
            button.BackColor = DangerSoft;
            button.ForeColor = Danger;
            button.FlatAppearance.BorderColor = Color.FromArgb(226, 188, 185);
        }
        else
        {
            button.BackColor = Surface;
            button.ForeColor = BrandDark;
            button.FlatAppearance.BorderColor = Border;
        }
    }

    internal static Label Caption(string text) => new()
    {
        Text = text,
        AutoSize = true,
        ForeColor = Muted,
        Font = Font(10.3f),
        UseCompatibleTextRendering = true,
        Margin = new Padding(3, 4, 3, 7)
    };

    internal static Label FieldLabel(string text) => new()
    {
        Text = text,
        AutoSize = true,
        ForeColor = BrandDark,
        Font = Font(10.5f, FontStyle.Bold),
        UseCompatibleTextRendering = true,
        Margin = new Padding(3, 0, 3, 7)
    };

    internal static void Fields(Control root)
    {
        foreach (Control item in root.Controls)
        {
            // GDI+ is required to paint the private embedded family reliably
            // on native WinForms labels/buttons without falling back to Segoe UI.
            if (item is Label label)
            {
                label.UseCompatibleTextRendering = false;
                if (!label.Font.FontFamily.Name.Contains("Vazirmatn", StringComparison.OrdinalIgnoreCase))
                    label.Font = Font(label.Font.SizeInPoints,
                        label.Font.Bold ? FontStyle.Bold : FontStyle.Regular);
            }
            else if (item is Button action)
            {
                action.UseCompatibleTextRendering = false;
                if (!action.Font.FontFamily.Name.Contains("Vazirmatn", StringComparison.OrdinalIgnoreCase))
                    action.Font = Font(action.Font.SizeInPoints,
                        action.Font.Bold ? FontStyle.Bold : FontStyle.Regular);
            }
            else if (item is CheckBox option)
            {
                option.UseCompatibleTextRendering = false;
                option.Font = Font(option.Font.SizeInPoints);
            }
            if (item is TextBox text)
            {
                text.BorderStyle = BorderStyle.FixedSingle;
                text.BackColor = text.ReadOnly ? Color.FromArgb(251, 251, 250) : Surface;
                text.ForeColor = Text;
                if (!text.Multiline) text.MinimumSize = new Size(0, 33);
            }
            else if (item is ListView list)
            {
                list.BackColor = Surface;
                list.ForeColor = Text;
                list.BorderStyle = BorderStyle.FixedSingle;
                list.HideSelection = false;
                list.Font = Font(10.4f);
            }
            Fields(item);
        }
    }

    internal static double Contrast(Color one, Color two)
    {
        static double Linear(byte b)
        {
            var v = b / 255d;
            return v <= 0.04045 ? v / 12.92 : Math.Pow((v + 0.055) / 1.055, 2.4);
        }
        static double L(Color c) => 0.2126 * Linear(c.R) + 0.7152 * Linear(c.G) + 0.0722 * Linear(c.B);
        var a = L(one); var b = L(two);
        return (Math.Max(a, b) + 0.05) / (Math.Min(a, b) + 0.05);
    }
}
