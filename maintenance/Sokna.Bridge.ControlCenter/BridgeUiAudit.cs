using System.Drawing;
using System.Drawing.Imaging;
using System.Windows.Forms;

namespace Sokna.Bridge.ControlCenter;

internal static class BridgeUiAudit
{
    // Runs real production WinForms entrypoint with mocked-only visual state:
    // no automatic environment refresh, no dangerous lifecycle or credential actions.
    internal static int Run(string output)
    {
        try
        {
            Directory.CreateDirectory(output);
            var screen = Screen.PrimaryScreen?.Bounds ?? Rectangle.Empty;
            File.WriteAllText(Path.Combine(output, "screen-coverage.txt"),
                $"Actual Windows runner desktop: {screen.Width}x{screen.Height}. " +
                "Screenshots larger than this desktop may be clipped by the real WinForms " +
                "paint API even when geometry and layout assertions pass.\n");
            var problems = new List<string>();
            using (var font = BridgeUi.Font(11f))
            {
                File.WriteAllText(Path.Combine(output, "persian-font-evidence.txt"),
                    $"embedded={BridgeUi.EmbeddedPersianFontLoaded}; native_gdi={BridgeUi.NativePersianFontRegistered}; family={font.FontFamily.Name}; " +
                    $"size={font.SizeInPoints}\n");
                if (!BridgeUi.EmbeddedPersianFontLoaded || !BridgeUi.NativePersianFontRegistered ||
                    !font.FontFamily.Name.Contains("Vazirmatn", StringComparison.OrdinalIgnoreCase))
                    problems.Add("missing-required-embedded-vazirmatn");
            }
            if (BridgeUi.Contrast(BridgeUi.Brand, Color.White) < 4.5 ||
                BridgeUi.Contrast(BridgeUi.Text, BridgeUi.Surface) < 4.5 ||
                BridgeUi.Contrast(BridgeUi.Danger, BridgeUi.DangerSoft) < 4.5)
                problems.Add("palette-contrast-below-4.5");
            foreach (var size in new[] { new Size(960, 600), new Size(1100, 660), new Size(1280, 720) })
            {
                using var form = new MainForm(layoutTestMode: true)
                {
                    StartPosition = FormStartPosition.Manual,
                    Location = new Point(15, 15),
                    ClientSize = size
                };
                form.Show();
                if (!form.Font.FontFamily.Name.Contains("Vazirmatn", StringComparison.OrdinalIgnoreCase))
                    problems.Add("actual-form-font-is-not-vazirmatn");
                Application.DoEvents();
                var tabs = form.Controls.OfType<TabControl>().Single();
                if (tabs.DrawMode != TabDrawMode.OwnerDrawFixed || tabs.ItemSize.Height < 42)
                    problems.Add("navigation-not-custom-painted-or-too-small");
                for (var i = 0; i < tabs.TabPages.Count; i++)
                {
                    tabs.SelectedIndex = i;
                    form.PerformLayout();
                    Application.DoEvents();
                    var page = tabs.TabPages[i];
                    var title = $"{size.Width}x{size.Height}-tab{i + 1}";
                    // A scrollable page is intentional at 960x600; horizontal
                    // overflow and action/control clipping are never intentional.
                    if (i == 0)
                    {
                        var statusCard = Descendants(page).OfType<TableLayoutPanel>()
                            .FirstOrDefault(table => table.Name == "BridgeAgentHealthCard");
                        var measuredWidth = statusCard?.Width ?? 0;
                        File.WriteAllText(Path.Combine(output, title + "-card-metrics.txt"),
                            $"Page: {page.ClientSize.Width}x{page.ClientSize.Height}; Card: {measuredWidth}; " +
                            $"ratio={(page.ClientSize.Width == 0 ? 0 : (double)measuredWidth / page.ClientSize.Width):F3}\n");
                        if (statusCard is null || measuredWidth < page.ClientSize.Width * 0.72)
                            problems.Add(title + $":dashboard-card-does-not-fill-available-width (card={measuredWidth},page={page.ClientSize.Width})");
                    }
                    if (i is 1 or 2 or 4)
                    {
                        var emptyState = Descendants(page).OfType<Label>()
                            .FirstOrDefault(label => label.Visible &&
                                label.Text.Contains("هنوز", StringComparison.Ordinal));
                        if (emptyState is null)
                            problems.Add(title + ":empty-state-invisible");
                        else if (i is 1 or 2 && (emptyState.Dock != DockStyle.Top ||
                                 emptyState.Height > 170 || emptyState.BackColor != BridgeUi.BrandSoft))
                            problems.Add(title + ":empty-state-not-compact-actionable-card");
                    }
                    if (i == 0)
                    {
                        var actionCard = Descendants(page).FirstOrDefault(c => c.Name == "BridgeAgentActionsCard");
                        var detailsCard = Descendants(page).FirstOrDefault(c => c.Name == "BridgeAgentDetailsCard");
                        var actionButton = Descendants(page).OfType<Button>()
                            .FirstOrDefault(button => button.Text == "تازه‌سازی وضعیت");
                        var pageBounds = page.RectangleToScreen(page.ClientRectangle);
                        var buttonBounds = actionButton is null ? Rectangle.Empty :
                            actionButton.RectangleToScreen(actionButton.ClientRectangle);
                        File.WriteAllText(Path.Combine(output, title + "-action-visibility.txt"),
                            $"page={pageBounds}; actionCard={actionCard?.Bounds}; " +
                            $"detailsCard={detailsCard?.Bounds}; actionButton={buttonBounds}\\n");
                        if (actionButton is null || !actionButton.Visible ||
                            buttonBounds.Top < pageBounds.Top ||
                            buttonBounds.Bottom > pageBounds.Bottom - 4)
                            problems.Add(title + ":primary-operator-actions-outside-visible-viewport");
                        if (actionCard is null || detailsCard is null)
                            problems.Add(title + ":missing-dashboard-action-or-details-card");
                        if (actionCard is { Height: > 180 })
                            problems.Add(title + $":oversized-empty-action-card:{actionCard.Height}px");
                    }
                    var issues = Check(page).ToArray();
                    File.WriteAllLines(Path.Combine(output, title + ".txt"),
                        issues.Length == 0 ? ["PASS"] : issues);
                    problems.AddRange(issues.Select(issue => title + ":" + issue));
                    using var bitmap = new Bitmap(size.Width, size.Height, PixelFormat.Format32bppArgb);
                    form.DrawToBitmap(bitmap, new Rectangle(Point.Empty, size));
                    bitmap.Save(Path.Combine(output, title + ".png"), ImageFormat.Png);
                    var step = Math.Max(1, Math.Min(size.Width, size.Height) / 180);
                    var nonCanvas = 0;
                    for (var y = 0; y < size.Height; y += step)
                    for (var x = 0; x < size.Width; x += step)
                    {
                        var c = bitmap.GetPixel(x, y);
                        if (Math.Abs(c.R - BridgeUi.Canvas.R) > 10 ||
                            Math.Abs(c.G - BridgeUi.Canvas.G) > 10 ||
                            Math.Abs(c.B - BridgeUi.Canvas.B) > 10)
                            nonCanvas++;
                    }
                    if (nonCanvas < 250) problems.Add(title + ":empty-painted-bitmap");
                }
                form.ShowLayoutError();
                tabs.SelectedIndex = 0;
                form.PerformLayout();
                Application.DoEvents();
                problems.AddRange(Check(tabs.TabPages[0]).Select(issue =>
                    $"{size.Width}x{size.Height}-error:" + issue));
                using (var errorImage = new Bitmap(size.Width, size.Height, PixelFormat.Format32bppArgb))
                {
                    form.DrawToBitmap(errorImage, new Rectangle(Point.Empty, size));
                    errorImage.Save(Path.Combine(output, $"{size.Width}x{size.Height}-error.png"), ImageFormat.Png);
                }
                form.Hide();
            }
            foreach (var fixture in new (string name, Func<Form> factory)[]
            {
                ("workspace-dialog", () => new WorkspaceDialog()),
                ("credential-dialog", () => new CredentialDialog())
            })
            {
                using var dialog = fixture.factory();
                dialog.StartPosition = FormStartPosition.Manual;
                dialog.Location = new Point(20, 20);
                dialog.Show();
                Application.DoEvents();
                problems.AddRange(Check(dialog).Select(issue => fixture.name + ":" + issue));
                using var image = new Bitmap(dialog.Width, dialog.Height, PixelFormat.Format32bppArgb);
                dialog.DrawToBitmap(image, new Rectangle(Point.Empty, image.Size));
                image.Save(Path.Combine(output, fixture.name + ".png"), ImageFormat.Png);
                dialog.Hide();
            }
            File.WriteAllLines(Path.Combine(output, "layout-audit.txt"),
                problems.Count == 0 ? ["PASS"] : problems);
            if (problems.Count != 0)
            {
                foreach (var problem in problems) Console.Error.WriteLine("BRIDGE_UI_AUDIT: " + problem);
                return 1;
            }
            Console.WriteLine("BRIDGE_CONTROL_CENTER_REAL_PAINTED_UI_23_SCREENSHOTS_PASS");
            Console.WriteLine("BRIDGE_UI_CONTRAST_BIDI_LAYOUT_STATIC_GATES_PASS");
            return 0;
        }
        catch (Exception ex)
        {
            try { File.WriteAllText(Path.Combine(output, "layout-audit-error.txt"), ex.ToString()); } catch { }
            Console.Error.WriteLine(ex);
            return 1;
        }
    }

