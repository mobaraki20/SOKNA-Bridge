using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;

namespace Sokna.Bridge.ControlCenter;

// A single reusable surface style for every content card. Rounded clipping is
// deliberate: hand-drawn borders alone leave bright rectangular WinForms corners.
internal sealed class BridgeSurfaceCard : TableLayoutPanel
{
    private const int Radius = 11;
    internal BridgeSurfaceCard()
    {
        DoubleBuffered = true;
        BackColor = BridgeUi.Surface;
        SetStyle(ControlStyles.ResizeRedraw | ControlStyles.AllPaintingInWmPaint |
                 ControlStyles.OptimizedDoubleBuffer, true);
    }

    protected override void OnResize(EventArgs e)
    {
        base.OnResize(e);
        if (Width < Radius * 2 || Height < Radius * 2) return;
        using var path = Rounded(new Rectangle(0, 0, Width - 1, Height - 1), Radius);
        var old = Region;
        Region = new Region(path);
        old?.Dispose();
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        if (Width < Radius * 2 || Height < Radius * 2) return;
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        using var outline = new Pen(BridgeUi.Border, 1f);
        using var path = Rounded(new Rectangle(0, 0, Width - 1, Height - 1), Radius);
        e.Graphics.DrawPath(outline, path);
    }

    private static GraphicsPath Rounded(Rectangle rect, int r)
    {
        var path = new GraphicsPath();
        var d = r * 2;
        path.AddArc(rect.Left, rect.Top, d, d, 180, 90);
        path.AddArc(rect.Right - d, rect.Top, d, d, 270, 90);
        path.AddArc(rect.Right - d, rect.Bottom - d, d, d, 0, 90);
        path.AddArc(rect.Left, rect.Bottom - d, d, d, 90, 90);
        path.CloseFigure();
        return path;
    }
}
