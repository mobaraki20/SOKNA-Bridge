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
    internal static readonly Color Canvas = Color.FromArgb(247, 246, 243);
    internal static readonly Color Surface = Color.White;
    internal static readonly Color Brand = Color.FromArgb(20, 91, 84);
    internal static readonly Color BrandDark = Color.FromArgb(12, 67, 62);
    internal static readonly Color BrandSoft = Color.FromArgb(234, 245, 242);
    internal static readonly Color Text = Color.FromArgb(33, 42, 41);
    internal static readonly Color Muted = Color.FromArgb(91, 101, 99);
    internal static readonly Color Border = Color.FromArgb(216, 222, 220);
    internal static readonly Color Good = Color.FromArgb(35, 116, 77);
    internal static readonly Color Warning = Color.FromArgb(140, 84, 9);
    internal static readonly Color Danger = Color.FromArgb(164, 53, 53);
    internal static readonly Color DangerSoft = Color.FromArgb(255, 245, 245);

    private static readonly PrivateFontCollection EmbeddedFontCollection = new();
    private static readonly List<GCHandle> FontPins = new();
    private static readonly FontFamily PersianFamily = InitializePersianFont();
    internal static bool EmbeddedPersianFontLoaded { get; private set; }

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
                FontPins.Add(handle); // Retained until process exit: AddMemoryFont needs live bytes.
                EmbeddedFontCollection.AddMemoryFont(handle.AddrOfPinnedObject(), bytes.Length);
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
        form.RightToLeftLayout = true;
    }

    internal static void Button(Button button, string kind = "secondary")
    {
        button.UseVisualStyleBackColor = false;
        button.FlatStyle = FlatStyle.Flat;
        button.FlatAppearance.BorderSize = 1;
        button.Font = Font(10.2f, FontStyle.Bold);
        button.Cursor = Cursors.Hand;
        button.AutoSize = true;
        button.MinimumSize = new Size(110, 42);
        button.Padding = new Padding(12, 5, 12, 5);
        button.Margin = new Padding(5);
        button.TextAlign = ContentAlignment.MiddleCenter;
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
        Margin = new Padding(3, 4, 3, 7)
    };

    internal static Label FieldLabel(string text) => new()
    {
        Text = text,
        AutoSize = true,
        ForeColor = BrandDark,
        Font = Font(10.5f, FontStyle.Bold),
        Margin = new Padding(3, 0, 3, 7)
    };

    internal static void Fields(Control root)
    {
        foreach (Control item in root.Controls)
        {
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