    private static IEnumerable<string> Check(Control root)
    {
        foreach (var control in Descendants(root))
        {
            if (!control.Visible) continue;
            if (control.Width <= 0 || control.Height <= 0) yield return "zero-size:" + control.Name;
            if (control is Button button && !button.Font.FontFamily.Name.Contains("Vazirmatn", StringComparison.OrdinalIgnoreCase))
                yield return "button-not-persian-font:" + button.Name;
            if (control is Label paintedLabel &&
                !paintedLabel.Font.FontFamily.Name.Contains("Vazirmatn", StringComparison.OrdinalIgnoreCase))
                yield return "label-not-persian-font:" + paintedLabel.Name;
            if (control is Button button && button.ClientSize.Width + 4 < button.PreferredSize.Width)
                yield return "button-clipped:" + button.Text;
            if (control is Button shortButton && shortButton.ClientSize.Height + 4 < shortButton.PreferredSize.Height)
                yield return "button-height-clipped:" + shortButton.Text;
            if (control is Label label && !label.AutoSize && !label.AutoEllipsis &&
                label.PreferredSize.Height > label.ClientSize.Height + 5)
                yield return "label-height-clipped:" + label.Text;
            if (control is FlowLayoutPanel flow && flow.FlowDirection == FlowDirection.TopDown &&
                flow.AutoScroll && flow.HorizontalScroll.Visible)
                yield return "unexpected-horizontal-scroll";
        }
    }

    private static IEnumerable<Control> Descendants(Control root)
    {
        foreach (Control child in root.Controls)
        {
            yield return child;
            foreach (var nested in Descendants(child)) yield return nested;
        }
    }
}
