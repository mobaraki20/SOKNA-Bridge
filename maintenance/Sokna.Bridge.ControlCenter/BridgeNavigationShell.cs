using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.Windows.Forms;

namespace Sokna.Bridge.ControlCenter;

// A real application shell, not repainted native tabs. Page contents and their
// existing agent/workspace/credential workflows are intentionally unchanged.
internal sealed class BridgeNavigationShell : UserControl
{
    private static readonly Color Sidebar = Color.FromArgb(19, 72, 68);
    private static readonly Color SidebarActive = Color.FromArgb(43, 111, 101);
    private static readonly Color SidebarSecondary = Color.FromArgb(181, 211, 202);
    private readonly List<Panel> _pages;
    private readonly List<NavigationItem> _navigation = [];
    private readonly Panel _viewport;
    private readonly Label _pageTitle;
    private readonly Label _pageHint;
    internal int SelectedIndex { get; private set; } = -1;
    internal Panel CurrentPage => _pages[SelectedIndex];
    internal IReadOnlyList<Panel> Pages => _pages;

    internal BridgeNavigationShell(IEnumerable<Panel> pages)
    {
        _pages = pages.ToList();
        Dock = DockStyle.Fill;
        BackColor = BridgeUi.Canvas;
        RightToLeft = RightToLeft.No;
        Font = BridgeUi.Font(11f);
        var shell = new TableLayoutPanel
        {
            Dock = DockStyle.Fill, RightToLeft = RightToLeft.No, Margin = Padding.Empty,
            Padding = Padding.Empty, ColumnCount = 2, RowCount = 1,
            BackColor = BridgeUi.Canvas
        };
        shell.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        shell.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 212));

        var primary = new TableLayoutPanel
        {
            Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 2,
            RightToLeft = RightToLeft.No, Padding = Padding.Empty, Margin = Padding.Empty,
            BackColor = BridgeUi.Canvas
        };
        primary.RowStyles.Add(new RowStyle(SizeType.Absolute, 76));
        primary.RowStyles.Add(new RowStyle(SizeType.Percent, 100));

        var header = new Panel { Dock = DockStyle.Fill, BackColor = BridgeUi.Surface };
        header.Paint += (_, e) =>
        {
            using var pen = new Pen(BridgeUi.Border);
            e.Graphics.DrawLine(pen, 0, header.Height - 1, header.Width, header.Height - 1);
        };
        _pageTitle = new Label
        {
            AutoSize = false, Height = 30, Dock = DockStyle.Top,
            TextAlign = ContentAlignment.MiddleRight, RightToLeft = RightToLeft.Yes,
            UseCompatibleTextRendering = true,
            Font = BridgeUi.Font(15.5f, FontStyle.Bold),
            ForeColor = BridgeUi.BrandDark,
            Margin = Padding.Empty, Padding = new Padding(0, 2, 0, 0)
        };
        _pageHint = new Label
        {
            AutoSize = false, Height = 23, Dock = DockStyle.Top,
            TextAlign = ContentAlignment.MiddleRight, RightToLeft = RightToLeft.Yes,
            UseCompatibleTextRendering = true,
            Font = BridgeUi.Font(9.7f),
            ForeColor = BridgeUi.Muted
        };
        var heading = new Panel { Dock = DockStyle.Fill, Padding = new Padding(22, 12, 22, 6) };
        // DockStyle.Top stacks in reverse z-order.
        heading.Controls.Add(_pageHint);
        heading.Controls.Add(_pageTitle);
        header.Controls.Add(heading);

        _viewport = new Panel
        {
            Dock = DockStyle.Fill, BackColor = BridgeUi.Canvas, Padding = Padding.Empty
        };
        foreach (var page in _pages)
        {
            page.Dock = DockStyle.Fill;
            page.Visible = false;
            page.Margin = Padding.Empty;
            _viewport.Controls.Add(page);
        }

        primary.Controls.Add(header, 0, 0);
        primary.Controls.Add(_viewport, 0, 1);

        var sidebar = new TableLayoutPanel
        {
            Dock = DockStyle.Fill, RightToLeft = RightToLeft.No,
            BackColor = Sidebar, ColumnCount = 1, RowCount = 3,
            Margin = Padding.Empty, Padding = Padding.Empty
        };
        sidebar.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        sidebar.RowStyles.Add(new RowStyle(SizeType.Absolute, 119));
        sidebar.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        sidebar.RowStyles.Add(new RowStyle(SizeType.Absolute, 65));

        var brand = new Panel { Dock = DockStyle.Fill, BackColor = Sidebar,
            Padding = new Padding(19, 18, 19, 6) };
        var english = new Label
        {
            Text = "SOKNA  /  BRIDGE", AutoSize = false, Dock = DockStyle.Top,
            Height = 24, TextAlign = ContentAlignment.MiddleRight,
            Font = BridgeUi.Font(10f, FontStyle.Bold),
            UseCompatibleTextRendering = true,
            ForeColor = SidebarSecondary
        };
        var persian = new Label
        {
            Text = "بریج سکنا", Dock = DockStyle.Top, Height = 44,
            TextAlign = ContentAlignment.MiddleRight,
            RightToLeft = RightToLeft.Yes,
            Font = BridgeUi.Font(18.5f, FontStyle.Bold),
            UseCompatibleTextRendering = true, ForeColor = Color.White
        };
        var description = new Label
        {
            Text = "مرکز مدیریت و دسترسی", Dock = DockStyle.Top, Height = 24,
            TextAlign = ContentAlignment.MiddleRight, RightToLeft = RightToLeft.Yes,
            Font = BridgeUi.Font(10f), UseCompatibleTextRendering = true,
            ForeColor = SidebarSecondary
        };
        brand.Controls.Add(description);
        brand.Controls.Add(persian);
        brand.Controls.Add(english);

        var menu = new TableLayoutPanel
        {
            Dock = DockStyle.Top, Height = 308, ColumnCount = 1,
            RowCount = _pages.Count, Margin = Padding.Empty,
            Padding = new Padding(8, 2, 8, 2), RightToLeft = RightToLeft.No,
            BackColor = Sidebar
        };
        menu.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        for (var i = 0; i < _pages.Count; i++)
        {
            menu.RowStyles.Add(new RowStyle(SizeType.Absolute, 49));
            var item = new NavigationItem(_pages[i].Text, i, SidebarActive, SidebarSecondary);
            item.Dock = DockStyle.Fill;
            item.Margin = new Padding(4, 3, 4, 3);
            var index = i;
            item.Click += (_, _) => SelectPage(index);
            menu.Controls.Add(item, 0, i);
            _navigation.Add(item);
        }
        var menuPanel = new Panel { Dock = DockStyle.Fill, BackColor = Sidebar };
        menuPanel.Controls.Add(menu);

        var bottom = new Panel { Dock = DockStyle.Fill, BackColor = Sidebar,
            Padding = new Padding(18, 12, 18, 9) };
        bottom.Paint += (_, e) =>
        {
            using var stroke = new Pen(Color.FromArgb(73, 122, 113));
            e.Graphics.DrawLine(stroke, 18, 0, bottom.Width - 18, 0);
        };
        var foot = new Label
        {
            Text = "راهنمای شروع و اتصال",
            Dock = DockStyle.Fill, ForeColor = SidebarSecondary,
            Font = BridgeUi.Font(10f),
            RightToLeft = RightToLeft.Yes, UseCompatibleTextRendering = true,
            TextAlign = ContentAlignment.MiddleRight
        };
        bottom.Controls.Add(foot);

        sidebar.Controls.Add(brand, 0, 0);
        sidebar.Controls.Add(menuPanel, 0, 1);
        sidebar.Controls.Add(bottom, 0, 2);
        shell.Controls.Add(primary, 0, 0);
        shell.Controls.Add(sidebar, 1, 0);
        Controls.Add(shell);
        if (_pages.Count > 0) SelectPage(0);
    }

    internal void SelectPage(int index)
    {
        if (index < 0 || index >= _pages.Count) throw new ArgumentOutOfRangeException(nameof(index));
        foreach (var page in _pages) page.Visible = false;
        SelectedIndex = index;
        _pages[index].Visible = true;
        _pages[index].BringToFront();
        _pageTitle.Text = _pages[index].Text switch
        {
            "وضعیت" => "وضعیت و کنترل",
            "فضاهای کاری" => "مدیریت فضاهای کاری",
            "اعتبارنامه‌ها" => "اطلاعات دسترسی",
            "تنظیمات" => "تنظیمات برنامه",
            "عیب‌یابی" => "عیب‌یابی و پشتیبانی",
            _ => "راهنمای راه‌اندازی"
        };
        _pageHint.Text = index switch
        {
            0 => "وضعیت ارتباط و عملیات اصلی ایجنت",
            1 => "پوشه‌ها و محدودهٔ دسترسی بریج",
            2 => "حفاظت و مدیریت اطلاعات ورود",
            3 => "اتصال محلی و محل نگهداری فایل‌ها",
            4 => "بررسی خطاها و تهیهٔ گزارش پشتیبانی",
            _ => "گام‌های اتصال بریج به مرورگر و گفتگو"
        };
        foreach (var nav in _navigation)
        {
            nav.IsSelected = nav.PageIndex == index;
            nav.Invalidate();
        }
        _viewport.PerformLayout();
    }

    private sealed class NavigationItem : Control
    {
        private readonly Color _selectedBackground;
        private readonly Color _mutedText;
        private bool _hover;
        internal int PageIndex { get; }
        internal bool IsSelected { get; set; }
        internal NavigationItem(string title, int index, Color selectedBackground, Color mutedText)
        {
            Text = title;
            PageIndex = index;
            _selectedBackground = selectedBackground;
            _mutedText = mutedText;
            Font = BridgeUi.Font(11.2f);
            DoubleBuffered = true;
            Cursor = Cursors.Hand;
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint |
                ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        }
        protected override void OnMouseEnter(EventArgs e)
        {
            base.OnMouseEnter(e); _hover = true; Invalidate();
        }
        protected override void OnMouseLeave(EventArgs e)
        {
            base.OnMouseLeave(e); _hover = false; Invalidate();
        }
        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
            var rect = new Rectangle(0, 0, Width - 1, Height - 1);
            if (IsSelected || _hover)
            {
                using var path = RoundedRect(rect, 10);
                using var bg = new SolidBrush(IsSelected ? _selectedBackground :
                    Color.FromArgb(29, 88, 82));
                g.FillPath(bg, path);
            }
            if (IsSelected)
            {
                using var indicator = new SolidBrush(Color.FromArgb(187, 224, 200));
                g.FillRectangle(indicator, Width - 5, 10, 3, Math.Max(0, Height - 20));
            }
            using var ink = new SolidBrush(IsSelected ? Color.White : _mutedText);
            using var f = BridgeUi.Font(11.2f, IsSelected ? FontStyle.Bold : FontStyle.Regular);
            using var fmt = new StringFormat
            {
                Alignment = StringAlignment.Far, LineAlignment = StringAlignment.Center,
                FormatFlags = StringFormatFlags.DirectionRightToLeft
            };
            g.DrawString(Text, f, ink, new RectangleF(15, 0, Width - 30, Height), fmt);
        }
        private static GraphicsPath RoundedRect(Rectangle bounds, int radius)
        {
            var path = new GraphicsPath();
            var d = radius * 2;
            path.AddArc(bounds.Left, bounds.Top, d, d, 180, 90);
            path.AddArc(bounds.Right - d, bounds.Top, d, d, 270, 90);
            path.AddArc(bounds.Right - d, bounds.Bottom - d, d, d, 0, 90);
            path.AddArc(bounds.Left, bounds.Bottom - d, d, d, 90, 90);
            path.CloseFigure();
            return path;
        }
    }
}
