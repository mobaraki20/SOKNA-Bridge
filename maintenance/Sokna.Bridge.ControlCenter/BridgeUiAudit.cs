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
            foreach (var size in new[] { new Size(840, 560), new Size(960, 600), new Size(1100, 660), new Size(1280, 720) })
            {
                using var form = new MainForm(layoutTestMode: true)
                {
                    StartPosition = FormStartPosition.Manual,
                    Location = new Point(15, 15),
                    // An outer 960x600 window must be imaged as 960x600; using
                    // ClientSize here used to crop the bottom 30px titlebar offset.
                    Size = size
                };
                form.Show();
                if (!form.Font.FontFamily.Name.Contains("Vazirmatn", StringComparison.OrdinalIgnoreCase))
                    problems.Add("actual-form-font-is-not-vazirmatn");
                Application.DoEvents();
                var footer = Descendants(form).OfType<Label>()
                    .FirstOrDefault(x => x.Text == "راهنمای شروع و اتصال");
                var viewport = form.RectangleToScreen(form.ClientRectangle);
                if (footer is null)
                    problems.Add("missing-sidebar-footer");
                else if (footer.RectangleToScreen(footer.ClientRectangle).Bottom > viewport.Bottom)
                    problems.Add("sidebar-footer-cut-by-window-height");
                // Ensure standard native caption placement, not the mirrored HWND
                // which moves close/maximize/minimize to the left in Windows.
                if (form.RightToLeftLayout || form.RightToLeft != RightToLeft.Yes)
                    problems.Add("window-caption-native-rtl-mirroring-regression");
                var navigation = Descendants(form).OfType<BridgeNavigationShell>().SingleOrDefault();
                if (navigation is null || form.AuditPages.Count != 6)
                    problems.Add("missing-custom-persian-navigation-shell");
                for (var i = 0; i < form.AuditPages.Count; i++)
                {
                    form.SelectAuditPage(i);
                    form.PerformLayout();
                    Application.DoEvents();
                    var page = form.ActiveAuditPage;
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
                    if (i == 3)
                    {
                        if (size.Width == 840)
                        {
                            var save = Descendants(page).OfType<Button>().FirstOrDefault(x =>
                                x.Text == "ذخیرهٔ تنظیمات و راه‌اندازی مجدد");
                            var pageBounds = page.RectangleToScreen(page.ClientRectangle);
                            if (save is null ||
                                save.RectangleToScreen(save.ClientRectangle).Bottom > pageBounds.Bottom - 4)
                                problems.Add(title + ":settings-save-hidden-on-minimum-window");
                        }
                        var portField = Descendants(page).FirstOrDefault(x => x.Name == "BridgePortField");
                        var artifactField = Descendants(page).FirstOrDefault(x => x.Name == "BridgeArtifactField");
                        if (portField is null || artifactField is null ||
                            portField.Height < 60 || artifactField.Height < 65)
                            problems.Add(title + ":inconsistent-settings-field-layout");
                        else if (Math.Abs(portField.Left - artifactField.Left) > 12 ||
                                 Math.Abs(portField.Width - artifactField.Width) > 20)
                            problems.Add(title + ":settings-fields-have-different-horizontal-grid");
                    }
                    if (i == 0)
                    {
                        var actionCard = Descendants(page).FirstOrDefault(c => c.Name == "BridgeAgentActionsCard");
                        var detailsCard = Descendants(page).FirstOrDefault(c => c.Name == "BridgeAgentDetailsCard");
                        var actionButton = Descendants(page).OfType<Button>()
                            .FirstOrDefault(button => button.Text == "تازه‌سازی");
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
                        if (actionCard is not null)
                        {
                            var cardBounds = actionCard.RectangleToScreen(actionCard.ClientRectangle);
                            foreach (var action in Descendants(actionCard).OfType<Button>())
                            {
                                var bounds = action.RectangleToScreen(action.ClientRectangle);
                                if (!action.Visible || bounds.Left < cardBounds.Left + 3 ||
                                    bounds.Right > cardBounds.Right - 3 ||
                                    bounds.Top < cardBounds.Top ||
                                    bounds.Bottom > cardBounds.Bottom - 3)
                                    problems.Add(title + ":lifecycle-action-clipped:" + action.Text);
                            }
                        }
                        var start = Descendants(page).OfType<Button>()
                            .FirstOrDefault(x => x.Text == "شروع");
                        var stop = Descendants(page).OfType<Button>()
                            .FirstOrDefault(x => x.Text == "توقف");
                        var restart = Descendants(page).OfType<Button>()
                            .FirstOrDefault(x => x.Text == "راه‌اندازی مجدد");
                        if (start is null || stop is null || restart is null)
                            problems.Add(title + ":missing-lifecycle-controls");
                        else
                        {
                            form.SetAuditAgentReachability(null);
                            if (start.Enabled || stop.Enabled || restart.Enabled)
                                problems.Add(title + ":unknown-agent-state-allows-actions");
                            form.SetAuditAgentReachability(false);
                            if (!start.Enabled || stop.Enabled || restart.Enabled)
                                problems.Add(title + ":offline-agent-actions-incorrect");
                            form.SetAuditAgentReachability(true);
                            if (start.Enabled || !stop.Enabled || !restart.Enabled)
                                problems.Add(title + ":online-agent-actions-incorrect");
                            form.SetAuditAgentReachability(null);
                        }
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
                if (size.Width == 960)
                {
                    form.ApplyVisualAuditFixtures();
                    foreach (var index in new[] { 0, 1, 2, 4 })
                    {
                        form.SelectAuditPage(index);
                        form.PerformLayout();
                        Application.DoEvents();
                        problems.AddRange(Check(form.ActiveAuditPage).Select(issue =>
                            $"960x600-populated-tab{index + 1}:" + issue));
                        using var populated = new Bitmap(size.Width, size.Height, PixelFormat.Format32bppArgb);
                        form.DrawToBitmap(populated, new Rectangle(Point.Empty, size));
                        populated.Save(Path.Combine(output,
                            $"960x600-populated-tab{index + 1}.png"), ImageFormat.Png);
                    }
                }
                form.ShowLayoutError();
                form.SelectAuditPage(0);
                form.PerformLayout();
                Application.DoEvents();
                problems.AddRange(Check(form.ActiveAuditPage).Select(issue =>
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
                if (fixture.name == "workspace-dialog" && dialog.ClientSize.Height > 510)
                    problems.Add("workspace-dialog-excessive-height");
                if (fixture.name == "credential-dialog" && dialog.ClientSize.Height > 445)
                    problems.Add("credential-dialog-excessive-height");
                if (dialog.RightToLeftLayout)
                    problems.Add(fixture.name + ":caption-buttons-mirrored-left");
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
            Console.WriteLine("BRIDGE_CONTROL_CENTER_SIDEBAR_GUI_34_SCREENSHOTS_PASS");
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
            if (control is Button fontButton && !fontButton.Font.FontFamily.Name.Contains("Vazirmatn", StringComparison.OrdinalIgnoreCase))
                yield return "button-not-persian-font:" + fontButton.Name;
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
