using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.Windows.Forms;

namespace Sokna.Bridge.ControlCenter;

// Native ListView selection, keyboard navigation and accessibility are
// preserved; only the legacy grid chrome/text paint is replaced.
internal sealed class BridgeDataList : ListView
{
    private static readonly Color Alternate = Color.FromArgb(249, 251, 249);
    private static readonly Color Selected = Color.FromArgb(227, 242, 236);

    internal BridgeDataList()
    {
        OwnerDraw = true;
        DoubleBuffered = true;
        ShowItemToolTips = true;
        FullRowSelect = true;
        MultiSelect = false;
        RightToLeft = RightToLeft.Yes;
        RightToLeftLayout = true;
        GridLines = false;
        BorderStyle = BorderStyle.FixedSingle;
        HeaderStyle = ColumnHeaderStyle.Nonclickable;
        BackColor = BridgeUi.Surface;
        ForeColor = BridgeUi.Text;
        Font = BridgeUi.Font(10.5f);
        // The image list determines detail-row height while rows have no icons.
        SmallImageList = new ImageList { ImageSize = new Size(1, 35), ColorDepth = ColorDepth.Depth32Bit };
    }

    protected override void OnDrawColumnHeader(DrawListViewColumnHeaderEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;
        using var bg = new SolidBrush(BridgeUi.BrandSoft);
        g.FillRectangle(bg, e.Bounds);
        using var line = new Pen(BridgeUi.Border);
        g.DrawLine(line, e.Bounds.Left, e.Bounds.Bottom - 1,
            e.Bounds.Right, e.Bounds.Bottom - 1);
        var technical = e.Header.Text is "مسیر" or "شناسه";
        using var ink = new SolidBrush(BridgeUi.BrandDark);
        using var f = BridgeUi.Font(10.3f, FontStyle.Bold);
        using var format = Format(!technical);
        var inset = Rectangle.Inflate(e.Bounds, -8, -2);
        DrawUnmirrored(g, e.Header.Text, f, ink, inset, format);
    }

    protected override void OnDrawItem(DrawListViewItemEventArgs e)
    {
        // Details view paints individual cells in OnDrawSubItem.
        if (View != View.Details) e.DrawDefault = true;
    }

    protected override void OnDrawSubItem(DrawListViewSubItemEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;
        using var bg = new SolidBrush(e.Item.Selected ? Selected :
            e.ItemIndex % 2 == 0 ? BridgeUi.Surface : Alternate);
        g.FillRectangle(bg, e.Bounds);
        using var separator = new Pen(BridgeUi.Border);
        g.DrawLine(separator, e.Bounds.Left, e.Bounds.Bottom - 1,
            e.Bounds.Right, e.Bounds.Bottom - 1);
        var content = e.SubItem.Text ?? "";
        // Paths, codes and account IDs retain natural left-to-right flow.
        var leftToRight = content.Contains(":\\", StringComparison.Ordinal) ||
            (content.Any(ch => ch >= 'A' && ch <= 'Z' || ch >= 'a' && ch <= 'z') &&
             !content.Any(ch => ch >= '\u0600' && ch <= '\u06FF'));
        using var ink = new SolidBrush(BridgeUi.Text);
        using var f = BridgeUi.Font(10.5f);
        using var format = Format(!leftToRight);
        var inset = Rectangle.Inflate(e.Bounds, -8, -3);
        DrawUnmirrored(g, content, f, ink, inset, format);
    }

    // RightToLeftLayout mirrors the native list HWND and therefore the
    // GDI drawing context. GDI+ DrawString otherwise paints each glyph
    // backwards even when the font and unicode contents are valid.
    private static void DrawUnmirrored(Graphics g, string value, Font font,
        Brush brush, Rectangle bounds, StringFormat format)
    {
        var state = g.Save();
        g.TranslateTransform(bounds.Left + bounds.Right, 0);
        g.ScaleTransform(-1f, 1f);
        g.DrawString(value, font, brush, bounds, format);
        g.Restore(state);
    }

    private static StringFormat Format(bool rtl)
    {
        var f = new StringFormat
        {
            Alignment = rtl ? StringAlignment.Far : StringAlignment.Near,
            LineAlignment = StringAlignment.Center,
            Trimming = StringTrimming.EllipsisCharacter,
            FormatFlags = StringFormatFlags.NoWrap
        };
        if (rtl) f.FormatFlags |= StringFormatFlags.DirectionRightToLeft;
        return f;
    }
}
